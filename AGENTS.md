# AGENTS.md

Guidance for coding agents working in this repository.

## What this repository is

A Yarn 4 workspaces monorepo:

- `packages/host-card-emulation` - the published library `@icedevml/react-native-host-card-emulation`:
  Host Card Emulation (HCE) for React Native, implemented as a TurboModule (New Architecture only)
  for Android (`HostApduService`) and iOS 17.4+ (`CoreNFC` `CardSession`).
- `packages/demo-ndef-app` - private demo app (NFC Forum Type 4 Tag / NDEF emulator) consuming the
  library through `workspace:^`. It is also the only project that compiles the library's native code.

The root `package.json` has no scripts. Run commands inside the workspace directories.

## Setup and commands

- Node.js (CI uses 26, the demo requires >= 22.11) and Yarn 4 through Corepack:
  `corepack enable && yarn install` at the repository root. Dependencies are hoisted to the root `node_modules`.
- Library tests: `cd packages/host-card-emulation && yarn test`
- Library type-check: `cd packages/host-card-emulation && yarn typecheck`. Its `tsconfig.json` enables
  the strictest compiler options on purpose: the TS sources are published and apps type-check them with
  their own settings, so keep the sources compiling under all of them.
- Demo type-check and tests: `cd packages/demo-ndef-app && yarn tsc && yarn test`
- Android JVM tests of the native module (JUnit, Robolectric, Mockito; `android/src/test`, needs the Android SDK
  and `yarn install`): `cd packages/demo-ndef-app/android && ./gradlew :icedevml_react-native-host-card-emulation:testDebugUnitTest`
- CI runs the library type-check and tests, the demo tests, `yarn pack` and the Android JVM tests.
- Lint (demo only): `cd packages/demo-ndef-app && yarn lint` (the `no-bitwise` warnings in `ndef-lib/` are expected).
- Android build (Android SDK, NDK 27.1, a JDK 17 installation - the React Native Gradle plugin requests
  a Java 17 toolchain): `cd packages/demo-ndef-app/android && ./gradlew assembleDebug`.
  Only the library module: `./gradlew :icedevml_react-native-host-card-emulation:compileDebugJavaWithJavac`
- iOS build (macOS only): `cd packages/demo-ndef-app/ios && bundle install && bundle exec pod install`,
  then build `DemoHCEModuleIOSApp.xcworkspace` in Xcode.
- Published file list: `cd packages/host-card-emulation && npm pack --dry-run` (controlled by `files` in `package.json`).

HCE can't be exercised in emulators or simulators: it needs a physical device and an NFC reader, and on iOS
also an Apple HCE entitlement (EEA). Native changes can usually only be compiled, not run - say so in your report.
The Android routing state machine (`HCEManager`) is covered by the JVM tests, extend them when changing it.

## Library layout

- `js/index.ts` - public entry point: the `HCE` object (default export), `HCEError`, hex helpers, types.
- `js/types.ts` - public types. Their JSDoc is user-facing documentation (the TS sources are shipped).
- `js/session.ts` - foreground sessions (`HCE.beginSession()`, `HCESession`).
- `js/background.ts` - Android background handler (`HCE.registerBackgroundHandler()`, headless JS task).
- `js/internal.ts` - event routing by session ID, `SerialQueue`, handler timeouts, `processApdu()`.
- `js/NativeHCEModule.ts` - codegen spec of the TurboModule `NativeHCEModule` (codegen library `RTNHCEModuleSpec`).
  Internal, apps must not use it directly.
- `jest/` - published Jest mock of the native module (`NativeHCEModuleMock.js` + `.d.ts`, simulates the native
  side) and `setup.js`, which installs it. Used by the library's and the demo's tests and by the apps' tests.
- `android/src/main/java/com/itsecrnd/rtnhceandroid/`
  - `HCEManager.java` - process-wide state machine: the foreground session, the current activation, routing,
    status words. Start here for any Android behavior. Its `ApduService` and `HeadlessTasks` interfaces are
    replaced in `android/src/test/.../HCEManagerTest.java` (not published, excluded in `files`).
  - `HCEService.java` - thin `HostApduService` adapter. Its callbacks must never throw (that crashes the app process).
  - `RTNHCEAndroidModule.java` - the TurboModule, also manages `CardEmulation.setPreferredService()`.
  - `BinaryUtils.java` - derived from Apache-2.0 code, keep its license header.
- `ios/RTNHCEModuleIOS.mm` - ObjC++ TurboModule, forwards everything to `ios/RTNHCEModuleIOSImpl.swift`
  (all the logic, `@available(iOS 17.4, *)`) and answers "unsupported" on older iOS.
- `RTNHCEModuleIOS.podspec` (CocoaPods, version read from `package.json`), `Package.swift` and
  `react-native-spm-prefix.h` (experimental SwiftPM autolinking, React Native 0.87+).
- There is no build step: `main`/`types` point to `js/index.ts` and the app's Metro compiles it.

## How it works (keep these invariants)

- A single native event stream `onEvent` carries `{sessionId, type, apduId, command, deviceLocked, reason}`,
  `type` is one of `sessionStarted`, `readerDetected`, `readerLost`, `apdu`, `sessionInvalidated`.
  JS routes events by `sessionId`. Foreground session IDs are generated in JS (`fg-...`),
  background ones by Android (UUID).
- Every `apdu` event is answered exactly once with `respondApdu(sessionId, apduId, hex)`. Responses are bound
  to `apduId`, a stale one is rejected natively with `err_stale_apdu` (expected, ignored by JS).
  C-APDUs of sessions nobody listens to are answered with `6F00` by JS.
