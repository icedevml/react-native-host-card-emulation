package com.itsecrnd.rtnhceandroid;

import android.app.Application;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.VisibleForTesting;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.facebook.react.jstasks.HeadlessJsTaskContext;

import java.util.UUID;

/**
 * Process-wide state machine of the HCE interactions. The single source of truth for:
 * - the foreground session (created by the JS app through beginSession());
 * - the current activation, i.e. the link with the reader since the first C-APDU until deactivation.
 * <p>
 * All methods are synchronized, as they're called from the main thread (HostApduService callbacks,
 * headless task lifecycle) and from the JS thread (module methods). None of them blocks on the
 * other thread: event emission and sendResponseApdu() are both asynchronous.
 */
final class HCEManager {
    private static final String TAG = "HCEManager";

    static final String BACKGROUND_TASK_KEY = "handleBackgroundHCECall";
    // must match KEEP_ALIVE_TASK_KEY in js/session.ts
    static final String KEEP_ALIVE_TASK_KEY = "keepAliveHCESession";
    // <meta-data> of HCEService in the app's AndroidManifest.xml, see isBackgroundHandlerEnabled()
    static final String BACKGROUND_HANDLER_META_DATA = "com.itsecrnd.rtnhceandroid.background_handler_enabled";

    // ISO 7816-4: file or application not found (response to SELECT that can't be served)
    private static final byte[] SW_APPLICATION_NOT_FOUND = {(byte) 0x6A, (byte) 0x82};
    // ISO 7816-4: conditions of use not satisfied (response to other commands that can't be served)
    private static final byte[] SW_CONDITIONS_NOT_SATISFIED = {(byte) 0x69, (byte) 0x85};
    // ISO 7816-4: no precise diagnosis (internal error)
    static final byte[] SW_NO_PRECISE_DIAGNOSIS = {(byte) 0x6F, (byte) 0x00};

    /*
     How long a background interaction may wait for React Native to start and for the JS side to declare
     whether it has a background handler. Generous, as a cold start on a slow device might take a while.
     */
    private static final long ROUTING_TIMEOUT_MS = 15_000;

    private static final HCEManager INSTANCE = new HCEManager(HCEManager::startHeadlessJsTask);

    static HCEManager getInstance() {
        return INSTANCE;
    }

    /**
     * The part of HCEService that HCEManager uses (implemented by HostApduService's own final methods),
     * replaced in the tests.
     */
    interface ApduService {
        void sendResponseApdu(byte[] response);

        Application getApplication();
    }

    /**
     * Starts the headless JS tasks, replaced in the tests. Returns the task ID, throws if the task can't be started.
     */
    interface HeadlessTasks {
        // must be called on the main thread
        int start(@NonNull ReactContext context, @NonNull String taskKey, @NonNull Bundle data);
    }

    private static int startHeadlessJsTask(@NonNull ReactContext context, @NonNull String taskKey, @NonNull Bundle data) {
        return HeadlessJsTaskContext.getInstance(context).startTask(new HeadlessJsTaskConfig(
                taskKey,
                Arguments.fromBundle(data),
                // no timeout, the JS side finishes the task once the handlers of the interaction have finished
                0,
                // also used when the app is in foreground
                true));
    }

    private static final class ForegroundSession {
        final String id;
        final RTNHCEAndroidModule module;
        final boolean allowWhenLocked;
        boolean emulationRunning;
        // the number of the interactions with the reader handled so far
        int interactions;

        ForegroundSession(String id, RTNHCEAndroidModule module, boolean allowWhenLocked) {
            this.id = id;
            this.module = module;
            this.allowWhenLocked = allowWhenLocked;
        }
    }

    private enum Target {
        // C-APDUs are handled by the foreground session
        SESSION,
        // C-APDUs are handled by the background handler (headless JS task)
        BACKGROUND,
        // nobody is able to handle C-APDUs, they're rejected with an error status word
        REJECTED,
    }

    private static final class Activation {
        final ApduService service;
        Target target;
        String sessionId;
        RTNHCEAndroidModule module;
        // whether the JS side is listening for the events of this activation
        boolean ready;
        // whether the activation waits for the JS side to declare whether it has a background handler
        boolean awaitingJs;
        int taskId = -1;
        // whether the C-APDUs may be handled while the device is locked, null until the handler is known
        @Nullable
        Boolean allowWhenLocked;
        // whether the device was locked when the most recent C-APDU was received
        boolean deviceLocked;

