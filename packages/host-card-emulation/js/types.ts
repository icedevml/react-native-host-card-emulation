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

export interface SessionHandlers {
  /**
   * Handle the C-APDU and return the R-APDU. Called sequentially, the next C-APDU is never
   * delivered before the previous call has finished. If the handler throws or returns an invalid
   * response, the reader receives the 6F00 status word (no precise diagnosis).
   */
  onApdu: ApduHandler;
  /**
   * iOS: The reader's field was detected.
   * Android: The reader has selected the application.
   */
  onReaderDetected?: () => void | Promise<void>;
  /**
   * The reader was lost, a different application was selected by the reader or the emulation was stopped.
   */
  onReaderLost?: () => void | Promise<void>;
  /**
   * The session was closed and can't be used anymore.
   */
  onInvalidated?: (reason: string) => void;
  /**
   * Errors thrown by the handlers above or by responding to a C-APDU.
   * Logged with console.warn() if not provided.
   */
  onError?: (error: unknown) => void;
}

export interface BeginSessionOptions {
  /**
   * Aborting the signal invalidates the session, also if it's still being started.
   */
  signal?: AbortSignal;
}

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
 * the state of that interaction in a closure.
 */
export type BackgroundHandlerFactory = (
  context: BackgroundContext,
) => BackgroundHandlers | Promise<BackgroundHandlers>;
