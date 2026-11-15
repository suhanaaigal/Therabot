const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { hashPatientPassword } = require('../patientPassword');

const requirePassword = (name, minimumLength) => {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length < minimumLength || value.length > 128) {
    throw new Error(`${name} must be between ${minimumLength} and 128 characters.`);
  }
  return value;
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const doctorPassword = requirePassword('DOCTOR_PASSWORD', 6);
  const patientPassword = requirePassword('PATIENT_PASSWORD', 8);

  await mongoose.connect(process.env.MONGO_URI);

  const doctorPasswordHash = await hashPatientPassword(doctorPassword);
  const patientPasswordHash = await hashPatientPassword(patientPassword);
  const doctorResult = await Doctor.updateOne(
    { username: 'doctor' },
    { $set: { password: doctorPasswordHash } }
  );
  const patientResult = await Patient.updateMany(
    {},
    { $set: { password: patientPasswordHash } }
  );

  if (doctorResult.matchedCount !== 1) {
    throw new Error('The production doctor account was not found.');
  }

  console.log(`Updated doctor account: ${doctorResult.modifiedCount}`);
  console.log(`Updated patient accounts: ${patientResult.modifiedCount}`);
};

run()
  .catch(error => {
    console.error(`Password migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