        // set while waiting for React Native to start
        @Nullable
        ReactHost reactHost;
        @Nullable
        ReactInstanceEventListener reactListener;
        // set while waiting for the background handler to be known
        @Nullable
        Runnable routingTimeout;

        long pendingApduId;
        byte[] pendingCommand;
        boolean pendingDeviceLocked;

        Activation(ApduService service, boolean deviceLocked) {
            this.service = service;
            this.deviceLocked = deviceLocked;
        }
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final HeadlessTasks headlessTasks;
    private ForegroundSession foregroundSession;
    private Activation activation;
    private long lastApduId;
    // null until the manifest has been read
    @Nullable
    private volatile Boolean backgroundHandlerEnabled;

    // the tests create their own instances
    @VisibleForTesting
    HCEManager(@NonNull HeadlessTasks headlessTasks) {
        this.headlessTasks = headlessTasks;
    }

    /**
     * Whether the app has enabled the background handler with the <meta-data> of HCEService. It's disabled
     * by default, so that a reader never starts React Native in background unless the app handles
     * the interactions there (Android starts the app's process for HCEService anyway). Not synchronized:
     * reading the manifest is a binder call, so it must not be done while holding the lock. The manifest
     * can't change while the process is running, it's read once.
     */
    boolean isBackgroundHandlerEnabled(@NonNull Context context) {
        Boolean enabled = backgroundHandlerEnabled;

        if (enabled == null) {
            enabled = readBackgroundHandlerEnabled(context);
            backgroundHandlerEnabled = enabled;
        }

        return enabled;
    }

    // the flags overload replacing getServiceInfo(ComponentName, int) needs API 33
    @SuppressWarnings("deprecation")
    private static boolean readBackgroundHandlerEnabled(@NonNull Context context) {
        try {
            ServiceInfo service = context.getPackageManager().getServiceInfo(
                    new ComponentName(context, HCEService.class), PackageManager.GET_META_DATA);
            return service.metaData != null && service.metaData.getBoolean(BACKGROUND_HANDLER_META_DATA, false);
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            Log.w(TAG, "readBackgroundHandlerEnabled: unable to read the meta-data of HCEService", e);
            return false;
        }
    }

    private static boolean isSelectByName(byte[] command) {
        return command.length >= 4 && command[1] == (byte) 0xA4 && command[2] == (byte) 0x04;
    }

    private static byte[] notAvailableResponse(byte[] command) {
        return isSelectByName(command) ? SW_APPLICATION_NOT_FOUND.clone() : SW_CONDITIONS_NOT_SATISFIED.clone();
    }

    @Nullable
    private static ReactHost getReactHost(@NonNull Application application) {
        if (!(application instanceof ReactApplication)) {
            Log.e(TAG, "The Application class doesn't implement ReactApplication");
            return null;
        }

        try {
            return ((ReactApplication) application).getReactHost();
        } catch (RuntimeException e) {
            Log.e(TAG, "getReactHost() failed", e);
            return null;
        }
    }

    @Nullable
    private static RTNHCEAndroidModule getModule(@NonNull ReactContext reactContext) {
        try {
            NativeModule module = reactContext.getNativeModule(RTNHCEAndroidModule.NAME);
            return module instanceof RTNHCEAndroidModule ? (RTNHCEAndroidModule) module : null;
        } catch (RuntimeException e) {
            Log.e(TAG, "getNativeModule() failed", e);
            return null;
        }
    }

    /* ---------------------------------------------------------------------------------------------
     * HostApduService callbacks (main thread)
     * ------------------------------------------------------------------------------------------- */

    /**
     * @return the response to send synchronously or null if the response will be sent asynchronously
     */
    synchronized byte[] onCommand(@NonNull ApduService service, @NonNull byte[] command, boolean deviceLocked,
                                  boolean backgroundHandlerEnabled) {
        if (activation != null && activation.service != service) {
            Log.w(TAG, "onCommand: C-APDU from a different service instance, ending the previous activation");
            endActivation(activation);
            activation = null;
        }

        if (activation != null && activation.target == Target.REJECTED && isSelectByName(command)) {
            // the reader re-selects the application, it might be possible to serve it now
            activation = null;
        }

        if (activation == null) {
            activation = startActivation(service, deviceLocked, backgroundHandlerEnabled);
        }

        Activation a = activation;
        a.deviceLocked = deviceLocked;

        if (a.target == Target.REJECTED) {
            return notAvailableResponse(command);
        }

        if (deviceLocked && Boolean.FALSE.equals(a.allowWhenLocked)) {
            // the device was locked during the interaction, the C-APDU isn't delivered to the JS side
            Log.d(TAG, "onCommand: the device is locked and the handler doesn't allow that, rejecting the C-APDU");
            // a late response to the previous C-APDU must not be taken as the response to this one
            a.pendingCommand = null;
            return notAvailableResponse(command);
        }

        if (a.pendingCommand != null) {
            Log.w(TAG, "onCommand: received a C-APDU while the previous one wasn't responded to, dropping the previous one");
        }

        a.pendingApduId = ++lastApduId;
        a.pendingCommand = command;
        a.pendingDeviceLocked = deviceLocked;

        if (a.ready) {
            emitPendingApdu(a);
        }

        return null;
    }

