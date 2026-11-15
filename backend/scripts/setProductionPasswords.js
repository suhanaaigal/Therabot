const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { hashPatientPassword } = require('../patientPassword');

const validatePassword = (name, value, minimumLength) => {
  if (typeof value !== 'string' || value.length < minimumLength || value.length > 128) {
    throw new Error(`${name} must be between ${minimumLength} and 128 characters.`);
  }
  return value;
};

const migratePasswords = async ({ doctorPassword, patientPassword }) => {
  validatePassword('DOCTOR_PASSWORD', doctorPassword, 6);
  validatePassword('PATIENT_PASSWORD', patientPassword, 8);
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

  return {
    doctorCount: doctorResult.modifiedCount,
    patientCount: patientResult.modifiedCount
  };
};

if (require.main === module) {
  if (!process.env.MONGO_URI) {
    console.error('Password migration failed: MONGO_URI is required.');
    process.exitCode = 1;
  } else {
    mongoose.connect(process.env.MONGO_URI)
      .then(() => migratePasswords({
        doctorPassword: process.env.DOCTOR_PASSWORD,
        patientPassword: process.env.PATIENT_PASSWORD
      }))
      .then(result => {
        console.log(`Updated doctor account: ${result.doctorCount}`);
        console.log(`Updated patient accounts: ${result.patientCount}`);
      })
      .catch(error => {
        console.error(`Password migration failed: ${error.message}`);
        process.exitCode = 1;
      })
      .finally(async () => {
        await mongoose.disconnect();
      });
  }
}

module.exports = { migratePasswords };
