const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const mongoose = require('mongoose');
const {
  demoPatients,
  demoCheckIns,
  demoAppointments,
  demoCallSessions,
  demoNotifications,
  demoStressReadings,
  demoQuestionnaires,
  demoChatMessages
} = require('../demoStore');
const { signPatientSession } = require('../patientSession');
const authRouter = require('./auth');
const Patient = require('../models/Patient');
const DailyCheckIn = require('../models/DailyCheckIn');
const Appointment = require('../models/Appointment');
const CallSession = require('../models/CallSession');
const Notification = require('../models/Notification');
const ChatMessage = require('../models/ChatMessage');
const StressReading = require('../models/StressReading');
const Questionnaire = require('../models/Questionnaire');

test('patient deletion endpoint removes the account and its demo records', async () => {
  const patientId = `delete-test-${Date.now()}`;
  demoPatients.set(patientId, { _id: patientId, fullName: 'Deletion Test Patient' });
  demoCheckIns.set(patientId, [{ patientId }]);
  demoAppointments.push({ patientId });
  demoCallSessions.push({ patientId });
  demoNotifications.push({ patientId });
  demoStressReadings.set(patientId, [{ patientId, stressProb: 0.6, source: 'wesad-replay' }]);
  demoQuestionnaires.set(patientId, [{ patientId, type: 'PHQ-9', total: 4 }]);
  demoChatMessages.set(patientId, [{ patientId, message: 'Test history' }]);

  const app = express();
  app.use('/api/auth', authRouter);
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${signPatientSession(patientId)}` }
    });

    assert.equal(response.status, 200);
    assert.equal(demoPatients.has(patientId), false);
    assert.equal(demoCheckIns.has(patientId), false);
    assert.equal(demoAppointments.some(item => String(item.patientId) === patientId), false);
    assert.equal(demoCallSessions.some(item => String(item.patientId) === patientId), false);
    assert.equal(demoNotifications.some(item => String(item.patientId) === patientId), false);
    assert.equal(demoStressReadings.has(patientId), false);
    assert.equal(demoQuestionnaires.has(patientId), false);
    assert.equal(demoChatMessages.has(patientId), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    demoPatients.delete(patientId);
    demoCheckIns.delete(patientId);
    demoStressReadings.delete(patientId);
    demoQuestionnaires.delete(patientId);
    demoChatMessages.delete(patientId);
    for (const list of [demoAppointments, demoCallSessions, demoNotifications]) {
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (String(list[index].patientId) === patientId) list.splice(index, 1);
      }
    }
  }
});

test('persistent deletion scopes cleanup across every patient-linked collection', async () => {
  const patientId = `mongo-delete-test-${Date.now()}`;
  const models = [DailyCheckIn, Appointment, CallSession, Notification, ChatMessage, StressReading, Questionnaire, Patient];
  const originalMethods = new Map(models.map(model => [model, {
    findById: model.findById,
    deleteMany: model.deleteMany,
    deleteOne: model.deleteOne
  }]));
  const readyStateDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const deleted = [];
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  Patient.findById = () => ({ select: async () => ({ _id: patientId }) });
  for (const model of models) {
    model.deleteMany = async filter => { deleted.push([model.modelName, filter]); };
    model.deleteOne = async filter => { deleted.push([model.modelName, filter]); };
  }

  const app = express();
  app.use('/api/auth', authRouter);
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${signPatientSession(patientId)}` }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(deleted.map(([name]) => name), [
      'DailyCheckIn', 'Appointment', 'CallSession', 'Notification',
      'StressReading', 'Questionnaire', 'ChatMessage', 'Patient'
    ]);
    assert.deepEqual(deleted[0][1], { patientId });
    assert.deepEqual(deleted[5][1], { patientId });
    assert.deepEqual(deleted[6][1], { roomId: { $in: [`ai:${patientId}`, patientId] } });
    assert.deepEqual(deleted[7][1], { _id: patientId });
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [model, methods] of originalMethods) {
      model.findById = methods.findById;
      model.deleteMany = methods.deleteMany;
      model.deleteOne = methods.deleteOne;
    }
    if (readyStateDescriptor) Object.defineProperty(mongoose.connection, 'readyState', readyStateDescriptor);
    else delete mongoose.connection.readyState;
  }
});
