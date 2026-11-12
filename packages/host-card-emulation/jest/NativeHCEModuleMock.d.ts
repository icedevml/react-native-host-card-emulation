import type {NativeHCEEvent, Spec} from '../js/NativeHCEModule';

type MockedMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? jest.Mock<R, A> : T[K];
};

/**
 * The mocked native module, every method is a jest.fn().
 */
export declare const NativeHCEModule: MockedMethods<Spec>;
export default NativeHCEModule;

/**
 * Deliver the native event to the library right away. Missing fields get their default values.
 */
export declare function emitEvent(event: Pick<NativeHCEEvent, 'sessionId' | 'type'> & Partial<NativeHCEEvent>): void;

/**
 * Simulate the reader sending the C-APDU (hex) to the session.
 * Resolves with the R-APDU (hex) the library has responded with.
 */
export declare function sendApdu(sessionId: string, command: string, options?: {deviceLocked?: boolean}): Promise<string>;

/**
 * Restore the default implementations, clear the recorded calls and forget the sessions.
 */
export declare function reset(): void;
