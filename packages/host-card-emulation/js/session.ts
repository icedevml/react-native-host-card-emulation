import NativeHCEModule, {NativeHCEEvent} from './NativeHCEModule';
import {addSessionListener, HCEError, processApdu, reportError, SerialQueue} from './internal';
import type {BeginSessionOptions, EmulationStopStatus, HCESession, SessionHandlers} from './types';

let sessionCounter = 0;

function generateSessionId(): string {
  sessionCounter += 1;
  return `fg-${Date.now().toString(36)}-${sessionCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

class Session implements HCESession {
  readonly id: string;
  readonly closed: Promise<string>;
  readonly started: Promise<void>;

  private readonly handlers: SessionHandlers;
  private readonly queue = new SerialQueue();
  private readonly removeListener: () => void;
  private active = true;
  private isStarted = false;
  private resolveClosed!: (reason: string) => void;
  private resolveStarted!: () => void;
  private rejectStarted!: (error: Error) => void;

  constructor(id: string, handlers: SessionHandlers) {
    this.id = id;
    this.handlers = handlers;
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
  }

  get isActive(): boolean {
    return this.active;
  }

  private runHandler(handler: (() => unknown) | undefined) {
    if (!handler) {
      return;
    }

    this.queue.push(handler).catch(e => reportError(this.handlers.onError, e));
  }

  private handleEvent(event: NativeHCEEvent) {
    switch (event.type) {
      case 'sessionStarted':
        this.isStarted = true;
        this.resolveStarted();
        break;

      case 'readerDetected':
        this.runHandler(this.handlers.onReaderDetected);
        break;

      case 'readerLost':
        this.runHandler(this.handlers.onReaderLost);
        break;

      case 'apdu':
        this.queue.push(() => processApdu(this.id, event, this.handlers.onApdu, this.handlers.onError));
        break;

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
      this.runHandler(onInvalidated ? () => onInvalidated(reason) : undefined);
    }

    this.resolveClosed(reason);
  }

  private ensureActive() {
    if (!this.active) {
      throw new HCEError('err_no_session', 'The session is not active.');
    }
  }

  async startEmulation(): Promise<void> {
    this.ensureActive();
    await NativeHCEModule.startEmulation(this.id);
  }

  async stopEmulation(status: EmulationStopStatus = 'success'): Promise<void> {
    this.ensureActive();
    await NativeHCEModule.stopEmulation(this.id, status);
  }

  async isEmulationRunning(): Promise<boolean> {
    if (!this.active) {
      return false;
    }

    return NativeHCEModule.isEmulationRunning(this.id);
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

  if (signal?.aborted) {
    throw new HCEError('err_aborted', 'The operation was aborted.');
  }

  const session = new Session(generateSessionId(), handlers);
  const onAbort = () => session.invalidate();
  signal?.addEventListener('abort', onAbort);
  session.closed.then(() => signal?.removeEventListener('abort', onAbort));

  try {
    await NativeHCEModule.beginSession(session.id);
  } catch (e) {
    session.close('beginSessionFailed');
    throw e;
  }

  try {
    await session.started;
  } catch (e) {
    if (signal?.aborted) {
      throw new HCEError('err_aborted', 'The operation was aborted.');
    }

    throw e;
  }

  return session;
}
