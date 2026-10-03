const router = require('express').Router();
const mongoose = require('mongoose');
const DailyCheckIn = require('../models/DailyCheckIn');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const { demoPatients, demoCheckIns, demoNotifications } = require('../demoStore');
const { requirePatientSession } = require('../patientSession');

router.get('/:patientId/checkins', requirePatientSession, async (req, res) => {
  try {
    const { patientId } = req.params;
    if (String(req.patientId) !== String(patientId)) return res.status(403).json({ error: 'You can only view your own check-in history.' });
    if (mongoose.connection.readyState === 1) {
      const checkIns = await DailyCheckIn.find({ patientId }).sort({ date: 1 }).select('moodScore anxietyLevel sleepHours calculatedBand date');
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

const createAlertNotification = async (patient, band, summaryText) => {
  if (band !== 'Red' && band !== 'Orange') return null;

  const patientName = patient?.fullName || patient?.name || 'Patient';
  const emergencyContact = patient?.emergencyContact || 'Emergency contact not provided';
  const message = `Urgent alert: ${patientName} is currently in ${band} risk band. Summary: ${summaryText}. Emergency contact: ${emergencyContact}.`;

  const notification = {
    patientId: patient?._id || patient?.id || 'unknown-patient',
    patientName,
    type: 'medical_alert',
    severity: band === 'Red' ? 'critical' : 'warning',
    message,
    sentToEmergencyContact: band === 'Red',
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
    const { patientId, sleepHours, moodScore, anxietyLevel, journalText } = req.body;
    if (String(req.patientId) !== String(patientId)) return res.status(403).json({ error: 'You can only save your own check-in.' });

    let band = 'Green';
    if (sleepHours < 4 || moodScore <= 2 || anxietyLevel >= 9) {
      band = 'Red';
    } else if ((sleepHours >= 4 && sleepHours < 5) || (moodScore >= 3 && moodScore <= 4) || (anxietyLevel >= 7 && anxietyLevel < 9)) {
      band = 'Orange';
    } else if ((sleepHours >= 5 && sleepHours < 6) || (moodScore >= 5 && moodScore <= 6) || (anxietyLevel >= 5 && anxietyLevel < 7)) {
      band = 'Yellow';
    }

    const summaryText = `Sleep ${sleepHours} hrs, mood ${moodScore}/10, anxiety ${anxietyLevel}/10.`;
    const checkIn = {
      patientId,
      sleepHours,
      moodScore,
      anxietyLevel,
      journalText,
      calculatedBand: band,
      date: new Date()
    };

    const existing = demoCheckIns.get(patientId) || [];
    existing.unshift(checkIn);
    demoCheckIns.set(patientId, existing);

    const databaseConnected = mongoose.connection.readyState === 1;
    if (databaseConnected) {
      const created = new DailyCheckIn(checkIn);
      await created.save();
    }

    let patient = databaseConnected ? await Patient.findById(patientId) : demoPatients.get(patientId);
    if (!patient) patient = { _id: patientId, currentRiskBand: band };

    if (databaseConnected) {
      await Patient.findByIdAndUpdate(patientId, { currentRiskBand: band });
    }

    patient.currentRiskBand = band;
    if (!databaseConnected) demoPatients.set(patientId, patient);
    await createAlertNotification(patient, band, summaryText);

    res.status(200).json({ message: 'Check-in recorded successfully', band });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;