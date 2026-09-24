const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  type: { type: String, enum: ['medical_alert', 'system', 'doctor_update'], default: 'medical_alert' },
  severity: { type: String, enum: ['critical', 'warning', 'info'], default: 'warning' },
  message: { type: String, required: true },
  sentToEmergencyContact: { type: Boolean, default: false },
  sentToDoctor: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
