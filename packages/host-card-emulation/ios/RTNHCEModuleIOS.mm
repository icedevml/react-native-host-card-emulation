#import "RTNHCEModuleIOS.h"

#if __has_include("RCTDefaultReactNativeFactoryDelegate.h")
#import "RCTDefaultReactNativeFactoryDelegate.h"
#endif

// the header generated from the Swift sources is named after the module:
// "RTNHCEModuleIOS" (CocoaPods) or "ReactNativeHostCardEmulationSwift" (SwiftPM)
#if __has_include("RTNHCEModuleIOS-Swift.h")
#import "RTNHCEModuleIOS-Swift.h"
#elif __has_include(<RTNHCEModuleIOS/RTNHCEModuleIOS-Swift.h>)
#import <RTNHCEModuleIOS/RTNHCEModuleIOS-Swift.h>
#else
#import "ReactNativeHostCardEmulationSwift-Swift.h"
#endif

static NSString *const kUnsupportedCode = @"err_platform_unsupported";
static NSString *const kUnsupportedMessage = @"This iOS version does not support HCE.";

@implementation RTNHCEModuleIOS {
    API_AVAILABLE(ios(17.4))
    RTNHCEModuleIOSImpl *hcemoduleios;
}

-(id) init {
    self = [super init];

    if (@available(iOS 17.4, *)) {
        __weak RTNHCEModuleIOS *weakSelf = self;

        hcemoduleios = [RTNHCEModuleIOSImpl new];
        [hcemoduleios setEmitOnEventWithEmitOnEvent:^(NSDictionary *value){
            [weakSelf emitOnEvent:value];
        }];
    }

    return(self);
}

// called by React Native when the module is torn down (e.g. JS reload)
- (void)invalidate {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios invalidateAll];
    }
}

- (void)dealloc {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios invalidateAll];
    }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::NativeHCEModuleSpecJSI>(params);
}

- (void)getCapabilities:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios getCapabilitiesWithResolve:resolve reject:reject];
    } else {
        resolve(@{
            @"platform": @"ios",
            @"hceSupported": @NO,
            @"nfcEnabled": @NO,
            @"eligible": @NO,
            @"backgroundSupported": @NO,
            @"presentmentSupported": @NO,
        });
    }
}

- (void)acquireExclusiveNFC:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios acquireExclusiveNFCWithResolve:resolve reject:reject];
    } else {
        reject(kUnsupportedCode, kUnsupportedMessage, nil);
    }
}

- (void)releaseExclusiveNFC {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios releaseExclusiveNFC];
    }
}

- (nonnull NSNumber *)isExclusiveNFC {
    if (@available(iOS 17.4, *)) {
        return [hcemoduleios isExclusiveNFC] ? @YES : @NO;
    }

    return @NO;
}

// allowWhenLocked is ignored, it's impossible to communicate over HCE while the device is locked
- (void)beginSession:(nonnull NSString *)sessionId allowWhenLocked:(BOOL)allowWhenLocked resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios beginSessionWithSessionId:sessionId resolve:resolve reject:reject];
    } else {
        reject(kUnsupportedCode, kUnsupportedMessage, nil);
    }
}

- (void)invalidateSession:(nonnull NSString *)sessionId {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios invalidateSessionWithSessionId:sessionId];
    }
}

- (void)setSessionAlertMessage:(nonnull NSString *)sessionId message:(nonnull NSString *)message {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios setSessionAlertMessageWithSessionId:sessionId message:message];
    }
}

- (void)startEmulation:(nonnull NSString *)sessionId resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios startEmulationWithSessionId:sessionId resolve:resolve reject:reject];
    } else {
        reject(kUnsupportedCode, kUnsupportedMessage, nil);
    }
}

- (void)stopEmulation:(nonnull NSString *)sessionId status:(nonnull NSString *)status resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios stopEmulationWithSessionId:sessionId status:status resolve:resolve reject:reject];
    } else {
        reject(kUnsupportedCode, kUnsupportedMessage, nil);
    }
}

- (void)isEmulationRunning:(nonnull NSString *)sessionId resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios isEmulationRunningWithSessionId:sessionId resolve:resolve reject:reject];
    } else {
        resolve(@NO);
    }
}

- (void)respondApdu:(nonnull NSString *)sessionId apduId:(double)apduId rapdu:(nonnull NSString *)rapdu resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
    if (@available(iOS 17.4, *)) {
        [hcemoduleios respondApduWithSessionId:sessionId apduId:apduId rapdu:rapdu resolve:resolve reject:reject];
    } else {
        reject(kUnsupportedCode, kUnsupportedMessage, nil);
    }
}

- (void)setBackgroundHandlerRegistered:(BOOL)registered allowWhenLocked:(BOOL)allowWhenLocked {
    // background HCE is not supported on iOS, no-op
}

- (nonnull NSNumber *)backgroundSessionReady:(nonnull NSString *)sessionId {
    // background HCE is not supported on iOS
    return @NO;
}

- (nonnull NSNumber *)isBackgroundHandlerEnabled {
    // background HCE is not supported on iOS
    return @NO;
}

+ (NSString *)moduleName {
    return @"NativeHCEModule";
}

@end
