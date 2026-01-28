/*
 * Some of the code inspired by:
 * https://github.com/appidea/react-native-hce
 * https://github.com/transistorsoft/react-native-background-fetch
 */

package com.itsecrnd.rtnhceandroid;

import static com.facebook.react.jstasks.HeadlessJsTaskContext.Companion;

import android.app.ActivityManager;
import android.content.Context;
import android.nfc.cardemulation.HostApduService;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.jstasks.HeadlessJsTaskEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
public class HCEService extends HostApduService implements HCEServiceCallback {
    private static final String TAG = "HCEService";

    private boolean isForeground;
    private volatile boolean isDeactivated;
    private String backgroundSessionUUID;
    private RTNHCEAndroidModule hceModule;
    private byte[] pendingCAPDU;
    private volatile boolean needsResponse;
    private final HashMap<String, Integer> taskSessionIdMap;

    public HCEService() {
        super();

        taskSessionIdMap = new HashMap<>();
    }

    private boolean isAppOnForeground(Context context) {
        /*
         We need to check if app is in foreground otherwise the app will crash.
         https://stackoverflow.com/questions/8489993/check-android-application-is-in-foreground-or-not
         */
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> appProcesses =
                activityManager.getRunningAppProcesses();
        if (appProcesses == null) {
            return false;
        }
        final String packageName = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo appProcess : appProcesses) {
            if (appProcess.importance ==
                    ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                    appProcess.processName.equals(packageName)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void onBackgroundHCEInit(String handle) {
        Log.d(TAG, "HCEService:onBackgroundHCEInit");
        Log.d(TAG, "HCEService:onBackgroundHCEInit:" + handle + ":" + backgroundSessionUUID);

        if (handle == null && backgroundSessionUUID != null) {
            Log.d(TAG, "HCEService:onBackgroundHCEInit foreground call to background session");
            throw new IllegalStateException();
        } else if (handle != null && !handle.equals(backgroundSessionUUID)) {
            Log.d(TAG, "HCEService:onBackgroundHCEInit mismatched background session handle");
            throw new IllegalStateException();
        }

        if (pendingCAPDU != null) {
            Log.d(TAG, "HCEService:onBackgroundHCEInit send pendingCAPDU");
            hceModule.sendBackgroundEvent(backgroundSessionUUID, "received", BinaryUtils.ByteArrayToHexString(pendingCAPDU));
            pendingCAPDU = null;
        }
    }

    @Override
    public void onBackgroundHCEFinish(String handle) {
        Log.d(TAG, "HCEService:onBackgroundHCEFinish");
        Integer taskId = taskSessionIdMap.get(handle);

        if (taskId == null) {
            Log.d(TAG, "HCEService:onBackgroundHCEFinish unable to resolve taskId");
            throw new IllegalArgumentException();
        }

        ReactHost reactHost = ((ReactApplication) getApplication()).getReactHost();

        if (reactHost == null) {
            Log.d(TAG, "HCEService:onBackgroundHCEFinish getReactHost() returned null");
            throw new IllegalArgumentException();
        }

        ReactContext reactContext = reactHost.getCurrentReactContext();

        if (reactContext == null) {
            Log.d(TAG, "HCEService:onBackgroundHCEFinish getCurrentReactContext() returned null");
            throw new IllegalArgumentException();
        }

        HeadlessJsTaskContext headlessJsTaskContext = Companion.getInstance(reactContext);
        headlessJsTaskContext.finishTask(taskId);
        taskSessionIdMap.remove(handle);
        stopSelf();
    }

    @Override
    public void onRespondAPDU(String handle, String rapdu) {
        Log.d(TAG, "HCEService:onRespondAPDU");

        if (handle == null && backgroundSessionUUID != null) {
            Log.d(TAG, "HCEService:onRespondAPDU foreground call to background session");
            throw new IllegalStateException();
        } else if (handle != null && !handle.equals(backgroundSessionUUID)) {
            Log.d(TAG, "HCEService:onRespondAPDU mismatched background session handle");
            throw new IllegalStateException();
        }

        if (!needsResponse) {
            Log.d(TAG, "HCEService:onRespondAPDU not waiting for a response");
            throw new IllegalStateException();
        }

        needsResponse = false;
        sendResponseApdu(BinaryUtils.HexStringToByteArray(rapdu));
    }

    @Override
    public byte[] processCommandApdu(byte[] command, Bundle extras) {
        Log.d(TAG, "HCEService:processCommandApdu");

        if (isDeactivated) {
            onCreate();
        }

        String capdu = BinaryUtils.ByteArrayToHexString(command).toUpperCase(Locale.ROOT);

        if (isForeground) {
            if (hceModule._isHCERunning() && hceModule.isHCEActiveConnection()) {
                Log.d(TAG, "HCEService:processCommandApdu foreground sendEvent received");
                needsResponse = true;
                hceModule.sendEvent("received", capdu);
            } else {
                Log.d(TAG, "HCEService:processCommandApdu foreground respond 6999");
                return new byte[]{(byte) 0x69, (byte) 0x99};
            }
        } else {
            if (hceModule != null && hceModule.isHCEBackgroundHandlerReady()) {
                Log.d(TAG, "HCEService:processCommandApdu background sendBackgroundEvent received");
                needsResponse = true;
                hceModule.sendBackgroundEvent(backgroundSessionUUID, "received", capdu);
            } else {
                Log.d(TAG, "HCEService:processCommandApdu background pendingCAPDU");
                needsResponse = true;
                pendingCAPDU = command;
            }
        }

        return null;
    }

    @Override
    public void onCreate() {
        Log.d(TAG, "HCEService:onCreate");

        ReactHost reactHost = ((ReactApplication) getApplication()).getReactHost();

        if (reactHost == null) {
            throw new RuntimeException("BUG! getReactHost() returned null.");
        }

        isForeground = isAppOnForeground(getApplicationContext());
        isDeactivated = false;
        pendingCAPDU = null;
        hceModule = null;
        needsResponse = false;

        if (isForeground) {
            Log.d(TAG, "HCEService:onCreate foreground");
            this.backgroundSessionUUID = null;

            ReactContext reactContext = reactHost.getCurrentReactContext();

            if (reactContext == null) {
                throw new RuntimeException("BUG! getCurrentReactContext() returned null in foreground.");
            }

            this.hceModule = ((RTNHCEAndroidModule) reactContext.getNativeModule("NativeHCEModule"));

            if (this.hceModule == null) {
                throw new RuntimeException("BUG! getNativeModule() returned null in foreground.");
            }

            this.hceModule.setHCEService(this);

            if (this.hceModule._isHCERunning()) {
                this.hceModule.sendEvent("readerDetected", "");
            } else {
                this.hceModule.setHCEBrokenConnection();
            }
        } else {
            ReactContext reactContext = reactHost.getCurrentReactContext();
            Log.d(TAG, "HCEService:onCreate background");
            final String useSessID = UUID.randomUUID().toString();
            backgroundSessionUUID = useSessID;

            if (reactContext == null) {
                reactHost.addReactInstanceEventListener(evReactContext -> {
                    HeadlessJsTaskContext headlessJsTaskContext = Companion.getInstance(evReactContext);
                    headlessJsTaskContext.addTaskEventListener(new HeadlessJsTaskEventListener() {
                        @Override
                        public void onHeadlessJsTaskStart(int i) {
                            Log.d(TAG, "HCEService:HeadlessJsTaskEventListener:onHeadlessJsTaskStart: " + i);
                        }

                        @Override
                        public void onHeadlessJsTaskFinish(int i) {
                            Log.d(TAG, "HCEService:HeadlessJsTaskEventListener:onHeadlessJsTaskFinish: " + i);
                        }
                    });

                    setupRunJSTask(evReactContext, useSessID);
                });
                reactHost.start();
            } else {
                setupRunJSTask(reactContext, useSessID);
            }
        }
    }

    @Override
    public void onDeactivated(int reason) {
        Log.d(TAG, "HCEService:onDeactivated: " + reason);
        needsResponse = false;
        isDeactivated = true;

        if (isForeground) {
            if (this.hceModule != null && this.hceModule.isHCEActiveConnection()) {
                this.hceModule.sendEvent("readerDeselected", "");
            }
        } else if (backgroundSessionUUID != null) {
            String prevBackgroundSessionUUID = backgroundSessionUUID;
            backgroundSessionUUID = null;

            if (this.hceModule != null) {
                this.hceModule.sendBackgroundEvent(prevBackgroundSessionUUID, "readerDeselected", "");
            }
        }
    }

    public void setupRunJSTask(final @NonNull ReactContext reactContext, final String useSessUUID) {
        hceModule = (RTNHCEAndroidModule) reactContext.getNativeModule("NativeHCEModule");

        if (hceModule == null) {
            throw new RuntimeException("BUG! getNativeModule() returned null in background.");
        }

        hceModule.setHCEService(this);

        UiThreadUtil.runOnUiThread(() -> {
            Log.d(TAG, "HCEService:setupRunJSTask:runOnUiThread startTask");
            Bundle argBundle = new Bundle();
            argBundle.putString("handle", useSessUUID);
            HeadlessJsTaskContext headlessJsTaskContext = Companion.getInstance(reactContext);
            int taskId = headlessJsTaskContext.startTask(
                    new HeadlessJsTaskConfig(
                            "handleBackgroundHCECall",
                            Arguments.fromBundle(argBundle),
                            15000,
                            false // not allowed in foreground
                    ));
            taskSessionIdMap.put(useSessUUID, taskId);
        });
    }

    @Override
    public void onDestroy() {
        super.onDestroy();

        Log.d(TAG, "HCEService:onDestroy");
    }
}
