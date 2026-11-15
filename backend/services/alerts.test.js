const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sendEmergencyAlert, getAlertStatus } = require('./alerts');

test('maps Twilio message statuses to truthful alert statuses', () => {
  for (const status of ['accepted', 'scheduled', 'queued', 'sending']) {
    assert.equal(getAlertStatus(status), 'queued');
  }
  for (const status of ['sent', 'delivered', 'read']) {
    assert.equal(getAlertStatus(status), 'sent');
  }
  for (const status of ['failed', 'undelivered', 'canceled', 'partially_delivered', undefined]) {
    assert.equal(getAlertStatus(status), 'failed');
  }
});

test('does not contact an emergency contact without explicit consent and provider configuration', async () => {
  const names = ['TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(await sendEmergencyAlert({
      fullName: 'Test Patient',
      emergencyContactPhone: '+15551234567',
      emergencyContactConsent: true
    }), { status: 'not_configured' });
    process.env.TWILIO_SID = 'configured';
    process.env.TWILIO_TOKEN = 'configured';
    process.env.TWILIO_FROM = '+15557654321';
    assert.deepEqual(await sendEmergencyAlert({
      fullName: 'Test Patient',
      emergencyContactPhone: '+15551234567',
      emergencyContactConsent: false
    }), { status: 'not_configured' });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
