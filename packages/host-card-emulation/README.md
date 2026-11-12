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
It's enabled by default since React Native 0.76 and it's the only architecture since React Native 0.82. The package
is developed and tested with React Native 0.88.

### iOS
1. Ensure that you are enrolled as organization (not individual) in Apple Developer Program, and that you are established in the European Economic Area (EEA).
2. Ensure that you meet other [non-technical requirements imposed by Apple](https://developer.apple.com/support/hce-transactions-in-apps/#requirements-and-availability).
3. Find out the Bundle ID of your existing application or [register a new Bundle ID](https://developer.apple.com/account/resources/identifiers/bundleId/add/bundle).
4. [Request the HCE Entitlement](https://developer.apple.com/contact/request/hce-entitlement/) for your application's bundle ID.
5. Wait until the entitlement is approved by Apple.

### Android
1. Ensure that your app's `minSdkVersion` is at least 24 (Android 7.0). This is the floor imposed by React Native's New Architecture; the Host Card Emulation APIs used by this package are available since Android 5.1.
2. Note that HCE availability also depends on the device hardware - always check `HCE.getCapabilities()` (`hceSupported` and `nfcEnabled`) before starting a session.

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
   With this configuration, the readers are only handled while your app has a session with running emulation.
   To handle them also without a session (e.g. while the app is in background or not running at all), see
   [Android: Enabling the background handler and the lock screen](#android-enabling-the-background-handler-and-the-lock-screen).
2. Create file `android/app/src/main/res/xml/aid_list.xml`:
   ```xml
   <host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
     android:description="@string/app_name"
     android:requireDeviceUnlock="true"
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

   Keep `android:requireDeviceUnlock="true"` unless your app is meant to work on the lock screen: Android then asks
   the user to unlock the device first and never passes the C-APDUs of a locked device to your app. See
   [Android: Enabling the background handler and the lock screen](#android-enabling-the-background-handler-and-the-lock-screen).

   For `android:requireDeviceScreenOn` - set it according to your use case.

## API

> [!NOTE]
> Version 2.x has a new API, which is not compatible with 0.x versions, and secure defaults on Android.
> See [Migrating to 2.x](#migrating-to-2x).

```typescript
import HCE from '@icedevml/react-native-host-card-emulation';
```

The library guarantees that **every C-APDU is responded to exactly once** (unless the reader is lost or the session
is closed in the meantime): your handler returns the R-APDU and the library sends it. If the handler throws an exception,
returns an invalid response or doesn't finish in time, the reader receives the `6F00` status word (no precise diagnosis).
Responses are bound to the C-APDU they were produced for, so a late response can never be sent as a reply to a different
command.

All the handlers of a given session are called sequentially - the next event is never delivered before the handler
of the previous one has finished (including the returned promise). A handler that doesn't finish within the handler
timeout (10 seconds by default) is abandoned: its result is ignored, `onError` receives an `err_handler_timeout` error
and the next event is delivered (a timed out `onApdu` is responded to with `6F00`). This way, a single stuck promise
can't block the session or the background interaction forever. An abandoned handler can't be cancelled though, it keeps
running and might overlap with the next handlers.

Once a session is closed, the events that are still waiting for their turn are dropped: their handlers are never called
(the C-APDUs are answered with `6F00`), only `onInvalidated` is.

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
//   backgroundSupported: boolean,  // registerBackgroundHandler() can be used (Android, enabled in AndroidManifest.xml)
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
       // every handler receives the session as its last argument
       onReaderDetected: (s) => s.setAlertMessage('Reader detected'),  // only for iOS, no-op on Android
       onReaderLost: (s) => s.setAlertMessage('Lost reader'),          // only for iOS, no-op on Android
       onInvalidated: (reason) => console.log('session closed', reason),
       onError: (error) => console.warn('HCE handler error', error),
   });

   session.setAlertMessage('Tap towards the reader');  // only for iOS, no-op on Android
   await session.startEmulation();
   ```
   `beginSession()` resolves once the session is started and ready for `startEmulation()`. Only a single session can be
   active at a time, `beginSession()` rejects with `err_session_exists` otherwise.

   Every handler receives the session as its last argument: `onApdu(apdu, session)`, `onReaderDetected(session)`,
   `onReaderLost(session)`, `onInvalidated(reason, session)` and `onError(error, session)`. Use it instead of
   the variable that the result of `beginSession()` is assigned to, a handler might run before that assignment.

   The optional second argument accepts:
   ```typescript
   await HCE.beginSession(handlers, {
       signal,                  // AbortSignal, aborting it invalidates the session (see below)
       handlerTimeout: 10000,   // ms, the default; 0 or Infinity disables the timeout
       allowWhenLocked: false,  // Android: the default; see "Enabling the background handler and the lock screen"
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
   `session.closed` is a promise that resolves with the reason once the session is closed (by you or by the OS),
   `onInvalidated` receives the same reason:
   * `userInvalidated` - `session.invalidate()` was called (also through the `AbortSignal`), or on iOS the user has
     closed the system NFC prompt or the app has gone to background, e.g. the device was locked (these cases can't be
     told apart);
   * iOS: the name of the `CardSession.Error` case that has ended the session, e.g. `maxSessionDurationReached`;
   * iOS: `internalError: <description>` if the session's event stream has failed, `unknown` if it has ended without
     a reason.

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
* iOS: `onReaderDetected` is called as soon as the NFC reader's field presence is observed. `onReaderLost` is called if the reader is physically disconnected or the emulation is stopped.
* Android: `onReaderDetected` is called as soon as the first matching SELECT AID command is observed. `onReaderLost` is called if the reader is physically disconnected, a non-matching AID is selected by the reader or the emulation is stopped.

iOS doesn't notify the app when the reader selects a non-matching AID: the system answers that SELECT with `6A82`
itself and the following commands with `6A81` until the reader selects a matching AID again.

#### iOS: The system NFC prompt and the session lifetime

* While the emulation is running, the system NFC prompt covers the app and blocks its UI. Closing it ends the session
  (`userInvalidated`), so does locking the device.
* `stopEmulation('success')` shows a confirmation in the prompt, `stopEmulation('failure')` just closes it without any
  indication of the failure. Use `session.setAlertMessage()` before stopping the emulation, or your own UI after it.
* Invalidating the session while the emulation is running (also by reloading the JS bundle) shows an error in the
  prompt. Call `stopEmulation('success')` first to finish without it.
* The system ends the session (`maxSessionDurationReached`) about a minute after the last `startEmulation()` call.
* A session that waits for the reader with exclusive NFC access (see below) without starting the emulation isn't
  notified when that access expires: it detects no reader anymore and the system doesn't end it. Invalidate it once
  `HCE.isExclusiveNFC()` becomes `false`.
* Starting the emulation again right after `stopEmulation()` while the device is still at the reader might leave the
  link with the reader unusable (the system answers the C-APDUs with `6A81`). Wait for the reader to be removed or
  begin a new session.

The `deviceLocked` flag of each C-APDU:
* iOS: Always `false` - it's impossible to communicate over HCE while the device is locked.
* Android: Sampled when the C-APDU arrives. Always `false` on devices without a secure lock screen (PIN, pattern, password, biometrics).

On Android, the C-APDUs are only delivered while the device is unlocked by default, see
[Android: Enabling the background handler and the lock screen](#android-enabling-the-background-handler-and-the-lock-screen).

#### Status words sent by the library

| Situation | Status word |
|---|---|
| The handler has thrown an exception, returned an invalid response or hasn't finished within the handler timeout | `6F00` (no precise diagnosis) |
| The C-APDU was still waiting in the queue when its session was closed, or it has arrived for a session or a background interaction that has already ended on the JS side (the handler isn't called) | `6F00` (no precise diagnosis) |
| Android: nobody can handle the interaction - there is no session with running emulation and no background handler (not enabled in `AndroidManifest.xml` or not registered), or the device is locked and `allowWhenLocked` is `false` | `6A82` (file or application not found) for SELECT, `6985` (conditions of use not satisfied) for other commands |
| Android: the session was invalidated or its emulation was stopped during the interaction (until the reader selects the application again) | `6A82` for SELECT, `6985` for other commands |

Closing a session also ends its interaction natively: on Android the reader then receives `6A82`/`6985` (the last row)
and the `6F00` of the second row is discarded, on iOS the system ends the NFC session.

### iOS: Acquiring exclusive NFC access

If you need to utilize `NFCPresentmentIntentAssertion` for enhanced user experience, call:
```typescript
await HCE.acquireExclusiveNFC();
```
This function will acquire an exclusive NFC access for 15 seconds. No system services or other applications will be able to interfere with NFC during that period. For example, the NFC background tag reading will be disabled so it would not generate any distracting notifications.

While both session and exclusive NFC access are active, `onReaderDetected` is called even when the emulation is not started at the time (without any explicit UI being displayed by the system). You can then call `session.startEmulation()` from within that handler to initiate the interaction automatically, without needing the user to click anything beforehand.

This function will throw an exception if:
* the presentment intent assertion was already acquired and is still active;
* you are in the cooldown period where you are not allowed to acquire the presentment intent assertion (cooldown is 15 seconds after the previous assertion has ended - expired, released with `HCE.releaseExclusiveNFC()` or revoked when the app went to background), it rejects with `err_acquire_presentment` then;
* the feature is not supported or the device is not eligible for whatever reason (rejects with `err_platform_unsupported` on Android).

You can check if you are holding an exclusive NFC access by calling `HCE.isExclusiveNFC()`. Whenever you don't need the exclusive NFC access anymore, call `HCE.releaseExclusiveNFC()`.

> [!TIP]
> Your exclusive NFC access might time out after exceeding certain allowance period imposed by iOS. Thus, you should periodically poll
> the `HCE.isExclusiveNFC()` value to see if it's still granted.

> [!TIP]
> Use the React's [AppState](https://reactnative.dev/docs/appstate) listener to see when your app goes out to background
> and call `HCE.releaseExclusiveNFC()` in such event. The operating system revokes your exclusive NFC access anyway,
> as your app has gone to background. Note that the device might auto-lock while the app waits for the reader with
> exclusive NFC access (no system prompt is displayed then), which also revokes it. Right after the device is unlocked,
> `acquireExclusiveNFC()` and `beginSession()` might briefly reject with `err_card_session_not_eligible`.

### Android: Enabling the background handler and the lock screen

By default, the readers can only interact with your app while it has a session with running emulation and the device
is unlocked. Anything beyond that has to be enabled explicitly, in up to three places:

| What | Default | How to enable it |
|---|---|---|
| Background handler: interactions without a session with running emulation, also while the app isn't running | Disabled: the readers are rejected natively, React Native is never started for them | `com.itsecrnd.rtnhceandroid.background_handler_enabled` meta-data of `HCEService` in `AndroidManifest.xml` |
| Android passes the C-APDUs of a locked device to your app | No (`android:requireDeviceUnlock="true"`): Android asks the user to unlock the device and tap again ("Tap your phone on the NFC reader again to use ...", with the `android:description` of `aid_list.xml`) | `android:requireDeviceUnlock="false"` in `aid_list.xml` |
| The library delivers the C-APDUs of a locked device to your handlers | No (`allowWhenLocked: false`): the reader receives an error status word | `allowWhenLocked: true` in the options of `HCE.beginSession()` / `HCE.registerBackgroundHandler()` |

To handle the readers without a session (e.g. while the app is in background or not running at all):
1. Add the meta-data to the `HCEService` declaration in `AndroidManifest.xml`:
   ```diff
      <service
        android:name="com.itsecrnd.rtnhceandroid.HCEService"
        ...>
        ...
        <meta-data
          android:name="android.nfc.cardemulation.host_apdu_service"
          android:resource="@xml/aid_list" />
   +    <meta-data
   +      android:name="com.itsecrnd.rtnhceandroid.background_handler_enabled"
   +      android:value="true" />
      </service>
   ```
2. Register the background handler at the top level of your app's entry file, see
   [Android: Handling HCE interactions without an active session](#android-handling-hce-interactions-without-an-active-session).

To handle the readers also while the device is locked:
1. Set `android:requireDeviceUnlock="false"` in `aid_list.xml`.
2. Pass `allowWhenLocked: true` to `HCE.beginSession()` and/or `HCE.registerBackgroundHandler()`, only to those
   that should work on the lock screen. Each C-APDU carries the `deviceLocked` flag, so your handlers can still decide
   what to do per command.

Both steps are needed: with `requireDeviceUnlock="true"` Android doesn't pass the C-APDUs of a locked device to the app
at all, with `allowWhenLocked: false` the library rejects them. The combination of `requireDeviceUnlock="false"` and
`allowWhenLocked: false` is useful too: the locked device's readers are then rejected by the library (see the status
words above) instead of Android asking the user to unlock the device.

> [!WARNING]
> With the background handler and the lock screen enabled, anybody who is able to tap a reader to the phone can interact
> with your app - also while the device is locked and the app isn't running. Only enable that if your app is really
> meant to work that way.

### Android: Handling HCE interactions without an active session

Exclusively on Android platform it is possible to handle HCE interactions while the app has no session with running
emulation. The background handler is used when:
* the app is not running at all (it's started in headless mode, no user interface is available);
* the app is in background;
* the app is in foreground, but it has no session with running emulation.

The background handler is disabled by default, enable it in `AndroidManifest.xml` first, see
[Android: Enabling the background handler and the lock screen](#android-enabling-the-background-handler-and-the-lock-screen).
Then register the handler at the top level of your app's entry file (`index.js`):
```typescript
import { AppRegistry } from 'react-native';
import HCE from '@icedevml/react-native-host-card-emulation';
import App from './App';
import { name as appName } from './app.json';

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
as the second argument, e.g. `HCE.registerBackgroundHandler(factory, { handlerTimeout: 5000 })` (`allowWhenLocked`
is `false` by default here as well). If the background handler isn't enabled in `AndroidManifest.xml`,
`registerBackgroundHandler()` logs a warning and the handler is never called.

The factory may also return a promise (e.g. to load some state from the storage) - the C-APDUs are held by the library
until it resolves. The handler timeout applies to the factory as well: if it throws or doesn't finish in time,
the reader receives an error status word for the rest of the interaction. If no background handler is registered,
the reader receives an error status word (see the table above).

Routing rules on Android:
1. If there is a session with running emulation, it handles the interaction (also when the app went to background in the meantime - stop the emulation on `AppState` change if you don't want that).
   While the app's activity is resumed, the library also makes `HCEService` the preferred service (`CardEmulation.setPreferredService()`),
   so that the session wins over other apps that have registered the same AIDs. In background, such conflicts are resolved by Android.
2. Otherwise, if the background handler is enabled in `AndroidManifest.xml`, the background handler handles the interaction.
3. Otherwise, the reader receives an error status word. Without the opt-in in `AndroidManifest.xml`, this is decided
   natively and React Native is never started for the reader. Android still starts the app's process to run `HCEService`
   (it's the app's own service), but nothing beyond the native code of the library.

Call `HCE.unregisterBackgroundHandler()` to temporarily stop handling interactions in background (e.g. on a screen
where the HCE should only work after the user explicitly started it) and `HCE.registerBackgroundHandler()` to resume.

With the background handler enabled, Android starts the app's process and React Native in background whenever a reader
selects one of your AIDs while the app isn't running. The interaction is held until the JS side declares whether it has
a background handler, which happens once the entry file has been evaluated. If that doesn't happen within 15 seconds
(e.g. the JS bundle has crashed), the interaction is rejected. That's why `HCE.registerBackgroundHandler()` belongs to
the top level of the entry file: Metro loads the modules lazily by default (`inlineRequires`), so the modules imported
only by your components might never be loaded in background.

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
for a complete example. The mock behaves like an app that has enabled the background handler in `AndroidManifest.xml`,
`NativeHCEModule.isBackgroundHandlerEnabled.mockReturnValue(false)` simulates the opposite.

### Error codes

The errors of the library (rejected promises and the errors it passes to `onError`) are `HCEError` instances with
a `code` property. The errors of the native side are converted to `HCEError` as well, keeping the original error
as `cause`. Errors thrown by your own handlers are passed to `onError` as they are.

```typescript
import HCE, { HCEError } from '@icedevml/react-native-host-card-emulation';

try {
    await HCE.beginSession(handlers);
} catch (e) {
    if (e instanceof HCEError && e.code === 'err_session_exists') {
        // ...
    }
}
```

| Code | Meaning |
|---|---|
| `err_platform_unsupported` | The device or the OS doesn't support the requested feature. |
| `err_invalid_argument` | Invalid handlers or options were passed. |
| `err_handler_timeout` | Passed to `onError`: a handler hasn't finished within the handler timeout. |
| `err_invalid_rapdu` | Passed to `onError`: `onApdu` has returned an invalid R-APDU (not bytes, or shorter than the 2-byte status word), the reader has received `6F00`. |
| `err_invalid_hex` | `hexToBytes()` has received an invalid hex string. |
| `err_session_exists` | Another session is already active. |
| `err_no_session` | The session is not active anymore. |
| `err_session_invalidated` | The session was invalidated while it was being started. |
| `err_aborted` | `beginSession()` was aborted through the `AbortSignal`. |
| `err_start_emulation` | iOS: The OS has refused to start the emulation. |
| `err_apdu_respond` | iOS, passed to `onError`: The OS has failed to send the R-APDU to the reader. |
| `err_nfc_reader_not_available`, `err_card_session_unsupported`, `err_card_session_not_eligible`, `err_create_card_session` | iOS: Preflight checks or session creation failed. |
| `err_already_exists`, `err_acquire_presentment` | iOS: `acquireExclusiveNFC()` failed. |

### Migrating to 2.x

Version 2.x has a new API, which is not compatible with 0.x versions:

| 0.x | 2.x |
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

The behavior has changed too, most notably the defaults on Android are secure. Enable what your app needs, see
[Android: Enabling the background handler and the lock screen](#android-enabling-the-background-handler-and-the-lock-screen).

| 0.x | 2.x |
|---|---|
| Android: a reader always starts the app in background | The background handler is disabled by default, enable it with the `com.itsecrnd.rtnhceandroid.background_handler_enabled` meta-data of `HCEService` |
| Android: the C-APDUs are delivered also while the device is locked | Only while it's unlocked, unless `allowWhenLocked: true` is passed |
| `android:requireDeviceUnlock="false"` recommended | `android:requireDeviceUnlock="true"` recommended, unless the app is meant to work on the lock screen |
| Android: in foreground without an active session, the reader receives `6999` | The background handler is used (if enabled), otherwise the reader receives `6A82` / `6985` |
| iOS: `readerDeselected` isn't emitted when the emulation is stopped | `onReaderLost` is called, like on Android |

### More resources

* [Source Code for Demo Application: NDEF NFC Type 4 Tag Emulator (for iOS/Android)](https://github.com/icedevml/react-native-host-card-emulation/tree/master/packages/demo-ndef-app)
