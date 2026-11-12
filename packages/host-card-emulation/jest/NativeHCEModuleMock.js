/**
 * Jest mock of the library's native module (NativeHCEModule), so that tests run the real JS code
 * of the library against a simulated native side. Load it with jest/setup.js.
 *
 * Every method is a jest.fn() whose default implementation behaves like the native side: a single
 * session at a time, events emitted asynchronously, etc. Call reset() before each test to restore
 * the default implementations and to forget the sessions.
 */
'use strict';

const {Platform} = require('react-native');

const listeners = new Set();
// session ID -> {emulationRunning}
const sessions = new Map();
// APDU ID -> resolve() of the promise returned by sendApdu()
const pendingResponses = new Map();
let lastApduId = 0;
let exclusiveNFC = false;

function codedError(code, message) {
  return Object.assign(new Error(message), {code});
}

/**
 * Deliver the native event to the library right away. Missing fields get their default values.
 */
function emitEvent(event) {
  const fullEvent = {sessionId: '', type: '', apduId: 0, command: '', deviceLocked: false, reason: '', ...event};

  if (fullEvent.type === 'sessionInvalidated') {
    sessions.delete(fullEvent.sessionId);
  }

  for (const listener of Array.from(listeners)) {
    listener(fullEvent);
  }
}

// like the native side, emit asynchronously (a microtask, so that it also works with fake timers)
function emitEventLater(event) {
  Promise.resolve().then(() => emitEvent(event));
}

/**
 * Simulate the reader sending the C-APDU (hex) to the session.
 * Resolves with the R-APDU (hex) the library has responded with.
 */
function sendApdu(sessionId, command, {deviceLocked = false} = {}) {
  lastApduId += 1;
  const apduId = lastApduId;
  const response = new Promise(resolve => pendingResponses.set(apduId, resolve));
  emitEvent({sessionId, type: 'apdu', apduId, command, deviceLocked});
  return response;
}

function requireSession(sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    throw codedError('err_no_session', 'The session is not active.');
  }

  return session;
}

const defaultImplementations = {
  getCapabilities: async () => ({
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    hceSupported: true,
    nfcEnabled: true,
    eligible: true,
    backgroundSupported: Platform.OS !== 'ios',
    presentmentSupported: Platform.OS === 'ios',
  }),
  beginSession: async sessionId => {
    if (sessions.size > 0) {
      throw codedError('err_session_exists', 'A session already exists.');
    }

    sessions.set(sessionId, {emulationRunning: false});
    emitEventLater({sessionId, type: 'sessionStarted'});
  },
  invalidateSession: sessionId => {
    if (sessions.delete(sessionId)) {
      emitEventLater({sessionId, type: 'sessionInvalidated', reason: 'userInvalidated'});
    }
  },
  setSessionAlertMessage: () => {},
  startEmulation: async sessionId => {
    requireSession(sessionId).emulationRunning = true;
  },
  stopEmulation: async sessionId => {
    requireSession(sessionId).emulationRunning = false;
  },
  isEmulationRunning: async sessionId => sessions.get(sessionId)?.emulationRunning ?? false,
  respondApdu: async (_sessionId, apduId, rapdu) => {
    const resolve = pendingResponses.get(apduId);
    pendingResponses.delete(apduId);
    resolve?.(rapdu);
  },
  acquireExclusiveNFC: async () => {
    if (Platform.OS !== 'ios') {
      throw codedError('err_platform_unsupported', 'acquireExclusiveNFC() is not supported on Android.');
    }

    exclusiveNFC = true;
  },
  releaseExclusiveNFC: () => {
    exclusiveNFC = false;
  },
  isExclusiveNFC: () => exclusiveNFC,
  setBackgroundHandlerRegistered: () => {},
  backgroundSessionReady: () => true,
  onEvent: listener => {
    listeners.add(listener);
    return {remove: () => listeners.delete(listener)};
  },
};

const NativeHCEModule = {};

for (const [name, implementation] of Object.entries(defaultImplementations)) {
  NativeHCEModule[name] = jest.fn(implementation);
}

/**
 * Restore the default implementations, clear the recorded calls and forget the sessions.
 */
function reset() {
  sessions.clear();
  pendingResponses.clear();
  exclusiveNFC = false;

  for (const [name, implementation] of Object.entries(defaultImplementations)) {
    NativeHCEModule[name].mockReset();
    NativeHCEModule[name].mockImplementation(implementation);
  }
}

module.exports = {
  __esModule: true,
  default: NativeHCEModule,
  NativeHCEModule,
  emitEvent,
  sendApdu,
  reset,
};
