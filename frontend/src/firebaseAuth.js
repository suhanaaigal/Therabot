import { backendUrl } from './api';

const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';

const ensureConfigured = () => {
  if (!API_KEY || !PROJECT_ID) {
    throw new Error('Firebase Auth is not configured. Add VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID to the frontend environment.');
  }
};

const firebaseRequest = async (method, body) => {
  ensureConfigured();
  const response = await fetch(`${IDENTITY_TOOLKIT}/${method}?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = result.error?.message || 'UNKNOWN_ERROR';
    const messages = {
      EMAIL_EXISTS: 'An account with this email already exists. Choose Returning to sign in.',
      EMAIL_NOT_FOUND: 'No Firebase account exists for this email yet.',
      INVALID_LOGIN_CREDENTIALS: 'Email or password is incorrect.',
      INVALID_PASSWORD: 'Password is incorrect.',
      WEAK_PASSWORD: 'Choose a password with at least 6 characters.',
      INVALID_EMAIL: 'Enter a valid email address.',
      USER_DISABLED: 'This account has been disabled. Contact the care team.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Email or password is incorrect. Please try again.',
      RESET_PASSWORD_EXCEED_LIMIT: 'Please try again in a little while.',
      OPERATION_NOT_ALLOWED: 'Email and password sign-in is not enabled in Firebase Authentication.'
    };
    const error = new Error(messages[code] || `Firebase Authentication error: ${code}`);
    error.code = code;
    throw error;
  }
  return result;
};

export const firebaseSignUp = (email, password) => firebaseRequest('accounts:signUp', {
  email: email.trim().toLowerCase(),
  password,
  returnSecureToken: true
});

export const firebaseSignIn = (email, password) => firebaseRequest('accounts:signInWithPassword', {
  email: email.trim().toLowerCase(),
  password,
  returnSecureToken: true
});

export const sendFirebaseEmailVerification = idToken => firebaseRequest('accounts:sendOobCode', {
  requestType: 'VERIFY_EMAIL',
  idToken
});

export const sendFirebasePasswordReset = async email => {
  try {
    return await firebaseRequest('accounts:sendOobCode', {
      requestType: 'PASSWORD_RESET',
      email: email.trim().toLowerCase()
    });
  } catch (error) {
    if (error.code === 'EMAIL_NOT_FOUND' || error.code === 'USER_NOT_FOUND') return {};
    throw error;
  }
};

export const linkFirebasePatientProfile = async (idToken, profile = {}) => {
  const response = await fetch(`${backendUrl}/api/auth/firebase-profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(profile)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not load your patient profile.');
  return result;
};
