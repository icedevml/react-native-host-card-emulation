package com.itsecrnd.rtnhceandroid;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;

import java.util.HashMap;
import java.util.Map;

public class RTNHCEAndroidPackage extends BaseReactPackage {
    @Nullable
    @Override
    public NativeModule getModule(@NonNull String name, @NonNull ReactApplicationContext reactContext) {
        if (name.equals(RTNHCEAndroidModule.NAME)) {
            return new RTNHCEAndroidModule(reactContext);
        } else {
            return null;
        }
    }

    @NonNull
    @Override
    public ReactModuleInfoProvider getReactModuleInfoProvider() {
        return () -> {
            final Map<String, ReactModuleInfo> moduleInfos = new HashMap<>();
            moduleInfos.put(
                    RTNHCEAndroidModule.NAME,
                    new ReactModuleInfo(
                            RTNHCEAndroidModule.NAME,
                            RTNHCEAndroidModule.NAME,
                            false, // canOverrideExistingModule
                            false, // needsEagerInit
                            false, // isCxxModule
                            true // isTurboModule
                    ));
            return moduleInfos;
        };
    }
}
