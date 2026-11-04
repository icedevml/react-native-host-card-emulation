import { Buffer } from 'buffer/';

import type { BackgroundHandlerFactory } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from './ndefType4TagApp.ts';

/*
 Called once per interaction with the reader, so the NDEF tag state is never shared between
 concurrent interactions.
 */
const createBackgroundHandler: BackgroundHandlerFactory = ({ sessionId, appState }) => {
  const [_getNDEFAppState, _resetNDEFAppState, handleCAPDU] = createNDEFType4TagApp();
  console.log('background HCE interaction started', sessionId, appState);

  return {
    onApdu: apdu => handleCAPDU(Buffer.from(apdu.command)),
    onReaderLost: () => {
      console.log('background HCE interaction finished', sessionId);
    },
  };
};

export default createBackgroundHandler;
