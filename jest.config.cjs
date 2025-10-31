module.exports = {
  testEnvironment: 'node',
  // Treat .js files as ESM since the project uses `type: module`.
  extensionsToTreatAsEsm: ['.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  // Don't transform (keeps config minimal). In CI, ensure Node >= 18.
  transform: {}
};
