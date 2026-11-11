import { Buffer } from 'buffer/';
import NDEF from './ndef-lib/index'

export interface NDEFType4TagAppState {
  // whether the reader has read the whole NDEF message
  // within the current selection of the app
  wasNDEFRead: boolean;
}

export type NDEFType4TagApp = [
  getAppState: () => NDEFType4TagAppState,
  resetAppState: () => void,
  handleCAPDU: (capdu: Buffer) => Buffer,
]

export const DEFAULT_NDEF_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// NFC Forum Type 4 Tag, mapping version 2.0
const NDEF_AID = Buffer.from('D2760000850101', 'hex');
const CC_FILE_ID = 0xE103;
const NDEF_FILE_ID = 0xE104;
// maximum R-APDU data size (Le = 0x00 stands for 256 bytes in short APDUs)
const MLE = 0x0100;
// maximum C-APDU data size, there are no commands with data besides SELECT
const MLC = 0x00FF;
const MAX_NDEF_FILE_SIZE = 0x7FFF;

// ISO 7816-4 status words
const SW_OK = Buffer.from([0x90, 0x00]);
const SW_END_OF_FILE = Buffer.from([0x62, 0x82]);
const SW_WRONG_LENGTH = Buffer.from([0x67, 0x00]);
const SW_NO_CURRENT_EF = Buffer.from([0x69, 0x86]);
const SW_FILE_NOT_FOUND = Buffer.from([0x6A, 0x82]);
const SW_INCORRECT_P1P2 = Buffer.from([0x6A, 0x86]);
const SW_WRONG_P1P2 = Buffer.from([0x6B, 0x00]);
const SW_INS_NOT_SUPPORTED = Buffer.from([0x6D, 0x00]);
const SW_CLA_NOT_SUPPORTED = Buffer.from([0x6E, 0x00]);

interface ParsedAPDU {
  p1: number;
  p2: number;
  data: Buffer;
  // expected response length (Ne), null if absent
  ne: number | null;
}

// short APDUs only, MLe and MLc fit in them
function parseAPDU(capdu: Buffer): ParsedAPDU | null {
  const p1 = capdu[2];
  const p2 = capdu[3];
  const body = capdu.slice(4);

  if (body.length === 0) {
    // case 1
    return { p1, p2, data: Buffer.alloc(0), ne: null };
  }

  if (body.length === 1) {
    // case 2
    return { p1, p2, data: Buffer.alloc(0), ne: body[0] === 0 ? 256 : body[0] };
  }

  const lc = body[0];

  if (lc === 0) {
    // extended length, unsupported
    return null;
  }

  if (body.length === 1 + lc) {
    // case 3
    return { p1, p2, data: body.slice(1), ne: null };
  }

  if (body.length === 2 + lc) {
    // case 4
    const le = body[1 + lc];
    return { p1, p2, data: body.slice(1, 1 + lc), ne: le === 0 ? 256 : le };
  }

  return null;
}

