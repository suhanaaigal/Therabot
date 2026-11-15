const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { demoChatMessages, demoPatients } = require('../demoStore');
const { signPatientSession } = require('../patientSession');
const aiRouter = require('./ai');

test('replaces model replies that contain prescriptions or unsupported diagnoses', () => {
  const safeReply = "I can't give medical advice or a diagnosis. A clinician can help with that, and I can help you book an appointment. Meanwhile, I'm here to listen.";
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(aiRouter.guardAiReply('Take 20 mg twice daily.', 'test-model'), safeReply);
    assert.equal(aiRouter.guardAiReply('You have depression.', 'test-model'), safeReply);
    assert.equal(aiRouter.guardAiReply('That sounds difficult. What support would feel helpful?', 'test-model'), 'That sounds difficult. What support would feel helpful?');
  } finally {
    console.warn = originalWarn;
  }
});

test('crisis replies bypass optional retrieval and always disable grounding', async () => {
  const result = await aiRouter.generateGroundedAiReply('I want to kill myself tonight.', [], true);
  assert.equal(result.provider, 'safety-response');
  assert.equal(result.groundingUsed, false);
  assert.match(result.reply, /emergency services|crisis line/i);
});

test('crisis detection recognizes direct and negated self-harm statements', () => {
  assert.equal(aiRouter.detectCrisis('I am thinking about ending my life.'), true);
  assert.equal(aiRouter.detectCrisis('I may be in danger from myself right now.'), true);
  assert.equal(aiRouter.detectCrisis('I am not going to hurt myself.'), false);
});

test('AI history is authenticated and chat storage ignores a body-supplied patient id', async () => {
  const patientId = `ai-history-${Date.now()}`;
  const otherPatientId = `ai-other-${Date.now()}`;
  demoPatients.set(patientId, { _id: patientId, fullName: 'AI Test Patient' });
  demoPatients.set(otherPatientId, { _id: otherPatientId, fullName: 'Other Patient' });
  demoChatMessages.set(patientId, [{
    roomId: `ai:${patientId}`,
    author: 'Patient',
    message: 'My private message',
    createdAt: new Date()
  }]);
  demoChatMessages.set(otherPatientId, [{
    roomId: `ai:${otherPatientId}`,
    author: 'Patient',
    message: 'Other patient private message',
    createdAt: new Date()
  }]);
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/ai`;
    const unauthorized = await fetch(`${base}/history`);
    assert.equal(unauthorized.status, 401);

    const token = signPatientSession(patientId);
    const history = await fetch(`${base}/history`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(history.status, 200);
    const messages = await history.json();
    assert.deepEqual(messages.map(item => item.message), ['My private message']);

    const crisis = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'I want to kill myself tonight.', patientId: otherPatientId })
    });
    assert.equal(crisis.status, 200);
    assert.equal((await crisis.json()).riskDetected, true);
    assert.equal(demoChatMessages.get(otherPatientId).length, 1);
    assert.equal(demoChatMessages.get(patientId).some(item => item.message === 'I want to kill myself tonight.'), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    demoPatients.delete(patientId);
    demoPatients.delete(otherPatientId);
    demoChatMessages.delete(patientId);
    demoChatMessages.delete(otherPatientId);
  }
});

test('opt-in coping retrieval is added as constrained provider context', async () => {
  const originalEnvironment = {
    mlUrl: process.env.ML_URL,
    provider: process.env.AI_PROVIDER,
    baseUrl: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY
  };
  let providerRequest;
  const retrievalServer = express().use(express.json()).post('/retrieve-coping', async (req, res) => {
    assert.equal(req.body.query, 'I have a difficult day');
    await new Promise(resolve => setTimeout(resolve, 4200));
    res.json({ snippets: [{ id: 'test-coping', text: 'Consider one small manageable step.' }] });
  }).listen(0);
  const providerServer = express().use(express.json()).post('/chat/completions', (req, res) => {
    providerRequest = req.body;
    res.json({ choices: [{ message: { content: 'You could choose one small step, if that feels useful.' } }] });
  }).listen(0);

  try {
    await Promise.all([
      new Promise(resolve => retrievalServer.once('listening', resolve)),
      new Promise(resolve => providerServer.once('listening', resolve))
    ]);
    process.env.ML_URL = `http://127.0.0.1:${retrievalServer.address().port}`;
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${providerServer.address().port}`;
    process.env.OPENAI_API_KEY = 'test-key-not-a-secret';

    const result = await aiRouter.generateGroundedAiReply('I have a difficult day', [], true);

    assert.equal(result.groundingUsed, true);
    assert.match(result.reply, /small step/i);
    assert.match(providerRequest.messages[0].content, /Optional general coping ideas/);
    assert.match(providerRequest.messages[0].content, /one small manageable step/);
  } finally {
    for (const [key, value] of Object.entries({
      ML_URL: originalEnvironment.mlUrl,
      AI_PROVIDER: originalEnvironment.provider,
      OPENAI_BASE_URL: originalEnvironment.baseUrl,
      OPENAI_API_KEY: originalEnvironment.apiKey
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([
      new Promise(resolve => retrievalServer.close(resolve)),
      new Promise(resolve => providerServer.close(resolve))
    ]);
  }
});
