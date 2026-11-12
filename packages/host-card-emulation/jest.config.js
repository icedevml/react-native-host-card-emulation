module.exports = {
  preset: '@react-native/jest-preset',
  roots: ['<rootDir>/__tests__'],
  // the same setup as the apps use, see README.md: "Testing with Jest"
  setupFiles: ['<rootDir>/jest/setup.js'],
};
