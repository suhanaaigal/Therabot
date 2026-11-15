const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRateLimiter } = require('./rateLimit');

test('limits requests from the same IP during the configured window', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 1 });
  const req = { baseUrl: '/test-rate-limit', ip: `test-${Date.now()}` };
  const response = {
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  let nextCalled = false;
  limit(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const limitedResponse = { ...response, headers: {}, status: response.status, set: response.set, json: response.json };
  limit(req, limitedResponse, () => assert.fail('rate-limited request must not continue'));
  assert.equal(limitedResponse.statusCode, 429);
  assert.ok(Number(limitedResponse.headers['Retry-After']) > 0);
});
