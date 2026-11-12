import type {NativeHCEEvent} from '../js/NativeHCEModule';
// the native module is replaced with this mock by jest/setup.js (see jest.config.js)
import * as NativeHCEModuleMock from '../jest/NativeHCEModuleMock';

const mockNative = NativeHCEModuleMock.NativeHCEModule;

function event(sessionId: string, type: string, extra: Partial<NativeHCEEvent> = {}): NativeHCEEvent {
  return {sessionId, type, apduId: 0, command: '', deviceLocked: false, reason: '', ...extra};
}

function emit(e: NativeHCEEvent) {
  NativeHCEModuleMock.emitEvent(e);
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function startSession(
  handlers: Parameters<typeof import('../js').HCE.beginSession>[0],
  options?: Parameters<typeof import('../js').HCE.beginSession>[1],
) {
  const {HCE} = require('../js') as typeof import('../js');
  return HCE.beginSession(handlers, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  NativeHCEModuleMock.reset();
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

    expect(mockNative.beginSession).toHaveBeenCalledWith(session.id, true);

    emit(event(session.id, 'apdu', {apduId: 7, command: '00A40400', deviceLocked: true}));
    await flush();

    expect(onApdu).toHaveBeenCalledWith(
      {id: 7, command: new Uint8Array([0x00, 0xa4, 0x04, 0x00]), deviceLocked: true},
      session,
    );
    expect(mockNative.respondApdu).toHaveBeenCalledWith(session.id, 7, '0A9000');
    session.invalidate();
  });

  it('responds to the reader simulated by the Jest mock', async () => {
    const session = await startSession({onApdu: apdu => [apdu.command.length, 0x90, 0x00]});

    await expect(NativeHCEModuleMock.sendApdu(session.id, '00A40400')).resolves.toBe('049000');
    session.invalidate();
  });

  it('rejects when another session already exists', async () => {
    const session = await startSession({onApdu: () => [0x90, 0x00]});

    await expect(startSession({onApdu: () => [0x90, 0x00]})).rejects.toMatchObject({code: 'err_session_exists'});
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
    expect(onInvalidated).toHaveBeenCalledWith('userInvalidated', session);
    expect(mockNative.respondApdu).toHaveBeenCalledWith(session.id, 3, '6F00');
  });

  it('closes when the OS invalidates the session', async () => {
    const onInvalidated = jest.fn();
    const session = await startSession({onApdu: () => [0x90, 0x00], onInvalidated});

    emit(event(session.id, 'sessionInvalidated', {reason: 'maxSessionDurationReached'}));
    await flush();

    await expect(session.closed).resolves.toBe('maxSessionDurationReached');
    expect(onInvalidated).toHaveBeenCalledWith('maxSessionDurationReached', session);
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

  it('invalidates the native session again if the start was aborted before it was created', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const controller = new AbortController();
    let resolveNative!: () => void;
    mockNative.beginSession.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveNative = resolve;
        }),
    );

    const promise = HCE.beginSession({onApdu: () => [0x90, 0x00]}, {signal: controller.signal});
    controller.abort();
    resolveNative();

    await expect(promise).rejects.toMatchObject({code: 'err_aborted'});
    // once by invalidate(), once more after the native session was created
    expect(mockNative.invalidateSession).toHaveBeenCalledTimes(2);
  });

  it('rejects with err_aborted when the native start fails because it was aborted', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const controller = new AbortController();
    let rejectNative!: (error: Error) => void;
    mockNative.beginSession.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectNative = reject;
        }),
    );

    const promise = HCE.beginSession({onApdu: () => [0x90, 0x00]}, {signal: controller.signal});
    controller.abort();
    rejectNative(Object.assign(new Error('invalidated'), {code: 'err_session_invalidated'}));

    await expect(promise).rejects.toMatchObject({code: 'err_aborted'});
  });

  it('converts the error to HCEError when the native beginSession() fails', async () => {
    const {HCE, HCEError} = require('../js') as typeof import('../js');
    const error = Object.assign(new Error('exists'), {code: 'err_session_exists'});
    mockNative.beginSession.mockImplementation(() => Promise.reject(error));

    const promise = HCE.beginSession({onApdu: () => [0x90, 0x00]});

    await expect(promise).rejects.toBeInstanceOf(HCEError);
    await expect(promise).rejects.toMatchObject({code: 'err_session_exists', message: 'exists', cause: error});
  });

  it('converts the errors of the other native calls to HCEError', async () => {
    const {HCE, HCEError} = require('../js') as typeof import('../js');
    const nativeError = (code: string) => Object.assign(new Error(code), {code});
    const onError = jest.fn();
    const session = await startSession({onApdu: () => [0x90, 0x00], onError});

    mockNative.startEmulation.mockRejectedValueOnce(nativeError('err_start_emulation'));
    await expect(session.startEmulation()).rejects.toBeInstanceOf(HCEError);

    mockNative.acquireExclusiveNFC.mockRejectedValueOnce(nativeError('err_already_exists'));
    await expect(HCE.acquireExclusiveNFC()).rejects.toBeInstanceOf(HCEError);

    // passed to onError()
    mockNative.respondApdu.mockRejectedValueOnce(nativeError('err_apdu_respond'));
    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(HCEError), session);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'err_apdu_respond'}), session);
    session.invalidate();
  });

  it('responds with 6F00 when onApdu() times out and delivers the next C-APDU', async () => {
    const onError = jest.fn();
    const onApdu = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => [0x90, 0x00]);
    const session = await startSession({onApdu, onError}, {handlerTimeout: 20});

    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    emit(event(session.id, 'apdu', {apduId: 2, command: '00'}));
    await sleep(50);

    expect(mockNative.respondApdu).toHaveBeenNthCalledWith(1, session.id, 1, '6F00');
    expect(mockNative.respondApdu).toHaveBeenNthCalledWith(2, session.id, 2, '9000');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'err_handler_timeout'}), session);
    session.invalidate();
  });

  it('times out the other handlers too, so that they never block the session', async () => {
    const onError = jest.fn();
    const onInvalidated = jest.fn();
    const session = await startSession(
      {onApdu: () => [0x90, 0x00], onReaderDetected: () => new Promise(() => {}), onInvalidated, onError},
      {handlerTimeout: 20},
    );

    emit(event(session.id, 'readerDetected'));
    session.invalidate();
    await sleep(50);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'err_handler_timeout'}), session);
    expect(onInvalidated).toHaveBeenCalledWith('userInvalidated', session);
  });

  it('passes the session to every handler', async () => {
    const received: unknown[] = [];
    const session = await startSession({
      onApdu: (_apdu, s) => {
        received.push(s);
        throw new Error('boom');
      },
      onReaderDetected: s => {
        received.push(s);
      },
      onReaderLost: s => {
        received.push(s);
      },
      onInvalidated: (_reason, s) => {
        received.push(s);
      },
      onError: (_error, s) => {
        received.push(s);
      },
    });

    emit(event(session.id, 'readerDetected'));
    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    emit(event(session.id, 'readerLost'));
    session.invalidate();
    await flush();

    // onReaderDetected(), onApdu(), onError(), onReaderLost(), onInvalidated()
    expect(received).toHaveLength(5);
    expect(received.every(s => s === session)).toBe(true);
  });

  it('passes allowWhenLocked to the native side', async () => {
    const session = await startSession({onApdu: () => [0x90, 0x00]}, {allowWhenLocked: false});

    expect(mockNative.beginSession).toHaveBeenCalledWith(session.id, false);
    session.invalidate();
  });

  it('rejects invalid options', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const handlers = {onApdu: () => [0x90, 0x00]};

    for (const handlerTimeout of [-1, NaN, 0x80000000, '10' as unknown as number]) {
      await expect(HCE.beginSession(handlers, {handlerTimeout})).rejects.toMatchObject({code: 'err_invalid_argument'});
    }

    await expect(
      HCE.beginSession(handlers, {allowWhenLocked: 'no' as unknown as boolean}),
    ).rejects.toMatchObject({code: 'err_invalid_argument'});
    expect(mockNative.beginSession).not.toHaveBeenCalled();
  });

  it('accepts 0 and Infinity as no timeout', async () => {
    for (const handlerTimeout of [0, Infinity]) {
      const session = await startSession({onApdu: () => [0x90, 0x00]}, {handlerTimeout});
      session.invalidate();
    }
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
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledWith(true, true);

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
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenLastCalledWith(false, true);

    HCE.registerBackgroundHandler(factory, {allowWhenLocked: false});
    expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenLastCalledWith(true, false);
  });

  it('finishes if the factory times out, without signalling readiness', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const onApdu = jest.fn(() => [0x90, 0x00]);
    let resolveFactory!: (handlers: {onApdu: typeof onApdu}) => void;
    HCE.registerBackgroundHandler(
      () =>
        new Promise(resolve => {
          resolveFactory = resolve;
        }),
      {handlerTimeout: 20},
    );

    await task({sessionId: 'bg-4', appState: 'background'});
    expect(console.warn).toHaveBeenCalledWith('[HCE] handler error', expect.objectContaining({code: 'err_handler_timeout'}));

    // the late result is ignored
    resolveFactory({onApdu});
    await flush();
    emit(event('bg-4', 'apdu', {apduId: 1, command: '00'}));
    await flush();

    expect(mockNative.backgroundSessionReady).not.toHaveBeenCalled();
    expect(onApdu).not.toHaveBeenCalled();
  });

  it('finishes when onReaderLost() times out', async () => {
    const {HCE} = require('../js') as typeof import('../js');
    const onError = jest.fn();
    HCE.registerBackgroundHandler(
      () => ({onApdu: () => [0x90, 0x00], onReaderLost: () => new Promise<void>(() => {}), onError}),
      {handlerTimeout: 20},
    );

    const taskPromise = task({sessionId: 'bg-5', appState: 'background'});
    await flush();
    emit(event('bg-5', 'readerLost'));
    await taskPromise;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'err_handler_timeout'}));
  });
});

