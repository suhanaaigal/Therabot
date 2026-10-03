const assert = require('node:assert/strict');
const { test } = require('node:test');
const { demoDoctors, ensureDefaultDoctor } = require('./demoStore');

test('keeps the default clinician distinct from additional demo clinicians', () => {
  demoDoctors.set('doctor-two', {
    _id: 'doctor-two',
    username: 'doctor-two',
    fullName: 'Dr. Two'
  });

  const defaultDoctor = ensureDefaultDoctor();

  assert.equal(defaultDoctor._id, 'doctor-default');
  assert.equal(defaultDoctor.username, 'doctor');
  assert.equal(ensureDefaultDoctor()._id, 'doctor-default');
  assert.equal(demoDoctors.get('doctor-two').fullName, 'Dr. Two');
});