    synchronized void onDeactivated(@NonNull ApduService service, int reason) {
        Log.d(TAG, "onDeactivated: " + reason);

        if (activation != null && activation.service == service) {
            endActivation(activation);
            activation = null;
        }
    }

    synchronized void onServiceDestroyed(@NonNull ApduService service) {
        if (activation != null && activation.service == service) {
            endActivation(activation);
            activation = null;
        }
    }

    /* ---------------------------------------------------------------------------------------------
     * Activation handling
     * ------------------------------------------------------------------------------------------- */

    private Activation startActivation(@NonNull ApduService service, boolean deviceLocked,
                                       boolean backgroundHandlerEnabled) {
        Activation a = new Activation(service, deviceLocked);
        ForegroundSession fg = foregroundSession;

        if (fg != null && fg.emulationRunning) {
            Log.d(TAG, "startActivation: foreground session " + fg.id);
            a.target = Target.SESSION;
            a.sessionId = fg.id;
            a.module = fg.module;
            a.allowWhenLocked = fg.allowWhenLocked;

            if (deviceLocked && !fg.allowWhenLocked) {
                Log.d(TAG, "startActivation: the device is locked and the session doesn't allow that, rejecting");
                a.target = Target.REJECTED;
                return a;
            }

            a.ready = true;
            fg.module.emitEvent(fg.id, "readerDetected");
            fg.interactions++;
            startKeepAliveTask(fg.module, fg.id, fg.interactions);
            return a;
        }

        if (!backgroundHandlerEnabled) {
            // the app doesn't handle interactions without a session, don't start React Native for nothing
            Log.d(TAG, "startActivation: no session with running emulation and the background handler isn't enabled, rejecting");
            a.target = Target.REJECTED;
            return a;
        }

        a.target = Target.BACKGROUND;
        a.sessionId = UUID.randomUUID().toString();

        final ReactHost reactHost = getReactHost(service.getApplication());

        if (reactHost == null) {
            a.target = Target.REJECTED;
            return a;
        }

        ReactContext reactContext = reactHost.getCurrentReactContext();

        if (reactContext != null) {
            routeToBackgroundHandler(a, getModule(reactContext), reactContext);
        } else {
            Log.d(TAG, "startActivation: starting React Native for background handler " + a.sessionId);
            final Activation pendingActivation = a;

            a.reactHost = reactHost;
            a.reactListener = new ReactInstanceEventListener() {
                @Override
                public void onReactContextInitialized(@NonNull ReactContext context) {
                    // one-shot listener, otherwise it would leak and fire again on every reload
                    reactHost.removeReactInstanceEventListener(this);
                    // HeadlessJsTaskContext must be used on the main thread
                    UiThreadUtil.runOnUiThread(() -> onReactContextReady(pendingActivation, context));
                }
            };
            reactHost.addReactInstanceEventListener(a.reactListener);
            reactHost.start();
        }

        if (a.target == Target.BACKGROUND && a.module == null) {
            // don't hold the reader forever if React Native fails to start or the JS side never declares the handler
            final Activation waitingActivation = a;
            a.routingTimeout = () -> onRoutingTimeout(waitingActivation);
            mainHandler.postDelayed(a.routingTimeout, ROUTING_TIMEOUT_MS);
        }

        return a;
    }

    private synchronized void onRoutingTimeout(Activation a) {
        if (activation == a && a.target == Target.BACKGROUND && a.module == null) {
            Log.w(TAG, "onRoutingTimeout: the background handler is still unknown, rejecting " + a.sessionId);
            rejectActivation(a);
        }
    }

    /**
     * Stop waiting for React Native and for the background handler declaration.
     */
    private void stopRouting(Activation a) {
        if (a.routingTimeout != null) {
            mainHandler.removeCallbacks(a.routingTimeout);
            a.routingTimeout = null;
        }

        if (a.reactHost != null && a.reactListener != null) {
            a.reactHost.removeReactInstanceEventListener(a.reactListener);
        }

        a.reactHost = null;
        a.reactListener = null;
    }

