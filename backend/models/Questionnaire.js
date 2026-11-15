const mongoose = require('mongoose');

const questionnaireSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  type: { type: String, enum: ['PHQ-9', 'GAD-7'], required: true, index: true },
  gadDifficulty: { type: String, enum: ['Not difficult at all', 'Somewhat difficult', 'Very difficult', 'Extremely difficult', ''], default: '' },
  answers: { type: [Number], required: true },
  total: { type: Number, required: true },
  band: { type: String, required: true },
  crisisFlag: { type: Boolean, default: false },
  date: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Questionnaire', questionnaireSchema);
