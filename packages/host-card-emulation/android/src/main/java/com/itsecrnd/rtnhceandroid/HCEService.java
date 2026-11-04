/*
 * Some of the code inspired by:
 * https://github.com/appidea/react-native-hce
 * https://github.com/transistorsoft/react-native-background-fetch
 */

package com.itsecrnd.rtnhceandroid;

import android.app.KeyguardManager;
import android.content.Context;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;
import android.util.Log;

/**
 * Thin adapter between the Android NFC stack and HCEManager, which holds all the state.
 * None of the callbacks is allowed to throw, as that would crash the whole app process.
 */
public class HCEService extends HostApduService {
    private static final String TAG = "HCEService";

    private boolean isDeviceLocked() {
        /*
         The KeyguardManager has to be obtained lazily, as the service's context
         is not yet attached when the instance is being constructed.
         */
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return keyguardManager != null && keyguardManager.isDeviceLocked();
    }

    @Override
    public byte[] processCommandApdu(byte[] command, Bundle extras) {
        try {
            // binder call, so it's done before entering HCEManager's critical section
            boolean deviceLocked = isDeviceLocked();
            return HCEManager.getInstance().onCommand(this, command, deviceLocked);
        } catch (RuntimeException e) {
            Log.e(TAG, "processCommandApdu failed", e);
            return HCEManager.SW_NO_PRECISE_DIAGNOSIS.clone();
        }
    }

    @Override
    public void onDeactivated(int reason) {
        try {
            HCEManager.getInstance().onDeactivated(this, reason);
        } catch (RuntimeException e) {
            Log.e(TAG, "onDeactivated failed", e);
        }
    }

    @Override
    public void onDestroy() {
        try {
            HCEManager.getInstance().onServiceDestroyed(this);
        } catch (RuntimeException e) {
            Log.e(TAG, "onDestroy failed", e);
        }

        super.onDestroy();
    }
}
