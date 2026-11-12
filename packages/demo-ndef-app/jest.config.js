module.exports = {
  preset: '@react-native/jest-preset',
  // replaces the native module of the HCE library with its Jest mock
  setupFiles: ['@icedevml/react-native-host-card-emulation/jest/setup'],
};
