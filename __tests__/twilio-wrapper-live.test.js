// Jest ESM mock test for the live Twilio path using unstable_mockModule
// This test dynamically mocks the 'twilio' package before importing the wrapper

/* eslint-env node, jest */

// Use top-level await to setup mocks before importing the module under test.
await (async () => {
  // Mock twilio to return a client with messages.create
  const mockMessagesCreate = jest.fn().mockResolvedValue({ sid: 'live-0001' });
  const mockClient = { messages: { create: mockMessagesCreate } };

  // Setup environment variables to simulate ENABLE_TWILIO
  process.env.TWILIO_ACCOUNT_SID = 'AC_TEST';
  process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST';
  process.env.ENABLE_TWILIO = 'true';

  // Mock the ESM 'twilio' module before importing our wrapper
  await jest.unstable_mockModule('twilio', async () => {
    return {
      __esModule: true,
      default: () => mockClient
    };
  });

  // Now import the module under test
  const { createMessage } = await import('../lib/twilio-wrapper.js');

  describe('twilio-wrapper live path (mocked)', () => {
    test('delegates to twilio.messages.create when enabled', async () => {
      const res = await createMessage({ from: '+1000', to: '+1999', body: 'hi' });
      expect(res).toBeDefined();
      expect(res).toHaveProperty('sid', 'live-0001');
    });
  });
})();
