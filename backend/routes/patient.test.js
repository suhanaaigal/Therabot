const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const {
  demoPatients,
  demoCheckIns,
  demoNotifications,
  demoQuestionnaires
} = require('../demoStore');
const { signPatientSession } = require('../patientSession');
const patientRouter = require('./patient');

test('check-ins are patient-authenticated, narrative-first, and crisis-aware', async () => {
  const patientId = `checkin-test-${Date.now()}`;
  const token = signPatientSession(patientId);
  demoPatients.set(patientId, { _id: patientId, fullName: 'Check-in Test Patient' });
  const app = express();
  app.use(express.json());
  app.use('/api/patient', patientRouter);
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/patient`;
    const unauthorized = await fetch(`${base}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journalText: 'A short reflection.' })
    });
    assert.equal(unauthorized.status, 401);

    const normal = await fetch(`${base}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ journalText: 'Today felt steady.' })
    });
    assert.equal(normal.status, 200);
    const normalBody = await normal.json();
    assert.equal(normalBody.band, 'Green');
    assert.match(normalBody.message, /decision support only/i);

    const crisis = await fetch(`${base}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ journalText: 'I am in immediate danger.' })
    });
    assert.equal(crisis.status, 200);
    assert.equal((await crisis.json()).band, 'Red');
    assert.equal(demoNotifications.some(item => item.patientId === patientId && item.severity === 'critical'), true);

    const otherPatientHistory = await fetch(`${base}/other-patient/checkins`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(otherPatientHistory.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    demoPatients.delete(patientId);
    demoCheckIns.delete(patientId);
    demoQuestionnaires.delete(patientId);
    for (let index = demoNotifications.length - 1; index >= 0; index -= 1) {
      if (String(demoNotifications[index].patientId) === patientId) demoNotifications.splice(index, 1);
    }
  }
});

test('PHQ-9 self-harm response creates a Red clinician alert and stores history', async () => {
  const patientId = `screening-test-${Date.now()}`;
  const token = signPatientSession(patientId);
  demoPatients.set(patientId, { _id: patientId, fullName: 'Screening Test Patient', currentRiskBand: 'Green' });
  const otherPatientId = `${patientId}-other`;
  demoPatients.set(otherPatientId, { _id: otherPatientId, fullName: 'Other Screening Patient' });
  demoQuestionnaires.set(otherPatientId, [{ patientId: otherPatientId, type: 'GAD-7', total: 14 }]);
  const app = express();
  app.use(express.json());
  app.use('/api/patient', patientRouter);
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/patient`;
    const response = await fetch(`${base}/questionnaires`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'PHQ-9', answers: [0, 0, 0, 0, 0, 0, 0, 0, 1] })
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.crisisFlag, true);
    assert.equal(demoPatients.get(patientId).currentRiskBand, 'Red');
    assert.equal(demoNotifications.some(item => item.patientId === patientId && item.severity === 'critical'), true);

    const history = await fetch(`${base}/questionnaires`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(history.status, 200);
    assert.equal((await history.json())[0].total, 1);
    const requestedOtherHistory = await fetch(`${base}/questionnaires?patientId=${otherPatientId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ownHistory = await requestedOtherHistory.json();
    assert.equal(requestedOtherHistory.status, 200);
    assert.deepEqual(ownHistory.map(item => item.patientId), [patientId]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    demoPatients.delete(patientId);
    demoPatients.delete(otherPatientId);
    demoQuestionnaires.delete(otherPatientId);
    demoQuestionnaires.delete(patientId);
    for (let index = demoNotifications.length - 1; index >= 0; index -= 1) {
      if (String(demoNotifications[index].patientId) === patientId) demoNotifications.splice(index, 1);
    }
  }
});
