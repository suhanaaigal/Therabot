// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// require('dotenv').config();

// const app = express();
// app.use(express.json());
// app.use(cors());
// app.use('/api/patient', require('./routes/patient'));
// app.use('/api/doctor', require('./routes/doctor'));
// // Connect to MongoDB
// mongoose.connect(process.env.MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// }).then(() => console.log("MongoDB Connected"))
//   .catch(err => console.log(err));

// app.listen(5000, () => {
//   console.log("Server running on port 5000");
// });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Patient = require('./models/Patient');
const Appointment = require('./models/Appointment');
const Doctor = require('./models/Doctor');
const { demoAppointments, demoPatients, seedDemoPatients } = require('./demoStore');
const { verifyPatientSession } = require('./patientSession');
const { verifyDoctorSession } = require('./doctorSession');
const { createRateLimiter } = require('./middleware/rateLimit');
const { hashPatientPassword } = require('./patientPassword');
const { migratePasswords } = require('./scripts/setProductionPasswords');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || true }));
app.use('/api/auth', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api/ai', createRateLimiter({ windowMs: 60 * 1000, max: 20 }));
app.use('/api/appointment', createRateLimiter({ windowMs: 60 * 1000, max: 60 }));

const isMongoConfigured = Boolean(process.env.MONGO_URI && process.env.MONGO_URI.startsWith('mongodb'));
const isProduction = process.env.NODE_ENV === 'production';

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || true, methods: ["GET", "POST"] }
});

app.get('/health', (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  const isHealthy = !isProduction || databaseConnected;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'database_unavailable',
    persistence: databaseConnected ? 'mongodb' : 'demo-memory'
  });
});

