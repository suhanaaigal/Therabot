const router = require('express').Router();
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { signDoctorSession } = require('../doctorSession');
const { hashPatientPassword, verifyPatientPassword } = require('../patientPassword');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { demoPatients, demoDoctors, ensureDefaultDoctor } = require('../demoStore');

const normalizeEmail = email => String(email || '').trim().toLowerCase();
const findDemoPatientByEmail = email => [...demoPatients.values()].find(patient => normalizeEmail(patient.email) === email);

const findPatientByEmail = async email => {
  if (mongoose.connection.readyState === 1) {
    return Patient.findOne({ email }).select('+password');
  }
  return findDemoPatientByEmail(email) || null;
};

const savePatient = async patient => {
  if (mongoose.connection.readyState === 1) {
    await patient.save();
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Persistent storage is unavailable.');
  }
  demoPatients.set(String(patient._id), patient);
};

router.post('/register-simple', async (req, res) => {
  try {
    const { fullName, email: submittedEmail, age, gender, phoneNumber, emergencyContact, doctorId, password } = req.body || {};
    const email = normalizeEmail(submittedEmail);
    const patientAge = Number(age);

    if (!String(fullName || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter your full name and a valid email address.' });
    }
    if (!Number.isInteger(patientAge) || patientAge < 1 || patientAge > 120 || !String(gender || '').trim()) {
      return res.status(400).json({ error: 'Enter a valid age and select a gender.' });
    }
    if (!/^\d{10}$/.test(String(phoneNumber || '').trim())) {
      return res.status(400).json({ error: 'Enter a 10-digit phone number.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
    }
    if (!doctorId) return res.status(400).json({ error: 'Choose a doctor for your care team.' });

    const assignedDoctor = mongoose.connection.readyState === 1
      ? await Doctor.findById(doctorId).select('_id')
      : demoDoctors.get(String(doctorId)) || (String(doctorId) === 'doctor-default' ? ensureDefaultDoctor() : null);
    if (!assignedDoctor) return res.status(400).json({ error: 'The selected doctor is unavailable. Please choose another.' });

    const existingPatient = await findPatientByEmail(email);
    if (existingPatient) {
      if (existingPatient.firebaseUid && !existingPatient.password) {
        return res.status(409).json({ error: 'This account was created with the previous sign-in system and needs to be migrated by the care team.' });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Choose Returning to sign in.' });
    }

    const patient = new Patient({
      fullName: String(fullName).trim(),
      email,
      assignedDoctorId: String(assignedDoctor._id || assignedDoctor.id),
      age: patientAge,
      gender: String(gender).trim(),
      phoneNumber: String(phoneNumber).trim(),
      emergencyContact: String(emergencyContact || '').trim(),
      password: await hashPatientPassword(password)
    });
    await savePatient(patient);

    return res.status(201).json({
      message: 'Account created successfully.',
      patientId: String(patient._id),
      patientName: patient.fullName,
      assignedDoctorId: patient.assignedDoctorId
    });
  } catch (error) {
    console.error('Patient signup failed:', error.message);
    return res.status(500).json({ error: 'Could not create your patient account. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { fullName, email: submittedEmail, password } = req.body || {};
    const email = normalizeEmail(submittedEmail);
    const identifier = email || String(fullName || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const patient = email
      ? await findPatientByEmail(email)
      : mongoose.connection.readyState === 1
        ? await Patient.findOne({ fullName: identifier }).select('+password')
        : [...demoPatients.values()].find(item => String(item.fullName || '') === identifier) || null;

    if (!patient) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    if (!patient.password && patient.firebaseUid) {
      return res.status(409).json({ error: 'This account was created with the previous sign-in system and needs to be migrated by the care team.' });
    }

    const passwordResult = await verifyPatientPassword(password, patient.password);
    if (!passwordResult.isValid) return res.status(401).json({ error: 'Email or password is incorrect.' });

    if (passwordResult.needsRehash) {
      patient.password = await hashPatientPassword(password);
      await savePatient(patient);
    }

    return res.status(200).json({
      message: 'Login successful',
      patientId: String(patient._id),
      patientName: patient.fullName,
      assignedDoctorId: patient.assignedDoctorId || ''
    });
  } catch (err) {
    console.error('Patient login failed:', err.message);
    return res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

router.post('/password-reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const recoveryCode = String(req.body?.recoveryCode || '').trim();
    const newPassword = req.body?.newPassword;
    if (!email || !recoveryCode || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Email, recovery code, and new password are required.' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
    }

    const recoveryCodeHash = crypto.createHash('sha256').update(recoveryCode).digest('hex');
    const passwordHash = await hashPatientPassword(newPassword);
    if (mongoose.connection.readyState === 1) {
      const updatedPatient = await Patient.findOneAndUpdate({
        email,
        passwordResetCodeHash: recoveryCodeHash,
        passwordResetExpiresAt: { $gt: new Date() }
      }, {
        $set: { password: passwordHash, passwordResetCodeHash: '', passwordResetExpiresAt: null }
      }, { new: true }).select('_id');
      if (!updatedPatient) {
        return res.status(400).json({ error: 'Recovery code is invalid or expired. Ask your care team for a new code.' });
      }
    } else {
      const patient = findDemoPatientByEmail(email);
      const submittedHash = Buffer.from(recoveryCodeHash, 'hex');
      const storedHashText = String(patient?.passwordResetCodeHash || '');
      const storedHash = /^[a-f\d]{64}$/i.test(storedHashText) ? Buffer.from(storedHashText, 'hex') : Buffer.alloc(32);
      const codeMatches = crypto.timingSafeEqual(submittedHash, storedHash) && Boolean(storedHashText);
      const codeIsCurrent = patient?.passwordResetExpiresAt && new Date(patient.passwordResetExpiresAt).getTime() > Date.now();
      if (!patient || !codeMatches || !codeIsCurrent) {
        return res.status(400).json({ error: 'Recovery code is invalid or expired. Ask your care team for a new code.' });
      }
      patient.password = passwordHash;
      patient.passwordResetCodeHash = '';
      patient.passwordResetExpiresAt = null;
      await savePatient(patient);
    }
    return res.status(200).json({ message: 'Password updated. You can now sign in with your new password.' });
  } catch (error) {
    console.error('Patient password reset failed:', error.message);
    return res.status(500).json({ error: 'Could not update your password. Please try again.' });
  }
});

router.post('/firebase-profile', (_req, res) => res.status(410).json({ error: 'Firebase patient sign-in is no longer supported. Reload the app and create or migrate a local account.' }));

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

router.post('/register', (_req, res) => res.status(410).json({ error: 'Use email and password to create a patient account.' }));
router.post('/verify-otp', (_req, res) => res.status(410).json({ error: 'Phone verification is not currently available.' }));

module.exports = router;