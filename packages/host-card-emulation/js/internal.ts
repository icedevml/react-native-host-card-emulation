import type {EventSubscription} from 'react-native';

import NativeHCEModule, {NativeHCEEvent} from './NativeHCEModule';
import type {ApduHandler, ResponseAPDU} from './types';

// ISO 7816-4: no precise diagnosis
const SW_NO_PRECISE_DIAGNOSIS = '6F00';
const HEX_CHARS = '0123456789ABCDEF';

export class HCEError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HCEError';
    this.code = code;
  }
}

export function bytesToHex(bytes: ResponseAPDU): string {
  let out = '';

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];

    if (!Number.isInteger(b) || b < 0 || b > 0xff) {
      throw new HCEError('err_invalid_rapdu', `Invalid byte value at index ${i}: ${b}`);
    }

    out += HEX_CHARS[b >> 4] + HEX_CHARS[b & 0x0f];
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
): Promise<void> {
  let response: string;

  try {
    const result = await onApdu({
      id: event.apduId,
      command: hexToBytes(event.command),
      deviceLocked: event.deviceLocked,
    });

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
      reportError(onError, e);
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
