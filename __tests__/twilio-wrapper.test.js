import { createMessage } from '../lib/twilio-wrapper.js';

describe('lib/twilio-wrapper', () => {
  test('throws MISSING_PARAMS when required fields are missing', async () => {
    await expect(createMessage({})).rejects.toHaveProperty('code', 'MISSING_PARAMS');
  });

  test('returns dry-run object when ENABLE_TWILIO is not enabled', async () => {
    const original = process.env.ENABLE_TWILIO;
    delete process.env.ENABLE_TWILIO;
    // minimal valid params
    const res = await createMessage({ from: '+10000000000', to: '+19999999999', body: 'test' });
    expect(res).toBeDefined();
    expect(res).toHaveProperty('dryRun', true);
    expect(res).toHaveProperty('sid');
    process.env.ENABLE_TWILIO = original;
  });
});
