import { Buffer } from 'buffer/';

import type { BackgroundHandlerFactory } from '@icedevml/react-native-host-card-emulation';
import { createNDEFType4TagApp } from './ndefType4TagApp.ts';
import { logApdu, logEvent } from './components/eventLog.ts';

/*
 Called once per interaction with the reader, so the NDEF tag state is never shared between
 concurrent interactions.
 */
const createBackgroundHandler: BackgroundHandlerFactory = ({ sessionId, appState }) => {
  const [_getNDEFAppState, _resetNDEFAppState, handleCAPDU] = createNDEFType4TagApp();
  logEvent(`BackgroundHandlerFactory(${sessionId.slice(0, 8)}, ${appState})`, 'bg');

  return {
    onApdu: apdu => {
      const command = Buffer.from(apdu.command);
      const response = handleCAPDU(command);
      logApdu(command, response, 'bg');
      return response;
    },
    onReaderLost: () => logEvent('onReaderLost()', 'bg'),
    onError: error => logEvent(`onError(${error})`, 'bg'),
  };
};

export default createBackgroundHandler;
