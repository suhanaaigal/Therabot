const router = require('express').Router();
const isValidPhoneNumber = phoneNumber => /^\d{10}$/.test(String(phoneNumber || '').trim());
const { signDoctorSession } = require('../doctorSession');
const { verifyFirebaseIdToken } = require('../firebaseToken');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { demoPatients, demoDoctors, ensureDefaultDoctor } = require('../demoStore');

router.post('/register-simple', async (req, res) => {
  return res.status(410).json({ error: 'Patient signup now uses Firebase Authentication. Reload the Therabot signup page and try again.' });
});

router.post('/login', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    const identifier = String(email || fullName || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    let patient = await Patient.findOne({ email: identifier.toLowerCase() }).catch(() => null);
    if (!patient) patient = await Patient.findOne({ fullName: identifier }).catch(() => null);
    if (!patient) {
      patient = demoPatients.get(identifier) || [...demoPatients.values()].find(item => String(item.email || '').toLowerCase() === identifier.toLowerCase()) || null;
    }

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found. Please create a new account.' });
    }

    if (patient.password !== password) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    return res.status(200).json({
      message: 'Login successful',
      patientId: patient._id,
      patientName: patient.fullName
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/firebase-profile', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Firebase sign-in is required.' });

    let identity;
    try {
      identity = await verifyFirebaseIdToken(token);
    } catch (error) {
      console.warn('Firebase patient token rejected:', error.message);
      return res.status(401).json({ error: 'Could not verify your Firebase account. Please sign in again.' });
    }

    const email = String(identity.email || '').trim().toLowerCase();
    if (!email) return res.status(403).json({ error: 'Your Firebase account does not have an email address.' });
    if (identity.email_verified !== true) {
      return res.status(403).json({ error: 'Verify your email using the link Firebase sent, then sign in again.' });
    }

    const { fullName, age, gender, phoneNumber, emergencyContact } = req.body || {};
    let patient = await Patient.findOne({ firebaseUid: identity.sub }).catch(() => null);
    if (!patient) patient = await Patient.findOne({ email }).catch(() => null);

    if (!patient) {
      if (!fullName || !age || !gender || !/^\d{10}$/.test(String(phoneNumber || ''))) {
        return res.status(404).json({ error: 'Patient profile details are required to finish account setup.' });
      }
      patient = new Patient({ fullName: String(fullName).trim(), email, age: Number(age), gender, phoneNumber, emergencyContact: emergencyContact || '', firebaseUid: identity.sub, isVerified: true });
    }

    if (patient.firebaseUid && patient.firebaseUid !== identity.sub) {
      return res.status(409).json({ error: 'This patient profile is linked to another sign-in account.' });
    }

    patient.firebaseUid = identity.sub;
    patient.email = email;
    patient.isVerified = true;
    patient.password = '';
    patient.otpCode = null;
    await patient.save().catch(async error => {
      if (process.env.NODE_ENV === 'production') throw error;
      demoPatients.set(String(patient._id), patient);
    });
    demoPatients.set(String(patient._id), patient);
    return res.status(200).json({ message: 'Patient profile linked successfully.', patientId: patient._id, patientName: patient.fullName });
  } catch (error) {
    console.error('Firebase patient profile linking failed:', error.message);
    return res.status(500).json({ error: 'Could not load your patient profile.' });
  }
});

router.post('/doctor-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const doctor = await Doctor.findOne({ username }).catch(() => null);
    const defaultDoctor = ensureDefaultDoctor();

    if (doctor) {
      if (doctor.password !== password) {
        return res.status(401).json({ error: 'Incorrect password' });
      }

      if (doctor.username === 'doctor' && doctor.fullName !== 'Dr. Suhana Aigal') {
        doctor.fullName = 'Dr. Suhana Aigal';
        await doctor.save();
      }
      demoDoctors.set(String(doctor._id || doctor.username), doctor.toObject ? doctor.toObject() : doctor);
      return res.status(200).json({
        message: 'Doctor login successful',
        doctorName: doctor.username === 'doctor' ? 'Dr. Suhana Aigal' : doctor.fullName,
        username: doctor.username,
        doctorId: String(doctor._id),
        doctorSessionToken: signDoctorSession(doctor._id)
      });
    }

    if (username === defaultDoctor.username && password === defaultDoctor.password) {
      demoDoctors.set(defaultDoctor._id, defaultDoctor);
      return res.status(200).json({
        message: 'Doctor login successful',
        doctorName: defaultDoctor.fullName,
        username: defaultDoctor.username,
        doctorId: defaultDoctor._id,
        doctorSessionToken: signDoctorSession(defaultDoctor._id)
      });
    }

    return res.status(401).json({ error: 'Doctor not found or invalid credentials' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/register', (_req, res) => res.status(410).json({ error: 'Patient signup now uses Firebase Authentication.' }));
router.post('/verify-otp', (_req, res) => res.status(410).json({ error: 'Patient verification now uses Firebase Authentication.' }));

module.exports = router;