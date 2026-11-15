const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const StressReading = require('../models/StressReading');
const { demoStressReadings } = require('../demoStore');

const REPLAY_INTERVAL_MS = 5000;
const MAX_REPLAY_WINDOWS = 10000;
const DEFAULT_REPLAY_PATH = path.resolve(__dirname, '../../ml-service/replay_S17.json');
const activeReplays = new Map();

const replayPath = () => process.env.WESAD_REPLAY_PATH || DEFAULT_REPLAY_PATH;

const loadReplayWindows = async (filePath = replayPath()) => {
  const contents = await fs.readFile(filePath, 'utf8');
  let windows;
  try {
    windows = JSON.parse(contents);
  } catch (error) {
    throw new Error(`WESAD replay file is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > MAX_REPLAY_WINDOWS) {
    throw new Error(`WESAD replay must contain between 1 and ${MAX_REPLAY_WINDOWS} feature windows.`);
  }
  for (const [index, features] of windows.entries()) {
    if (!features || typeof features !== 'object' || Array.isArray(features) || Object.keys(features).length === 0 ||
        Object.values(features).some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error(`WESAD replay window ${index} contains invalid features.`);
    }
  }
  return windows;
};

const predictStressProbability = async features => {
  const baseUrl = String(process.env.ML_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('ML_URL is not configured.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl}/predict-stress`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features })
    });
    if (!response.ok) throw new Error(`ML service returned HTTP ${response.status}.`);
    const result = await response.json();
    if (typeof result.stress_prob !== 'number' || !Number.isFinite(result.stress_prob) ||
        result.stress_prob < 0 || result.stress_prob > 1) {
      throw new Error('ML service returned an invalid stress probability.');
    }
    return result.stress_prob;
  } finally {
    clearTimeout(timeout);
  }
};

const saveReading = async (patientId, stressProb) => {
  const reading = {
    patientId: String(patientId),
    timestamp: new Date(),
    stressProb,
    source: 'wesad-replay'
  };
  if (mongoose.connection.readyState === 1) return StressReading.create(reading);
  const readings = demoStressReadings.get(String(patientId)) || [];
  readings.unshift(reading);
  demoStressReadings.set(String(patientId), readings);
  return reading;
};

const getReplayStatus = patientId => {
  const replay = activeReplays.get(String(patientId));
  if (!replay) return { status: 'not_running' };
  return {
    status: replay.status,
    windowsProcessed: replay.index,
    totalWindows: replay.windows.length,
    lastError: replay.lastError
  };
};

const stopReplayForPatient = patientId => {
  const key = String(patientId);
  const replay = activeReplays.get(key);
  if (!replay) return false;
  replay.status = 'stopped';
  if (replay.timer) clearTimeout(replay.timer);
  activeReplays.delete(key);
  return true;
};

const startReplayForPatient = (patientId, windows) => {
  const key = String(patientId);
  const existing = activeReplays.get(key);
  if (existing?.status === 'running') return { started: false, status: getReplayStatus(key) };

  const replay = { windows, index: 0, timer: null, status: 'running', lastError: '' };
  activeReplays.set(key, replay);

  const processNextWindow = async () => {
    if (activeReplays.get(key) !== replay || replay.status !== 'running') return;
    const tickStartedAt = Date.now();
    try {
      const stressProb = await predictStressProbability(replay.windows[replay.index]);
      if (activeReplays.get(key) !== replay || replay.status !== 'running') return;
      await saveReading(key, stressProb);
      replay.lastError = '';
    } catch (error) {
      replay.lastError = 'A replay window could not be analyzed; the next window will be tried.';
      console.error('WESAD replay window failed:', error.message);
    }

    replay.index += 1;
    if (replay.index >= replay.windows.length) {
      replay.status = 'completed';
      return;
    }
    replay.timer = setTimeout(
      processNextWindow,
      Math.max(0, tickStartedAt + REPLAY_INTERVAL_MS - Date.now())
    );
    replay.timer.unref?.();
  };

  void processNextWindow();
  return { started: true, status: getReplayStatus(key) };
};

module.exports = {
  getReplayStatus,
  loadReplayWindows,
  predictStressProbability,
  saveReading,
  startReplayForPatient,
  stopReplayForPatient
};
