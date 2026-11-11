package com.itsecrnd.rtnhceandroid;

import android.content.pm.PackageManager;
import android.nfc.NfcAdapter;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.jstasks.HeadlessJsTaskEventListener;

public class RTNHCEAndroidModule extends NativeHCEModuleSpec {
    public static final String TAG = "RTNHCEAndroidModule";
    public static final String NAME = "NativeHCEModule";

    // null until the JS side declares whether it has a background handler
    private volatile Boolean backgroundHandlerRegistered;

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

    RTNHCEAndroidModule(ReactApplicationContext context) {
        super(context);
        HeadlessJsTaskContext.getInstance(context).addTaskEventListener(headlessJsTaskEventListener);
    }

    @Override
    public void invalidate() {
        Log.d(TAG, "invalidate");
        HeadlessJsTaskContext.getInstance(getReactApplicationContext()).removeTaskEventListener(headlessJsTaskEventListener);
        HCEManager.getInstance().onModuleInvalidated(this);
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
    Boolean getBackgroundHandlerRegistered() {
        return backgroundHandlerRegistered;
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
        map.putBoolean("backgroundSupported", hceSupported);
        map.putBoolean("presentmentSupported", false);
        promise.resolve(map);
    }

    @Override
    public void beginSession(String sessionId, Promise promise) {
        if (!isHCESupported()) {
            promise.reject("err_platform_unsupported", "The device doesn't support NFC host card emulation.");
            return;
        }

        try {
            HCEManager.getInstance().beginSession(this, sessionId);
        } catch (IllegalStateException e) {
            promise.reject("err_session_exists", "A session already exists.");
            return;
        }

        promise.resolve(null);
    }

    @Override
    public void invalidateSession(String sessionId) {
        HCEManager.getInstance().invalidateSession(this, sessionId);
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
    public void setBackgroundHandlerRegistered(boolean registered) {
        this.backgroundHandlerRegistered = registered;
        UiThreadUtil.runOnUiThread(() -> HCEManager.getInstance().onBackgroundHandlerDeclared(this));
    }

    @Override
    public boolean backgroundSessionReady(String sessionId) {
        return HCEManager.getInstance().backgroundSessionReady(this, sessionId);
    }
}
