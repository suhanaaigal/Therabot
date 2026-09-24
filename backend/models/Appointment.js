const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  doctorId: { type: String, default: '' },
  doctorName: { type: String, default: 'Doctor' },
  scheduledDate: { type: String, required: true },
  scheduledTime: { type: String, required: true },
  urgency: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], default: 'Routine' },
  status: { type: String, enum: ['Pending', 'Approved', 'Declined', 'Completed', 'Cancelled'], default: 'Pending' },
  roomUrl: { type: String, default: '' },
  callStarted: { type: Boolean, default: false },
  callEnded: { type: Boolean, default: false },
  approvedAt: { type: Date, default: null },
  declinedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Appointment', appointmentSchema);