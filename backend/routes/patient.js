const router = require('express').Router();
const mongoose = require('mongoose');
const DailyCheckIn = require('../models/DailyCheckIn');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const StressReading = require('../models/StressReading');
const Questionnaire = require('../models/Questionnaire');
const { demoPatients, demoCheckIns, demoNotifications } = require('../demoStore');
const { demoStressReadings, demoQuestionnaires } = require('../demoStore');
const { requirePatientSession } = require('../patientSession');
const { sendEmergencyAlert } = require('../services/alerts');
const { analyzeTextWithMl, detectCrisisRegex } = require('../services/textAnalysis');
const { fuse } = require('../services/fuse');
const { scoreQuestionnaire } = require('../services/questionnaireScoring');

router.get('/:patientId/checkins', requirePatientSession, async (req, res) => {
  try {
    const { patientId } = req.params;
    if (String(req.patientId) !== String(patientId)) return res.status(403).json({ error: 'You can only view your own check-in history.' });
    if (mongoose.connection.readyState === 1) {
      const checkIns = await DailyCheckIn.find({ patientId }).sort({ date: 1 }).select('moodScore anxietyLevel sleepHours journalText calculatedBand riskReasons riskSource stressProbability physiologyStressProbability topWords mlAnalysis date');
      return res.status(200).json(checkIns);
    }

    const checkIns = (demoCheckIns.get(patientId) || [])
      .map(item => ({ ...item }))
      .sort((first, second) => new Date(first.date) - new Date(second.date));
    return res.status(200).json(checkIns);
  } catch (error) {
    console.error('Patient check-in history lookup failed:', error.message);
    return res.status(500).json({ error: 'Could not load your mood history.' });
  }
});

router.get('/questionnaires', requirePatientSession, async (req, res) => {
  try {
    const patientId = String(req.patientId);
    const questionnaires = mongoose.connection.readyState === 1
      ? await Questionnaire.find({ patientId }).sort({ date: -1 }).limit(100).lean()
      : (demoQuestionnaires.get(patientId) || []).slice(0, 100);
    return res.status(200).json(questionnaires);
  } catch (error) {
    console.error('Patient questionnaire history lookup failed:', error.message);
    return res.status(500).json({ error: 'Could not load your screening history.' });
  }
});

