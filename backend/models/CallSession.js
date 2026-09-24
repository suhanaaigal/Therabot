const mongoose = require('mongoose');

const callSessionSchema = new mongoose.Schema({
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  doctorName: { type: String, default: 'Doctor' },
  roomUrl: { type: String, required: true },
  scheduledDate: { type: String, required: true },
  scheduledTime: { type: String, required: true },
  transcript: [{
    author: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  }],
  summary: { type: String, default: 'No summary generated yet.' },
  clinicalNote: {
    text: { type: String, default: '' },
    generatedAt: { type: Date, default: null },
    model: { type: String, default: '' },
    source: { type: String, default: 'transcript' }
  },
  isRecorded: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CallSession', callSessionSchema);
