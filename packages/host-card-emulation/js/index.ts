import NativeHCEModule from './NativeHCEModule';
import {registerBackgroundHandler, unregisterBackgroundHandler} from './background';
import {bytesToHex, HCEError, hexToBytes} from './internal';
import {beginSession} from './session';
import type {HCECapabilities, HCEPlatform} from './types';

async function getCapabilities(): Promise<HCECapabilities> {
  const caps = await NativeHCEModule.getCapabilities();

  return {
    platform: caps.platform as HCEPlatform,
    hceSupported: caps.hceSupported,
    nfcEnabled: caps.nfcEnabled,
    eligible: caps.eligible,
    backgroundSupported: caps.backgroundSupported,
    presentmentSupported: caps.presentmentSupported,
  };
}

export const HCE = {
  /**
   * Check what the device supports. Always check it before beginning a session.
   */
  getCapabilities,
  beginSession,
  registerBackgroundHandler,
  unregisterBackgroundHandler,

  /**
   * iOS: Acquire NFCPresentmentIntentAssertion (exclusive NFC access for a limited time).
   * Android: Not supported, rejects with err_platform_unsupported.
   */
  acquireExclusiveNFC: (): Promise<void> => NativeHCEModule.acquireExclusiveNFC(),
  /**
   * iOS: Release NFCPresentmentIntentAssertion.
   * Android: No-op.
   */
  releaseExclusiveNFC: (): void => NativeHCEModule.releaseExclusiveNFC(),
  /**
   * iOS: Whether NFCPresentmentIntentAssertion is acquired and still valid.
   * Android: Always false.
   */
  isExclusiveNFC: (): boolean => NativeHCEModule.isExclusiveNFC(),
};

export default HCE;

export {HCEError, bytesToHex, hexToBytes};
export * from './types';
