const router = require('express').Router();
const DailyCheckIn = require('../models/DailyCheckIn');
const Patient = require('../models/Patient');
const Notification = require('../models/Notification');
const { demoPatients, demoCheckIns } = require('../demoStore');

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

  try {
    return await Notification.create(notification);
  } catch (err) {
    console.log('Notification save failed in demo mode:', err.message);
    return { ...notification, _id: `notif-${Date.now()}` };
  }
};

// Submit Daily Check-in & Calculate Risk Band
router.post('/checkin', async (req, res) => {
  try {
    const { patientId, sleepHours, moodScore, anxietyLevel, journalText } = req.body;

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

    try {
      const created = new DailyCheckIn(checkIn);
      await created.save();
    } catch (dbErr) {
      console.log('DB check-in save failed; kept in demo mode:', dbErr.message);
    }

    let patient = null;
    try {
      patient = await Patient.findById(patientId);
    } catch (dbErr) {
      console.log('Patient lookup failed during status update:', dbErr.message);
      patient = demoPatients.get(patientId) || { _id: patientId, currentRiskBand: band };
    }

    try {
      await Patient.findByIdAndUpdate(patientId, { currentRiskBand: band });
    } catch (dbErr) {
      console.log('Patient risk update skipped in demo mode:', dbErr.message);
      if (patient) {
        patient.currentRiskBand = band;
        demoPatients.set(patientId, patient);
      }
    }

    if (patient) {
      patient.currentRiskBand = band;
      demoPatients.set(patientId, patient);
      await createAlertNotification(patient, band, summaryText);
    }

    res.status(200).json({ message: 'Check-in recorded successfully', band });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;