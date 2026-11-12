export type HCEPlatform = 'android' | 'ios';

export interface HCECapabilities {
  readonly platform: HCEPlatform;
  /**
   * Whether the device and the OS version support host card emulation at all.
   */
  readonly hceSupported: boolean;
  /**
   * Whether NFC is currently enabled (Android) / available for reading (iOS).
   */
  readonly nfcEnabled: boolean;
  /**
   * Whether the app is allowed to use HCE right now.
   * iOS: result of CardSession.isEligible (region, entitlement, etc.).
   * Android: same as hceSupported.
   */
  readonly eligible: boolean;
  /**
   * Whether registerBackgroundHandler() is supported (Android only).
   */
  readonly backgroundSupported: boolean;
  /**
   * Whether acquireExclusiveNFC() is supported (iOS only).
   */
  readonly presentmentSupported: boolean;
}

export interface CommandAPDU {
  /**
   * Identifier of the C-APDU, unique within the app process.
   */
  readonly id: number;
  /**
   * Raw bytes of the C-APDU.
   */
  readonly command: Uint8Array;
  /**
   * Whether the device was locked when the C-APDU was received.
   * iOS: always false, it's impossible to communicate over HCE while the device is locked.
   */
  readonly deviceLocked: boolean;
}

/**
 * Raw bytes of the R-APDU, including the status word (at least 2 bytes).
 */
export type ResponseAPDU = Uint8Array | ReadonlyArray<number>;

export type ApduHandler = (apdu: CommandAPDU) => ResponseAPDU | Promise<ResponseAPDU>;

export type EmulationStopStatus = 'success' | 'failure';

/**
 * Every handler receives the session as its last argument, so it doesn't have to rely on the variable
 * that the result of beginSession() is assigned to.
 */
export interface SessionHandlers {
  /**
   * Handle the C-APDU and return the R-APDU. Called sequentially, the next C-APDU is never
   * delivered before the previous call has finished. If the handler throws, returns an invalid
   * response or doesn't finish within the handler timeout, the reader receives the 6F00 status word
   * (no precise diagnosis).
   */
  onApdu: (apdu: CommandAPDU, session: HCESession) => ResponseAPDU | Promise<ResponseAPDU>;
  /**
   * iOS: The reader's field was detected.
   * Android: The reader has selected the application.
   */
  onReaderDetected?: (session: HCESession) => void | Promise<void>;
  /**
   * The reader was lost, a different application was selected by the reader or the emulation was stopped.
   */
  onReaderLost?: (session: HCESession) => void | Promise<void>;
  /**
   * The session was closed and can't be used anymore.
   */
  onInvalidated?: (reason: string, session: HCESession) => void;
  /**
   * Errors thrown by the handlers above (as they are) and the library's errors (HCEError: err_handler_timeout,
   * err_invalid_rapdu, failures of responding to a C-APDU). Logged with console.warn() if not provided.
   */
  onError?: (error: unknown, session: HCESession) => void;
}

export interface HandlerOptions {
  /**
   * The maximum time (in milliseconds) a single handler call may take, including the returned promise.
   * Once it's exceeded, the handler's result is ignored, onError() receives an err_handler_timeout error
   * and the next event is delivered (a timed out onApdu() is responded to with the 6F00 status word).
   * Without the limit, a handler that never finishes would block all the subsequent events.
   *
   * Default: 10000. Pass 0 or Infinity to disable the timeout.
   */
  handlerTimeout?: number;
  /**
   * Android: Whether the interaction is allowed while the device is locked. If false, the C-APDUs
   * received while the device is locked are never delivered to the handlers and the reader receives
   * an error status word instead. Set it to false unless the app is meant to work on the lock screen.
   * iOS: Ignored, it's impossible to communicate over HCE while the device is locked.
   *
   * Default: true.
   */
  allowWhenLocked?: boolean;
}

export interface BeginSessionOptions extends HandlerOptions {
  /**
   * Aborting the signal invalidates the session, also if it's still being started.
   */
  signal?: AbortSignal;
}

/**
 * The options of the background handler, handlerTimeout also applies to the factory.
 */
export type BackgroundHandlerOptions = HandlerOptions;

export interface HCESession {
  readonly id: string;
  /**
   * Whether the session is still open.
   */
  readonly isActive: boolean;
  /**
   * Resolves with the reason once the session is closed.
   */
  readonly closed: Promise<string>;

  /**
   * iOS: Start the card emulation, displaying the system NFC UI.
   * Android: Start forwarding C-APDUs to this session.
   */
  startEmulation(): Promise<void>;
  /**
   * iOS: Stop the card emulation with "success"/"failure" UI status.
   * Android: Stop forwarding C-APDUs to this session (the status is ignored).
   */
  stopEmulation(status?: EmulationStopStatus): Promise<void>;
  isEmulationRunning(): Promise<boolean>;
  /**
   * iOS: Set the alert message of the system NFC UI.
   * Android: No-op.
   */
  setAlertMessage(message: string): void;
  /**
   * Close the session. Idempotent.
   */
  invalidate(): void;
}

/**
 * - 'background': the app is not in foreground (or not running at all).
 * - 'foreground': the app is in foreground, but it has no session with running emulation.
 */
export type BackgroundAppState = 'background' | 'foreground';

export interface BackgroundContext {
  readonly sessionId: string;
  readonly appState: BackgroundAppState;
}

export interface BackgroundHandlers {
  /**
   * Same semantics as SessionHandlers.onApdu.
   */
  onApdu: ApduHandler;
  /**
   * The reader was lost or a different application was selected by the reader.
   * The background interaction ends after this handler has finished.
   */
  onReaderLost?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Called once per interaction with the reader, so the returned handlers can safely keep
 * the state of that interaction in a closure. If it throws or doesn't finish within the handler
 * timeout, the reader receives an error status word for the rest of the interaction.
 */
export type BackgroundHandlerFactory = (
  context: BackgroundContext,
) => BackgroundHandlers | Promise<BackgroundHandlers>;
