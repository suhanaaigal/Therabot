const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const { demoPatients, demoStressReadings } = require('../demoStore');
const { signPatientSession } = require('../patientSession');
const { loadReplayWindows, predictStressProbability } = require('./stressReplay');

test('loads a bounded JSON replay containing finite values or nulls', async () => {
  const replayPath = path.join(os.tmpdir(), `therabot-replay-${process.pid}-${Date.now()}.json`);
  try {
    await fs.writeFile(replayPath, JSON.stringify([{ hr: 72, sdnn: null }]), 'utf8');
    assert.deepEqual(await loadReplayWindows(replayPath), [{ hr: 72, sdnn: null }]);
    await fs.writeFile(replayPath, JSON.stringify([{ hr: 'invalid' }]), 'utf8');
    await assert.rejects(loadReplayWindows(replayPath), /invalid features/);
  } finally {
    await fs.unlink(replayPath).catch(() => {});
  }
});

test('validates the probability returned by the ML service', async () => {
  const server = require('node:http').createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ stress_prob: 0.73 }));
  });
  const previousUrl = process.env.ML_URL;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.ML_URL = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await predictStressProbability({ hr: 72 }), 0.73);
  } finally {
    if (previousUrl === undefined) delete process.env.ML_URL;
    else process.env.ML_URL = previousUrl;
    await new Promise(resolve => server.close(resolve));
  }
});

test('authenticated patient can start a simulated replay that stores a scoped reading', async () => {
  const patientId = `stress-replay-test-${Date.now()}`;
  const replayPath = path.join(os.tmpdir(), `therabot-replay-route-${process.pid}-${Date.now()}.json`);
  const modelServer = require('node:http').createServer((request, response) => {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ stress_prob: 0.64 }));
  });
  const app = express();
  app.use('/api/stress', require('../routes/stress'));
  const apiServer = app.listen(0);
  const apiListening = new Promise(resolve => apiServer.once('listening', resolve));
  const previousUrl = process.env.ML_URL;
  const previousReplayPath = process.env.WESAD_REPLAY_PATH;

  try {
    demoPatients.set(patientId, { _id: patientId, fullName: 'Replay Test Patient' });
    await fs.writeFile(replayPath, JSON.stringify([{ hr: 72 }]), 'utf8');
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
    await apiListening;
    process.env.ML_URL = `http://127.0.0.1:${modelServer.address().port}`;
    process.env.WESAD_REPLAY_PATH = replayPath;

    const startResponse = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/stress/replay/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signPatientSession(patientId)}` }
    });
    assert.equal(startResponse.status, 202);
    await new Promise(resolve => setTimeout(resolve, 100));
    const readingsResponse = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/stress/readings`, {
      headers: { Authorization: `Bearer ${signPatientSession(patientId)}` }
    });
    assert.equal(readingsResponse.status, 200);
    const readings = await readingsResponse.json();
    assert.equal(readings.length, 1);
    assert.equal(readings[0].stressProb, 0.64);
    assert.equal(readings[0].source, 'wesad-replay');
  } finally {
    require('./stressReplay').stopReplayForPatient(patientId);
    demoPatients.delete(patientId);
    demoStressReadings.delete(patientId);
    if (previousUrl === undefined) delete process.env.ML_URL;
    else process.env.ML_URL = previousUrl;
    if (previousReplayPath === undefined) delete process.env.WESAD_REPLAY_PATH;
    else process.env.WESAD_REPLAY_PATH = previousReplayPath;
    await new Promise(resolve => apiServer.close(resolve));
    await new Promise(resolve => modelServer.close(resolve));
    await fs.unlink(replayPath).catch(() => {});
  }
});
