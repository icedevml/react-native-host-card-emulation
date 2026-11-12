import type {EventSubscription} from 'react-native';

import NativeHCEModule, {type NativeHCEEvent} from './NativeHCEModule';
import type {ApduHandler, HandlerOptions, ResponseAPDU} from './types';

// ISO 7816-4: no precise diagnosis
const SW_NO_PRECISE_DIAGNOSIS = '6F00';
const HEX_CHARS = '0123456789ABCDEF';

const DEFAULT_HANDLER_TIMEOUT = 10000;
// setTimeout() fires immediately when the delay doesn't fit in a signed 32-bit integer
const MAX_HANDLER_TIMEOUT = 0x7fffffff;

export class HCEError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HCEError';
    this.code = code;
  }
}

/**
 * The native side rejects with plain errors having a `code`, turn them into HCEError (keeping the original
 * error as `cause`), so that the apps can rely on `instanceof HCEError`.
 */
export function toHCEError(error: unknown): unknown {
  if (error instanceof HCEError || typeof error !== 'object' || error === null) {
    return error;
  }

  const {code, message} = error as {code?: unknown; message?: unknown};

  if (typeof code !== 'string') {
    return error;
  }

  const hceError = new HCEError(code, typeof message === 'string' ? message : code);
  hceError.cause = error;
  return hceError;
}

export function callNative<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(e => {
    throw toHCEError(e);
  });
}

export function bytesToHex(bytes: ResponseAPDU): string {
  let out = '';

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];

    if (b === undefined || !Number.isInteger(b) || b < 0 || b > 0xff) {
      throw new HCEError('err_invalid_rapdu', `Invalid byte value at index ${i}: ${b}`);
    }

    out += HEX_CHARS.charAt(b >> 4) + HEX_CHARS.charAt(b & 0x0f);
  }

  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new HCEError('err_invalid_hex', 'Invalid hex string.');
  }

  const out = new Uint8Array(hex.length / 2);

  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return out;
}

export function reportError(onError: ((error: unknown) => void) | undefined, error: unknown) {
  if (onError) {
    try {
      onError(error);
      return;
    } catch (e) {
      console.warn('[HCE] onError handler threw', e);
    }
  }

  console.warn('[HCE] handler error', error);
}

export function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as {code?: unknown}).code === code;
}

export interface ResolvedHandlerOptions {
  // milliseconds, 0 stands for no timeout
  handlerTimeout: number;
  allowWhenLocked: boolean;
}

export function resolveHandlerOptions(options: HandlerOptions): ResolvedHandlerOptions {
  const {handlerTimeout = DEFAULT_HANDLER_TIMEOUT, allowWhenLocked = true} = options;

  if (
    typeof handlerTimeout !== 'number' ||
    !(handlerTimeout === Infinity || (handlerTimeout >= 0 && handlerTimeout <= MAX_HANDLER_TIMEOUT))
  ) {
    throw new HCEError(
      'err_invalid_argument',
      `handlerTimeout must be a number of milliseconds between 0 and ${MAX_HANDLER_TIMEOUT} or Infinity.`,
    );
  }

  if (typeof allowWhenLocked !== 'boolean') {
    throw new HCEError('err_invalid_argument', 'allowWhenLocked must be a boolean.');
  }

  return {handlerTimeout: handlerTimeout === Infinity ? 0 : handlerTimeout, allowWhenLocked};
}

/**
 * Call the handler and wait for its result, but at most `timeout` milliseconds (0 = no limit).
 * The handler can't be cancelled, its late result (or error) is ignored.
 */
export function callHandler<T>(name: string, handler: () => T | PromiseLike<T>, timeout: number): Promise<T> {
  // also turns a synchronous exception into a rejection
  const result = new Promise<T>(resolve => resolve(handler()));

  if (timeout === 0) {
    return result;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new HCEError('err_handler_timeout', `${name} has not finished within ${timeout} ms.`));
    }, timeout);

    result.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Runs the pushed tasks one after another, so that the event handlers never interleave.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  push(task: () => unknown): Promise<void> {
    const result = this.tail.then(async () => {
      await task();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}

/**
 * Pass the C-APDU to the handler and always respond to it: with the handler's result
 * or with an error status word if the handler has failed.
 */
export async function processApdu(
  sessionId: string,
  event: NativeHCEEvent,
  onApdu: ApduHandler,
  onError: ((error: unknown) => void) | undefined,
  timeout: number,
): Promise<void> {
  let response: string;

  try {
    const result = await callHandler(
      'onApdu()',
      () =>
        onApdu({
          id: event.apduId,
          command: hexToBytes(event.command),
          deviceLocked: event.deviceLocked,
        }),
      timeout,
    );

    if (result == null || typeof result.length !== 'number' || result.length < 2) {
      throw new HCEError('err_invalid_rapdu', 'onApdu() must return at least 2 bytes (the status word).');
    }

    response = bytesToHex(result);
  } catch (e) {
    reportError(onError, e);
    response = SW_NO_PRECISE_DIAGNOSIS;
  }

  try {
    await NativeHCEModule.respondApdu(sessionId, event.apduId, response);
  } catch (e) {
    // the reader was lost or the session was closed in the meantime, that's expected
    if (!isErrorCode(e, 'err_stale_apdu')) {
      reportError(onError, toHCEError(e));
    }
  }
}

type SessionListener = (event: NativeHCEEvent) => void;

const sessionListeners = new Map<string, SessionListener>();
let subscription: EventSubscription | null = null;

function dispatchEvent(event: NativeHCEEvent) {
  const listener = sessionListeners.get(event.sessionId);

  if (listener) {
    listener(event);
  } else if (event.type === 'apdu') {
    // nobody is listening, don't leave the reader waiting
    NativeHCEModule.respondApdu(event.sessionId, event.apduId, SW_NO_PRECISE_DIAGNOSIS).catch(() => {});
  }
}

/**
 * There is a single native event stream, the events are routed to listeners by session ID.
 */
export function addSessionListener(sessionId: string, listener: SessionListener): () => void {
  if (!subscription) {
    subscription = NativeHCEModule.onEvent(dispatchEvent);
  }

  sessionListeners.set(sessionId, listener);

  return () => {
    if (sessionListeners.get(sessionId) === listener) {
      sessionListeners.delete(sessionId);
    }
  };
}
