// swift-tools-version: 6.0
//
// Swift Package Manager support for React Native's SwiftPM autolinking (react-native >= 0.87, experimental).
// CocoaPods users are unaffected, see RTNHCEModuleIOS.podspec.
//
// This package mixes Swift and Objective-C(++) sources, which Swift Package Manager can't compile
// in a single target. The ObjC++ TurboModule (RTNHCEModuleIOS.mm) calls into the Swift implementation
// (RTNHCEModuleIOSImpl.swift), so the ObjC target depends on the Swift target and never the reverse.
//
// The two React Native packages are resolved by the autolinker relative to
// build/generated/autolinking/libs/<package> in the app.
import PackageDescription

let reactHeaders: [Target.Dependency] = [
    .product(name: "ReactHeaders", package: "ReactNative"),
    .product(name: "ReactNativeHeaders", package: "ReactNative"),
    .product(name: "ReactNativeDependenciesHeaders", package: "ReactNative"),
    .product(name: "ReactAppHeaders", package: "React-GeneratedCode"),
]

let package = Package(
    name: "ReactNativeHostCardEmulation",
    // React Native's minimum, the generated Autolinked aggregate never targets a lower version.
    // HCE itself requires iOS 17.4, which is checked at runtime.
    platforms: [.iOS("15.1")],
    products: [
        .library(name: "ReactNativeHostCardEmulation", targets: ["ReactNativeHostCardEmulationSwift", "ReactNativeHostCardEmulationObjC"]),
    ],
    dependencies: [
        .package(name: "ReactNative", path: "../../../../xcframeworks"),
        .package(name: "React-GeneratedCode", path: "../../../ios"),
    ],
    targets: [
        .target(
            name: "ReactNativeHostCardEmulationSwift",
            dependencies: reactHeaders,
            path: ".",
            exclude: [
                "ios/RTNHCEModuleIOS-Bridging-Header.h",
                "ios/RTNHCEModuleIOS.h",
                "ios/RTNHCEModuleIOS.mm",
            ],
            sources: [
                "ios/RTNHCEModuleIOSImpl.swift",
            ],
            linkerSettings: [
                .linkedFramework("CoreNFC"),
                .linkedFramework("UIKit"),
                .linkedFramework("Foundation"),
            ]
        ),
        .target(
            name: "ReactNativeHostCardEmulationObjC",
            dependencies: reactHeaders + ["ReactNativeHostCardEmulationSwift"],
            path: ".",
            sources: [
                "ios/RTNHCEModuleIOS-Bridging-Header.h",
                "ios/RTNHCEModuleIOS.h",
                "ios/RTNHCEModuleIOS.mm",
            ],
            publicHeadersPath: "ios",
            cSettings: [
                // SwiftPM autolinking is New Architecture only; CocoaPods gets this from install_modules_dependencies.
                .define("RCT_NEW_ARCH_ENABLED", to: "1"),
                .headerSearchPath("ios"),
                .headerSearchPath("."),
                .unsafeFlags(["-include", "react-native-spm-prefix.h"]),
            ],
            cxxSettings: [
                .define("RCT_NEW_ARCH_ENABLED", to: "1"),
                .headerSearchPath("ios"),
                .headerSearchPath("."),
                .unsafeFlags(["-include", "react-native-spm-prefix.h"]),
                .define("DEBUG", .when(configuration: .debug)),
                .define("NDEBUG", .when(configuration: .release)),
            ],
            linkerSettings: [
                .linkedFramework("CoreNFC"),
                .linkedFramework("UIKit"),
                .linkedFramework("Foundation"),
                .linkedFramework("CoreGraphics"),
            ]
        ),
    ],
    swiftLanguageModes: [.v5],
    cxxLanguageStandard: .cxx20
)
