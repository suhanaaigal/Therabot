const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { demoNotifications } = require('../demoStore');
const { sendEmergencyAlert } = require('./alerts');

const createPatientAlert = async (patient, { band = 'Red', summaryText = '' } = {}) => {
  if (!['Red', 'Orange'].includes(band)) return null;

  const patientName = patient?.fullName || patient?.name || 'Patient';
  const isRed = band === 'Red';
  const message = isRed
    ? `Urgent alert: ${patientName} needs a clinician check-in. ${summaryText}`.trim()
    : `Follow-up alert: ${patientName} is currently in the Orange risk band. ${summaryText}`.trim();
  const smsResult = isRed ? await sendEmergencyAlert(patient) : { status: 'not_configured' };
  const notification = {
    patientId: String(patient?._id || patient?.id || ''),
    patientName,
    type: 'medical_alert',
    severity: isRed ? 'critical' : 'warning',
    message,
    alertStatus: smsResult.status,
    alertChannel: smsResult.channel || '',
    alertProviderId: smsResult.providerId || '',
    alertError: smsResult.error || '',
    alertAttemptedAt: smsResult.status === 'not_configured' ? null : new Date(),
    sentToDoctor: true
  };

  if (mongoose.connection.readyState === 1) return Notification.create(notification);
  const demoNotification = { ...notification, _id: `notif-${Date.now()}`, createdAt: new Date() };
  demoNotifications.unshift(demoNotification);
  return demoNotification;
};

module.exports = { createPatientAlert };