describe('background handler declaration', () => {
  const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  // the isolated modules share the native module mock (like the native side outlives a reload of the app)
  function loadIsolated(entry: (hce: typeof import('../js').HCE) => void) {
    jest.isolateModules(() => {
      const {AppRegistry, Platform} = require('react-native');
      Platform.OS = 'android';
      jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation(() => {});
      entry((require('../js') as typeof import('../js')).HCE);
    });
  }

  it('declares that there is no background handler once the entry file was evaluated', async () => {
    // JS timers don't fire while the app is started in background, the declaration must not depend on them
    jest.useFakeTimers();

    try {
      loadIsolated(() => {});
      expect(mockNative.setBackgroundHandlerRegistered).not.toHaveBeenCalled();

      await Promise.resolve();

      expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledTimes(1);
      expect(mockNative.setBackgroundHandlerRegistered).toHaveBeenCalledWith(false, true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('only declares the handler registered by the entry file', async () => {
    loadIsolated(HCE => HCE.registerBackgroundHandler(() => ({onApdu: () => [0x90, 0x00]})));
    await nextTick();

    expect(mockNative.setBackgroundHandlerRegistered.mock.calls).toEqual([[true, true]]);
  });
});

describe('keep-alive task (Android)', () => {
  let keepAlive: (data: object) => Promise<void>;
  let HCE: typeof import('../js').HCE;

  beforeAll(() => {
    jest.isolateModules(() => {
      const {AppRegistry, Platform} = require('react-native');
      Platform.OS = 'android';
      jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation((...args: unknown[]) => {
        if (args[0] === 'keepAliveHCESession') {
          keepAlive = (args[1] as () => typeof keepAlive)();
        }
      });
      HCE = (require('../js') as typeof import('../js')).HCE;
    });
  });

  function beginSession(handlers: Parameters<typeof HCE.beginSession>[0]) {
    return HCE.beginSession(handlers);
  }

  it('finishes once the handlers of the interaction have finished', async () => {
    let releaseReaderLost!: () => void;
    const session = await beginSession({
      onApdu: () => [0x90, 0x00],
      onReaderLost: () =>
        new Promise<void>(resolve => {
          releaseReaderLost = resolve;
        }),
    });

    let finished = false;
    emit(event(session.id, 'readerDetected'));
    const task = keepAlive({sessionId: session.id, interaction: 1}).then(() => {
      finished = true;
    });
    emit(event(session.id, 'apdu', {apduId: 1, command: '00'}));
    emit(event(session.id, 'readerLost'));
    await flush();

    // onReaderLost() is still running
    expect(finished).toBe(false);

    releaseReaderLost();
    await task;
    session.invalidate();
  });

  it('waits for the end of its own interaction', async () => {
    const session = await beginSession({onApdu: () => [0x90, 0x00]});

    emit(event(session.id, 'readerDetected'));
    emit(event(session.id, 'readerLost'));
    await flush();

    // the first interaction has already ended, the task finishes right away
    await keepAlive({sessionId: session.id, interaction: 1});

    let finished = false;
    const task = keepAlive({sessionId: session.id, interaction: 2}).then(() => {
      finished = true;
    });
    await flush();
    expect(finished).toBe(false);

    emit(event(session.id, 'readerDetected'));
    emit(event(session.id, 'readerLost'));
    await task;
    session.invalidate();
  });

  it('finishes when the session is closed or unknown', async () => {
    const session = await beginSession({onApdu: () => [0x90, 0x00]});
    const task = keepAlive({sessionId: session.id, interaction: 1});

    session.invalidate();

    await task;
    await keepAlive({sessionId: session.id, interaction: 1});
    await keepAlive({sessionId: 'unknown', interaction: 1});
  });
});
