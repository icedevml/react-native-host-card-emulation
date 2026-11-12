/**
 * Jest setup file replacing the library's native module with jest/NativeHCEModuleMock.js.
 * Add it to `setupFiles` in the Jest config (see README.md: "Testing with Jest").
 */
jest.mock('../js/NativeHCEModule', () => require('./NativeHCEModuleMock'));