app.get('/api/privacy', (_req, res) => {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  let providerName = provider === 'ollama' ? 'Ollama (local)' : 'OpenAI';
  if (provider !== 'ollama') {
    try {
      const host = new URL(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').hostname.toLowerCase();
      if (host.includes('groq')) providerName = 'Groq';
      else if (host.includes('openai')) providerName = 'OpenAI';
      else providerName = host;
    } catch {
      providerName = 'the configured AI provider';
    }
  }
  let textAnalysisService = 'not_configured';
  if (String(process.env.ML_URL || '').trim()) {
    try {
      textAnalysisService = new URL(process.env.ML_URL).hostname || 'configured service';
    } catch (error) {
      console.error('Configured ML_URL could not be identified for the privacy page:', error.message);
      textAnalysisService = 'configured service (hostname unavailable)';
    }
  }
  res.status(200).json({
    aiProvider: providerName,
    textAnalysisService,
    privacyVersion: '2026-11-04',
    persistence: mongoose.connection.readyState === 1 ? 'mongodb' : 'demo-memory'
  });
});

app.use((req, res, next) => {
  if (isProduction && mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Persistent storage is unavailable. Please retry when the database connection is restored.' });
  }
  return next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patient', require('./routes/patient'));
app.use('/api/doctor', require('./routes/doctor'));
app.use('/api/appointment', require('./routes/appointment'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/stress', require('./routes/stress'));

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const patient = verifyPatientSession(token);
  const doctor = patient ? null : verifyDoctorSession(token);
  if (!patient && !doctor) return next(new Error('unauthorized'));
  socket.data.user = patient
    ? { role: 'patient', id: patient.patientId }
    : { role: 'doctor', id: doctor.doctorId };
  return next();
});

const findSocketAppointment = async appointmentId => {
  if (mongoose.connection.readyState === 1) return Appointment.findById(appointmentId);
  return demoAppointments.find(item => String(item._id) === String(appointmentId)) || null;
};

const socketUserCanAccessAppointment = async (user, appointment) => {
  if (!appointment) return false;
  if (mongoose.connection.readyState === 1) {
    const patient = await Patient.findOne({ _id: appointment.patientId }).select('assignedDoctorId');
    if (!patient) return false;
    if (user.role === 'patient') return String(appointment.patientId) === user.id;
    return String(appointment.doctorId) === user.id && String(patient.assignedDoctorId) === user.id;
  }
  const patient = [...demoPatients.values()].find(item => String(item._id) === String(appointment.patientId));
  if (!patient) return false;
  if (user.role === 'patient') return String(appointment.patientId) === user.id;
  if (String(appointment.doctorId) !== user.id) return false;
  return [...demoPatients.values()].some(patient =>
    String(patient._id) === String(appointment.patientId) &&
    String(patient.assignedDoctorId || 'doctor-default') === user.id
  );
};

const canJoinPatientChat = async (user, patientId) => {
  if (mongoose.connection.readyState === 1) {
    const patient = await Patient.findById(patientId).select('assignedDoctorId');
    if (!patient) return false;
    return user.role === 'patient'
      ? patientId === user.id
      : String(patient.assignedDoctorId) === user.id;
  }
  if (user.role === 'patient') return patientId === user.id && demoPatients.has(patientId);
  return [...demoPatients.values()].some(patient =>
    String(patient._id) === patientId && String(patient.assignedDoctorId || 'doctor-default') === user.id
  );
};

// Socket.io real-time connection. Rooms are derived from authorized records, not client-provided names.
io.on('connection', (socket) => {
  socket.on('join_room', async (patientId, acknowledge) => {
    try {
      const roomId = String(patientId || '');
      if (!roomId || roomId.length > 100 || !await canJoinPatientChat(socket.data.user, roomId)) {
        acknowledge?.({ error: 'forbidden' });
        return;
      }
      const room = `patient-chat:${roomId}`;
      socket.data.chatRoom = room;
      socket.join(room);
      acknowledge?.({ ok: true });
    } catch (error) {
      console.error('Socket patient chat authorization failed:', error.message);
      acknowledge?.({ error: 'unavailable' });
    }
  });

  socket.on('join_call', async (payload, acknowledge) => {
    try {
      const appointmentId = payload?.appointmentId;
      if (!appointmentId || String(appointmentId).length > 100) return acknowledge?.({ error: 'forbidden' });
      const appointment = await findSocketAppointment(appointmentId);
      if (!await socketUserCanAccessAppointment(socket.data.user, appointment)) {
        acknowledge?.({ error: 'forbidden' });
        return;
      }
      const room = `appointment:${appointmentId}`;
      socket.data.callRooms ||= new Set();
      socket.data.callRooms.add(room);
      const participants = [...(io.sockets.adapter.rooms.get(room) || [])]
        .filter(peerId => peerId !== socket.id);
      socket.join(room);
      socket.emit('call_room_peers', { appointmentId, peerIds: participants });
      socket.to(room).emit('call_peer_joined', { appointmentId, peerId: socket.id });
      acknowledge?.({ ok: true });
    } catch (error) {
      console.error('Socket appointment authorization failed:', error.message);
      acknowledge?.({ error: 'unavailable' });
    }
  });

  socket.on('webrtc_signal', payload => {
    const { appointmentId, to, signal } = payload || {};
    const room = `appointment:${appointmentId}`;
    if (!to || !signal || !socket.rooms.has(room) || !io.sockets.adapter.rooms.get(room)?.has(to)) return;
    io.to(to).emit('webrtc_signal', { from: socket.id, appointmentId, signal });
  });

  socket.on('call_recording_status', payload => {
    const { appointmentId, recording } = payload || {};
    const room = `appointment:${appointmentId}`;
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit('call_recording_status', { appointmentId, recording: Boolean(recording) });
  });

  socket.on('call_ended', payload => {
    const { appointmentId, endedBy } = payload || {};
    const room = `appointment:${appointmentId}`;
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit('call_ended', { appointmentId, endedBy: endedBy || 'Doctor' });
  });

  socket.on('leave_call', appointmentId => {
    const room = `appointment:${appointmentId}`;
    if (!appointmentId || !socket.rooms.has(room)) return;
    socket.leave(room);
    socket.data.callRooms?.delete(room);
    socket.to(room).emit('call_peer_left', { peerId: socket.id });
  });

  socket.on('send_message', async (data) => {
    const room = socket.data.chatRoom;
    if (!room) return;
    const entry = {
      author: socket.data.user.role === 'doctor' ? 'Doctor' : 'Patient',
      message: String(data?.message || '').trim().slice(0, 2000),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (entry.message) socket.to(room).emit('receive_message', entry);
  });

  socket.on('disconnect', () => {});
});

// Local development can use demo mode; production must never accept ephemeral data.
const MONGO_URL = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mental-health-db";

const PORT = Number(process.env.PORT) || 5000;

const migrateLegacyPatientAssignments = async () => {
  const unassignedPatients = await Patient.find({
    $or: [{ assignedDoctorId: '' }, { assignedDoctorId: { $exists: false } }]
  }).select('_id');
  if (!unassignedPatients.length) return;

  let defaultDoctor = await Doctor.findOne().sort({ createdAt: 1 }).select('_id');
  if (!defaultDoctor && process.env.NODE_ENV !== 'production' && process.env.DEMO_DOCTOR_PASSWORD) {
    defaultDoctor = await Doctor.findOneAndUpdate(
      { username: 'doctor' },
      { username: 'doctor', password: await hashPatientPassword(process.env.DEMO_DOCTOR_PASSWORD), fullName: 'Dr. Suhana Aigal', specialty: 'Mental Wellness' },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).select('_id');
  }
  if (!defaultDoctor) throw new Error('Unassigned patient records exist, but no clinician is provisioned. Assign them through the trusted administrative process.');

  const patientIds = unassignedPatients.map(patient => String(patient._id));
  const historicalAppointments = await Appointment.find({
    patientId: { $in: patientIds },
    doctorId: { $nin: ['', null] }
  }).select('patientId doctorId createdAt').sort({ createdAt: -1 });
  const doctorByPatient = new Map();
  for (const appointment of historicalAppointments) {
    const patientId = String(appointment.patientId);
    if (!doctorByPatient.has(patientId)) doctorByPatient.set(patientId, String(appointment.doctorId));
  }

  const fallbackDoctorId = String(defaultDoctor._id);
  const updates = unassignedPatients.map(patient => ({
    updateOne: {
      filter: { _id: patient._id, $or: [{ assignedDoctorId: '' }, { assignedDoctorId: { $exists: false } }] },
      update: { $set: { assignedDoctorId: doctorByPatient.get(String(patient._id)) || fallbackDoctorId } }
    }
  }));
  await Patient.bulkWrite(updates);
  console.log(`Assigned ${updates.length} legacy patient records to their care teams.`);
};

const startServer = async () => {
  if (isProduction && !isMongoConfigured) {
    throw new Error('MONGO_URI must be configured in production; refusing to start with non-persistent demo storage.');
  }

  if (isMongoConfigured) {
    if (isProduction) {
      await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB Connected Successfully');
      await migrateLegacyPatientAssignments();
      if (process.env.PASSWORD_MIGRATION_DOCTOR_PASSWORD && process.env.PASSWORD_MIGRATION_PATIENT_PASSWORD) {
        const result = await migratePasswords({
          doctorPassword: process.env.PASSWORD_MIGRATION_DOCTOR_PASSWORD,
          patientPassword: process.env.PASSWORD_MIGRATION_PATIENT_PASSWORD
        });
        console.log(`Password migration updated doctor: ${result.doctorCount}, patients: ${result.patientCount}. Remove PASSWORD_MIGRATION_* variables now.`);
      }
    } else {
      mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 5000 })
        .then(async () => {
          console.log('MongoDB Connected Successfully');
          await migrateLegacyPatientAssignments();
        })
        .catch(err => console.warn('Local MongoDB initialization failed; check the database and clinician provisioning:', err.message));
    }
  } else {
    console.warn('MongoDB not configured. Running in non-persistent local demo mode.');
    await seedDemoPatients();
  }

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(error => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});