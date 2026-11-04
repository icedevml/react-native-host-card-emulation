import {AppRegistry, Platform} from 'react-native';

import NativeHCEModule from './NativeHCEModule';
import {addSessionListener, HCEError, processApdu, reportError, SerialQueue} from './internal';
import type {BackgroundAppState, BackgroundHandlerFactory, BackgroundHandlers} from './types';

// must match HCEManager.BACKGROUND_TASK_KEY on the native side
const BACKGROUND_TASK_KEY = 'handleBackgroundHCECall';

let currentFactory: BackgroundHandlerFactory | null = null;
let taskRegistered = false;

interface BackgroundTaskData {
  sessionId?: string;
  appState?: string;
}

async function runBackgroundTask(data: BackgroundTaskData): Promise<void> {
  const sessionId = data?.sessionId;
  const factory = currentFactory;

  if (!sessionId || !factory) {
    // finishing the task makes the native side reject the C-APDUs of this interaction
    return;
  }

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
        queue.push(() => processApdu(sessionId, event, h.onApdu, h.onError));
      } else if (event.type === 'readerLost') {
        const onReaderLost = h.onReaderLost;
        queue
          .push(() => onReaderLost?.())
          .catch(e => reportError(h.onError, e))
          .finally(finish);
      }
    });

    (async () => {
      try {
        const created = await factory({sessionId, appState});

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
 * Call it once, at the top level of the app's entry file (index.js), before AppRegistry.registerComponent().
 * Calling it again replaces the previous factory. No-op on iOS.
 */
export function registerBackgroundHandler(factory: BackgroundHandlerFactory): void {
  if (Platform.OS !== 'android') {
    return;
  }

  if (typeof factory !== 'function') {
    throw new HCEError('err_invalid_argument', 'The background handler factory must be a function.');
  }

  currentFactory = factory;

  if (!taskRegistered) {
    AppRegistry.registerHeadlessTask(BACKGROUND_TASK_KEY, () => runBackgroundTask);
    taskRegistered = true;
  }

  NativeHCEModule.setBackgroundHandlerRegistered(true);
}
