const twilio = require('twilio');

const getAlertStatus = providerStatus => {
  if (['sent', 'delivered', 'read'].includes(providerStatus)) return 'sent';
  if (['accepted', 'scheduled', 'queued', 'sending'].includes(providerStatus)) return 'queued';
  return 'failed';
};

const sendEmergencyAlert = async patient => {
  const phone = String(patient?.emergencyContactPhone || '').trim();
  if (!patient?.emergencyContactConsent || !phone || !process.env.TWILIO_SID || !process.env.TWILIO_TOKEN || !process.env.TWILIO_FROM) {
    return { status: 'not_configured' };
  }

  try {
    const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    const message = await client.messages.create({
      body: `Therabot: ${patient.fullName || 'Someone you care about'} may need support right now. Please check in with them.`,
      from: process.env.TWILIO_FROM,
      to: phone
    });
    const status = getAlertStatus(message.status);
    return {
      status,
      channel: 'sms',
      providerId: message.sid,
      ...(status === 'failed' ? { error: `Twilio message ended with status: ${message.status || 'unknown'}` } : {})
    };
  } catch (error) {
    return { status: 'failed', channel: 'sms', error: String(error.message || 'SMS provider error').slice(0, 300) };
  }
};

module.exports = { sendEmergencyAlert, getAlertStatus };
