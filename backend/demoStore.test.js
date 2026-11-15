const assert = require('node:assert/strict');
const { test } = require('node:test');
const { demoDoctors, ensureDefaultDoctor } = require('./demoStore');

test('keeps the default clinician distinct from additional demo clinicians', () => {
  demoDoctors.set('doctor-two', {
    _id: 'doctor-two',
    username: 'doctor-two',
    fullName: 'Dr. Two'
  });

  const previousPassword = process.env.DEMO_DOCTOR_PASSWORD;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.DEMO_DOCTOR_PASSWORD = 'test-demo-password';
  delete process.env.NODE_ENV;

  const run = async () => {
    try {
      const defaultDoctor = await ensureDefaultDoctor();

      assert.equal(defaultDoctor._id, 'doctor-default');
      assert.equal(defaultDoctor.username, 'doctor');
      assert.match(defaultDoctor.password, /^scrypt-v1\$/);
      assert.equal((await ensureDefaultDoctor())._id, 'doctor-default');
      assert.equal(demoDoctors.get('doctor-two').fullName, 'Dr. Two');
    } finally {
      if (previousPassword === undefined) delete process.env.DEMO_DOCTOR_PASSWORD;
      else process.env.DEMO_DOCTOR_PASSWORD = previousPassword;
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  };
  return run();
});