export function createNDEFType4TagApp(url: string = DEFAULT_NDEF_URL): NDEFType4TagApp {
  let wasNDEFRead: boolean = false;
  let appSelected: boolean = false;
  let currentFile: Buffer | null = null;

  // NDEF file: NLEN followed by the NDEF message
  const ndefMessage = Buffer.from(NDEF.encodeMessage([NDEF.uriRecord(url)]));
  const ndefFile = Buffer.concat([Buffer.alloc(2), ndefMessage]);
  ndefFile.writeUInt16BE(ndefMessage.length, 0);

  if (ndefFile.length > MAX_NDEF_FILE_SIZE) {
    throw new Error(`The NDEF message is too long (${ndefMessage.length} bytes).`);
  }

  // Capability Container
  const ccFile = Buffer.alloc(15);
  ccFile.writeUInt16BE(ccFile.length, 0);   // CCLEN
  ccFile[2] = 0x20;                         // mapping version 2.0
  ccFile.writeUInt16BE(MLE, 3);             // MLe
  ccFile.writeUInt16BE(MLC, 5);             // MLc
  ccFile[7] = 0x04;                         // NDEF File Control TLV
  ccFile[8] = 0x06;
  ccFile.writeUInt16BE(NDEF_FILE_ID, 9);    // NDEF file identifier
  ccFile.writeUInt16BE(ndefFile.length, 11); // maximum NDEF file size
  ccFile[13] = 0x00;                        // read access granted
  ccFile[14] = 0xFF;                        // no write access (read-only tag)

  const files: Record<number, Buffer> = {
    [CC_FILE_ID]: ccFile,
    [NDEF_FILE_ID]: ndefFile,
  };

  const selectCmd = (apdu: ParsedAPDU): Buffer => {
    if (apdu.p1 === 0x04 && (apdu.p2 === 0x00 || apdu.p2 === 0x0C)) {
      // select the application by name (the selection is unchanged on failure)
      if (apdu.data.compare(NDEF_AID) !== 0) {
        return SW_FILE_NOT_FOUND;
      }

      appSelected = true;
      currentFile = null;
      wasNDEFRead = false;
      return SW_OK;
    }

    if (apdu.p1 === 0x00 && (apdu.p2 === 0x0C || apdu.p2 === 0x00)) {
      // select the file by identifier (P2 = 0x0C in mapping version 2.0, 0x00 in 1.0)
      if (apdu.data.length !== 2) {
        return SW_WRONG_LENGTH;
      }

      const fileId = apdu.data.readUInt16BE(0);

      if (!appSelected || !files.hasOwnProperty(fileId)) {
        return SW_FILE_NOT_FOUND;
      }

      currentFile = files[fileId];
      return SW_OK;
    }

    return SW_INCORRECT_P1P2;
  };

  const readBinaryCmd = (apdu: ParsedAPDU): Buffer => {
    if (apdu.data.length !== 0 || apdu.ne === null) {
      return SW_WRONG_LENGTH;
    }

    if (apdu.p1 >= 0x80) {
      // short EF identifiers aren't supported, the offset is 0x0000 - 0x7FFF
      return SW_WRONG_P1P2;
    }

    if (currentFile === null) {
      return SW_NO_CURRENT_EF;
    }

    const offset = apdu.p1 * 0x100 + apdu.p2;

    if (offset >= currentFile.length) {
      return SW_WRONG_P1P2;
    }

    const data = currentFile.slice(offset, offset + apdu.ne);

    if (currentFile === ndefFile && offset + data.length === ndefFile.length) {
      wasNDEFRead = true;
    }

    // fewer bytes than requested, as the end of the file was reached
    return Buffer.concat([data, data.length < apdu.ne ? SW_END_OF_FILE : SW_OK]);
  };

  const cmdHandlers: Record<number, (apdu: ParsedAPDU) => Buffer> = {
    0xA4: selectCmd,
    0xB0: readBinaryCmd,
  };

  const getAppState = (): NDEFType4TagAppState => {
    return {
      wasNDEFRead
    } as NDEFType4TagAppState;
  }

  const resetAppState = () => {
    wasNDEFRead = false;
  }

  const handleAPDU = (capdu: Buffer): Buffer => {
    if (capdu.length < 4) {
      return SW_WRONG_LENGTH;
    }

    // validate class
    if (capdu[0] !== 0x00) {
      return SW_CLA_NOT_SUPPORTED;
    }

    // find handler for INS (UPDATE BINARY isn't supported, the tag is read-only)
    const handler = cmdHandlers[capdu[1]];

    if (!handler) {
      return SW_INS_NOT_SUPPORTED;
    }

    const apdu = parseAPDU(capdu);

    if (apdu === null) {
      return SW_WRONG_LENGTH;
    }

    return handler(apdu);
  }

  return [
    getAppState,
    resetAppState,
    handleAPDU
  ] as NDEFType4TagApp;
}
