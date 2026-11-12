# React Native Package: @icedevml/react-native-host-card-emulation

Host Card Emulation Module for React Native on iOS and Android platforms.

> [!NOTE]
> Pull requests are welcome! Please [report an issue](https://github.com/icedevml/react-native-host-card-emulation/issues) if you encounter any difficulties.

> [!IMPORTANT]  
> As per Apple's policy, **Host Card Emulation feature is only available for users based in the European
> Economic Area (EEA)** with an iPhone running iOS 17.4 or later. Applications require a special HCE entitlement
> in order to use this feature, which is managed by Apple. Read more in the official support article:
> "[HCE-based contactless NFC transactions for apps in the European Economic Area (EEA)](https://developer.apple.com/support/hce-transactions-in-apps/)".
>
> However, you can still use this package without any limitations if you only want to cover for Android implementation.

## Prerequisites
This package was designed for React Native [New Architecture](https://reactnative.dev/architecture/landing-page) only.
Make sure that your project has it enabled. Note that the New Architecture is enabled by default for React Native 0.76+ projects.

### iOS
1. Ensure that you are enrolled as organization (not individual) in Apple Developer Program, and that you are established in the European Economic Area (EEA).
2. Ensure that you meet other [non-technical requirements imposed by Apple](https://developer.apple.com/support/hce-transactions-in-apps/#requirements-and-availability).
3. Find out the Bundle ID of your existing application or [register a new Bundle ID](https://developer.apple.com/account/resources/identifiers/bundleId/add/bundle).
4. [Request the HCE Entitlement](https://developer.apple.com/contact/request/hce-entitlement/) for your application's bundle ID.
5. Wait until the entitlement is approved by Apple.

### Android
1. Ensure that your app's `minSdkVersion` is at least 24 (Android 7.0). This is the floor imposed by React Native's New Architecture; the Host Card Emulation APIs used by this package are available since Android 5.1.
2. Note that HCE availability also depends on the device hardware - always check `isPlatformSupported()` before starting a session.

## Installation
Install this package within your React Native project:

```
yarn add @icedevml/react-native-host-card-emulation
```
or using npm
```
npm install --save @icedevml/react-native-host-card-emulation
```

Afterwards, follow the subsections below for each platform that you need to support.

### iOS
1. Make sure to set up a proper signing team and bundle identifier in "Signing & Capabilities" configuration section of your project.
2. Add Host Card Emulation (HCE) entitlement with desired AIDs. This could be done either through XCode (by clicking "+ Capability") or within the entitlements XML file directly. Example:
    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>com.apple.developer.nfc.hce</key>
        <true/>
        <key>com.apple.developer.nfc.hce.iso7816.select-identifier-prefixes</key>
        <array>
            <string>F001020304</string>
            <string>F00102030405</string>
            <string>F0010203040506</string>
        </array>
    </dict>
    </plist>
    ```
   Replace `F001020304`, `F00102030405`, `F0010203040506` with the ISO7816 AIDs that you want to support.
3. In the `ios/` app's subdirectory, run `bundle install && bundle exec pod install`.

   Alternatively, with React Native 0.87+ you can use the experimental Swift Package Manager integration instead of
   CocoaPods - the package ships a `Package.swift` manifest for React Native's SwiftPM autolinking.

### Android
1. In `android/app/src/main/AndroidManifest.xml` add:
   ```diff
    <manifest xmlns:android="http://schemas.android.com/apk/res/android">
      ...

   +  <uses-permission android:name="android.permission.NFC" />
   +  <!-- set required="true" if your app would be entirely useless on devices without HCE support -->
   +  <uses-feature android:name="android.hardware.nfc.hce" android:required="false" />

      ...

      <application
        ...
        >

        ...
   
   +    <service
   +      android:name="com.itsecrnd.rtnhceandroid.HCEService"
   +      android:exported="true"
   +      android:enabled="true"
   +      android:permission="android.permission.BIND_NFC_SERVICE">
   +      <intent-filter>
   +        <action android:name="android.nfc.cardemulation.action.HOST_APDU_SERVICE" />
   +        <category android:name="android.intent.category.DEFAULT"/>
   +      </intent-filter>
   +
   +      <meta-data
   +        android:name="android.nfc.cardemulation.host_apdu_service"
   +        android:resource="@xml/aid_list" />
   +    </service>
      </application>
    </manifest>
   ```
2. Create file `android/app/src/main/res/xml/aid_list.xml`:
   ```xml
   <host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
     android:description="@string/app_name"
     android:requireDeviceUnlock="false"
     android:requireDeviceScreenOn="true">
     <aid-group android:category="other"
       android:description="@string/app_name">
       <aid-filter android:name="F001020304" />
       <aid-filter android:name="F00102030405" />
       <aid-filter android:name="F0010203040506" />
     </aid-group>
   </host-apdu-service>
   ```
   Replace `F001020304`, `F00102030405`, `F0010203040506` with the ISO7816 AIDs that you want to support.

   Always keep `android:requireDeviceUnlock` set to `false`. With `true`, Android displays its own native prompts
   whenever a reader is tapped while the phone is locked (e.g. "unlock the phone to complete the payment"), which
   confuses the users, especially if your app isn't related to payments. Control the lock screen behavior with
   the `allowWhenLocked` option instead (see [Interactions while the device is locked](#android-interactions-while-the-device-is-locked)).

   For `android:requireDeviceScreenOn` - set it according to your use case.

## API

> [!NOTE]
> Version 1.0 introduced a new API, which is not compatible with 0.x versions. See [Migrating from 0.x](#migrating-from-0x).

```typescript
import HCE from '@icedevml/react-native-host-card-emulation';
```

The library guarantees that **every C-APDU is responded to exactly once**: your handler returns the R-APDU and the library
sends it. If the handler throws an exception or returns an invalid response, the reader receives the `6F00` status word
(no precise diagnosis). Responses are bound to the C-APDU they were produced for, so a late response can never be sent
as a reply to a different command.

All the handlers of a given session are called sequentially - the next event is never delivered before the handler
of the previous one has finished (including the returned promise). A handler that doesn't finish within the handler
timeout (10 seconds by default) is abandoned: its result is ignored, `onError` receives an `err_handler_timeout` error
and the next event is delivered (a timed out `onApdu` is responded to with `6F00`). This way, a single stuck promise
can't block the session or the background interaction forever.

> [!WARNING]
> Don't log the APDUs in production apps. On Android, `console.log()` ends up in the system log (logcat) also in release
> builds, and the APDUs might carry sensitive data (tokens, credentials, personal data). The demo app does log them,
> but only for the demo purposes.

See [Source Code for Demo Application: NDEF NFC Type 4 Tag Emulator (for iOS/Android)](https://github.com/icedevml/react-native-host-card-emulation/tree/master/packages/demo-ndef-app) for a complete example.

### Checking device capabilities

```typescript
const caps = await HCE.getCapabilities();
// {
//   platform: 'android' | 'ios',
//   hceSupported: boolean,         // device & OS support HCE at all
//   nfcEnabled: boolean,           // NFC is turned on (Android) / available (iOS)
//   eligible: boolean,             // iOS: CardSession.isEligible (region, entitlement); Android: same as hceSupported
//   backgroundSupported: boolean,  // registerBackgroundHandler() is supported (Android)
//   presentmentSupported: boolean, // acquireExclusiveNFC() is supported (iOS)
// }
```

### Quick start guide

1. When the user indicates that they want to perform the HCE action, begin the session and start the emulation:
   ```typescript
   const session = await HCE.beginSession({
       // required: return the R-APDU (including the status word) for the given C-APDU
       onApdu: async (apdu) => {
           // apdu.command: Uint8Array, apdu.deviceLocked: boolean
           // for the demo purposes, we always respond with [0x0A] + status code 0x9000 (success)
           return new Uint8Array([0x0A, 0x90, 0x00]);
       },
       onReaderDetected: () => session.setAlertMessage('Reader detected'),  // only for iOS, no-op on Android
       onReaderLost: () => session.setAlertMessage('Lost reader'),          // only for iOS, no-op on Android
       onInvalidated: (reason) => console.log('session closed', reason),
       onError: (error) => console.warn('HCE handler error', error),
   });

   session.setAlertMessage('Tap towards the reader');  // only for iOS, no-op on Android
   await session.startEmulation();
   ```
   `beginSession()` resolves once the session is started and ready for `startEmulation()`. Only a single session can be
   active at a time, `beginSession()` rejects with `err_session_exists` otherwise.

   The optional second argument accepts:
   ```typescript
   await HCE.beginSession(handlers, {
       signal,                  // AbortSignal, aborting it invalidates the session (see below)
       handlerTimeout: 10000,   // ms, the default; 0 or Infinity disables the timeout
       allowWhenLocked: true,   // Android: the default; see "Interactions while the device is locked"
   });
   ```

   Calling `await session.startEmulation()` causes:
   * iOS: Your smartphone will start listening for C-APDUs (Command APDUs originating from reader devices) right after that function is called, which will be additionally indicated by the operating system popping out the NFC scanning user interface prompt.
   * Android: C-APDUs will be forwarded to this session from that point on. No specific user interface is displayed (you have to implement it on your own, within your app).

2. Close the session whenever you don't need it anymore:
   ```typescript
   await session.stopEmulation('success');  // iOS: 'success' / 'failure' UI status; Android: status is ignored
   session.invalidate();                   // idempotent
   ```
   `session.closed` is a promise that resolves with the reason once the session is closed (by you or by the OS).

3. Within React components, pass an `AbortSignal`, so the session is always closed when the component is unmounted -
   even if it's still being started at that time:
   ```typescript
   useEffect(() => {
       const controller = new AbortController();

       (async () => {
           const session = await HCE.beginSession({ onApdu }, { signal: controller.signal });
           await session.startEmulation();
       })().catch((e) => {
           if (!controller.signal.aborted) {
               console.error(e);
           }
       });

       // aborting invalidates the session
       return () => controller.abort();
   }, []);
   ```

#### Events

For the reader-related handlers, trigger mechanisms are platform dependent:
* iOS: `onReaderDetected` is called as soon as the NFC reader's field presence is observed. `onReaderLost` is called if the reader is physically disconnected or a non-matching AID is selected by the reader.
* Android: `onReaderDetected` is called as soon as the first matching SELECT AID command is observed. `onReaderLost` is called if the reader is physically disconnected, a non-matching AID is selected by the reader or the emulation is stopped.

The `deviceLocked` flag of each C-APDU:
* iOS: Always `false` - it's impossible to communicate over HCE while the device is locked.
* Android: Sampled when the C-APDU arrives. Always `false` on devices without a secure lock screen (PIN, pattern, password, biometrics).

#### Android: Interactions while the device is locked

By default (`allowWhenLocked: true`), the C-APDUs are delivered to your handlers also while the device is locked
and it's up to you to decide what to do based on the `deviceLocked` flag.

> [!IMPORTANT]
> If your app isn't meant to be used on the lock screen, pass `allowWhenLocked: false` to both `HCE.beginSession()`
> and `HCE.registerBackgroundHandler()`. The C-APDUs received while the device is locked are then rejected by the native
> side (see the status words below) and never reach your JS code - in background, not even the handler factory is called.
> Remember that with the background handler, anybody who is able to tap a reader to the locked phone can interact with your app.

Keep `android:requireDeviceUnlock="false"` in `aid_list.xml` regardless of this option (see [Installation](#installation)).

#### Status words sent by the library

| Situation | Status word |
|---|---|
| The handler has thrown an exception or returned an invalid response | `6F00` (no precise diagnosis) |
| Android: nobody can handle the interaction (or the device is locked with `allowWhenLocked: false`), response to SELECT | `6A82` (file or application not found) |
| Android: nobody can handle the interaction (or the device is locked with `allowWhenLocked: false`), response to other commands | `6985` (conditions of use not satisfied) |

### iOS: Acquiring exclusive NFC access

If you need to utilize `NFCPresentmentIntentAssertion` for enhanced user experience, call:
```typescript
await HCE.acquireExclusiveNFC();
```
This function will acquire an exclusive NFC access for 15 seconds. No system services or other applications will be able to interfere with NFC during that period. For example, the NFC background tag reading will be disabled so it would not generate any distracting notifications.

While both session and exclusive NFC access are active, `onReaderDetected` is called even when the emulation is not started at the time (without any explicit UI being displayed by the system). You can then call `session.startEmulation()` from within that handler to initiate the interaction automatically, without needing the user to click anything beforehand.

This function will throw an exception if:
* the presentment intent assertion was already acquired and is still active;
* you are in the cooldown period where you are not allowed to acquire the presentment intent assertion (cooldown is 15 seconds after the previous assertion had expired);
* the feature is not supported or the device is not eligible for whatever reason (rejects with `err_platform_unsupported` on Android).

You can check if you are holding an exclusive NFC access by calling `HCE.isExclusiveNFC()`. Whenever you don't need the exclusive NFC access anymore, call `HCE.releaseExclusiveNFC()`.

> [!TIP]
> Your exclusive NFC access might time out after exceeding certain allowance period imposed by iOS. Thus, you should periodically poll
> the `HCE.isExclusiveNFC()` value to see if it's still granted.

> [!TIP]
> Use the React's [AppState](https://reactnative.dev/docs/appstate) listener to see when your app goes out to background
> and call `HCE.releaseExclusiveNFC()` in such event. The operating system is not going to enforce your exclusive NFC access
> anyway, as your app has gone to background.

### Android: Handling HCE interactions without an active session

Exclusively on Android platform it is possible to handle HCE interactions while the app has no session with running
emulation. The background handler is used when:
* the app is not running at all (it's started in headless mode, no user interface is available);
* the app is in background;
* the app is in foreground, but it has no session with running emulation.

Register the handler at the top level of your app's entry file (`index.js`):
```typescript
import { AppRegistry } from 'react-native';
import HCE from '@icedevml/react-native-host-card-emulation';

HCE.registerBackgroundHandler(({ sessionId, appState }) => {
    // called once per interaction with the reader - keep the state of the interaction in this closure
    // appState: 'background' or 'foreground' (the app is in foreground, but has no active session)
    return {
        onApdu: async (apdu) => {
            return new Uint8Array([0x0A, 0x90, 0x00]);
        },
        // the interaction ends after this handler has finished
        onReaderLost: () => {
            // cleanup any side effects of the interaction
        },
    };
});

AppRegistry.registerComponent(appName, () => App);
```

`registerBackgroundHandler()` accepts the same `handlerTimeout` and `allowWhenLocked` options as `beginSession()`
as the second argument, e.g. `HCE.registerBackgroundHandler(factory, { allowWhenLocked: false })`.

The factory may also return a promise (e.g. to load some state from the storage) - the C-APDUs are held by the library
until it resolves. The handler timeout applies to the factory as well: if it throws or doesn't finish in time,
the reader receives an error status word for the rest of the interaction. If no background handler is registered,
the reader receives an error status word (see the table above).

Routing rules on Android:
1. If there is a session with running emulation, it handles the interaction (also when the app went to background in the meantime - stop the emulation on `AppState` change if you don't want that).
   While the app's activity is resumed, the library also makes `HCEService` the preferred service (`CardEmulation.setPreferredService()`),
   so that the session wins over other apps that have registered the same AIDs. In background, such conflicts are resolved by Android.
2. Otherwise, the background handler handles the interaction.
3. If there is no background handler, the reader receives an error status word.

Call `HCE.unregisterBackgroundHandler()` to temporarily stop handling interactions in background (e.g. on a screen
where the HCE should only work after the user explicitly started it) and `HCE.registerBackgroundHandler()` to resume.

While React Native is starting (e.g. the app wasn't running), the interaction is held until the entry file
has been evaluated, so that the background handler registered there is used. If that doesn't happen within 15 seconds
(e.g. the JS bundle has crashed), the interaction is rejected.

The decision is made when the reader selects the application and it doesn't change until the reader is lost. If the interaction
was rejected, the reader may re-select the application later (e.g. after you have started the emulation) and it will be routed again.

### Testing with Jest

The package ships a Jest mock of its native module, so that your tests run the library's real JS code against
a simulated native side. Add its setup file to your Jest config and let Jest transform the package (it's published
as TypeScript):
```js
// jest.config.js
module.exports = {
    preset: '@react-native/jest-preset',
    setupFiles: ['@icedevml/react-native-host-card-emulation/jest/setup'],
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@icedevml/react-native-host-card-emulation)/)',
    ],
};
```

The mock behaves like the native side (a single session at a time, events delivered asynchronously) and simulates
the reader:
```typescript
import HCE from '@icedevml/react-native-host-card-emulation';
import { NativeHCEModule, emitEvent, reset, sendApdu } from '@icedevml/react-native-host-card-emulation/jest/NativeHCEModuleMock';

beforeEach(() => reset());

test('responds to SELECT', async () => {
    const session = await HCE.beginSession({ onApdu: () => [0x90, 0x00] });

    // resolves with the R-APDU (hex) sent by the library
    expect(await sendApdu(session.id, '00A4040007D2760000850101')).toBe('9000');

    emitEvent({ sessionId: session.id, type: 'readerLost' });
    expect(NativeHCEModule.respondApdu).toHaveBeenCalledTimes(1);
    session.invalidate();
});
```

Every method of `NativeHCEModule` is a `jest.fn()`, e.g. `NativeHCEModule.getCapabilities.mockResolvedValueOnce(...)`,
and `reset()` restores their default implementations. See the demo app's `__tests__/ndefType4TagApp.test.ts`
for a complete example.

### Error codes

Promises returned by the library reject with errors having a `code` property:

| Code | Meaning |
|---|---|
| `err_platform_unsupported` | The device or the OS doesn't support the requested feature. |
| `err_invalid_argument` | Invalid handlers or options were passed. |
| `err_handler_timeout` | Passed to `onError`: a handler hasn't finished within the handler timeout. |
| `err_session_exists` | Another session is already active. |
| `err_no_session` | The session is not active anymore. |
| `err_session_invalidated` | The session was invalidated while it was being started. |
| `err_aborted` | `beginSession()` was aborted through the `AbortSignal`. |
| `err_start_emulation` | iOS: The OS has refused to start the emulation. |
| `err_nfc_reader_not_available`, `err_card_session_unsupported`, `err_card_session_not_eligible`, `err_create_card_session` | iOS: Preflight checks or session creation failed. |
| `err_already_exists`, `err_acquire_presentment` | iOS: `acquireExclusiveNFC()` failed. |

### Migrating from 0.x

| 0.x | 1.0 |
|---|---|
| `import NativeHCEModule from '.../js/NativeHCEModule'` | `import HCE from '@icedevml/react-native-host-card-emulation'` |
| `isPlatformSupported()` | `await HCE.getCapabilities()` |
| `NativeHCEModule.onEvent(...)` + `beginSession()` | `const session = await HCE.beginSession(handlers)` |
| `'received'` event + `respondAPDU(null, hex)` | return the R-APDU from `onApdu` |
| `'readerDetected'` / `'readerDeselected'` events | `onReaderDetected` / `onReaderLost` handlers |
| `'deviceLocked'` / `'deviceUnlocked'` events | `apdu.deviceLocked` flag |
| `'sessionInvalidated'` event | `onInvalidated` handler / `session.closed` |
| `startHCE()` / `stopHCE(status)` / `isHCERunning()` | `session.startEmulation()` / `session.stopEmulation(status)` / `session.isEmulationRunning()` |
| `setSessionAlertMessage()` / `invalidateSession()` | `session.setAlertMessage()` / `session.invalidate()` |
| `registerHeadlessTask('handleBackgroundHCECall', ...)` + `createBackgroundHCE()` | `HCE.registerBackgroundHandler(factory)` |

Note that on Android, the background handler is now also used when the app is in foreground without an active session
(0.x has responded with `6999` in such case).

### More resources

* [Source Code for Demo Application: NDEF NFC Type 4 Tag Emulator (for iOS/Android)](https://github.com/icedevml/react-native-host-card-emulation/tree/master/packages/demo-ndef-app)
