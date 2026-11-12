# React Native Demo Application: NDEF NFC Type 4 Tag Emulator (for iOS/Android)

Demo React Native application using `@icedevml/react-native-host-card-emulation` in order to emulate NFC Forum Type 4 Tag with an example URL NDEF.

The emulated NDEF tag is recognized out of the box when it's scanned by another iOS/Android smartphone from the home screen's level (i.e. using background tag reading). This emulation is cross-compatible, the iOS could emulate a tag that will be recognized by Android and vice versa.

> [!NOTE]
> Make sure you have completed the [React Native's Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

> [!NOTE]
> For iOS, you will first need to [request the HCE entitlement](https://developer.apple.com/contact/request/hce-entitlement/) for using ISO7816 AID `D2760000850101` (i.e. NFC Forum Type 4 Tag - NDEF) before you can run this app.

## Prerequisites
1. Clone the repository.
2. Install the dependencies with Yarn 4, which is pinned in the root `package.json` and provided by Corepack:
   run `corepack enable` (Node.js 25+ doesn't bundle Corepack, install it first with `npm install -g corepack`)
   and then `yarn` inside the repository.
3. (iOS) Install Pods: `cd ios/ && bundle install && bundle exec pod install`. Then, open the project in XCode through the `ios/DemoHCEModuleIOSApp.xcworkspace` file.
4. (iOS) Make sure to set up your Signing Team and Bundle Identifier in "Signing & Capabilities" settings section of the project.
5. (iOS) Ensure that Host Card Emulation (HCE) entitlement with the ISO7816 AID `D2760000850101` is added to the app.

## Launching the app
### Android
1. Start Metro dev server:
   ```sh
   yarn start
   ```
2. Build and run the app:
   ```
   npx react-native run-android
   ```

### iOS
1. Start Metro dev server:
    ```sh
    yarn start
    ```
2. (iOS) Press the "Run" button in XCode.

## Android: background handling and the lock screen

The app enables the library's background handler (the `com.itsecrnd.rtnhceandroid.background_handler_enabled` meta-data
of `HCEService` in `android/app/src/main/AndroidManifest.xml`), so it handles the readers also when it's not open.
Otherwise it keeps the library's secure defaults: the readers are only handled while the device is unlocked. See
"Android: Enabling the background handler and the lock screen" in the library's README to change that.

## Tests

Run `yarn test`. The tests use the library's Jest mock of its native module, see `jest.config.js`.

## Logging

> [!WARNING]
> For the demo purposes, the app logs every C-APDU and R-APDU with `console.log()` (see `components/eventLog.ts`),
> which ends up in the system log (logcat on Android) also in release builds. Don't copy that into production apps:
> APDUs might carry sensitive data (tokens, credentials, personal data) readable by anyone with access to the device logs.
