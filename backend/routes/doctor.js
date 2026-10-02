const router = require('express').Router();
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const DailyCheckIn = require('../models/DailyCheckIn');
const Notification = require('../models/Notification');
const Appointment = require('../models/Appointment');
const ChatMessage = require('../models/ChatMessage');
const CallSession = require('../models/CallSession');
const { demoPatients, demoCheckIns, demoAppointments, demoCallSessions, demoNotifications } = require('../demoStore');
const { requireDoctorSession } = require('../doctorSession');

const isDemoMode = () => mongoose.connection.readyState !== 1 || !process.env.MONGO_URI || !process.env.MONGO_URI.startsWith('mongodb');
const sanitizePatient = patient => {
  if (!patient) return patient;
  const safePatient = patient.toObject ? patient.toObject() : { ...patient };
  delete safePatient.password;
  delete safePatient.otpCode;
  delete safePatient.passwordResetCodeHash;
  delete safePatient.passwordResetExpiresAt;
  return safePatient;
};

const buildPatientReport = (patient, checkIns, appointments, aiMessages = []) => {
  const latest = checkIns[0] || {};
  const lastBand = latest.calculatedBand || patient?.currentRiskBand || 'Green';
  const averageMood = checkIns.length
    ? (checkIns.reduce((sum, item) => sum + Number(item.moodScore || 0), 0) / checkIns.length).toFixed(1)
    : 'N/A';
  const averageAnxiety = checkIns.length
    ? (checkIns.reduce((sum, item) => sum + Number(item.anxietyLevel || 0), 0) / checkIns.length).toFixed(1)
    : 'N/A';
  const averageSleep = checkIns.length
    ? (checkIns.reduce((sum, item) => sum + Number(item.sleepHours || 0), 0) / checkIns.length).toFixed(1)
    : 'N/A';
  const summary = aiMessages.length
    ? aiMessages.map((item) => item.message).slice(-3).join(' ')
    : 'No AI conversation captured yet.';

  return {
    patientName: patient?.fullName || 'Unknown Patient',
    riskBand: lastBand,
    latestCheckIn: latest,
    averages: {
      mood: averageMood,
      anxiety: averageAnxiety,
      sleep: averageSleep
    },
    aiSummary: summary,
    appointmentCount: appointments.length,
    notes: `This patient currently shows ${lastBand} risk status. Average mood is ${averageMood}, anxiety is ${averageAnxiety}, and sleep is ${averageSleep} hours.`,
    generatedAt: new Date().toISOString()
  };
};

// Get all patients sorted by priority (Red -> Orange -> Yellow -> Green)
router.get('/patients', requireDoctorSession, async (req, res) => {
  try {
    const patients = isDemoMode()
      ? [...new Map([...demoPatients.values()].map(patient => [String(patient._id || patient.fullName).toLowerCase(), patient])).values()]
      : await Patient.find().select('-password -otpCode -passwordResetCodeHash -passwordResetExpiresAt');
    const bandPriority = { 'Red': 1, 'Orange': 2, 'Yellow': 3, 'Green': 4 };

    const safePatients = patients.map(sanitizePatient);
    safePatients.sort((a, b) => {
      return (bandPriority[a.currentRiskBand] || 5) - (bandPriority[b.currentRiskBand] || 5);
    });

    res.status(200).json(safePatients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific patient's profile and check-in history
router.get('/patient/:id', requireDoctorSession, async (req, res) => {
  try {
    const patientId = req.params.id;
    if (isDemoMode()) {
      const patient = demoPatients.get(patientId) || [...demoPatients.values()].find(item => String(item._id) === String(patientId));
      if (!patient) return res.status(404).json({ error: 'Patient not found.' });
      const checkIns = demoCheckIns.get(patientId) || [];
      const appointments = demoAppointments.filter(item => String(item.patientId) === String(patientId));
      const callSessions = demoCallSessions.filter(item => String(item.patientId) === String(patientId));
      const notifications = demoNotifications.filter(item => String(item.patientId) === String(patientId));
      return res.status(200).json({ patient: sanitizePatient(patient), checkIns, appointments, notifications, aiMessages: [], callSessions, report: buildPatientReport(patient, checkIns, appointments) });
    }
    const patient = await Patient.findById(patientId).select('-password -otpCode -passwordResetCodeHash -passwordResetExpiresAt');
    const checkIns = await DailyCheckIn.find({ patientId }).sort({ date: -1 });
    const appointments = await Appointment.find({ patientId }).sort({ createdAt: -1 });
    const notifications = await Notification.find({ patientId }).sort({ createdAt: -1 });
    const aiMessages = await ChatMessage.find({ roomId: patientId }).sort({ createdAt: 1 });
    const callSessions = await CallSession.find({ patientId }).sort({ createdAt: -1 });
    const report = buildPatientReport(patient, checkIns, appointments, aiMessages);

    res.status(200).json({ patient: sanitizePatient(patient), checkIns, appointments, notifications, aiMessages, callSessions, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications', requireDoctorSession, async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ createdAt: -1 });
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patient/:id/report', requireDoctorSession, async (req, res) => {
  try {
    const patientId = req.params.id;
    if (isDemoMode()) {
      const patient = demoPatients.get(patientId) || [...demoPatients.values()].find(item => String(item._id) === String(patientId));
      if (!patient) return res.status(404).json({ error: 'Patient not found.' });
      return res.status(200).json(buildPatientReport(patient, demoCheckIns.get(patientId) || [], demoAppointments.filter(item => String(item.patientId) === String(patientId))));
    }
    const patient = await Patient.findById(patientId);
    const checkIns = await DailyCheckIn.find({ patientId }).sort({ date: -1 });
    const appointments = await Appointment.find({ patientId }).sort({ createdAt: -1 });
    const aiMessages = await ChatMessage.find({ roomId: patientId }).sort({ createdAt: 1 });
    const report = buildPatientReport(patient, checkIns, appointments, aiMessages);

    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/patient/:id', requireDoctorSession, async (req, res) => {
  const patientId = String(req.params.id);
  try {
    if (isDemoMode()) {
      const patient = demoPatients.get(patientId) || [...demoPatients.values()].find(item => String(item._id) === patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found.' });
      for (const [key, item] of demoPatients.entries()) {
        if (String(item._id) === patientId) demoPatients.delete(key);
      }
      demoCheckIns.delete(patientId);
      const removeForPatient = items => {
        for (let index = items.length - 1; index >= 0; index -= 1) {
          if (String(items[index].patientId) === patientId) items.splice(index, 1);
        }
      };
      removeForPatient(demoAppointments);
      removeForPatient(demoCallSessions);
      removeForPatient(demoNotifications);
      return res.status(200).json({ message: 'Patient and associated records deleted.' });
    }

    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    await Promise.all([
      DailyCheckIn.deleteMany({ patientId }),
      Notification.deleteMany({ patientId }),
      Appointment.deleteMany({ patientId }),
      CallSession.deleteMany({ patientId }),
      ChatMessage.deleteMany({ roomId: patientId }),
      Patient.deleteOne({ _id: patientId })
    ]);
    return res.status(200).json({ message: 'Patient and associated records deleted.' });
  } catch (error) {
    console.error('Patient deletion failed:', error.message);
    return res.status(500).json({ error: 'Could not delete the patient record.' });
  }
});

module.exports = router;