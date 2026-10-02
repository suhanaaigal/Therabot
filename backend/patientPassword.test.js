const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hashPatientPassword, verifyPatientPassword } = require('./patientPassword');

test('stores a salted scrypt hash and verifies the password', async () => {
  const firstHash = await hashPatientPassword('correct horse battery staple');
  const secondHash = await hashPatientPassword('correct horse battery staple');

  assert.match(firstHash, /^scrypt-v1\$/);
  assert.notEqual(firstHash, secondHash);
  assert.deepEqual(await verifyPatientPassword('correct horse battery staple', firstHash), {
    isValid: true,
    needsRehash: false
  });
  assert.equal((await verifyPatientPassword('wrong password', firstHash)).isValid, false);
});

test('accepts a legacy plaintext password for one-time rehashing', async () => {
  assert.deepEqual(await verifyPatientPassword('legacy-password', 'legacy-password'), {
    isValid: true,
    needsRehash: true
  });
  assert.equal((await verifyPatientPassword('different-password', 'legacy-password')).isValid, false);
});