package com.itsecrnd.rtnhceandroid;

import android.app.Activity;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.nfc.NfcAdapter;
import android.nfc.cardemulation.CardEmulation;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.jstasks.HeadlessJsTaskEventListener;

public class RTNHCEAndroidModule extends NativeHCEModuleSpec {
    public static final String TAG = "RTNHCEAndroidModule";
    public static final String NAME = "NativeHCEModule";

    static final class BackgroundHandlerDeclaration {
        final boolean registered;
        final boolean allowWhenLocked;

        BackgroundHandlerDeclaration(boolean registered, boolean allowWhenLocked) {
            this.registered = registered;
            this.allowWhenLocked = allowWhenLocked;
        }
    }

    // null until the JS side declares whether it has a background handler
    private volatile BackgroundHandlerDeclaration backgroundHandlerDeclaration;

    // the activity for which HCEService is the preferred service, main thread only
    @Nullable
    private Activity preferredServiceActivity;

    private final HeadlessJsTaskEventListener headlessJsTaskEventListener = new HeadlessJsTaskEventListener() {
        @Override
        public void onHeadlessJsTaskStart(int taskId) {
            // nothing to do
        }

        @Override
        public void onHeadlessJsTaskFinish(int taskId) {
            HCEManager.getInstance().onHeadlessTaskFinished(RTNHCEAndroidModule.this, taskId);
        }
    };

    /*
     Android only allows setting the preferred service for a resumed activity
     and the preference has to be removed once the activity is paused.
     */
    private final LifecycleEventListener lifecycleEventListener = new LifecycleEventListener() {
        @Override
        public void onHostResume() {
            updatePreferredService(true);
        }

        @Override
        public void onHostPause() {
            updatePreferredService(false);
        }

        @Override
        public void onHostDestroy() {
            updatePreferredService(false);
        }
    };

    RTNHCEAndroidModule(ReactApplicationContext context) {
        super(context);
        HeadlessJsTaskContext.getInstance(context).addTaskEventListener(headlessJsTaskEventListener);
        context.addLifecycleEventListener(lifecycleEventListener);
    }

    @Override
    public void invalidate() {
        Log.d(TAG, "invalidate");
        ReactApplicationContext context = getReactApplicationContext();
        HeadlessJsTaskContext.getInstance(context).removeTaskEventListener(headlessJsTaskEventListener);
        context.removeLifecycleEventListener(lifecycleEventListener);
        HCEManager.getInstance().onModuleInvalidated(this);
        UiThreadUtil.runOnUiThread(() -> updatePreferredService(false));
        super.invalidate();
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    ReactApplicationContext getContext() {
        return getReactApplicationContext();
    }

    @Nullable
    BackgroundHandlerDeclaration getBackgroundHandlerDeclaration() {
        return backgroundHandlerDeclaration;
    }

    @Nullable
    private CardEmulation getCardEmulation() {
        try {
            NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getReactApplicationContext());
            return adapter != null ? CardEmulation.getInstance(adapter) : null;
        } catch (RuntimeException e) {
            // UnsupportedOperationException if the device doesn't support HCE
            Log.w(TAG, "getCardEmulation: CardEmulation is not available", e);
            return null;
        }
    }

    /**
     * Make HCEService the preferred service while the app's activity is resumed and the foreground session
     * has running emulation, so that it wins the routing of AIDs that other apps also have registered.
     */
    // main thread
    private void updatePreferredService(boolean hostResumed) {
        Activity activity = hostResumed ? getReactApplicationContext().getCurrentActivity() : null;
        boolean wanted = activity != null && HCEManager.getInstance().hasRunningEmulation(this);

        if (wanted && activity == preferredServiceActivity) {
            return;
        }

        CardEmulation cardEmulation = null;

        if (preferredServiceActivity != null) {
            cardEmulation = getCardEmulation();

            try {
                if (cardEmulation != null) {
                    cardEmulation.unsetPreferredService(preferredServiceActivity);
                }
            } catch (RuntimeException e) {
                // IllegalArgumentException if the activity isn't resumed anymore, the preference is gone anyway
                Log.w(TAG, "updatePreferredService: unsetPreferredService() failed", e);
            }

            preferredServiceActivity = null;
        }

        if (!wanted) {
            return;
        }

        if (cardEmulation == null) {
            cardEmulation = getCardEmulation();
        }

        if (cardEmulation == null) {
            return;
        }

        try {
            ComponentName service = new ComponentName(getReactApplicationContext(), HCEService.class);

            if (cardEmulation.setPreferredService(activity, service)) {
                preferredServiceActivity = activity;
            } else {
                Log.w(TAG, "updatePreferredService: setPreferredService() refused, is HCEService declared in the manifest?");
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "updatePreferredService: setPreferredService() failed", e);
        }
    }

    private void refreshPreferredService() {
        UiThreadUtil.runOnUiThread(() -> updatePreferredService(
                getReactApplicationContext().getLifecycleState() == LifecycleState.RESUMED));
    }

    void emitEvent(String sessionId, String type) {
        emitEvent(sessionId, type, 0, "", false, "");
    }