    private synchronized void onReactContextReady(Activation a, ReactContext reactContext) {
        // the listener has already removed itself
        a.reactHost = null;
        a.reactListener = null;

        if (activation != a || a.target != Target.BACKGROUND || a.module != null) {
            // the activation has already ended
            return;
        }

        routeToBackgroundHandler(a, getModule(reactContext), reactContext);
    }

    /**
     * The React context exists before the JS bundle is evaluated, so the module (or the JS side's
     * declaration of the background handler) might not be there yet. In such case, the activation
     * holds the C-APDU until onBackgroundHandlerDeclared() or the reader is lost.
     */
    // must be called on the main thread
    private void routeToBackgroundHandler(Activation a, @Nullable RTNHCEAndroidModule module, ReactContext reactContext) {
        RTNHCEAndroidModule.BackgroundHandlerDeclaration declaration =
                module != null ? module.getBackgroundHandlerDeclaration() : null;

        if (declaration == null) {
            Log.d(TAG, "routeToBackgroundHandler: waiting for the JS side " + a.sessionId);
            a.awaitingJs = true;
            return;
        }

        a.awaitingJs = false;

        if (!declaration.registered) {
            Log.d(TAG, "routeToBackgroundHandler: no session and no background handler, rejecting");
            rejectActivation(a);
            return;
        }

        if (a.deviceLocked && !declaration.allowWhenLocked) {
            Log.d(TAG, "routeToBackgroundHandler: the device is locked and the background handler doesn't allow that, rejecting");
            rejectActivation(a);
            return;
        }

        a.allowWhenLocked = declaration.allowWhenLocked;

        Log.d(TAG, "routeToBackgroundHandler: background handler " + a.sessionId);
        startBackgroundTask(a, module, reactContext);
    }

    // must be called on the main thread
    private void startBackgroundTask(Activation a, RTNHCEAndroidModule module, ReactContext reactContext) {
        stopRouting(a);
        a.module = module;
        ReactContext taskContext = module.getContext();

        if (!taskContext.hasActiveReactInstance()) {
            Log.e(TAG, "startBackgroundTask: no active React instance");
            rejectActivation(a);
            return;
        }

        boolean foreground = reactContext.getLifecycleState() == LifecycleState.RESUMED;
        Bundle data = new Bundle();
        data.putString("sessionId", a.sessionId);
        data.putString("appState", foreground ? "foreground" : "background");

        try {
            // the JS side finishes the task when the reader is lost
            a.taskId = headlessTasks.start(taskContext, BACKGROUND_TASK_KEY, data);
        } catch (RuntimeException | AssertionError e) {
            Log.e(TAG, "startBackgroundTask: failed to start the headless task", e);
            rejectActivation(a);
        }
    }

    /**
     * React Native pauses the JS timers while the app isn't resumed, unless a headless task is running.
     * Keep them running while the session handles the interaction, so that its handlers (and their timeouts)
     * work also while the app is in background. The JS side finishes the task once the handlers
     * of the interaction have finished.
     */
    // must be called on the main thread
    private void startKeepAliveTask(RTNHCEAndroidModule module, String sessionId, int interaction) {
        ReactContext context = module.getContext();

        if (!context.hasActiveReactInstance()) {
            return;
        }

        Bundle data = new Bundle();
        data.putString("sessionId", sessionId);
        data.putInt("interaction", interaction);

        try {
            headlessTasks.start(context, KEEP_ALIVE_TASK_KEY, data);
        } catch (RuntimeException | AssertionError e) {
            // not fatal, the timers only stop while the app isn't resumed
            Log.w(TAG, "startKeepAliveTask: failed to start the headless task", e);
        }
    }

    private void emitPendingApdu(Activation a) {
        a.module.emitEvent(
                a.sessionId,
                "apdu",
                a.pendingApduId,
                BinaryUtils.ByteArrayToHexString(a.pendingCommand),
                a.pendingDeviceLocked,
                "");
    }

    /**
     * Stop routing C-APDUs to the JS side for the rest of the activation.
     * The pending C-APDU (if any) is responded to with an error status word.
     */
    private void rejectActivation(Activation a) {
        stopRouting(a);
        a.target = Target.REJECTED;
        a.ready = false;

        if (a.pendingCommand != null) {
            a.service.sendResponseApdu(notAvailableResponse(a.pendingCommand));
            a.pendingCommand = null;
        }
    }

