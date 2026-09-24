const mongoose = require('mongoose');

const dailyCheckInSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.Mixed, required: true },
  sleepHours: { type: Number, required: true },
  moodScore: { type: Number, required: true }, // Scale 1 to 10
  anxietyLevel: { type: Number, required: true }, // Scale 1 to 10
  journalText: { type: String },
  calculatedBand: { type: String, enum: ['Red', 'Orange', 'Yellow', 'Green'], default: 'Green' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DailyCheckIn', dailyCheckInSchema);