const router = require('express').Router();
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const twilio = require('twilio');
const { demoPatients, demoDoctors, ensureDefaultDoctor } = require('../demoStore');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const isTwilioConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
);

const sendOtpViaTwilio = async (phoneNumber, otpCode) => {
  if (!isTwilioConfigured || !client) {
    return { demoOtp: otpCode, mode: 'demo' };
  }

  try {
    await client.messages.create({
      body: `Your MHM Platform Verification OTP is: ${otpCode}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    return { mode: 'twilio' };
  } catch (error) {
    console.warn('Twilio OTP send failed, falling back to demo OTP:', error.message);
    return { demoOtp: otpCode, mode: 'demo' };
  }
};

router.post('/register-simple', async (req, res) => {
  try {
    const { fullName, age, gender, phoneNumber, emergencyContact, password } = req.body;

    if (!fullName || !password) {
      return res.status(400).json({ error: 'Name and password are required' });
    }

    const normalizedName = fullName.trim();
    const existing = await Patient.findOne({ fullName: { $regex: new RegExp(`^${normalizedName}$`, 'i') } }).catch(() => null);
    if (existing) {
      return res.status(409).json({ error: 'A patient with this name already exists. Please log in instead.' });
    }

    const patientData = {
      fullName: normalizedName,
      age: Number(age || 0),
      gender: gender || 'Prefer not to say',
      phoneNumber: phoneNumber || `${Date.now()}`,
      emergencyContact: emergencyContact || phoneNumber || 'Not provided',
      password,
      otpCode: null,
      isVerified: true,
      currentRiskBand: 'Green',
      createdAt: new Date()
    };

    const created = await Patient.create(patientData).catch((createErr) => {
      console.log('Create patient failed:', createErr.message);
      return null;
    });

    const finalPatient = created || { ...patientData, _id: `demo-patient-${Date.now()}` };
    demoPatients.set(normalizedName, finalPatient);
    demoPatients.set(String(finalPatient._id), finalPatient);

    return res.status(200).json({
      message: 'Account created successfully',
      patientId: finalPatient._id,
      patientName: normalizedName
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { fullName, password } = req.body;

    if (!fullName || !password) {
      return res.status(400).json({ error: 'Name and password are required' });
    }

    let patient = await Patient.findOne({ fullName }).catch(() => null);
    if (!patient) {
      patient = demoPatients.get(fullName) || null;
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

      demoDoctors.set(String(doctor._id || doctor.username), doctor.toObject ? doctor.toObject() : doctor);
      return res.status(200).json({
        message: 'Doctor login successful',
        doctorName: doctor.fullName,
        username: doctor.username,
        doctorId: String(doctor._id)
      });
    }

    if (username === defaultDoctor.username && password === defaultDoctor.password) {
      demoDoctors.set(defaultDoctor._id, defaultDoctor);
      return res.status(200).json({
        message: 'Doctor login successful',
        doctorName: defaultDoctor.fullName,
        username: defaultDoctor.username,
        doctorId: defaultDoctor._id
      });
    }

    return res.status(401).json({ error: 'Doctor not found or invalid credentials' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 1. Register Patient & Send OTP
router.post('/register', async (req, res) => {
  try {
    const { fullName, age, gender, phoneNumber, emergencyContact } = req.body;
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    let patient = null;
    try {
      patient = await Patient.findOne({ phoneNumber });
    } catch (dbErr) {
      console.log('DB lookup failed, using demo mode for registration:', dbErr.message);
    }

    if (patient) {
      patient.fullName = fullName;
      patient.age = age;
      patient.gender = gender;
      patient.emergencyContact = emergencyContact;
      patient.otpCode = otpCode;
      patient.isVerified = false;
      await patient.save();
    } else {
      const patientData = {
        fullName,
        age,
        gender,
        phoneNumber,
        emergencyContact,
        otpCode,
        isVerified: false,
        currentRiskBand: 'Green',
        createdAt: new Date()
      };

      if (Patient && typeof Patient.create === 'function') {
        try {
          patient = await Patient.create(patientData);
        } catch (createErr) {
          demoPatients.set(phoneNumber, patientData);
        }
      } else {
        demoPatients.set(phoneNumber, patientData);
      }
    }

    const otpResult = await sendOtpViaTwilio(phoneNumber, otpCode);

    res.status(200).json({
      message: otpResult.mode === 'twilio' ? 'OTP sent successfully' : 'Demo OTP generated successfully',
      phoneNumber,
      demoOtp: otpResult.demoOtp || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otpCode } = req.body;

    let patient = null;
    try {
      patient = await Patient.findOne({ phoneNumber });
    } catch (dbErr) {
      console.log('DB lookup failed, using demo mode for verification:', dbErr.message);
    }

    const demoPatient = demoPatients.get(phoneNumber);
    const candidate = patient || demoPatient;

    if (!candidate || candidate.otpCode !== otpCode) {
      return res.status(400).json({ error: 'Invalid OTP or phone number' });
    }

    if (patient) {
      patient.isVerified = true;
      patient.otpCode = null;
      await patient.save();
    } else {
      demoPatient.isVerified = true;
      demoPatient.otpCode = null;
      demoPatients.set(phoneNumber, demoPatient);
    }

    res.status(200).json({
      message: 'Verification successful',
      patientId: candidate._id,
      patientName: candidate.fullName
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;