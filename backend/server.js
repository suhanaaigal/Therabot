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
const CallSession = require('./models/CallSession');
const { demoCallSessions } = require('./demoStore');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || true }));

const isMongoConfigured = Boolean(process.env.MONGO_URI && process.env.MONGO_URI.startsWith('mongodb'));
const isProduction = process.env.NODE_ENV === 'production';

const normalizeTranscriptEntry = (item = {}) => {
  if (!item || typeof item !== 'object') return null;
  const author = String(item.author || 'Patient');
  const message = String(item.message || '').replace(/\s+/g, ' ').trim();
  if (!message) return null;

  return {
    author,
    message,
    time: item.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
};

const generateSessionSummary = (transcript = []) => {
  const normalizedTranscript = (Array.isArray(transcript) ? transcript : [])
    .map(normalizeTranscriptEntry)
    .filter(Boolean);

  if (!normalizedTranscript.length) {
    return 'No transcript captured yet.';
  }

  const recentMessages = normalizedTranscript.slice(-10).map(item => item.message);
  const patientMessages = normalizedTranscript.filter(item => /patient/i.test(item.author || '')).map(item => item.message);
  const doctorMessages = normalizedTranscript.filter(item => /doctor/i.test(item.author || '')).map(item => item.message);

  const concernKeywords = ['stress', 'anxiety', 'sleep', 'mood', 'fear', 'relapse', 'burnout', 'overwhelmed', 'panic', 'sad', 'work', 'family', 'relationship', 'depressed', 'lonely'];
  const matchedConcerns = concernKeywords.filter(keyword => recentMessages.join(' ').toLowerCase().includes(keyword));

  const patientLead = patientMessages.length ? patientMessages.slice(-2).join(' ') : recentMessages.slice(-2).join(' ');
  const doctorLead = doctorMessages.length ? doctorMessages.slice(-2).join(' ') : 'Supportive follow-up and coping guidance were discussed.';

  if (matchedConcerns.length) {
    return `The patient discussed ${matchedConcerns.slice(0, 3).join(', ')} while sharing current concerns. The doctor responded with supportive guidance and follow-up planning based on the conversation: "${patientLead.slice(0, 180)}". ${doctorLead.slice(0, 180)}`;
  }

  return `During this consultation, the patient shared their current emotional and practical concerns, and the clinician responded with supportive guidance and next-step planning. Key discussion points included: "${patientLead.slice(0, 180)}". Follow-up guidance: "${doctorLead.slice(0, 180)}"`;
};

const persistCallTranscript = async (roomKey, entry) => {
  if (!roomKey || !entry || !entry.message) return;

  const nextEntry = normalizeTranscriptEntry(entry);
  if (!nextEntry) return;

  if (mongoose.connection.readyState === 1) {
    const session = await CallSession.findOne({ roomUrl: roomKey });
    if (!session) return;

    const transcript = Array.isArray(session.transcript) ? session.transcript : [];
    const updatedTranscript = [...transcript, nextEntry];
    session.transcript = updatedTranscript;
    session.summary = generateSessionSummary(updatedTranscript);
    session.isRecorded = updatedTranscript.length > 0;
    await session.save();
    return;
  }

  const session = demoCallSessions.find(item => String(item.roomUrl) === String(roomKey));
  if (!session) return;

  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const updatedTranscript = [...transcript, nextEntry];
  session.transcript = updatedTranscript;
  session.summary = generateSessionSummary(updatedTranscript);
  session.isRecorded = updatedTranscript.length > 0;
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || true, methods: ["GET", "POST"] }
});

app.get('/health', (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  const isHealthy = !isProduction || databaseConnected;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'database_unavailable',
    persistence: databaseConnected ? 'mongodb' : 'demo-memory',
    firebaseAuthConfigured: Boolean(process.env.FIREBASE_PROJECT_ID)
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

// Socket.io Real-Time Connection
io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  socket.on('join_call', (room) => {
    if (!room) return;
    const participants = [...(io.sockets.adapter.rooms.get(room) || [])]
      .filter(peerId => peerId !== socket.id);
    socket.join(room);
    socket.emit('call_room_peers', { peerIds: participants });
    socket.to(room).emit('call_peer_joined', { peerId: socket.id });
  });

  socket.on('webrtc_signal', ({ to, signal } = {}) => {
    if (!to || !signal) return;
    io.to(to).emit('webrtc_signal', { from: socket.id, signal });
  });

  socket.on('call_recording_status', ({ room, recording } = {}) => {
    if (!room) return;
    socket.to(room).emit('call_recording_status', { recording: Boolean(recording) });
  });

  socket.on('call_ended', ({ room, endedBy } = {}) => {
    if (!room) return;
    socket.to(room).emit('call_ended', { endedBy: endedBy || 'Doctor' });
  });

  socket.on('leave_call', (room) => {
    if (!room) return;
    socket.leave(room);
    socket.to(room).emit('call_peer_left', { peerId: socket.id });
  });

  socket.on('send_message', async (data) => {
    const room = data?.room || data?.roomUrl || data?.roomId;
    const entry = {
      author: data?.author || 'Patient',
      message: String(data?.message || '').trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (room && entry.message) {
      await persistCallTranscript(room, entry);
    }

    io.to(room).emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    console.log(`User Disconnected: ${socket.id}`);
  });
});

// Local development can use demo mode; production must never accept ephemeral data.
const MONGO_URL = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mental-health-db";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async () => {
  if (isProduction && !isMongoConfigured) {
    throw new Error('MONGO_URI must be configured in production; refusing to start with non-persistent demo storage.');
  }

  if (isMongoConfigured) {
    if (isProduction) {
      await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB Connected Successfully');
    } else {
      mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 5000 })
        .then(() => console.log('MongoDB Connected Successfully'))
        .catch(err => console.warn('MongoDB unavailable; local development is using demo storage:', err.message));
    }
  } else {
    console.warn('MongoDB not configured. Running in non-persistent local demo mode.');
  }

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(error => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});