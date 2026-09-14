import type {CodegenTypes, TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type HCEModuleEventType =
    'sessionStarted'
    | 'sessionInvalidated'
    /**
     * iOS: Whether the reader field was detected.
     * Android: Whether the reader had sent the select command to us.
     */
    | 'readerDetected'
    /**
     * Whether our HCE app was deselected or the reader was lost.
     */
    | 'readerDeselected'
    /**
     * Received C-APDU (hex-encoded string in "arg" key) from the reader.
     * Respond by calling respondAPDU(rapdu).
     */
    | 'received'
    /**
     * The device lock state, always reported before the 'received' event of the
     * first C-APDU of a session and then again whenever it changes.
     *
     * iOS: Always 'deviceUnlocked' - it's impossible to communicate over HCE while
     * the device is locked, so the state cannot change during a session.
     * Android: The state is sampled whenever a C-APDU arrives, so a change is
     * reported straight before the 'received' event of the C-APDU during which it
     * was noticed.
     */
    | 'deviceLocked'
    | 'deviceUnlocked';
export type HCEModuleStopReason = 'success' | 'failure';

export type HCEModuleBackgroundEventType =
    'readerDeselected'
    | 'received'
    /**
     * The device lock state, always reported before the 'received' event of the
     * first C-APDU of a session and then again whenever it changes. The state is
     * sampled whenever a C-APDU arrives, so a change is reported straight before
     * the 'received' event of the C-APDU during which it was noticed.
     */
    | 'deviceLocked'
    | 'deviceUnlocked';

export type HCEModuleEvent = {
  type: HCEModuleEventType
  arg: string | null,
}

export type HCEModuleBackgroundEvent = {
  type: HCEModuleBackgroundEventType
  arg: string | null,
  audience: string,
}

export interface Spec extends TurboModule {
  /**
   * Checks if a given smartphone supports required HCE features.
   */
  isPlatformSupported(): boolean;

  /**
   * iOS: Tries to acquire NFCPresentmentIntentAssertion.
   * Android: Not supported (throws an exception).
   */
  acquireExclusiveNFC(): Promise<void>;
  /**
   * iOS: Release NFCPresentmentIntentAssertion object.
   * Android: Not supported (no-op).
   */
  releaseExclusiveNFC(): void;
  /**
   * iOS: Whether the NFCPresentmentIntentAssertion is acquired and still valid.
   * Android: Always false.
   */
  isExclusiveNFC(): boolean;

  /**
   * Begin card operation session.
   * iOS: Create CardSession.
   * Android: Sets an internal flag that the session is open.
   */
  beginSession(): Promise<void>;
  /**
   * iOS: Set alert message on the NFC system UI.
   * Android: NO-OP.
   */
  setSessionAlertMessage(message: string): void;
  /**
   * iOS: Invalidate CardSession.
   * Android: Set an internal flag that the session is closed and disable HCE service.
   */
  invalidateSession(): void;
  /**
   * iOS: Checks if CardSession is running.
   * Android: Checks if an internal flag is set.
   */
  isSessionRunning(): boolean;

  /**
   * iOS: Start the card emulation.
   * Android: Enable HCE service.
   */
  startHCE(): Promise<void>;
  /**
   * iOS: Stop the card emulation with "success"/"failure" UI status.
   * Android: Disable HCE service.
   */
  stopHCE(status: HCEModuleStopReason): Promise<void>;
  /**
   * Send R-APDU (hex-encoded string) as a response to the last received C-APDU event.
   * Set handle=null when calling this function from foreground app.
   */
  respondAPDU(handle: string | null, rapdu: string): Promise<void>;
  /**
   * iOS: Checks if the card emulation is running.
   * Android: Checks if the HCE service is enabled.
   */
  isHCERunning(): Promise<boolean>;

  /**
   * Android: Report that the JS headless task is ready to handle HCE interaction in the background.
   * NOTE: Don't call this API directly, use wrapper hceBackground.ts:createBackgroundHCE.
   * See demo app or README.md for example wrapper usage.
   */
  beginBackgroundHCE(handle: string): boolean;

  /**
   * Android: Report the background HCE interaction was finished.
   * NOTE: Don't call this API directly, use wrapper hceBackground.ts:createBackgroundHCE.
   * See demo app or README.md for example wrapper usage.
   */
  finishBackgroundHCE(handle: string): boolean;

  /**
   * Event handler for foreground HCE interactions.
   */
  readonly onEvent: CodegenTypes.EventEmitter<HCEModuleEvent>;

  /**
   * Event handler for background HCE interactions.
   * NOTE: Don't subscribe to that handler directly, use wrapper hceBackground.ts:createBackgroundHCE.
   * See demo app or README.md for example wrapper usage.
   */
  readonly onBackgroundEvent: CodegenTypes.EventEmitter<HCEModuleBackgroundEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>(
  'NativeHCEModule',
);
