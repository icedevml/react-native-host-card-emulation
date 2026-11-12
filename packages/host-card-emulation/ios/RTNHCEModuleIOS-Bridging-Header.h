// Not used as a bridging header, but keep it: CocoaPods puts this public header into the pod's umbrella header,
// which is how RTNHCEModuleIOSImpl.swift gets RCTPromiseResolveBlock/RCTPromiseRejectBlock without importing React.
// The SwiftPM target doesn't use it, the Swift sources `import React` there (see Package.swift).
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
