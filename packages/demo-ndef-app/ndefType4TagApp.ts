import { Buffer } from 'buffer/';
import NDEF from './ndef-lib/index'

export interface NDEFType4TagAppState {
  // whether the reader was trying to access NDEF contents
  // within the current selection of the app
  wasNDEFRead: boolean;
}

export type NDEFType4TagApp = [
  getAppState: () => NDEFType4TagAppState,
  resetAppState: () => void,
  handleCAPDU: (capdu: Buffer) => Buffer,
]

export const DEFAULT_NDEF_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

export function createNDEFType4TagApp(url: string = DEFAULT_NDEF_URL): NDEFType4TagApp {
  let wasNDEFRead: boolean = false;
  let currentFile: Buffer | null = null;

  // NFC Forum Type 4 Tag
  // Capability Container
  const fileE103 = Buffer.from("001720010000FF0406E10401000000", "hex");
  const fileE103Padded = Buffer.concat([
    fileE103,
    Buffer.alloc(32 - fileE103.length)
  ]);

  // NDEF file
  const fileE104 = Buffer.concat([
    Buffer.alloc(2),
    Buffer.from(
      NDEF.encodeMessage([NDEF.uriRecord(url)])
    ),
  ]);
  // fill in the total size of NDEF
  fileE104.writeUInt16BE(fileE104.length - 2, 0);
  // pad to 256 bytes (file size specified in Capability Container)
  const fileE104Padded = Buffer.concat([
    fileE104,
    Buffer.alloc(256 - fileE104.length)
  ]);

  const files: Record<number, Buffer> = {
    0xE103: fileE103Padded,
    0xE104: fileE104Padded
  };

  const cmdHandlers: Record<string, (capdu: Buffer) => Buffer> = {
    "00A4": (capdu) => {
      if (capdu.slice(0, 4).compare(Buffer.from([0x00, 0xA4, 0x04, 0x00])) === 0) {
        // select applet
        wasNDEFRead = false;
        return Buffer.from([0x90, 0x00]);
      } else if (capdu.slice(0, 4).compare(Buffer.from([0x00, 0xA4, 0x00, 0x0C])) === 0) {
        // select file by ID
        if (capdu[4] !== 0x02) {
          return Buffer.from([0x67, 0x00]);
        }

        const fileId = capdu.slice(5, 7).readUInt16BE(0);
        if (!files.hasOwnProperty(fileId)) {
          return Buffer.from([0x6A, 0x82]);
        }

        currentFile = files[fileId];
        return Buffer.from([0x90, 0x00]);
      } else {
        return Buffer.from([0x6A, 0x00]);
      }
    },
    "00B0": (capdu) => {
      const offset = capdu.slice(2, 4).readUInt16BE(0);
      const le = capdu[4];

      if (currentFile === null) {
        return Buffer.from([0x69, 0x85]);
      }

      if (currentFile === fileE104Padded && le > 2) {
        wasNDEFRead = true;
      }

      return Buffer.concat([
        currentFile.slice(offset, offset+le),
        Buffer.from([0x90, 0x00])
      ]);
    }
  }

  const getAppState = (): NDEFType4TagAppState => {
    return {
      wasNDEFRead
    } as NDEFType4TagAppState;
  }

  const resetAppState = () => {
    wasNDEFRead = false;
  }

  const handleAPDU = (capdu: Buffer): Buffer => {
    const prefix = capdu.slice(0, 2).toString("hex").toUpperCase();

    // validate class
    if (capdu[0] !== 0x00) {
      return Buffer.from([0x6E, 0x00])
    }

    // find handler for CLA/INS
    if (!cmdHandlers.hasOwnProperty(prefix)) {
      return Buffer.from([0x6D, 0x00]);
    }

    return cmdHandlers[prefix](capdu)
  }

  return [
    getAppState,
    resetAppState,
    handleAPDU
  ] as NDEFType4TagApp;
}
