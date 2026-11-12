import HCE from '@icedevml/react-native-host-card-emulation';
// the library's Jest mock of its native module, loaded by its jest/setup (see jest.config.js)
import { sendApdu } from '@icedevml/react-native-host-card-emulation/jest/NativeHCEModuleMock';
import { Buffer } from 'buffer/';

import { createNDEFType4TagApp } from '../ndefType4TagApp';

test('a reader reads the NDEF message through the HCE session', async () => {
  const [getAppState, , handleCAPDU] = createNDEFType4TagApp('https://example.com/');
  const session = await HCE.beginSession({
    onApdu: apdu => handleCAPDU(Buffer.from(apdu.command)),
  });
  await session.startEmulation();

  // NDEF Tag Application Select
  expect(await sendApdu(session.id, '00A4040007D276000085010100')).toBe('9000');
  // Capability Container: NDEF file E104 of 0x13 bytes, read-only
  expect(await sendApdu(session.id, '00A4000C02E103')).toBe('9000');
  expect(await sendApdu(session.id, '00B000000F')).toBe('000F20010000FF0406E104001300FF9000');
  // NDEF file: NLEN, then the URI record "https://" + "example.com/"
  expect(await sendApdu(session.id, '00A4000C02E104')).toBe('9000');
  expect(await sendApdu(session.id, '00B0000002')).toBe('00119000');
  expect(getAppState().wasNDEFRead).toBe(false);
  expect(await sendApdu(session.id, '00B0000211')).toBe('D1010D55046578616D706C652E636F6D2F9000');
  expect(getAppState().wasNDEFRead).toBe(true);

  session.invalidate();
});
