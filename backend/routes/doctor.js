const router = require('express').Router();
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const Patient = require('../models/Patient');
const DailyCheckIn = require('../models/DailyCheckIn');
const Notification = require('../models/Notification');
const Appointment = require('../models/Appointment');
const ChatMessage = require('../models/ChatMessage');
const CallSession = require('../models/CallSession');
const { demoPatients, demoCheckIns, demoAppointments, demoCallSessions, demoNotifications } = require('../demoStore');
const { requireDoctorSession } = require('../doctorSession');

const isDemoMode = () => mongoose.connection.readyState !== 1 || !process.env.MONGO_URI || !process.env.MONGO_URI.startsWith('mongodb');
const findDemoPatient = (patientId, doctorId) => [...demoPatients.values()].find(patient =>
  String(patient._id) === String(patientId) && String(patient.assignedDoctorId || 'doctor-default') === String(doctorId)
);
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
      ? [...new Map([...demoPatients.values()]
        .filter(patient => String(patient.assignedDoctorId || 'doctor-default') === String(req.doctorId))
        .map(patient => [String(patient._id || patient.fullName).toLowerCase(), patient])).values()]
      : await Patient.find({ assignedDoctorId: String(req.doctorId) }).select('-password -otpCode -passwordResetCodeHash -passwordResetExpiresAt');
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
      const patient = findDemoPatient(patientId, req.doctorId);
      if (!patient) return res.status(404).json({ error: 'Patient not found.' });
      const checkIns = demoCheckIns.get(patientId) || [];
      const appointments = demoAppointments.filter(item => String(item.patientId) === String(patientId));
      const callSessions = demoCallSessions.filter(item => String(item.patientId) === String(patientId));
      const notifications = demoNotifications.filter(item => String(item.patientId) === String(patientId));
      return res.status(200).json({ patient: sanitizePatient(patient), checkIns, appointments, notifications, aiMessages: [], callSessions, report: buildPatientReport(patient, checkIns, appointments) });
    }
    const patient = await Patient.findOne({ _id: patientId, assignedDoctorId: String(req.doctorId) }).select('-password -otpCode -passwordResetCodeHash -passwordResetExpiresAt');
    if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
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
    const patientIds = isDemoMode()
      ? [...demoPatients.values()].filter(patient => String(patient.assignedDoctorId || 'doctor-default') === String(req.doctorId)).map(patient => String(patient._id))
      : (await Patient.find({ assignedDoctorId: String(req.doctorId) }).select('_id')).map(patient => String(patient._id));
    const notifications = isDemoMode()
      ? demoNotifications.filter(notification => patientIds.includes(String(notification.patientId)))
      : await Notification.find({ patientId: { $in: patientIds } }).sort({ createdAt: -1 });
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/:id/review', requireDoctorSession, async (req, res) => {
  try {
    if (isDemoMode()) {
      const notification = demoNotifications.find(item => String(item._id) === String(req.params.id));
      if (!notification || !findDemoPatient(notification.patientId, req.doctorId)) return res.status(404).json({ error: 'Alert not found.' });
      notification.reviewedAt = notification.reviewedAt || new Date();
      return res.status(200).json(notification);
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Alert not found.' });
    const patient = await Patient.findOne({ _id: notification.patientId, assignedDoctorId: String(req.doctorId) }).select('_id');
    if (!patient) return res.status(404).json({ error: 'Alert not found.' });
    notification.reviewedAt = notification.reviewedAt || new Date();
    await notification.save();
    return res.status(200).json(notification);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/patient/:id/report', requireDoctorSession, async (req, res) => {
  try {
    const patientId = req.params.id;
    if (isDemoMode()) {
      const patient = findDemoPatient(patientId, req.doctorId);
      if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
      return res.status(200).json(buildPatientReport(patient, demoCheckIns.get(patientId) || [], demoAppointments.filter(item => String(item.patientId) === String(patientId))));
    }
    const patient = await Patient.findOne({ _id: patientId, assignedDoctorId: String(req.doctorId) });
    if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
    const checkIns = await DailyCheckIn.find({ patientId }).sort({ date: -1 });
    const appointments = await Appointment.find({ patientId }).sort({ createdAt: -1 });
    const aiMessages = await ChatMessage.find({ roomId: patientId }).sort({ createdAt: 1 });
    const report = buildPatientReport(patient, checkIns, appointments, aiMessages);

    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/patient/:id/password-reset', requireDoctorSession, async (req, res) => {
  try {
    const patientId = String(req.params.id);
    const patient = isDemoMode()
      ? findDemoPatient(patientId, req.doctorId)
      : await Patient.findOne({ _id: patientId, assignedDoctorId: String(req.doctorId) });
    if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });

    const recoveryCode = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    patient.passwordResetCodeHash = crypto.createHash('sha256').update(recoveryCode).digest('hex');
    patient.passwordResetExpiresAt = expiresAt;

    if (isDemoMode()) demoPatients.set(String(patient._id), patient);
    else await patient.save();

    return res.status(200).json({ recoveryCode, expiresAt });
  } catch (error) {
    console.error('Patient recovery code creation failed:', error.message);
    return res.status(500).json({ error: 'Could not create a recovery code. Please try again.' });
  }
});

router.patch('/patient/:id/notes', requireDoctorSession, async (req, res) => {
  const patientId = String(req.params.id);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

  try {
    if (isDemoMode()) {
      const patient = findDemoPatient(patientId, req.doctorId);
      if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
      patient.doctorNotes = notes;
      return res.status(200).json({ notes: patient.doctorNotes });
    }

    const patient = await Patient.findOneAndUpdate(
      { _id: patientId, assignedDoctorId: String(req.doctorId) },
      { $set: { doctorNotes: notes } },
      { new: true, runValidators: true }
    ).select('doctorNotes');
    if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
    return res.status(200).json({ notes: patient.doctorNotes || '' });
  } catch (error) {
    console.error('Patient notes update failed:', error.message);
    return res.status(500).json({ error: 'Could not save the patient note.' });
  }
});

router.delete('/patient/:id', requireDoctorSession, async (req, res) => {
  const patientId = String(req.params.id);
  try {
    if (isDemoMode()) {
      const patient = findDemoPatient(patientId, req.doctorId);
      if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
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

    const patient = await Patient.findOne({ _id: patientId, assignedDoctorId: String(req.doctorId) });
    if (!patient) return res.status(404).json({ error: 'Patient not found in your care team.' });
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