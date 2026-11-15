const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  type: { type: String, enum: ['medical_alert', 'system', 'doctor_update'], default: 'medical_alert' },
  severity: { type: String, enum: ['critical', 'warning', 'info'], default: 'warning' },
  message: { type: String, required: true },
  alertStatus: { type: String, enum: ['not_configured', 'queued', 'sent', 'failed'], default: 'not_configured' },
  alertChannel: { type: String, default: '' },
  alertProviderId: { type: String, default: '' },
  alertError: { type: String, default: '' },
  alertAttemptedAt: { type: Date, default: null },
  sentToDoctor: { type: Boolean, default: true },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
