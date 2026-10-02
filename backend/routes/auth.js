const router = require('express').Router();
const mongoose = require('mongoose');
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
    const { fullName, email: submittedEmail, age, gender, phoneNumber, emergencyContact, password } = req.body || {};
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
      patientName: patient.fullName
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
      patientName: patient.fullName
    });
  } catch (err) {
    console.error('Patient login failed:', err.message);
    return res.status(500).json({ error: 'Could not sign in. Please try again.' });
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