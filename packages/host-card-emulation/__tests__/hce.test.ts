import type {NativeHCEEvent} from '../js/NativeHCEModule';

type Listener = (event: NativeHCEEvent) => void;

const mockNative = {
  listener: null as Listener | null,
  onEvent: jest.fn((listener: Listener) => {
    mockNative.listener = listener;
    return {remove: jest.fn()};
  }),
  getCapabilities: jest.fn(),
  beginSession: jest.fn(),
  invalidateSession: jest.fn(),
  setSessionAlertMessage: jest.fn(),
  startEmulation: jest.fn(() => Promise.resolve()),
  stopEmulation: jest.fn(() => Promise.resolve()),
  isEmulationRunning: jest.fn(() => Promise.resolve(false)),
  respondApdu: jest.fn(() => Promise.resolve()),
  acquireExclusiveNFC: jest.fn(),
  releaseExclusiveNFC: jest.fn(),
  isExclusiveNFC: jest.fn(() => false),
  setBackgroundHandlerRegistered: jest.fn(),
  backgroundSessionReady: jest.fn(() => true),
};

jest.mock('../js/NativeHCEModule', () => ({
  __esModule: true,
  default: mockNative,
}));

function event(sessionId: string, type: string, extra: Partial<NativeHCEEvent> = {}): NativeHCEEvent {
  return {sessionId, type, apduId: 0, command: '', deviceLocked: false, reason: '', ...extra};
}

function emit(e: NativeHCEEvent) {
  mockNative.listener!(e);
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

async function startSession(handlers: Parameters<typeof import('../js').HCE.beginSession>[0]) {
  const {HCE} = require('../js') as typeof import('../js');
  mockNative.beginSession.mockImplementation((id: string) => {
    // the native side emits sessionStarted asynchronously
    setImmediate(() => emit(event(id, 'sessionStarted')));
    return Promise.resolve();
  });
  return HCE.beginSession(handlers);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('hex helpers', () => {
  const {bytesToHex, hexToBytes} = require('../js') as typeof import('../js');

  it('round-trips bytes', () => {
    expect(bytesToHex(hexToBytes('00a4040007d2760000850101'))).toBe('00A4040007D2760000850101');
  });

  it('rejects invalid input', () => {
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
    expect(() => bytesToHex([256])).toThrow();
    expect(() => bytesToHex([1.5])).toThrow();
  });
});

describe('foreground session', () => {
  it('resolves after sessionStarted and responds with the returned R-APDU', async () => {
    const onApdu = jest.fn(() => new Uint8Array([0x0a, 0x90, 0x00]));
    const session = await startSession({onApdu});

    expect(mockNative.beginSession).toHaveBeenCalledWith(session.id);

    emit(event(session.id, 'apdu', {apduId: 7, command: '00A40400', deviceLocked: true}));
    await flush();

    expect(onApdu).toHaveBeenCalledWith({id: 7, command: new Uint8Array([0x00, 0xa4, 0x04, 0x00]), deviceLocked: true});
    expect(mockNative.respondApdu).toHaveBeenCalledWith(session.id, 7, '0A9000');
    session.invalidate();
  });

  it('responds with 6F00 when the handler throws or returns an invalid response', async () => {
    const onError = jest.fn();
    const onApdu = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => [0x90]);
    const session = await startSession({onApdu, onError});

    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    emit(event(session.id, 'apdu', {apduId: 2, command: '00'}));
    await flush();

    expect(mockNative.respondApdu).toHaveBeenNthCalledWith(1, session.id, 1, '6F00');
    expect(mockNative.respondApdu).toHaveBeenNthCalledWith(2, session.id, 2, '6F00');
    expect(onError).toHaveBeenCalledTimes(2);
    session.invalidate();
  });

  it('runs the handlers sequentially', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;

    const session = await startSession({
      onApdu: async apdu => {
        order.push(`apdu-start-${apdu.id}`);

        if (apdu.id === 1) {
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
        }

        order.push(`apdu-end-${apdu.id}`);
        return [0x90, 0x00];
      },
      onReaderLost: () => {
        order.push('readerLost');
      },
    });

    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    emit(event(session.id, 'apdu', {apduId: 2, command: '00'}));
    emit(event(session.id, 'readerLost'));
    await flush();

    expect(order).toEqual(['apdu-start-1']);

    releaseFirst();
    await flush();

    expect(order).toEqual(['apdu-start-1', 'apdu-end-1', 'apdu-start-2', 'apdu-end-2', 'readerLost']);
    session.invalidate();
  });

  it('closes on invalidate() and answers APDUs of unknown sessions with 6F00', async () => {
    const onInvalidated = jest.fn();
    const onApdu = jest.fn(() => [0x90, 0x00]);
    const session = await startSession({onApdu, onInvalidated});

    session.invalidate();
    session.invalidate();

    expect(mockNative.invalidateSession).toHaveBeenCalledTimes(1);
    await expect(session.closed).resolves.toBe('userInvalidated');
    expect(session.isActive).toBe(false);
    await expect(session.startEmulation()).rejects.toMatchObject({code: 'err_no_session'});

    emit(event(session.id, 'apdu', {apduId: 3, command: '00'}));
    await flush();

    expect(onApdu).not.toHaveBeenCalled();
    expect(onInvalidated).toHaveBeenCalledWith('userInvalidated');
    expect(mockNative.respondApdu).toHaveBeenCalledWith(session.id, 3, '6F00');
  });

  it('closes when the OS invalidates the session', async () => {
    const onInvalidated = jest.fn();
    const session = await startSession({onApdu: () => [0x90, 0x00], onInvalidated});

    emit(event(session.id, 'sessionInvalidated', {reason: 'maxSessionDurationReached'}));
    await flush();

    await expect(session.closed).resolves.toBe('maxSessionDurationReached');
    expect(onInvalidated).toHaveBeenCalledWith('maxSessionDurationReached');
  });

  it('invalidates the session when aborted while starting', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const controller = new AbortController();
    mockNative.beginSession.mockImplementation(() => Promise.resolve());

    const promise = HCE.beginSession({onApdu: () => [0x90, 0x00]}, {signal: controller.signal});
    await flush();
    controller.abort();

    await expect(promise).rejects.toMatchObject({code: 'err_aborted'});
    expect(mockNative.invalidateSession).toHaveBeenCalledTimes(1);
  });

  it('cleans up when the native beginSession() fails', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const error = Object.assign(new Error('exists'), {code: 'err_session_exists'});
    mockNative.beginSession.mockImplementation(() => Promise.reject(error));

    await expect(HCE.beginSession({onApdu: () => [0x90, 0x00]})).rejects.toBe(error);
  });

  it('ignores stale APDU responses', async () => {
    const onError = jest.fn();
    mockNative.respondApdu.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('stale'), {code: 'err_stale_apdu'})),
    );
    const session = await startSession({onApdu: () => [0x90, 0x00], onError});

    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    await flush();

    expect(onError).not.toHaveBeenCalled();
    session.invalidate();
  });
});

