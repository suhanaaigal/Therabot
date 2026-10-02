const router = require('express').Router();
const crypto = require('crypto');
const isValidPhoneNumber = phoneNumber => /^\d{10}$/.test(String(phoneNumber || '').trim());
const isValidEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
const maskEmail = email => {
  const [name, domain] = String(email || '').split('@');
  return name && domain ? `${name.slice(0, 1)}***@${domain}` : '[invalid-email]';
};
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
    const { fullName, email, age, gender, phoneNumber, emergencyContact, password } = req.body;

    if (!fullName || !password || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Name, a valid email address, and password are required.' });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
    }

    const normalizedName = fullName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const existingEmail = await Patient.findOne({ email: normalizedEmail }).catch(() => null);
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in or reset your password.' });
    }
    const existing = await Patient.findOne({ fullName: { $regex: new RegExp(`^${normalizedName}$`, 'i') } }).catch(() => null);
    if (existing) {
      return res.status(409).json({ error: 'A patient with this name already exists. Please log in instead.' });
    }

    const patientData = {
      fullName: normalizedName,
      email: normalizedEmail,
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

router.post('/password-reset/request', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return res.status(503).json({ error: 'Password recovery email is not configured yet. Please contact the care team.' });
  }

  try {
    const patient = await Patient.findOne({ email }).catch(() => null)
      || [...demoPatients.values()].find(item => String(item.email || '').toLowerCase() === email);
    if (!patient) {
      console.info(`Password reset requested for an unknown account (${maskEmail(email)}). No email sent.`);
      return res.status(200).json({ message: 'If an account exists for that email, a reset code has been sent.' });
    }

    const resetCode = crypto.randomInt(100000, 1000000).toString();
    const resetHash = crypto.createHash('sha256').update(resetCode).digest('hex');
    patient.passwordResetCodeHash = resetHash;
    patient.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await patient.save?.();
    if (!patient.save) demoPatients.set(String(patient._id), patient);

    const mailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email],
        subject: 'Your Therabot password reset code',
        text: `Your Therabot password reset code is ${resetCode}. It expires in 15 minutes. If you did not request this, you can ignore this email.`
      })
    });
    if (!mailResponse.ok) {
      const providerError = (await mailResponse.text()).slice(0, 500);
      console.error(`Password reset email rejected by Resend (HTTP ${mailResponse.status}, ${maskEmail(email)}): ${providerError}`);
      patient.passwordResetCodeHash = null;
      patient.passwordResetExpiresAt = null;
      await patient.save?.();
      return res.status(502).json({ error: 'We could not send the recovery email. Check the backend logs or try again later.' });
    }

    const delivery = await mailResponse.json().catch(() => ({}));
    console.info(`Password reset email accepted by Resend (${maskEmail(email)}, id: ${delivery.id || 'unknown'}).`);

    return res.status(200).json({ message: 'If an account exists for that email, a reset code has been sent.' });
  } catch (error) {
    console.error('Password reset request failed:', error.message);
    return res.status(500).json({ error: 'Could not process the password reset request.' });
  }
});

router.post('/password-reset/complete', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  if (!isValidEmail(email) || !/^\d{6}$/.test(code) || password.length < 8) {
    return res.status(400).json({ error: 'Enter the six-digit code and a new password with at least 8 characters.' });
  }

  try {
    const patient = await Patient.findOne({ email }).catch(() => null)
      || [...demoPatients.values()].find(item => String(item.email || '').toLowerCase() === email);
    const suppliedHash = crypto.createHash('sha256').update(code).digest('hex');
    if (!patient || patient.passwordResetCodeHash !== suppliedHash || !patient.passwordResetExpiresAt || new Date(patient.passwordResetExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'That code is invalid or expired. Request a new one.' });
    }

    patient.password = password;
    patient.passwordResetCodeHash = null;
    patient.passwordResetExpiresAt = null;
    await patient.save?.();
    if (!patient.save) demoPatients.set(String(patient._id), patient);
    return res.status(200).json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    console.error('Password reset completion failed:', error.message);
    return res.status(500).json({ error: 'Could not update the password.' });
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
    const { fullName, email, age, gender, phoneNumber, emergencyContact } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Phone number must be exactly 10 digits.' });
    }
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const normalizedEmail = email.trim().toLowerCase();

    const existingEmail = await Patient.findOne({ email: normalizedEmail }).catch(() => null);
    if (existingEmail && String(existingEmail.phoneNumber) !== String(phoneNumber)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    let patient = null;
    try {
      patient = await Patient.findOne({ phoneNumber });
    } catch (dbErr) {
      console.log('DB lookup failed, using demo mode for registration:', dbErr.message);
    }

    if (patient) {
      patient.fullName = fullName;
      patient.email = normalizedEmail;
      patient.age = age;
      patient.gender = gender;
      patient.emergencyContact = emergencyContact;
      patient.otpCode = otpCode;
      patient.isVerified = false;
      await patient.save();
    } else {
      const patientData = {
        fullName,
        email: normalizedEmail,
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