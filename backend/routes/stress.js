const router = require('express').Router();
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const StressReading = require('../models/StressReading');
const { demoPatients, demoStressReadings } = require('../demoStore');
const { requirePatientSession } = require('../patientSession');
const {
  getReplayStatus,
  loadReplayWindows,
  startReplayForPatient,
  stopReplayForPatient
} = require('../services/stressReplay');

router.post('/replay/start', requirePatientSession, async (req, res) => {
  const patientId = String(req.patientId);
  try {
    const existing = getReplayStatus(patientId);
    if (existing.status === 'running') return res.status(200).json(existing);

    const patient = mongoose.connection.readyState === 1
      ? await Patient.findById(patientId).select('_id')
      : demoPatients.get(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient account not found.' });
    if (!process.env.ML_URL) return res.status(503).json({ error: 'The ML service is not configured.' });

    const windows = await loadReplayWindows();
    const replay = startReplayForPatient(patientId, windows);
    return res.status(202).json({
      message: 'Simulated WESAD wearable replay started. This is lab dataset playback, not live device data.',
      ...replay.status
    });
  } catch (error) {
    console.error('Could not start WESAD replay:', error.message);
    return res.status(503).json({ error: 'The WESAD replay is unavailable. Generate the S17 replay file and configure the ML service.' });
  }
});

router.post('/replay/stop', requirePatientSession, (req, res) => {
  stopReplayForPatient(req.patientId);
  return res.status(200).json({ status: 'stopped' });
});

router.get('/replay/status', requirePatientSession, (req, res) => {
  return res.status(200).json(getReplayStatus(req.patientId));
});

router.get('/readings', requirePatientSession, async (req, res) => {
  try {
    const patientId = String(req.patientId);
    const readings = mongoose.connection.readyState === 1
      ? await StressReading.find({ patientId }).sort({ timestamp: -1 }).limit(500).lean()
      : (demoStressReadings.get(patientId) || []).slice(0, 500);
    return res.status(200).json(readings);
  } catch (error) {
    console.error('Could not load patient stress readings:', error.message);
    return res.status(500).json({ error: 'Could not load stress readings.' });
  }
});

module.exports = router;
