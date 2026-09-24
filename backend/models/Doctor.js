const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, default: 'Doctor' },
  specialty: { type: String, default: 'Mental Health' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Doctor', doctorSchema);