describe('background handler', () => {
  let task: (data: object) => Promise<void>;

  beforeAll(() => {
    const {AppRegistry, Platform} = require('react-native');
    Platform.OS = 'android';
    jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation((...args: unknown[]) => {
      const provider = args[1] as () => typeof task;
      task = provider();
    });
  });

  it('serves the interaction until the reader is lost', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const onReaderLost = jest.fn();
    const factory = jest.fn(() => ({onApdu: () => [0x90, 0x00], onReaderLost}));

    HCE.registerBackgroundHandler(factory);
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledWith(true);

    let finished = false;
    const taskPromise = task({sessionId: 'bg-1', appState: 'foreground'}).then(() => {
      finished = true;
    });
    await flush();

    expect(factory).toHaveBeenCalledWith({sessionId: 'bg-1', appState: 'foreground'});
    expect(mockNative.backgroundSessionReady).toHaveBeenCalledWith('bg-1');

    emit(event('bg-1', 'apdu', {apduId: 5, command: '00B0000000'}));
    await flush();

    expect(mockNative.respondApdu).toHaveBeenCalledWith('bg-1', 5, '9000');
    expect(finished).toBe(false);

    emit(event('bg-1', 'readerLost'));
    await taskPromise;

    expect(onReaderLost).toHaveBeenCalled();
    expect(finished).toBe(true);
  });

  it('finishes right away if the reader was already lost', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    mockNative.backgroundSessionReady.mockReturnValueOnce(false);
    HCE.registerBackgroundHandler(() => ({onApdu: () => [0x90, 0x00]}));

    await task({sessionId: 'bg-2', appState: 'background'});
  });

  it('finishes if the factory throws, without signalling readiness', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    HCE.registerBackgroundHandler(() => {
      throw new Error('factory failed');
    });

    await task({sessionId: 'bg-3', appState: 'background'});

    expect(mockNative.backgroundSessionReady).not.toHaveBeenCalled();
  });

  it('can be unregistered and registered again', () => {
    const {HCE} = require('../js') as typeof import('../js');
    const factory = () => ({onApdu: () => [0x90, 0x00]});

    HCE.registerBackgroundHandler(factory);
    HCE.unregisterBackgroundHandler();
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenLastCalledWith(false);

    HCE.registerBackgroundHandler(factory);
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenLastCalledWith(true);
  });
});

describe('background handler declaration', () => {
  const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  function loadIsolated(entry: (hce: typeof import('../js').HCE) => void) {
    jest.isolateModules(() => {
      const {AppRegistry, Platform} = require('react-native');
      Platform.OS = 'android';
      jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation(() => {});
      entry((require('../js') as typeof import('../js')).HCE);
    });
  }

  it('declares that there is no background handler once the entry file was evaluated', async () => {
    loadIsolated(() => {});
    expect(mockNative.setBackgroundHandlerRegistered).not.toHaveBeenCalled();

    await nextTick();

    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledTimes(1);
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledWith(false);
  });

  it('only declares the handler registered by the entry file', async () => {
    loadIsolated(HCE => HCE.registerBackgroundHandler(() => ({onApdu: () => [0x90, 0x00]})));
    await nextTick();

    expect(mockNative.setBackgroundHandlerRegistered.mock.calls).toEqual([[true]]);
  });
});
