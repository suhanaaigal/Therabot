const assert = require('node:assert/strict');
const { test } = require('node:test');
const { hasConflict, parseKolkataDateTime, toKolkataFields } = require('./appointmentTime');

test('appointment local date and time are interpreted in Asia/Kolkata', () => {
  const appointment = parseKolkataDateTime('2027-01-02', '09:30');
  assert.equal(appointment.toISOString(), '2027-01-02T04:00:00.000Z');
  assert.deepEqual(toKolkataFields(appointment), { scheduledDate: '2027-01-02', scheduledTime: '09:30' });
});

test('appointments conflict at 29 minutes but not 30 or 31 minutes', () => {
  const start = parseKolkataDateTime('2027-01-02', '09:00');
  assert.equal(hasConflict(start, new Date(start.getTime() + 29 * 60_000)), true);
  assert.equal(hasConflict(start, new Date(start.getTime() + 30 * 60_000)), false);
  assert.equal(hasConflict(start, new Date(start.getTime() + 31 * 60_000)), false);
});

test('appointment conflict window works across a local midnight boundary', () => {
  const start = parseKolkataDateTime('2027-01-02', '23:45');
  const next = parseKolkataDateTime('2027-01-03', '00:10');
  assert.equal(hasConflict(start, next), true);
});