    private void endActivation(Activation a) {
        stopRouting(a);

        if (a.ready && a.module != null) {
            a.module.emitEvent(a.sessionId, "readerLost");
        }

        a.ready = false;
        a.target = Target.REJECTED;
        a.pendingCommand = null;
    }

    /* ---------------------------------------------------------------------------------------------
     * Module callbacks (JS thread, main thread for headless task events)
     * ------------------------------------------------------------------------------------------- */

    synchronized void beginSession(RTNHCEAndroidModule module, String sessionId, boolean allowWhenLocked) {
        if (foregroundSession != null) {
            throw new IllegalStateException("A session already exists.");
        }

        foregroundSession = new ForegroundSession(sessionId, module, allowWhenLocked);
        module.emitEvent(sessionId, "sessionStarted");
    }

    synchronized void invalidateSession(RTNHCEAndroidModule module, String sessionId) {
        ForegroundSession fg = foregroundSession;

        if (fg == null || fg.module != module || !fg.id.equals(sessionId)) {
            return;
        }

        detachSessionActivation(fg);
        foregroundSession = null;
        module.emitEvent(sessionId, "sessionInvalidated", 0, "", false, "userInvalidated");
    }

    synchronized void startEmulation(RTNHCEAndroidModule module, String sessionId) {
        requireSession(module, sessionId).emulationRunning = true;
    }

    synchronized void stopEmulation(RTNHCEAndroidModule module, String sessionId) {
        ForegroundSession fg = requireSession(module, sessionId);
        fg.emulationRunning = false;
        detachSessionActivation(fg);
    }

    synchronized boolean isEmulationRunning(RTNHCEAndroidModule module, String sessionId) {
        ForegroundSession fg = foregroundSession;
        return fg != null && fg.module == module && fg.id.equals(sessionId) && fg.emulationRunning;
    }

    synchronized boolean hasRunningEmulation(RTNHCEAndroidModule module) {
        ForegroundSession fg = foregroundSession;
        return fg != null && fg.module == module && fg.emulationRunning;
    }

    private ForegroundSession requireSession(RTNHCEAndroidModule module, String sessionId) {
        ForegroundSession fg = foregroundSession;

        if (fg == null || fg.module != module || !fg.id.equals(sessionId)) {
            throw new IllegalStateException("The session is not active.");
        }

        return fg;
    }

    private void detachSessionActivation(ForegroundSession fg) {
        Activation a = activation;

        if (a != null && a.target == Target.SESSION && fg.id.equals(a.sessionId)) {
            a.module.emitEvent(a.sessionId, "readerLost");
            rejectActivation(a);
        }
    }

    // main thread
    synchronized void onBackgroundHandlerDeclared(RTNHCEAndroidModule module) {
        Activation a = activation;

        if (a != null && a.target == Target.BACKGROUND && a.awaitingJs) {
            routeToBackgroundHandler(a, module, module.getContext());
        }
    }

    synchronized boolean backgroundSessionReady(RTNHCEAndroidModule module, String sessionId) {
        Activation a = activation;

        if (a == null || a.target != Target.BACKGROUND || a.module != module || !sessionId.equals(a.sessionId)) {
            return false;
        }

        a.ready = true;

        if (a.pendingCommand != null) {
            emitPendingApdu(a);
        }

        return true;
    }

    synchronized void respondApdu(RTNHCEAndroidModule module, String sessionId, long apduId, byte[] response) {
        Activation a = activation;

        if (a == null || a.target == Target.REJECTED || a.module != module || !sessionId.equals(a.sessionId)
                || a.pendingCommand == null || a.pendingApduId != apduId) {
            throw new IllegalStateException("The C-APDU is not awaiting a response.");
        }

        a.pendingCommand = null;
        a.service.sendResponseApdu(response);
    }

    synchronized void onHeadlessTaskFinished(RTNHCEAndroidModule module, int taskId) {
        Activation a = activation;

        if (a != null && a.target == Target.BACKGROUND && a.module == module && a.taskId == taskId) {
            // the background handler has finished (or crashed) while the reader is still there
            Log.w(TAG, "onHeadlessTaskFinished: the background handler finished before the reader was lost");
            rejectActivation(a);
        }
    }

    synchronized void onModuleInvalidated(RTNHCEAndroidModule module) {
        if (foregroundSession != null && foregroundSession.module == module) {
            foregroundSession = null;
        }

        if (activation != null && activation.module == module) {
            rejectActivation(activation);
        }
    }
}
