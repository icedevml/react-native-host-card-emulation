import {AppRegistry, Platform} from 'react-native';

import NativeHCEModule from './NativeHCEModule';
import {
  addSessionListener,
  callHandler,
  HCEError,
  processApdu,
  reportError,
  resolveHandlerOptions,
  SerialQueue,
} from './internal';
import type {
  BackgroundAppState,
  BackgroundHandlerFactory,
  BackgroundHandlerOptions,
  BackgroundHandlers,
} from './types';

// must match HCEManager.BACKGROUND_TASK_KEY on the native side
const BACKGROUND_TASK_KEY = 'handleBackgroundHCECall';

interface BackgroundRegistration {
  factory: BackgroundHandlerFactory;
  handlerTimeout: number;
}

let currentRegistration: BackgroundRegistration | null = null;
let taskRegistered = false;

if (Platform.OS === 'android') {
  /*
   Until the JS side declares whether it has a background handler, the native side holds the
   interactions instead of rejecting them, as React Native might still be evaluating the bundle.
   The handler is registered at the top level of the entry file and the microtask runs once the whole
   bundle has been evaluated. A timer wouldn't do: timers don't fire while the app is started in background.
   */
  Promise.resolve().then(() => {
    if (!taskRegistered) {
      NativeHCEModule.setBackgroundHandlerRegistered(false, false);
    }
  });
}

interface BackgroundTaskData {
  sessionId?: string;
  appState?: string;
}

async function runBackgroundTask(data: BackgroundTaskData): Promise<void> {
  const sessionId = data?.sessionId;
  const registration = currentRegistration;

  if (!sessionId || !registration) {
    // finishing the task makes the native side reject the C-APDUs of this interaction
    return;
  }

  const {factory, handlerTimeout} = registration;
  const appState: BackgroundAppState = data.appState === 'foreground' ? 'foreground' : 'background';
  const queue = new SerialQueue();
  let handlers: BackgroundHandlers | null = null;

  /*
   The task lives until the reader is lost. Once it resolves, React Native finishes the headless
   task and the native side stops routing C-APDUs of this interaction to JS.
   */
  await new Promise<void>(resolve => {
    let finished = false;
    let removeListener = () => {};

    const finish = () => {
      if (!finished) {
        finished = true;
        removeListener();
        resolve();
      }
    };

    removeListener = addSessionListener(sessionId, event => {
      const h = handlers;

      if (!h || finished) {
        return;
      }

      if (event.type === 'apdu') {
        queue.push(() => processApdu(sessionId, event, h.onApdu, h.onError, handlerTimeout));
      } else if (event.type === 'readerLost') {
        const onReaderLost = h.onReaderLost;
        queue
          .push(() => callHandler('onReaderLost()', () => onReaderLost?.(), handlerTimeout))
          .catch(e => reportError(h.onError, e))
          .finally(finish);
      }
    });

    (async () => {
      try {
        const created = await callHandler(
          'The background handler factory',
          () => factory({sessionId, appState}),
          handlerTimeout,
        );

        if (!created || typeof created.onApdu !== 'function') {
          throw new HCEError('err_invalid_argument', 'The background handler factory must return an object with onApdu().');
        }

        handlers = created;
      } catch (e) {
        reportError(undefined, e);
        finish();
        return;
      }

      // the native side starts delivering events (including the queued C-APDU) from now on
      if (!NativeHCEModule.backgroundSessionReady(sessionId)) {
        // the reader was already lost
        finish();
      }
    })();
  });
}

/**
 * Android: Register the handler of HCE interactions that happen while the app has no session
 * with running emulation - i.e. the app is in background, not running at all or it's in foreground
 * without an active session (check BackgroundContext.appState).
 *
 * The background handler is disabled by default, the app has to enable it with the
 * `com.itsecrnd.rtnhceandroid.background_handler_enabled` <meta-data> of HCEService in AndroidManifest.xml.
 * Otherwise the readers are rejected natively and the app is never started for them (a warning is logged).
 *
 * Call it once, at the top level of the app's entry file (index.js), before AppRegistry.registerComponent().
 * Calling it again replaces the previous factory and its options. No-op on iOS.
 */
export function registerBackgroundHandler(
  factory: BackgroundHandlerFactory,
  options: BackgroundHandlerOptions = {},
): void {
  if (Platform.OS !== 'android') {
    return;
  }

  if (typeof factory !== 'function') {
    throw new HCEError('err_invalid_argument', 'The background handler factory must be a function.');
  }

  const {handlerTimeout, allowWhenLocked} = resolveHandlerOptions(options);
  currentRegistration = {factory, handlerTimeout};

  if (!taskRegistered) {
    AppRegistry.registerHeadlessTask(BACKGROUND_TASK_KEY, () => runBackgroundTask);
    taskRegistered = true;
  }

  NativeHCEModule.setBackgroundHandlerRegistered(true, allowWhenLocked);

  if (!NativeHCEModule.isBackgroundHandlerEnabled()) {
    console.warn(
      '[HCE] The background handler is disabled, it will never be called. Enable it by adding ' +
        '<meta-data android:name="com.itsecrnd.rtnhceandroid.background_handler_enabled" android:value="true" /> ' +
        'to HCEService in AndroidManifest.xml (see the README of @icedevml/react-native-host-card-emulation).',
    );
  }
}

/**
 * Android: Stop handling interactions in background, until registerBackgroundHandler() is called again.
 * The readers then receive an error status word unless there is a session with running emulation.
 * Interactions that have already started are served until the reader is lost. No-op on iOS.
 */
export function unregisterBackgroundHandler(): void {
  if (Platform.OS !== 'android') {
    return;
  }

  currentRegistration = null;
  NativeHCEModule.setBackgroundHandlerRegistered(false, false);
}
