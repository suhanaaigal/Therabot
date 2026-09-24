const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, required: true },
  phoneNumber: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  password: { type: String, default: '' },
  otpCode: { type: String, default: null },
  isVerified: { type: Boolean, default: false },
  currentRiskBand: { type: String, enum: ['Red', 'Orange', 'Yellow', 'Green'], default: 'Green' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Patient', patientSchema);
