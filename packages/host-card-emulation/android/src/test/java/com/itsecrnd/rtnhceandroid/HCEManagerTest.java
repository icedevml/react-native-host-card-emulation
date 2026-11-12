package com.itsecrnd.rtnhceandroid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.robolectric.Shadows.shadowOf;

import android.app.Application;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.common.LifecycleState;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The routing state machine of HCEManager, driven like HCEService and the module drive it. The React Native side
 * is mocked: the events emitted to JS and the started headless tasks are recorded.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public class HCEManagerTest {
    private static final String SELECT = "00A4040007D2760000850101";
    private static final String READ = "00B000000F";
    private static final byte[] OK = BinaryUtils.HexStringToByteArray("9000");

    private static final class FakeService implements HCEManager.ApduService {
        final List<String> responses = new ArrayList<>();
        private final Application application;

        FakeService(Application application) {
            this.application = application;
        }

        @Override
        public void sendResponseApdu(byte[] response) {
            responses.add(BinaryUtils.ByteArrayToHexString(response));
        }

        @Override
        public Application getApplication() {
            return application;
        }
    }

    private static final class TestApplication extends Application implements ReactApplication {
        private final ReactHost reactHost;

        TestApplication(ReactHost reactHost) {
            this.reactHost = reactHost;
        }

        @Override
        public ReactHost getReactHost() {
            return reactHost;
        }
    }

    private static final class StartedTask {
        final int id;
        final String key;
        final Bundle data;

        StartedTask(int id, String key, Bundle data) {
            this.id = id;
            this.key = key;
            this.data = data;
        }
    }

    private static final class FakeHeadlessTasks implements HCEManager.HeadlessTasks {
        final List<StartedTask> started = new ArrayList<>();
        @Nullable
        RuntimeException failure;

        @Override
        public int start(@NonNull ReactContext context, @NonNull String taskKey, @NonNull Bundle data) {
            if (failure != null) {
                throw failure;
            }

            StartedTask task = new StartedTask(started.size() + 1, taskKey, data);
            started.add(task);
            return task.id;
        }
    }

    // "<sessionId> <type>", "<sessionId> apdu <command>[ locked]" or "<sessionId> sessionInvalidated <reason>"
    private final List<String> events = new ArrayList<>();
    private final List<Long> apduIds = new ArrayList<>();

    private FakeHeadlessTasks tasks;
    private HCEManager manager;
    private ReactApplicationContext reactContext;
    private RTNHCEAndroidModule module;
    private ReactHost reactHost;
    private FakeService service;

    // the state of the device and of the manifest for the next C-APDU
    private boolean deviceLocked;
    private boolean backgroundHandlerEnabled;

    @Before
    public void setUp() {
        tasks = new FakeHeadlessTasks();
        manager = new HCEManager(tasks);

        reactContext = mock(ReactApplicationContext.class);
        when(reactContext.hasActiveReactInstance()).thenReturn(true);
        when(reactContext.getLifecycleState()).thenReturn(LifecycleState.BEFORE_RESUME);

        module = mockModule();
        when(reactContext.getNativeModule(RTNHCEAndroidModule.NAME)).thenReturn(module);

        reactHost = mock(ReactHost.class);
        when(reactHost.getCurrentReactContext()).thenReturn(reactContext);

        service = new FakeService(new TestApplication(reactHost));
    }

    private RTNHCEAndroidModule mockModule() {
        RTNHCEAndroidModule m = mock(RTNHCEAndroidModule.class);
        when(m.getContext()).thenReturn(reactContext);

        doAnswer(invocation -> {
            events.add(invocation.getArgument(0) + " " + invocation.getArgument(1));
            return null;
        }).when(m).emitEvent(anyString(), anyString());

        doAnswer(invocation -> {
            String sessionId = invocation.getArgument(0);
            String type = invocation.getArgument(1);

            if (type.equals("apdu")) {
                apduIds.add(invocation.getArgument(2));
                boolean locked = invocation.getArgument(4);
                events.add(sessionId + " apdu " + invocation.getArgument(3) + (locked ? " locked" : ""));
            } else {
                events.add(sessionId + " " + type + " " + invocation.getArgument(5));
            }

            return null;
        }).when(m).emitEvent(anyString(), anyString(), anyLong(), anyString(), anyBoolean(), anyString());

        return m;
    }

    /**
     * Pass the C-APDU like HCEService does, returns the synchronous response (hex) or null.
     */
    @Nullable
    private String send(String command) {
        byte[] response = manager.onCommand(service, BinaryUtils.HexStringToByteArray(command), deviceLocked,
                backgroundHandlerEnabled);
        return response != null ? BinaryUtils.ByteArrayToHexString(response) : null;
    }

    private void declareBackgroundHandler(boolean registered, boolean allowWhenLocked) {
        when(module.getBackgroundHandlerDeclaration())
                .thenReturn(new RTNHCEAndroidModule.BackgroundHandlerDeclaration(registered, allowWhenLocked));
    }

    private void beginEmulatingSession(String sessionId, boolean allowWhenLocked) {
        manager.beginSession(module, sessionId, allowWhenLocked);
        manager.startEmulation(module, sessionId);
    }

    private static void idleMainLooper(Duration duration) {
        shadowOf(Looper.getMainLooper()).idleFor(duration);
    }

    /* ---------------------------------------------------------------------------------------------
     * Foreground session
     * ------------------------------------------------------------------------------------------- */

    @Test
    public void routesTheInteractionToTheSessionWithRunningEmulation() {
        beginEmulatingSession("fg", false);

        assertNull(send(SELECT));
        manager.respondApdu(module, "fg", apduIds.get(0), OK);
        assertNull(send(READ));
        manager.onDeactivated(service, 0);

        assertEquals(Arrays.asList(
                "fg sessionStarted",
                "fg readerDetected",
                "fg apdu " + SELECT,
                "fg apdu " + READ,
                "fg readerLost"), events);
        assertEquals(Collections.singletonList("9000"), service.responses);
    }

    @Test
    public void rejectsTheReaderWithoutSessionWhenTheBackgroundHandlerIsDisabled() {
        // a session that hasn't started the emulation doesn't count
        manager.beginSession(module, "fg", false);

        assertEquals("6A82", send(SELECT));
        assertEquals("6985", send(READ));

        // the app (and React Native) is never started for the reader
        verifyNoInteractions(reactHost);
        assertTrue(tasks.started.isEmpty());
        assertEquals(Collections.singletonList("fg sessionStarted"), events);
    }

    @Test
    public void rejectsTheLockedDeviceUnlessTheSessionAllowsIt() {
        beginEmulatingSession("fg", false);

        deviceLocked = true;
        assertEquals("6A82", send(SELECT));
        assertEquals("6985", send(READ));

        // the reader selects the application again once the device is unlocked
        deviceLocked = false;
        assertNull(send(SELECT));

        assertEquals(Arrays.asList("fg sessionStarted", "fg readerDetected", "fg apdu " + SELECT), events);
    }

    @Test
    public void rejectsTheCommandsReceivedWhileLockedDuringTheInteraction() {
        beginEmulatingSession("fg", false);
        assertNull(send(SELECT));
        final long selectId = apduIds.get(0);

        deviceLocked = true;
        assertEquals("6985", send(READ));

        // a late response to the SELECT must not be taken as the response to the READ
        assertThrows(IllegalStateException.class, () -> manager.respondApdu(module, "fg", selectId, OK));
        assertTrue(service.responses.isEmpty());
    }

    @Test
    public void deliversTheCommandsOfTheLockedDeviceIfTheSessionAllowsIt() {
        beginEmulatingSession("fg", true);

        deviceLocked = true;
        assertNull(send(SELECT));

        assertEquals(Arrays.asList("fg sessionStarted", "fg readerDetected", "fg apdu " + SELECT + " locked"), events);
    }

    @Test
    public void rejectsTheResponsesThatAreNotAwaited() {
        beginEmulatingSession("fg", false);

        send(SELECT);
        final long selectId = apduIds.get(0);
        // the reader has given up on the SELECT and sent the next C-APDU
        send(READ);
        final long readId = apduIds.get(1);

        assertThrows(IllegalStateException.class, () -> manager.respondApdu(module, "fg", selectId, OK));
        assertThrows(IllegalStateException.class, () -> manager.respondApdu(module, "other", readId, OK));
        manager.respondApdu(module, "fg", readId, OK);
        // responded to at most once
        assertThrows(IllegalStateException.class, () -> manager.respondApdu(module, "fg", readId, OK));

        send(SELECT);
        final long lostId = apduIds.get(2);
        manager.onDeactivated(service, 0);
        assertThrows(IllegalStateException.class, () -> manager.respondApdu(module, "fg", lostId, OK));

        assertEquals(Collections.singletonList("9000"), service.responses);
    }

    @Test
    public void stoppingTheEmulationEndsTheInteraction() {
        beginEmulatingSession("fg", false);
        send(SELECT);

        manager.stopEmulation(module, "fg");

        // the awaited C-APDU is rejected
        assertEquals(Collections.singletonList("6A82"), service.responses);
        assertEquals("6985", send(READ));
        // re-selected: there is no session with running emulation and no background handler anymore
        assertEquals("6A82", send(SELECT));
        manager.onDeactivated(service, 0);

        // a single readerLost
        assertEquals(Arrays.asList(
                "fg sessionStarted",
                "fg readerDetected",
                "fg apdu " + SELECT,
                "fg readerLost"), events);
    }

    @Test
    public void invalidatingTheSessionEndsTheInteraction() {
        beginEmulatingSession("fg", false);
        send(SELECT);
        manager.respondApdu(module, "fg", apduIds.get(0), OK);
        send(READ);

        manager.invalidateSession(module, "fg");

        assertEquals(Arrays.asList("9000", "6985"), service.responses);
        assertEquals(Arrays.asList(
                "fg sessionStarted",
                "fg readerDetected",
                "fg apdu " + SELECT,
                "fg apdu " + READ,
                "fg readerLost",
                "fg sessionInvalidated userInvalidated"), events);

        // the next session can begin
        manager.beginSession(module, "fg2", false);
    }

    @Test
    public void countsTheInteractionsForTheKeepAliveTask() {
        beginEmulatingSession("fg", false);

        send(SELECT);
        manager.onDeactivated(service, 0);
        send(SELECT);
        // stopping the emulation ends the interaction too
        manager.stopEmulation(module, "fg");
        manager.startEmulation(module, "fg");
        send(SELECT);

        assertEquals(3, tasks.started.size());

        for (int i = 0; i < tasks.started.size(); i++) {
            StartedTask task = tasks.started.get(i);
            assertEquals(HCEManager.KEEP_ALIVE_TASK_KEY, task.key);
            assertEquals("fg", task.data.getString("sessionId"));
            assertEquals(i + 1, task.data.getInt("interaction"));
        }

        // every ended interaction has a single readerLost, the JS side counts them to finish the keep-alive tasks
        assertEquals(2, Collections.frequency(events, "fg readerLost"));
    }

    @Test
    public void allowsOnlyASingleSessionControlledByItsModule() {
        manager.beginSession(module, "fg", false);

        assertThrows(IllegalStateException.class, () -> manager.beginSession(module, "fg2", false));
        assertThrows(IllegalStateException.class, () -> manager.startEmulation(module, "fg2"));
        assertFalse(manager.isEmulationRunning(module, "fg"));

        manager.startEmulation(module, "fg");
        assertTrue(manager.isEmulationRunning(module, "fg"));
        assertTrue(manager.hasRunningEmulation(module));

        // e.g. the module of a reloaded JS bundle
        RTNHCEAndroidModule otherModule = mockModule();
        assertThrows(IllegalStateException.class, () -> manager.stopEmulation(otherModule, "fg"));
        manager.invalidateSession(otherModule, "fg");
        assertTrue(manager.isEmulationRunning(module, "fg"));
    }

    @Test
    public void theInvalidationOfTheModuleEndsItsSession() {
        beginEmulatingSession("fg", false);
        send(SELECT);

        manager.onModuleInvalidated(module);

        assertEquals(Collections.singletonList("6A82"), service.responses);
        assertFalse(manager.hasRunningEmulation(module));
        manager.beginSession(mockModule(), "fg2", false);
    }

    @Test
    public void aCommandOfAnotherServiceInstanceEndsThePreviousInteraction() {
        beginEmulatingSession("fg", false);
        send(SELECT);

        FakeService otherService = new FakeService(service.getApplication());
        assertNull(manager.onCommand(otherService, BinaryUtils.HexStringToByteArray(SELECT), false, false));

        assertEquals(Arrays.asList(
                "fg sessionStarted",
                "fg readerDetected",
                "fg apdu " + SELECT,
                "fg readerLost",
                "fg readerDetected",
                "fg apdu " + SELECT), events);
    }

    /* ---------------------------------------------------------------------------------------------
     * Background handler
     * ------------------------------------------------------------------------------------------- */

    @Test
    public void routesTheInteractionToTheBackgroundHandler() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);

        assertNull(send(SELECT));

        assertEquals(1, tasks.started.size());
        StartedTask task = tasks.started.get(0);
        assertEquals(HCEManager.BACKGROUND_TASK_KEY, task.key);
        assertEquals("background", task.data.getString("appState"));
        String sessionId = task.data.getString("sessionId");
        // the C-APDU is held until the JS side is ready
        assertTrue(events.isEmpty());

        assertTrue(manager.backgroundSessionReady(module, sessionId));
        manager.respondApdu(module, sessionId, apduIds.get(0), OK);
        manager.onDeactivated(service, 0);

        assertEquals(Arrays.asList(sessionId + " apdu " + SELECT, sessionId + " readerLost"), events);
        assertEquals(Collections.singletonList("9000"), service.responses);
    }

    @Test
    public void tellsTheBackgroundHandlerThatTheAppIsInForeground() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);
        when(reactContext.getLifecycleState()).thenReturn(LifecycleState.RESUMED);

        send(SELECT);

        assertEquals("foreground", tasks.started.get(0).data.getString("appState"));
    }

    @Test
    public void rejectsTheReaderIfNoBackgroundHandlerIsRegistered() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(false, false);

        assertEquals("6A82", send(SELECT));
        assertTrue(tasks.started.isEmpty());
    }

    @Test
    public void theBackgroundHandlerHonoursAllowWhenLocked() {
        backgroundHandlerEnabled = true;
        deviceLocked = true;

        declareBackgroundHandler(true, false);
        assertEquals("6A82", send(SELECT));
        assertTrue(tasks.started.isEmpty());

        // the next interaction
        manager.onDeactivated(service, 0);
        declareBackgroundHandler(true, true);
        assertNull(send(SELECT));
        assertEquals(1, tasks.started.size());
    }

    @Test
    public void holdsTheInteractionUntilTheJsSideDeclaresTheHandler() {
        backgroundHandlerEnabled = true;

        // the module exists, but the JS bundle hasn't declared the background handler yet
        assertNull(send(SELECT));
        assertTrue(tasks.started.isEmpty());

        declareBackgroundHandler(true, false);
        manager.onBackgroundHandlerDeclared(module);
        assertEquals(1, tasks.started.size());

        // the routing timeout was cancelled
        idleMainLooper(Duration.ofSeconds(20));
        assertTrue(service.responses.isEmpty());
    }

    @Test
    public void rejectsTheInteractionIfTheHandlerIsNotDeclaredWithin15Seconds() {
        backgroundHandlerEnabled = true;

        assertNull(send(SELECT));

        idleMainLooper(Duration.ofSeconds(14));
        assertTrue(service.responses.isEmpty());
        idleMainLooper(Duration.ofSeconds(1));
        assertEquals(Collections.singletonList("6A82"), service.responses);
        assertEquals("6985", send(READ));
    }

    @Test
    public void startsReactNativeAndWaitsForItsContext() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);
        when(reactHost.getCurrentReactContext()).thenReturn(null);

        assertNull(send(SELECT));

        ArgumentCaptor<ReactInstanceEventListener> listener = ArgumentCaptor.forClass(ReactInstanceEventListener.class);
        verify(reactHost).addReactInstanceEventListener(listener.capture());
        verify(reactHost).start();
        assertTrue(tasks.started.isEmpty());

        listener.getValue().onReactContextInitialized(reactContext);
        verify(reactHost).removeReactInstanceEventListener(listener.getValue());
        // the task is started on the main thread
        assertTrue(tasks.started.isEmpty());
        shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, tasks.started.size());

        // the routing timeout was cancelled
        idleMainLooper(Duration.ofSeconds(20));
        assertTrue(service.responses.isEmpty());
    }

    @Test
    public void rejectsTheInteractionIfTheBackgroundTaskFinishesEarly() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);
        send(SELECT);
        StartedTask task = tasks.started.get(0);

        // e.g. the JS task has crashed
        manager.onHeadlessTaskFinished(module, task.id);

        assertEquals(Collections.singletonList("6A82"), service.responses);
        assertEquals("6985", send(READ));
        assertFalse(manager.backgroundSessionReady(module, task.data.getString("sessionId")));
    }

    @Test
    public void rejectsTheInteractionIfTheBackgroundTaskCannotStart() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);
        tasks.failure = new IllegalStateException("no headless task");

        assertEquals("6A82", send(SELECT));
        assertTrue(service.responses.isEmpty());
    }

    @Test
    public void theBackgroundSessionIsOnlyReadyDuringItsOwnInteraction() {
        backgroundHandlerEnabled = true;
        declareBackgroundHandler(true, false);

        send(SELECT);
        String first = tasks.started.get(0).data.getString("sessionId");
        // the reader was lost before the JS side got ready
        manager.onDeactivated(service, 0);
        assertFalse(manager.backgroundSessionReady(module, first));

        send(SELECT);
        String second = tasks.started.get(1).data.getString("sessionId");
        assertNotEquals(first, second);
        assertFalse(manager.backgroundSessionReady(module, first));
        assertTrue(manager.backgroundSessionReady(module, second));

        // the JS side wasn't listening to the first interaction, so it isn't notified of its end
        assertEquals(Collections.singletonList(second + " apdu " + SELECT), events);
    }

    /* ---------------------------------------------------------------------------------------------
     * AndroidManifest.xml
     * ------------------------------------------------------------------------------------------- */

    @Test
    public void readsTheBackgroundHandlerOptInFromTheManifest() {
        Context context = RuntimeEnvironment.getApplication();
        assertFalse(manager.isBackgroundHandlerEnabled(context));

        ServiceInfo serviceInfo = new ServiceInfo();
        serviceInfo.packageName = context.getPackageName();
        serviceInfo.name = HCEService.class.getName();
        serviceInfo.metaData = new Bundle();
        serviceInfo.metaData.putBoolean(HCEManager.BACKGROUND_HANDLER_META_DATA, true);
        shadowOf(context.getPackageManager()).addOrUpdateService(serviceInfo);

        assertTrue(new HCEManager(tasks).isBackgroundHandlerEnabled(context));
        // the manifest can't change while the process is running, it's read once
        assertFalse(manager.isBackgroundHandlerEnabled(context));
    }
}
