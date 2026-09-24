const router = require('express').Router();
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const CallSession = require('../models/CallSession');
const Doctor = require('../models/Doctor');
const Notification = require('../models/Notification');
const { demoAppointments, demoCallSessions, demoDoctors, demoNotifications, ensureDefaultDoctor } = require('../demoStore');

const isDemoRecord = (value = '') => /\b(test|demo|dummy|sample)\b/i.test(String(value));

const isFutureSlot = (scheduledDate, scheduledTime) => {
  if (!scheduledDate) return false;

  const datePart = String(scheduledDate).trim();
  const timePart = String(scheduledTime || '00:00').trim();
  const scheduleDate = new Date(`${datePart}T${timePart || '00:00'}`);

  if (Number.isNaN(scheduleDate.getTime())) {
    return true;
  }

  return scheduleDate.getTime() >= Date.now();
};

const isAppointmentLive = (scheduledDate, scheduledTime) => {
  const appointmentDate = new Date(`${scheduledDate}T${scheduledTime}`);
  if (Number.isNaN(appointmentDate.getTime())) return false;
  const now = Date.now();
  const start = appointmentDate.getTime();
  return now >= start && now <= start + (60 * 60 * 1000);
};

const makeJitsiRoom = () => `https://meet.jit.si/MHM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isDemoMode = () => mongoose.connection.readyState !== 1 || !process.env.MONGO_URI || !process.env.MONGO_URI.startsWith('mongodb');
const getDemoDoctor = () => ensureDefaultDoctor();

const getDefaultDoctor = async () => {
  if (isDemoMode()) {
    return getDemoDoctor();
  }

  let doctor = await Doctor.findOne().sort({ createdAt: 1 }).catch(() => null);

  if (!doctor) {
    doctor = await Doctor.findOneAndUpdate(
      { username: 'doctor' },
      {
        username: 'doctor',
        password: 'doctor123',
        fullName: 'Dr. Aisha Khan',
        specialty: 'Mental Wellness'
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  return doctor;
};

const getSlotMinutes = (scheduledTime) => {
  const match = String(scheduledTime || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
};

const isPriorityAppointment = (appointment) => ['urgent', 'emergency'].includes(String(appointment?.urgency || '').toLowerCase());

const getAppointmentConflict = async (doctorId, scheduledDate, scheduledTime, excludeId = null) => {
  const requestedMinutes = getSlotMinutes(scheduledTime);
  const matchesSlot = (item) => {
    if (String(item.scheduledDate) !== String(scheduledDate)) return false;
    if (requestedMinutes === null) return String(item.scheduledTime) === String(scheduledTime);
    const itemMinutes = getSlotMinutes(item.scheduledTime);
    return itemMinutes !== null && Math.abs(itemMinutes - requestedMinutes) <= 30;
  };

  if (isDemoMode()) {
    return demoAppointments.find(item =>
      String(item.doctorId) === String(doctorId) &&
      matchesSlot(item) &&
      ['Pending', 'Approved'].includes(item.status) &&
      (!excludeId || String(item._id) !== String(excludeId))
    ) || null;
  }
  const query = { doctorId, scheduledDate, status: { $in: ['Pending', 'Approved'] } };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const appointments = await Appointment.find(query);
  return appointments.find(matchesSlot) || null;
};

const generateSessionSummary = (transcript = []) => {
  const normalizedTranscript = (Array.isArray(transcript) ? transcript : [])
    .map(item => {
      if (typeof item === 'string') return { author: 'Patient', message: item };
      if (item && typeof item.message === 'string') return item;
      return null;
    })
    .filter(Boolean);

  const messages = normalizedTranscript
    .map(item => ({
      author: String(item.author || 'Patient'),
      message: String(item.message || '').replace(/\s+/g, ' ').trim()
    }))
    .filter(item => item.message);

  if (!messages.length) {
    return 'No transcript captured yet.';
  }

  const recentMessages = messages.slice(-10).map(item => item.message);
  const patientMessages = messages
    .filter(item => /patient/i.test(item.author || ''))
    .map(item => item.message);

  const doctorMessages = messages
    .filter(item => /doctor/i.test(item.author || ''))
    .map(item => item.message);

  const concernKeywords = ['stress', 'anxiety', 'sleep', 'mood', 'fear', 'relapse', 'burnout', 'overwhelmed', 'panic', 'sad', 'work', 'family', 'relationship', 'depressed', 'lonely'];
  const matchedConcerns = concernKeywords.filter(keyword => recentMessages.join(' ').toLowerCase().includes(keyword));

  const patientLead = patientMessages.length ? patientMessages.slice(-2).join(' ') : recentMessages.slice(-2).join(' ');
  const doctorLead = doctorMessages.length ? doctorMessages.slice(-2).join(' ') : 'Supportive follow-up and coping guidance were discussed.';

  if (matchedConcerns.length) {
    return `The patient discussed ${matchedConcerns.slice(0, 3).join(', ')} while sharing current concerns. The doctor responded with supportive guidance and follow-up planning based on the conversation: "${patientLead.slice(0, 180)}". ${doctorLead.slice(0, 180)}`;
  }

  return `During this consultation, the patient shared their current emotional and practical concerns, and the clinician responded with supportive guidance and next-step planning. Key discussion points included: "${patientLead.slice(0, 180)}". Follow-up guidance: "${doctorLead.slice(0, 180)}"`;
};

router.get('/doctors', async (req, res) => {
  try {
    if (isDemoMode()) {
      const doctor = getDemoDoctor();
      return res.status(200).json([doctor]);
    }

    let doctors = await Doctor.find().sort({ fullName: 1 });

    if (!doctors.length) {
      const seededDoctor = await Doctor.findOneAndUpdate(
        { username: 'doctor' },
        {
          username: 'doctor',
          password: 'doctor123',
          fullName: 'Dr. Aisha Khan',
          specialty: 'Mental Wellness'
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      doctors = [seededDoctor];
    }

    res.status(200).json(doctors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-availability', async (req, res) => {
  try {
    let { doctorId, scheduledDate, scheduledTime } = req.query;

    if (!doctorId) {
      const doctor = await getDefaultDoctor();
      doctorId = doctor?._id?.toString();
    }

    if (!doctorId || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ error: 'doctorId, scheduledDate and scheduledTime are required.' });
    }

    const conflict = await getAppointmentConflict(doctorId, scheduledDate, scheduledTime);
    res.status(200).json({
      available: !conflict,
      conflict: conflict ? {
        _id: conflict._id,
        patientName: conflict.patientName,
        scheduledDate: conflict.scheduledDate,
        scheduledTime: conflict.scheduledTime,
        status: conflict.status
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/request', async (req, res) => {
  try {
    let { patientId, patientName, doctorId, doctorName, scheduledDate, scheduledTime, urgency } = req.body;

    const fallbackDoctor = await getDefaultDoctor();
    const resolvedDoctorId = doctorId || fallbackDoctor?._id?.toString();
    const normalizedPatientId = patientId || 'demo-patient-id';

    if (!resolvedDoctorId || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ error: 'doctorId, scheduledDate and scheduledTime are required.' });
    }

    const doctor = isDemoMode() ? getDemoDoctor() : await Doctor.findById(resolvedDoctorId).catch(() => null);
    const conflict = await getAppointmentConflict(resolvedDoctorId, scheduledDate, scheduledTime);

    if (isDemoMode()) {
      const appointment = {
        _id: `demo-apt-${Date.now()}`,
        patientId: normalizedPatientId,
        patientName: patientName || 'Patient',
        doctorId: resolvedDoctorId,
        doctorName: doctor?.fullName || doctorName || 'Doctor',
        scheduledDate,
        scheduledTime,
        urgency: ['Urgent', 'Emergency'].includes(urgency) ? urgency : 'Routine',
        status: 'Pending',
        roomUrl: '',
        callStarted: false,
        callEnded: false,
        approvedAt: null,
        declinedAt: null,
        createdAt: new Date()
      };
      demoAppointments.unshift(appointment);
      return res.status(200).json({
        message: conflict ? 'Appointment request created. The doctor must approve this slot after checking availability.' : 'Appointment request created successfully.',
        appointment,
        isAvailable: !conflict,
        conflict: !!conflict
      });
    }

    const savedAppointment = await Appointment.create({
      patientId: normalizedPatientId,
      patientName: patientName || 'Patient',
      doctorId: resolvedDoctorId,
      doctorName: doctor?.fullName || doctorName || 'Doctor',
      scheduledDate,
      scheduledTime,
      urgency: ['Urgent', 'Emergency'].includes(urgency) ? urgency : 'Routine',
      status: 'Pending',
      roomUrl: '',
      callStarted: false
    });

    return res.status(200).json({
      message: conflict ? 'Appointment request created. The doctor must approve this slot after checking availability.' : 'Appointment request created successfully.',
      appointment: savedAppointment,
      isAvailable: !conflict,
      conflict: !!conflict
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/patient/:patientId', async (req, res) => {
  try {
    if (isDemoMode()) {
      const appointments = demoAppointments.filter(item => String(item.patientId) === String(req.params.patientId));
      return res.status(200).json(appointments);
    }

    const appointments = await Appointment.find({ patientId: req.params.patientId }).sort({ createdAt: -1 });
    res.status(200).json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/doctor/:doctorId/requests', async (req, res) => {
  try {
    if (isDemoMode()) {
      const appointments = demoAppointments.filter(item => String(item.doctorId) === String(req.params.doctorId));
      const withAvailability = appointments.map((appointment) => ({
        ...appointment,
        isAvailable: !demoAppointments.some(item =>
          String(item.doctorId) === String(appointment.doctorId) &&
          String(item.scheduledDate) === String(appointment.scheduledDate) &&
          Math.abs((getSlotMinutes(item.scheduledTime) ?? -9999) - (getSlotMinutes(appointment.scheduledTime) ?? -9998)) <= 30 &&
          item._id !== appointment._id &&
          ['Pending', 'Approved'].includes(item.status)
        )
      }));
      return res.status(200).json(withAvailability);
    }

    const appointments = await Appointment.find({ doctorId: req.params.doctorId }).sort({ createdAt: -1 });
    const withAvailability = await Promise.all(appointments.map(async (appointment) => {
      const conflict = await getAppointmentConflict(appointment.doctorId, appointment.scheduledDate, appointment.scheduledTime, appointment._id);
      return {
        ...appointment.toObject(),
        isAvailable: !conflict
      };
    }));
    res.status(200).json(withAvailability);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/approve', async (req, res) => {
  try {
    const { doctorId } = req.body || {};

    if (isDemoMode()) {
      const appointment = demoAppointments.find(item => String(item._id) === String(req.params.id));
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
      if (doctorId && appointment.doctorId && String(appointment.doctorId) !== String(doctorId)) {
        return res.status(403).json({ error: 'This appointment is not assigned to this doctor.' });
      }

      const conflict = await getAppointmentConflict(appointment.doctorId, appointment.scheduledDate, appointment.scheduledTime, appointment._id);

      if (conflict && !isPriorityAppointment(appointment)) {
        return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.' });
      }

      appointment.status = 'Approved';
      appointment.roomUrl = appointment.roomUrl || makeJitsiRoom();
      appointment.approvedAt = new Date();
      appointment.callStarted = false;
      appointment.callEnded = false;

      demoNotifications.unshift({
        _id: `demo-notification-${Date.now()}`,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        type: 'doctor_update',
        severity: 'info',
        message: `Your appointment with ${appointment.doctorName} was approved for ${appointment.scheduledDate} at ${appointment.scheduledTime}. Your in-app call link is ready.`,
        createdAt: new Date()
      });

      const existingSession = demoCallSessions.find(item => String(item.roomUrl) === String(appointment.roomUrl));
      if (!existingSession) {
        demoCallSessions.unshift({
          _id: `demo-session-${Date.now()}`,
          patientId: appointment.patientId,
          patientName: appointment.patientName,
          doctorName: appointment.doctorName,
          roomUrl: appointment.roomUrl,
          scheduledDate: appointment.scheduledDate,
          scheduledTime: appointment.scheduledTime,
          transcript: [],
          summary: 'No transcript captured yet.',
          isRecorded: false,
          createdAt: new Date()
        });
      }
      return res.status(200).json({ message: 'Appointment approved successfully.', appointment });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (doctorId && appointment.doctorId && String(appointment.doctorId) !== String(doctorId)) {
      return res.status(403).json({ error: 'This appointment is not assigned to this doctor.' });
    }

    const conflict = await getAppointmentConflict(appointment.doctorId, appointment.scheduledDate, appointment.scheduledTime, appointment._id);
    if (conflict && !isPriorityAppointment(appointment)) {
      return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.' });
    }

    const roomUrl = appointment.roomUrl || makeJitsiRoom();
    appointment.status = 'Approved';
    appointment.roomUrl = roomUrl;
    appointment.approvedAt = new Date();
    appointment.callStarted = false;
    appointment.callEnded = false;
    await appointment.save();

    await Notification.create({
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      type: 'doctor_update',
      severity: 'info',
      message: `Your appointment with ${appointment.doctorName} has been approved for ${appointment.scheduledDate} at ${appointment.scheduledTime}. Join here: ${roomUrl}`,
      sentToEmergencyContact: false,
      sentToDoctor: false
    });

    const session = await CallSession.findOne({ roomUrl: roomUrl });
    if (!session) {
      await CallSession.create({
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        doctorName: appointment.doctorName,
        roomUrl,
        scheduledDate: appointment.scheduledDate,
        scheduledTime: appointment.scheduledTime,
        transcript: [],
        summary: 'No transcript captured yet.',
        isRecorded: false
      });
    }

    res.status(200).json({ message: 'Appointment approved successfully.', appointment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/decline', async (req, res) => {
  try {
    if (isDemoMode()) {
      const appointment = demoAppointments.find(item => String(item._id) === String(req.params.id));
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }
      appointment.status = 'Declined';
      appointment.declinedAt = new Date();
      demoNotifications.unshift({
        _id: `demo-notification-${Date.now()}`,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        type: 'doctor_update',
        severity: 'warning',
        message: appointment.urgency === 'Routine'
          ? 'The doctor declined this routine appointment. Please book another time.'
          : 'The doctor declined this appointment. Please contact the clinic for next steps.',
        createdAt: new Date()
      });
      return res.status(200).json({
        message: 'Doctor is busy at this time. Please book a different time.',
        appointment
      });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    appointment.status = 'Declined';
    appointment.declinedAt = new Date();
    await appointment.save();

    await Notification.create({
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      type: 'doctor_update',
      severity: 'warning',
      message: `Doctor is busy at this time. Please book a different time for ${appointment.scheduledDate} at ${appointment.scheduledTime}.`,
      sentToEmergencyContact: false,
      sentToDoctor: false
    });

    res.status(200).json({
      message: 'Doctor is busy at this time. Please book a different time.',
      appointment
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patient/:patientId/notifications', async (req, res) => {
  try {
    if (isDemoMode()) {
      return res.status(200).json(demoNotifications.filter(item => String(item.patientId) === String(req.params.patientId)));
    }

    const Notification = require('../models/Notification');
    const notifications = await Notification.find({ patientId: req.params.patientId }).sort({ createdAt: -1 });
    return res.status(200).json(notifications);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/start-call', async (req, res) => {
  try {
    const { doctorId } = req.body || {};

    if (isDemoMode()) {
      const appointment = demoAppointments.find(item => String(item._id) === String(req.params.id));
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
      if (doctorId && String(appointment.doctorId) !== String(doctorId)) {
        return res.status(403).json({ error: 'Only the assigned doctor can start this call.' });
      }
      if (!isAppointmentLive(appointment.scheduledDate, appointment.scheduledTime)) {
        return res.status(409).json({ error: 'The call can only be started during the scheduled appointment time.' });
      }
      appointment.callStarted = true;
      appointment.callEnded = false;
      appointment.status = 'Approved';
      appointment.roomUrl = appointment.roomUrl || makeJitsiRoom();
      return res.status(200).json({ message: 'Call started successfully.', appointment });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (doctorId && String(appointment.doctorId) !== String(doctorId)) {
      return res.status(403).json({ error: 'Only the assigned doctor can start this call.' });
    }

    if (!isAppointmentLive(appointment.scheduledDate, appointment.scheduledTime)) {
      return res.status(409).json({ error: 'The call can only be started during the scheduled appointment time.' });
    }

    appointment.callStarted = true;
    appointment.callEnded = false;
    appointment.status = 'Approved';
    await appointment.save();

    await Notification.create({
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      type: 'doctor_update',
      severity: 'info',
      message: `Your doctor has started the call for ${appointment.scheduledDate} at ${appointment.scheduledTime}. Join here: ${appointment.roomUrl}`,
      sentToEmergencyContact: false,
      sentToDoctor: false
    });

    res.status(200).json({ message: 'Call started successfully.', appointment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/end-call', async (req, res) => {
  try {
    if (isDemoMode()) {
      const appointment = demoAppointments.find(item => String(item._id) === String(req.params.id));
      if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
      appointment.callEnded = true;
      appointment.callStarted = false;
      return res.status(200).json({ message: 'Call ended successfully.', appointment });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    appointment.callEnded = true;
    appointment.callStarted = false;
    await appointment.save();
    return res.status(200).json({ message: 'Call ended successfully.', appointment });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Book a new appointment
router.post('/book', async (req, res) => {
  try {
    let { patientId, patientName, doctorId, doctorName, scheduledDate, scheduledTime } = req.body;

    if (!doctorId) {
      const doctor = await getDefaultDoctor();
      doctorId = doctor?._id?.toString();
    }

    if (!patientId || !doctorId || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ error: 'patientId, doctorId, scheduledDate and scheduledTime are required.' });
    }

    if (isDemoMode()) {
      const doctor = getDemoDoctor();
      const conflict = await getAppointmentConflict(doctorId, scheduledDate, scheduledTime);
      const appointment = {
        _id: `demo-apt-${Date.now()}`,
        patientId,
        patientName: patientName || 'Patient',
        doctorId,
        doctorName: doctor?.fullName || doctorName || 'Doctor',
        scheduledDate,
        scheduledTime,
        status: 'Pending',
        roomUrl: '',
        callStarted: false,
        approvedAt: null,
        declinedAt: null,
        createdAt: new Date()
      };
      demoAppointments.unshift(appointment);
      demoCallSessions.unshift({
        _id: `demo-session-${Date.now()}`,
        patientId,
        patientName: patientName || 'Patient',
        doctorName: doctor?.fullName || doctorName || 'Doctor',
        roomUrl: appointment.roomUrl || makeJitsiRoom(),
        scheduledDate,
        scheduledTime,
        transcript: [],
        summary: 'No transcript captured yet.',
        isRecorded: false,
        createdAt: new Date()
      });
      return res.status(200).json({
        message: conflict ? 'Appointment request created. Awaiting doctor approval.' : 'Appointment booked successfully',
        appointment,
        session: demoCallSessions[0],
        isAvailable: !conflict
      });
    }

    const doctor = await Doctor.findById(doctorId).catch(() => null);
    const appointment = new Appointment({
      patientId,
      patientName,
      doctorId,
      doctorName: doctor?.fullName || doctorName || 'Doctor',
      scheduledDate,
      scheduledTime,
      status: 'Pending',
      roomUrl: ''
    });

    await appointment.save();

    const conflict = await getAppointmentConflict(doctorId, scheduledDate, scheduledTime, appointment._id);

    const session = new CallSession({
      patientId,
      patientName,
      doctorName: doctor?.fullName || doctorName || 'Doctor',
      roomUrl: appointment.roomUrl || makeJitsiRoom(),
      scheduledDate,
      scheduledTime,
      transcript: [],
      summary: 'No transcript captured yet.',
      isRecorded: false
    });

    await session.save();

    return res.status(200).json({
      message: conflict ? 'Appointment request created. Awaiting doctor approval.' : 'Appointment booked successfully',
      appointment,
      session,
      isAvailable: !conflict
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all appointments (for Doctor & Patient views)
router.get('/all', async (req, res) => {
  try {
    if (isDemoMode()) {
      const validAppointments = demoAppointments.filter(
        app => !isDemoRecord(app.patientName) && isFutureSlot(app.scheduledDate, app.scheduledTime)
      );
      return res.status(200).json(validAppointments);
    }

    const appointments = await Appointment.find().sort({ createdAt: -1 });
    const validAppointments = appointments.filter(
      app => !isDemoRecord(app.patientName) && isFutureSlot(app.scheduledDate, app.scheduledTime)
    );
    res.status(200).json(validAppointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/session/transcript', async (req, res) => {
  try {
    const { roomUrl, transcript = [], doctorName = 'Doctor' } = req.body || {};

    if (!roomUrl) {
      return res.status(400).json({ error: 'roomUrl is required' });
    }

    if (isDemoMode()) {
      const session = demoCallSessions.find(item => String(item.roomUrl) === String(roomUrl));
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      session.transcript = transcript;
      session.doctorName = doctorName;
      session.summary = generateSessionSummary(transcript);
      session.isRecorded = transcript.length > 0;
      return res.status(200).json({ message: 'Call transcript saved', session });
    }

    const session = await CallSession.findOne({ roomUrl });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.transcript = transcript;
    session.doctorName = doctorName;
    session.summary = generateSessionSummary(transcript);
    session.isRecorded = transcript.length > 0;
    await session.save();

    res.status(200).json({ message: 'Call transcript saved', session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    if (isDemoMode()) {
      const validSessions = demoCallSessions.filter(
        session => !isDemoRecord(session.patientName) && isFutureSlot(session.scheduledDate, session.scheduledTime)
      );
      return res.status(200).json(validSessions);
    }

    const sessions = await CallSession.find().sort({ createdAt: -1 });

    for (const session of sessions) {
      const transcript = Array.isArray(session.transcript) ? session.transcript : [];
      const hasMeaningfulTranscript = transcript.length > 0;
      const hasFakeSummary = !session.summary || /No communication|No summary|No transcript captured yet|high stress|The plan is to break/i.test(session.summary || '');

      if (hasMeaningfulTranscript && hasFakeSummary) {
        session.summary = generateSessionSummary(transcript);
        session.isRecorded = true;
        await session.save();
      }

      if (!hasMeaningfulTranscript) {
        session.summary = 'No transcript captured yet.';
        session.isRecorded = false;
        await session.save();
      }
    }

    const validSessions = sessions.filter(
      session => !isDemoRecord(session.patientName) && isFutureSlot(session.scheduledDate, session.scheduledTime)
    );

    res.status(200).json(validSessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;