- The handlers of one session (or one background interaction) run one at a time through `SerialQueue`,
  each call is bounded by `handlerTimeout` (default 10 s). Once a session is closed, the events still waiting
  in its queue are dropped (C-APDUs answered with `6F00`), only `onInvalidated()` runs.
- Android: every interaction handled by a foreground session runs under the headless JS task
  `keepAliveHCESession` (the key is duplicated in `js/session.ts` and `HCEManager.java`), which keeps JS timers
  running while the app is in background. JS finishes it once the handlers of that interaction have finished.
- Android: an activation is the link with a reader from the first C-APDU until `onDeactivated()`. Routing is
  decided when it starts: foreground session with running emulation, else the background handler (headless
  JS task `handleBackgroundHCECall`, the key is duplicated in `js/background.ts` and `HCEManager.java`), else
  rejected (`6A82` for SELECT, `6985` otherwise). The background handler is only used if the app enables it with
  the `com.itsecrnd.rtnhceandroid.background_handler_enabled` meta-data of `HCEService` (disabled by default,
  then React Native is never started for a reader). It waits up to 15 s for React Native to start and for JS to
  call `setBackgroundHandlerRegistered()`.
- Android threading: `HCEManager` methods are `synchronized` and run on the main thread (service callbacks,
  headless task events) and on the JS / native modules threads. Never block on another thread while holding
  the lock. `HeadlessJsTaskContext` must be used on the main thread.
- iOS threading: the mutable state of `RTNHCEModuleIOSImpl` is guarded by `lock`, never hold it across `await`.
  Only one `CardSession` may exist per process, `beginSession` waits for the previous (invalidated) starts
  and event loops to end. An invalidated start frees the slot right away, like Android does. Separate `Task`s
  run in an undefined order, so `startEmulation`, `stopEmulation` and `isEmulationRunning` are chained in call
  order (`enqueueOperation()`); `invalidateSession` and `respondApdu` must never wait for that chain.
- Lock screen: `allowWhenLocked` (default `false`) is Android only and enforced natively, the apps also keep
  `android:requireDeviceUnlock="true"` unless they work on the lock screen. iOS can't do HCE while locked,
  `deviceLocked` is always `false` there.

## Platform gotchas

- TurboModule methods returning `void` or a `Promise` run asynchronously, in call order, on the module's
  native queue. Methods returning a value (`isExclusiveNFC()`, `backgroundSessionReady()`) run synchronously
  on the JS thread, so they are not ordered with the asynchronous ones.
- On Android, JS timers (`setTimeout`) are paused while the app is not resumed, unless a headless JS task
  is running. Promises and native events still work. Don't make anything that runs in background depend
  on a timer (e.g. the background handler declaration uses a microtask).
- `KeyguardManager.isDeviceLocked()` is `false` on devices without a secure lock screen.

## Changing the native API

A change in `js/NativeHCEModule.ts` must be mirrored in `RTNHCEAndroidModule.java`, `ios/RTNHCEModuleIOS.mm`,
`ios/RTNHCEModuleIOSImpl.swift` and in the Jest mock (`jest/NativeHCEModuleMock.js` and `.d.ts`). Codegen output is
not committed, it's generated by the demo's Gradle build and by `pod install` - rebuild the demo to check it.
Event type strings, `err_*` error codes and status words are duplicated across JS, Java, Swift and the README
tables, search for every occurrence when changing one.

## Conventions

- TypeScript in the library: 2 spaces, single quotes, no spaces inside braces (`{HCEError}`), trailing commas,
  lines up to ~120 characters. The demo follows its `.prettierrc.js` (spaces inside braces). Java: 4 spaces,
  Swift: 2 spaces.
- Comments explain why (threading, ordering, platform quirks), not what.
- Errors reaching the app are `HCEError` instances with a `code`. Native rejections use the same `err_*` codes
  and JS converts them with `callNative()` / `toHCEError()` (`js/internal.ts`), wrap every new native call too.
- Never log APDU contents in the library: `console.log()` and logcat are readable in release builds.
  The demo logs them on purpose (documented in its README).
- Cover JS behavior changes with tests in `__tests__/hce.test.ts`. The native module is replaced there by
  `jest/NativeHCEModuleMock.js` (installed by `jest/setup.js`): inject native events with `emitEvent()`,
  simulate the reader with `sendApdu()`. Mocks registered with `jest.mock()` are shared by `jest.isolateModules()`.
- The user documentation is `packages/host-card-emulation/README.md` (published to npm). Keep its API
  sections, the error code and status word tables and "Migrating to 2.x" in sync with the code.
  The root `README.md` only links the packages.

## CI and releases

- `.github/workflows/nodejs-package.yml`: every push (and every pull request from a fork) runs
  `yarn install --immutable`, the type-check, the tests and `npm pack --dry-run` (job `build`) and the Android JVM
  tests (job `android`). Creating a GitHub Release runs `publish-npm` (environment `production`, npm trusted
  publishing with provenance) once both have passed. Never publish manually.
- Supply chain: `publish-npm` holds the OIDC token that can publish the package, so it must never install
  dependencies or run any third-party code: it publishes the tarball of `npm pack --ignore-scripts` (the package
  has no build step). The install scripts of the dependencies are disabled (`enableScripts: false` in
  `.yarnrc.yml`); if a dependency really needs its script, allow only that one through `dependenciesMeta`.
- The version lives in `packages/host-card-emulation/package.json`, version bumps are separate PRs
  ("Bump version to X.Y.Z"). Work on a branch and open a PR against `master`.
- GitHub Actions are pinned by commit SHA, keep it that way when updating them.
- `packages/host-card-emulation/LICENSE` is a copy of the root `LICENSE` (only the package's own one gets
  published), keep them identical.
