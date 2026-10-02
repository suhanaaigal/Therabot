const crypto = require('crypto');

const signingKey = () => process.env.DOCTOR_AUTH_SECRET || process.env.MONGO_URI || 'therabot-local-doctor-session-key';

const signDoctorSession = doctorId => {
  const payload = Buffer.from(JSON.stringify({ sub: String(doctorId), exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 })).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const requireDoctorSession = (req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return res.status(401).json({ error: 'Doctor sign-in is required.' });

  const expectedSignature = crypto.createHmac('sha256', signingKey()).update(payload).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return res.status(401).json({ error: 'Doctor session is invalid. Sign in again.' });
  }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    return res.status(401).json({ error: 'Doctor session is invalid. Sign in again.' });
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.sub || !Number.isFinite(session.exp) || session.exp <= Date.now() / 1000) {
      return res.status(401).json({ error: 'Doctor session expired. Sign in again.' });
    }
    req.doctorId = session.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Doctor session is invalid. Sign in again.' });
  }
};

module.exports = { signDoctorSession, requireDoctorSession };
