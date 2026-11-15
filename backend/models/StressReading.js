const mongoose = require('mongoose');

const stressReadingSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  stressProb: { type: Number, required: true, min: 0, max: 1 },
  source: { type: String, enum: ['wesad-replay', 'upload', 'device'], required: true }
});

module.exports = mongoose.model('StressReading', stressReadingSchema);