    void emitEvent(String sessionId, String type, long apduId, String command, boolean deviceLocked, String reason) {
        if (this.mEventEmitterCallback == null) {
            Log.w(TAG, "emitEvent: missing event emitter, dropping " + type);
            return;
        }

        WritableMap map = Arguments.createMap();
        map.putString("sessionId", sessionId);
        map.putString("type", type);
        map.putDouble("apduId", (double) apduId);
        map.putString("command", command);
        map.putBoolean("deviceLocked", deviceLocked);
        map.putString("reason", reason);
        emitOnEvent(map);
    }

    private boolean isHCESupported() {
        PackageManager pm = getReactApplicationContext().getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_NFC)
                && pm.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION);
    }

    private boolean isBackgroundHandlerEnabledInManifest() {
        return HCEManager.getInstance().isBackgroundHandlerEnabled(getReactApplicationContext());
    }

    @Override
    public void getCapabilities(Promise promise) {
        boolean hceSupported = isHCESupported();
        boolean nfcEnabled = false;

        try {
            NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getReactApplicationContext());
            nfcEnabled = adapter != null && adapter.isEnabled();
        } catch (RuntimeException e) {
            Log.w(TAG, "getCapabilities: unable to check NFC adapter state", e);
        }

        WritableMap map = Arguments.createMap();
        map.putString("platform", "android");
        map.putBoolean("hceSupported", hceSupported);
        map.putBoolean("nfcEnabled", nfcEnabled);
        map.putBoolean("eligible", hceSupported);
        map.putBoolean("backgroundSupported", hceSupported && isBackgroundHandlerEnabledInManifest());
        map.putBoolean("presentmentSupported", false);
        promise.resolve(map);
    }

    @Override
    public void beginSession(String sessionId, boolean allowWhenLocked, Promise promise) {
        if (!isHCESupported()) {
            promise.reject("err_platform_unsupported", "The device doesn't support NFC host card emulation.");
            return;
        }

        try {
            HCEManager.getInstance().beginSession(this, sessionId, allowWhenLocked);
        } catch (IllegalStateException e) {
            promise.reject("err_session_exists", "A session already exists.");
            return;
        }

        promise.resolve(null);
    }

    @Override
    public void invalidateSession(String sessionId) {
        HCEManager.getInstance().invalidateSession(this, sessionId);
        refreshPreferredService();
    }

    @Override
    public void setSessionAlertMessage(String sessionId, String message) {
        // unsupported on Android, no-op
    }

    @Override
    public void startEmulation(String sessionId, Promise promise) {
        try {
            HCEManager.getInstance().startEmulation(this, sessionId);
        } catch (IllegalStateException e) {
            promise.reject("err_no_session", "The session is not active.");
            return;
        }

        refreshPreferredService();
        promise.resolve(null);
    }

    @Override
    public void stopEmulation(String sessionId, String status, Promise promise) {
        try {
            HCEManager.getInstance().stopEmulation(this, sessionId);
        } catch (IllegalStateException e) {
            promise.reject("err_no_session", "The session is not active.");
            return;
        }

        refreshPreferredService();
        promise.resolve(null);
    }

    @Override
    public void isEmulationRunning(String sessionId, Promise promise) {
        promise.resolve(HCEManager.getInstance().isEmulationRunning(this, sessionId));
    }

    @Override
    public void respondApdu(String sessionId, double apduId, String rapdu, Promise promise) {
        byte[] response;

        try {
            response = BinaryUtils.HexStringToByteArray(rapdu);
        } catch (IllegalArgumentException e) {
            promise.reject("err_invalid_rapdu", "The R-APDU is not a valid hex-encoded string.");
            return;
        }

        if (response.length < 2) {
            promise.reject("err_invalid_rapdu", "The R-APDU must contain at least the status word.");
            return;
        }

        try {
            HCEManager.getInstance().respondApdu(this, sessionId, (long) apduId, response);
        } catch (IllegalStateException e) {
            promise.reject("err_stale_apdu", "The C-APDU is not awaiting a response (reader lost or session closed).");
            return;
        }

        promise.resolve(null);
    }

    @Override
    public void acquireExclusiveNFC(Promise promise) {
        promise.reject("err_platform_unsupported", "acquireExclusiveNFC() is not supported on Android.");
    }

    @Override
    public void releaseExclusiveNFC() {
        // unsupported on Android, no-op
    }

    @Override
    public boolean isExclusiveNFC() {
        // unsupported on Android, always false
        return false;
    }

    @Override
    public void setBackgroundHandlerRegistered(boolean registered, boolean allowWhenLocked) {
        this.backgroundHandlerDeclaration = new BackgroundHandlerDeclaration(registered, allowWhenLocked);
        UiThreadUtil.runOnUiThread(() -> HCEManager.getInstance().onBackgroundHandlerDeclared(this));
    }

    @Override
    public boolean backgroundSessionReady(String sessionId) {
        return HCEManager.getInstance().backgroundSessionReady(this, sessionId);
    }

    @Override
    public boolean isBackgroundHandlerEnabled() {
        return isBackgroundHandlerEnabledInManifest();
    }
}
