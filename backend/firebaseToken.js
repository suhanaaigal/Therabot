const crypto = require('node:crypto');

const CERTIFICATE_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certificateCache = { certificates: null, expiresAt: 0 };

const decodePart = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const getCertificates = async () => {
  if (certificateCache.certificates && certificateCache.expiresAt > Date.now()) {
    return certificateCache.certificates;
  }

  const response = await fetch(CERTIFICATE_URL);
  if (!response.ok) throw new Error('Could not load Firebase token verification certificates.');
  const certificates = await response.json();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 300);
  certificateCache = { certificates, expiresAt: Date.now() + maxAge * 1000 };
  return certificates;
};

const verifyFirebaseIdToken = async token => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Firebase authentication is not configured on the backend.');

  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Firebase ID token.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Firebase token signature.');
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase token was issued for a different project.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || payload.sub.length > 128 || !payload.exp || payload.exp <= now || !payload.iat || payload.iat > now + 60 || !payload.auth_time || payload.auth_time > now + 60) {
    throw new Error('Firebase ID token is expired or invalid.');
  }

  const certificates = await getCertificates();
  const certificate = certificates[header.kid];
  if (!certificate) throw new Error('Firebase token signing key was not recognized.');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  if (!verifier.verify(certificate, Buffer.from(encodedSignature, 'base64url'))) {
    throw new Error('Firebase token signature is invalid.');
  }
  return payload;
};

module.exports = { verifyFirebaseIdToken };