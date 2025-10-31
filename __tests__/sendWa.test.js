import request from 'supertest';

jest.unstable_mockModule('../lib/twilio-wrapper.js', () => ({
  createMessage: jest.fn(async (p) => ({ sid: 'mock-sid', ...p }))
}));

const { createMessage } = await import('../lib/twilio-wrapper.js');
const { app } = await import('../server.js');

describe('POST /actions/send-wa', () => {
  it('returns ok and uses twilio wrapper when called', async () => {
    const res = await request(app)
      .post('/actions/send-wa')
      .send({ to: '+17891234567', template: 'hi', params: ['a'] })
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(createMessage).toHaveBeenCalled();
  });
});
