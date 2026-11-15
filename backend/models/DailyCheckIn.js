const mongoose = require('mongoose');

const dailyCheckInSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.Mixed, required: true },
  sleepHours: { type: Number, min: 0, max: 24 },
  moodScore: { type: Number, min: 1, max: 10 },
  anxietyLevel: { type: Number, min: 1, max: 10 },
  journalText: { type: String },
  mlAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
  riskReasons: { type: [String], default: [] },
  riskSource: { type: String, default: 'rules' },
  stressProbability: { type: Number, min: 0, max: 1, default: null },
  physiologyStressProbability: { type: Number, min: 0, max: 1, default: null },
  topWords: { type: [String], default: [] },
  calculatedBand: { type: String, enum: ['Red', 'Orange', 'Yellow', 'Green'], default: 'Green' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DailyCheckIn', dailyCheckInSchema);