router.post('/questionnaires', requirePatientSession, async (req, res) => {
  try {
    const scored = scoreQuestionnaire(req.body?.type, req.body?.answers);
    const gadDifficulty = req.body?.type === 'GAD-7' ? String(req.body?.gadDifficulty || '') : '';
    if (req.body?.type === 'GAD-7' && !['Not difficult at all', 'Somewhat difficult', 'Very difficult', 'Extremely difficult'].includes(gadDifficulty)) {
      return res.status(400).json({ error: 'Select the difficulty level for the GAD-7 follow-up question.' });
    }
    const patientId = String(req.patientId);
    const databaseConnected = mongoose.connection.readyState === 1;
    const patient = databaseConnected ? await Patient.findById(patientId) : demoPatients.get(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient account not found.' });

    const questionnaire = { patientId, ...scored, gadDifficulty, date: new Date() };
    if (databaseConnected) await Questionnaire.create(questionnaire);
    else {
      const history = demoQuestionnaires.get(patientId) || [];
      history.unshift(questionnaire);
      demoQuestionnaires.set(patientId, history);
    }

    const currentBand = patient.currentRiskBand || 'Green';
    const currentPriority = { Green: 0, Yellow: 1, Orange: 2, Red: 3 }[currentBand] || 0;
    if (scored.crisisFlag) {
      patient.currentRiskBand = 'Red';
      if (databaseConnected) await Patient.findByIdAndUpdate(patientId, { currentRiskBand: 'Red' });
      else demoPatients.set(patientId, patient);
      await createAlertNotification(patient, 'Red', 'A PHQ-9 safety response needs prompt clinician review.');
    } else if (scored.total >= 15 && currentPriority < 2) {
      patient.currentRiskBand = 'Orange';
      if (databaseConnected) await Patient.findByIdAndUpdate(patientId, { currentRiskBand: 'Orange' });
      else demoPatients.set(patientId, patient);
      await createAlertNotification(patient, 'Orange', 'A screening score indicates follow-up may be helpful.');
    }

    return res.status(201).json({
      questionnaire,
      message: scored.crisisFlag
        ? 'Your response was recorded. Your clinician has been alerted. If you may be in immediate danger, contact local emergency services or a crisis helpline now.'
        : 'Screening score recorded. This is not a diagnosis; please review it with your clinician.',
      crisisFlag: scored.crisisFlag,
      alertStatus: scored.crisisFlag ? 'clinician_alerted' : undefined
    });
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    console.error('Patient questionnaire submission failed:', error.message);
    return res.status(500).json({ error: 'Could not save your screening score.' });
  }
});

router.get('/profile', requirePatientSession, async (req, res) => {
  try {
    const patientId = req.patientId;
    if (mongoose.connection.readyState === 1) {
      const patient = await Patient.findById(patientId).select('fullName email age gender phoneNumber emergencyContact assignedDoctorId');
      if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
      return res.status(200).json({
        _id: String(patient._id),
        fullName: patient.fullName || 'Patient',
        email: patient.email || '',
        age: patient.age ?? '',
        gender: patient.gender || '',
        phoneNumber: patient.phoneNumber || '',
        emergencyContact: patient.emergencyContact || '',
        assignedDoctorId: patient.assignedDoctorId || ''
      });
    }

    const patient = demoPatients.get(String(patientId));
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    return res.status(200).json({
      _id: String(patient._id || patientId),
      fullName: patient.fullName || 'Patient',
      email: patient.email || '',
      age: patient.age ?? '',
      gender: patient.gender || '',
      phoneNumber: patient.phoneNumber || '',
      emergencyContact: patient.emergencyContact || '',
      assignedDoctorId: patient.assignedDoctorId || ''
    });
  } catch (error) {
    console.error('Patient profile lookup failed:', error.message);
    return res.status(500).json({ error: 'Could not load your profile.' });
  }
});

const createAlertNotification = async (patient, band, summaryText) => {
  if (band !== 'Red' && band !== 'Orange') return null;

  const patientName = patient?.fullName || patient?.name || 'Patient';
  const message = band === 'Red'
    ? `Urgent alert: ${patientName} is currently in the Red risk band. Summary: ${summaryText}.`
    : `Follow-up alert: ${patientName} is currently in the Orange risk band. Summary: ${summaryText}.`;
  const smsResult = band === 'Red' ? await sendEmergencyAlert(patient) : { status: 'not_configured' };

  const notification = {
    patientId: patient?._id || patient?.id || 'unknown-patient',
    patientName,
    type: 'medical_alert',
    severity: band === 'Red' ? 'critical' : 'warning',
    message,
    alertStatus: smsResult.status,
    alertChannel: smsResult.channel || '',
    alertProviderId: smsResult.providerId || '',
    alertError: smsResult.error || '',
    alertAttemptedAt: smsResult.status === 'not_configured' ? null : new Date(),
    sentToDoctor: true
  };

  if (mongoose.connection.readyState === 1) return Notification.create(notification);
  const demoNotification = { ...notification, _id: `notif-${Date.now()}`, createdAt: new Date() };
  demoNotifications.unshift(demoNotification);
  return demoNotification;
};

// Submit Daily Check-in & Calculate Risk Band
router.post('/checkin', requirePatientSession, async (req, res) => {
  try {
    const { sleepHours: rawSleep, moodScore: rawMood, anxietyLevel: rawAnxiety, journalText } = req.body || {};
    const patientId = String(req.patientId);
    const parseOptionalNumber = (value, minimum, maximum, integer = false) => {
      if (value === undefined || value === null || value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= minimum && number <= maximum && (!integer || Number.isInteger(number))
        ? number
        : NaN;
    };
    const sleepHours = parseOptionalNumber(rawSleep, 0, 24);
    const moodScore = parseOptionalNumber(rawMood, 1, 10, true);
    const anxietyLevel = parseOptionalNumber(rawAnxiety, 1, 10, true);
    const text = typeof journalText === 'string' ? journalText.trim() : '';
    if (!text || text.length > 2000 || Number.isNaN(sleepHours) || Number.isNaN(moodScore) || Number.isNaN(anxietyLevel)) {
      return res.status(400).json({ error: 'Write a check-in of up to 2,000 characters. Optional sleep, mood, and anxiety ratings must be within their stated ranges.' });
    }

    const databaseConnected = mongoose.connection.readyState === 1;
    const patient = databaseConnected ? await Patient.findById(patientId) : demoPatients.get(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient account not found.' });

    const mlAnalysis = await analyzeTextWithMl(text);
    const crisis = detectCrisisRegex(text);
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const latestStress = databaseConnected
      ? await StressReading.findOne({ patientId, timestamp: { $gt: since } }).sort({ timestamp: -1 }).lean()
      : (demoStressReadings.get(patientId) || []).find(item => new Date(item.timestamp).getTime() > since.getTime());
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentQuestionnaires = databaseConnected
      ? await Questionnaire.find({ patientId, date: { $gte: monthAgo } }).sort({ date: -1 }).limit(10).lean()
      : (demoQuestionnaires.get(patientId) || []).filter(item => new Date(item.date).getTime() >= monthAgo.getTime());
    const questionnaireScores = recentQuestionnaires.reduce((scores, item) => {
      if (item.type === 'PHQ-9') scores.phq9 ??= item.total;
      if (item.type === 'GAD-7') scores.gad7 ??= item.total;
      return scores;
    }, {});
    const result = fuse(
      mlAnalysis.status === 'available' ? { ...mlAnalysis, crisisFlag: mlAnalysis.crisisFlag || crisis } : null,
      latestStress?.stressProb,
      { sleepHours, selfMood: moodScore, selfAnxiety: anxietyLevel, crisis },
      questionnaireScores
    );
    const band = result.band;
    const checkIn = {
      patientId,
      sleepHours,
      moodScore,
      anxietyLevel,
      journalText: text,
      mlAnalysis: mlAnalysis.status === 'available' ? mlAnalysis : null,
      riskReasons: result.reasons,
      riskSource: result.source,
      stressProbability: result.probability,
      physiologyStressProbability: latestStress?.stressProb ?? null,
      topWords: mlAnalysis.status === 'available' ? mlAnalysis.topWords : [],
      calculatedBand: band,
      date: new Date()
    };

    if (databaseConnected) {
      await DailyCheckIn.create(checkIn);
    } else {
      const existing = demoCheckIns.get(patientId) || [];
      existing.unshift(checkIn);
      demoCheckIns.set(patientId, existing);
    }

    if (databaseConnected) {
      await Patient.findByIdAndUpdate(patientId, { currentRiskBand: band });
    }

    patient.currentRiskBand = band;
    if (!databaseConnected) demoPatients.set(patientId, patient);
    if (crisis || mlAnalysis.crisisFlag) {
      await createAlertNotification(patient, 'Red', 'A check-in safety indicator needs clinician review.');
    } else {
      await createAlertNotification(patient, band, 'A patient check-in indicates follow-up may be helpful.');
    }

    res.status(200).json({
      message: 'Check-in recorded. The automated estimate is decision support only and requires clinician review.',
      band,
      reasons: result.reasons,
      source: result.source,
      stressProbability: result.probability,
      topWords: checkIn.topWords
    });
  } catch (err) {
    console.error('Patient check-in failed:', err.message);
    res.status(500).json({ error: 'Could not save your check-in. Please try again.' });
  }
});

router.post('/help-now', requirePatientSession, async (req, res) => {
  try {
    const patientId = String(req.patientId);
    const patient = mongoose.connection.readyState === 1
      ? await Patient.findById(patientId)
      : demoPatients.get(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient account not found.' });

    patient.currentRiskBand = 'Red';
    if (mongoose.connection.readyState === 1) {
      await Patient.findByIdAndUpdate(patientId, { currentRiskBand: 'Red' });
    } else {
      demoPatients.set(patientId, patient);
    }
    const notification = await createAlertNotification(patient, 'Red', 'The patient selected “I need help now.”');
    return res.status(201).json({
      message: 'Your clinician has been alerted in the dashboard.',
      alertStatus: notification?.alertStatus || 'not_configured'
    });
  } catch (error) {
    console.error('Patient help request failed:', error.message);
    return res.status(500).json({ error: 'Could not alert your clinician. Please use the helpline or local emergency number directly.' });
  }
});

module.exports = router;