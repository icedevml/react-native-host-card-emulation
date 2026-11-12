import {AppRegistry, Platform} from 'react-native';

import NativeHCEModule, {type NativeHCEEvent} from './NativeHCEModule';
import {
  addSessionListener,
  callHandler,
  callNative,
  HCEError,
  processApdu,
  rejectApdu,
  reportError,
  resolveHandlerOptions,
  SerialQueue,
  toHCEError,
} from './internal';
import type {BeginSessionOptions, EmulationStopStatus, HCESession, SessionHandlers} from './types';

// must match HCEManager.KEEP_ALIVE_TASK_KEY on the native side
const KEEP_ALIVE_TASK_KEY = 'keepAliveHCESession';

interface KeepAliveTaskData {
  sessionId?: string;
  // the number of the interaction with the reader within the session, counted from 1
  interaction?: number;
}

interface KeepAliveWaiter {
  interaction: number;
  resolve: () => void;
}

let sessionCounter = 0;
const activeSessions = new Map<string, Session>();

function generateSessionId(): string {
  sessionCounter += 1;
  return `fg-${Date.now().toString(36)}-${sessionCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function abortError(): HCEError {
  return new HCEError('err_aborted', 'The operation was aborted.');
}

if (Platform.OS === 'android') {
  /*
   React Native pauses the JS timers while the app isn't resumed, unless a headless task is running.
   The native side starts this task for every interaction with the reader handled by a session, so that
   the handlers (and their timeouts) work also while the app is in background. The task finishes once
   the handlers of that interaction have finished.
   */
  AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK_KEY, () => async (data: KeepAliveTaskData) => {
    const session = data?.sessionId ? activeSessions.get(data.sessionId) : undefined;
    await session?.waitForInteractionEnd(data.interaction ?? 0);
  });
}

class Session implements HCESession {
  readonly id: string;
  readonly closed: Promise<string>;
  readonly started: Promise<void>;

  private readonly handlers: SessionHandlers;
  // handlers.onError() bound to this session
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly handlerTimeout: number;
  private readonly queue = new SerialQueue();
  private readonly removeListener: () => void;
  private active = true;
  private isStarted = false;
  // the number of the interactions with the reader that have ended (readerLost events)
  private interactionsEnded = 0;
  private keepAliveWaiters: KeepAliveWaiter[] = [];
  private resolveClosed!: (reason: string) => void;
  private resolveStarted!: () => void;
  private rejectStarted!: (error: Error) => void;

  constructor(id: string, handlers: SessionHandlers, handlerTimeout: number) {
    this.id = id;
    this.handlers = handlers;
    const {onError} = handlers;
    this.onError = onError ? error => onError(error, this) : undefined;
    this.handlerTimeout = handlerTimeout;
    this.closed = new Promise(resolve => {
      this.resolveClosed = resolve;
    });
    this.started = new Promise((resolve, reject) => {
      this.resolveStarted = resolve;
      this.rejectStarted = reject;
    });
    // beginSession() handles the rejection, avoid unhandled rejection warnings when it doesn't wait for it
    this.started.catch(() => {});
    // registered before the native session is created, so that no event can be missed
    this.removeListener = addSessionListener(id, event => this.handleEvent(event));
    activeSessions.set(id, this);
  }

  get isActive(): boolean {
    return this.active;
  }

  /*
   The events that are still waiting in the queue when the session is closed are dropped: their handlers are
   never called (a C-APDU is answered with 6F00), as the handlers might have side effects that the reader
   would never learn about. Only onInvalidated() is called after the session has been closed.
   */
  private runHandler(name: string, handler: ((session: HCESession) => unknown) | undefined, afterClose = false) {
    if (!handler) {
      return;
    }

    this.queue
      .push(() => (this.active || afterClose ? callHandler(name, () => handler(this), this.handlerTimeout) : undefined))
      .catch(e => reportError(this.onError, e));
  }

  private handleEvent(event: NativeHCEEvent) {
    switch (event.type) {
      case 'sessionStarted':
        this.isStarted = true;
        this.resolveStarted();
        break;

      case 'readerDetected':
        this.runHandler('onReaderDetected()', this.handlers.onReaderDetected);
        break;

      case 'readerLost':
        this.interactionsEnded += 1;
        this.runHandler('onReaderLost()', this.handlers.onReaderLost);
        this.releaseKeepAliveWaiters();
        break;

      case 'apdu': {
        const {onApdu} = this.handlers;
        this.queue.push(() =>
          this.active
            ? processApdu(this.id, event, apdu => onApdu(apdu, this), this.onError, this.handlerTimeout)
            : rejectApdu(this.id, event.apduId),
        );
        break;
      }

      case 'sessionInvalidated':
        this.close(event.reason || 'unknown');
        break;
    }
  }

  close(reason: string) {
    if (!this.active) {
      return;
    }

    this.active = false;
    this.removeListener();

    if (!this.isStarted) {
      // beginSession() rejects, so the app never gets the session object and isn't notified
      this.rejectStarted(new HCEError('err_session_invalidated', `The session was invalidated: ${reason}`));
    } else {
      const onInvalidated = this.handlers.onInvalidated;
      this.runHandler('onInvalidated()', onInvalidated ? session => onInvalidated(reason, session) : undefined, true);
    }

    activeSessions.delete(this.id);
    this.releaseKeepAliveWaiters();
    this.resolveClosed(reason);
  }

  /**
   * Resolves once the handlers of the given interaction with the reader have finished or the session is closed.
   */
  waitForInteractionEnd(interaction: number): Promise<void> {
    return new Promise(resolve => {
      this.keepAliveWaiters.push({interaction, resolve});
      this.releaseKeepAliveWaiters();
    });
  }

  private releaseKeepAliveWaiters() {
    const ended = this.keepAliveWaiters.filter(w => !this.active || w.interaction <= this.interactionsEnded);

    if (ended.length === 0) {
      return;
    }

    this.keepAliveWaiters = this.keepAliveWaiters.filter(w => !ended.includes(w));
    // after the handlers that are already queued
    this.queue.push(() => ended.forEach(w => w.resolve()));
  }

  private ensureActive() {
    if (!this.active) {
      throw new HCEError('err_no_session', 'The session is not active.');
    }
  }

  async startEmulation(): Promise<void> {
    this.ensureActive();
    await callNative(NativeHCEModule.startEmulation(this.id));
  }

  async stopEmulation(status: EmulationStopStatus = 'success'): Promise<void> {
    this.ensureActive();
    await callNative(NativeHCEModule.stopEmulation(this.id, status));
  }

  async isEmulationRunning(): Promise<boolean> {
    if (!this.active) {
      return false;
    }

    return callNative(NativeHCEModule.isEmulationRunning(this.id));
  }

  setAlertMessage(message: string): void {
    if (this.active) {
      NativeHCEModule.setSessionAlertMessage(this.id, message);
    }
  }

  invalidate(): void {
    if (!this.active) {
      return;
    }

    NativeHCEModule.invalidateSession(this.id);
    // don't rely on the native event, the session is closed from now on
    this.close('userInvalidated');
  }
}

/**
 * Begin the HCE session. Resolves once the session is started and ready for startEmulation().
 * Only a single session can be active at a time.
 */
export async function beginSession(handlers: SessionHandlers, options: BeginSessionOptions = {}): Promise<HCESession> {
  if (!handlers || typeof handlers.onApdu !== 'function') {
    throw new HCEError('err_invalid_argument', 'handlers.onApdu must be a function.');
  }

  const {signal} = options;
  const {handlerTimeout, allowWhenLocked} = resolveHandlerOptions(options);

  if (signal?.aborted) {
    throw abortError();
  }

  const session = new Session(generateSessionId(), handlers, handlerTimeout);
  const onAbort = () => session.invalidate();
  signal?.addEventListener('abort', onAbort);
  session.closed.then(() => signal?.removeEventListener('abort', onAbort));

  try {
    await NativeHCEModule.beginSession(session.id, allowWhenLocked);
  } catch (e) {
    session.close('beginSessionFailed');

    // e.g. iOS rejects with err_session_invalidated if the start was aborted
    if (signal?.aborted) {
      throw abortError();
    }

    throw toHCEError(e);
  }

  if (!session.isActive) {
    // closed while the native session was being created, make sure that it doesn't outlive the JS side
    NativeHCEModule.invalidateSession(session.id);
  }

  try {
    await session.started;
  } catch (e) {
    if (signal?.aborted) {
      throw abortError();
    }

    throw e;
  }

  return session;
}
