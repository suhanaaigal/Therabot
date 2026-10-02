const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const HASH_VERSION = 'scrypt-v1';
const KEY_LENGTH = 64;

const constantTimeTextEqual = (first, second) => {
  const firstHash = crypto.createHash('sha256').update(String(first)).digest();
  const secondHash = crypto.createHash('sha256').update(String(second)).digest();
  return crypto.timingSafeEqual(firstHash, secondHash);
};

const hashPatientPassword = async password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(String(password), salt, KEY_LENGTH);
  return `${HASH_VERSION}$${salt}$${derivedKey.toString('hex')}`;
};

const verifyPatientPassword = async (password, storedPassword) => {
  if (typeof storedPassword !== 'string' || !storedPassword) {
    return { isValid: false, needsRehash: false };
  }

  const [version, salt, expectedHex, extraPart] = storedPassword.split('$');
  if (version !== HASH_VERSION) {
    return {
      isValid: constantTimeTextEqual(password, storedPassword),
      needsRehash: true
    };
  }

  if (extraPart || !/^[a-f\d]{32}$/i.test(salt || '') || !/^[a-f\d]{128}$/i.test(expectedHex || '')) {
    return { isValid: false, needsRehash: false };
  }

  const expectedKey = Buffer.from(expectedHex, 'hex');
  const actualKey = await scrypt(String(password), salt, KEY_LENGTH);
  return {
    isValid: crypto.timingSafeEqual(actualKey, expectedKey),
    needsRehash: false
  };
};

module.exports = { hashPatientPassword, verifyPatientPassword };