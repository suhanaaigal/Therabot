const crypto = require('crypto');

const signingKey = () => process.env.DOCTOR_AUTH_SECRET || process.env.MONGO_URI || 'therabot-local-doctor-session-key';

const signDoctorSession = doctorId => {
  const payload = Buffer.from(JSON.stringify({ sub: String(doctorId), kind: 'doctor', exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 })).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const verifyDoctorSession = token => {
  if (typeof token !== 'string') return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;

  const expectedSignature = crypto.createHmac('sha256', signingKey()).update(payload).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.sub || (session.kind && session.kind !== 'doctor') || !Number.isFinite(session.exp) || session.exp <= Date.now() / 1000) {
      return null;
    }
    return { doctorId: String(session.sub) };
  } catch {
    return null;
  }
};

const requireDoctorSession = (req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = verifyDoctorSession(token);
  if (!session) return res.status(401).json({ error: 'Doctor session is invalid or expired. Sign in again.' });
  req.doctorId = session.doctorId;
  return next();
};

module.exports = { signDoctorSession, verifyDoctorSession, requireDoctorSession };
