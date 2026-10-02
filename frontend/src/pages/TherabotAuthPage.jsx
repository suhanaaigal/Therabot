import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { firebaseSignIn, firebaseSignUp, linkFirebasePatientProfile, sendFirebaseEmailVerification, sendFirebasePasswordReset } from '../firebaseAuth';

export default function TherabotAuthPage({ role }) {
  const isDoctor = role === 'doctor';
  const navigate = useNavigate();
  const [mode, setMode] = useState('new');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: 'doctor', email: '', phoneNumber: '', age: '', gender: '', emergencyContact: '', password: isDoctor ? 'doctor123' : '' });

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (isDoctor) {
        const response = await api.post('/api/auth/doctor-login', { username: form.username, password: form.password });
        localStorage.setItem('doctorAuthId', response.data.doctorId || '');
        localStorage.setItem('doctorId', response.data.doctorId || '');
        localStorage.setItem('doctorName', response.data.doctorName || 'Dr. Suhana Aigal');
        localStorage.setItem('doctorUsername', response.data.username || form.username);
        localStorage.setItem('doctorSessionToken', response.data.doctorSessionToken || '');
        localStorage.setItem('isDoctorAuthenticated', 'true');
        navigate('/doctor-dashboard');
        return;
      }

      if (mode === 'forgot') {
        await sendFirebasePasswordReset(form.email);
        setResetSent(true);
        return;
      }

      let firebaseUser;
      if (mode === 'new') {
        firebaseUser = await firebaseSignUp(form.email, form.password);
        await sendFirebaseEmailVerification(firebaseUser.idToken);
        const pendingProfile = {
          fullName: form.fullName,
          age: Number(form.age),
          gender: form.gender,
          phoneNumber: form.phoneNumber,
          emergencyContact: form.emergencyContact
        };
        localStorage.setItem(`therabot-pending-profile:${form.email.toLowerCase()}`, JSON.stringify(pendingProfile));
        setMode('existing');
        setForm(current => ({ ...current, password: '' }));
        setNotice('We sent a verification link to your email. Open it, then return here and sign in to finish setting up your patient profile.');
        return;
      } else {
        try {
          firebaseUser = await firebaseSignIn(form.email, form.password);
        } catch (firebaseError) {
          if (!['EMAIL_NOT_FOUND', 'INVALID_LOGIN_CREDENTIALS'].includes(firebaseError.code)) throw firebaseError;
          await api.post('/api/auth/login', { email: form.email, password: form.password });
          firebaseUser = await firebaseSignUp(form.email, form.password);
          await sendFirebaseEmailVerification(firebaseUser.idToken);
          setForm(current => ({ ...current, password: '' }));
          setNotice('We sent a verification link to your email. Open it, then return here and sign in again to finish moving your account to Firebase.');
          return;
        }
      }

      const pendingKey = `therabot-pending-profile:${form.email.toLowerCase()}`;
      const pendingProfile = JSON.parse(localStorage.getItem(pendingKey) || '{}');
      const profileDetails = mode === 'complete' ? {
        fullName: form.fullName,
        age: Number(form.age),
        gender: form.gender,
        phoneNumber: form.phoneNumber,
        emergencyContact: form.emergencyContact
      } : pendingProfile;
      let profile;
      try {
        profile = await linkFirebasePatientProfile(firebaseUser.idToken, profileDetails);
      } catch (profileError) {
        if (profileError.message.includes('Verify your email')) {
          await sendFirebaseEmailVerification(firebaseUser.idToken);
          setNotice('Your email is not verified yet. We sent another verification link; open it, then sign in again.');
          setForm(current => ({ ...current, password: '' }));
          return;
        }
        if (mode === 'existing' && profileError.message.includes('Patient profile details are required')) {
          setMode('complete');
          setNotice('Your sign-in worked, but your patient profile is missing. Enter your details below to restore it.');
          return;
        }
        throw profileError;
      }
      localStorage.removeItem(pendingKey);
      localStorage.setItem('patientId', profile.patientId);
      localStorage.setItem('patientName', profile.patientName || form.fullName);
      navigate('/dashboard');
    } catch (requestError) {
      const status = requestError?.response?.status;
      const serverMessage = requestError?.response?.data?.error;
      setError(serverMessage || requestError.message || (status === 404 ? 'Patient account was not found.' : 'We could not complete this request. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <button className="brand-lockup" type="button" onClick={() => navigate('/')} aria-label="Therabot home"><span className="brand-mark">t</span><span className="brand-name">therabot<span>.</span></span></button>
        <div className="auth-aside-copy"><span className="hero-kicker">{isDoctor ? 'Connected care' : 'A space for you'}</span><h1>{isDoctor ? 'Care starts with a clearer picture.' : 'You can begin exactly where you are.'}</h1><p>{isDoctor ? 'Review patient wellbeing, coordinate appointments and keep consultation notes together.' : 'Check in with yourself, find support and keep your care journey in one thoughtful place.'}</p></div>
        <small className="auth-footnote">Therabot · thoughtful tools for mental wellbeing</small>
      </aside>
      <section className="auth-form-side"><div className="auth-form-wrap">
        <p className="page-eyebrow">{isDoctor ? 'Clinician workspace' : 'Patient space'}</p>
        <h2>{isDoctor ? 'Welcome back' : mode === 'new' ? 'Create your space' : mode === 'complete' ? 'Restore your patient profile' : mode === 'forgot' ? 'Recover your account' : 'Welcome back'}</h2>
        <p>{isDoctor ? 'Sign in to review your care workspace.' : mode === 'new' ? 'A few details to get your wellbeing space ready.' : mode === 'complete' ? 'Your sign-in is ready. Add your details to reconnect your care profile.' : mode === 'forgot' ? 'Firebase will email a secure link to choose a new password.' : 'Sign in to continue your wellbeing journey.'}</p>
        {!isDoctor && ['new', 'existing'].includes(mode) && <div className="auth-toggle"><button className={mode === 'new' ? 'is-active' : ''} type="button" onClick={() => { setMode('new'); setError(''); setNotice(''); setResetSent(false); }}>New patient</button><button className={mode === 'existing' ? 'is-active' : ''} type="button" onClick={() => { setMode('existing'); setError(''); setNotice(''); setResetSent(false); }}>Returning</button></div>}
        <form className="auth-fields" onSubmit={handleSubmit}>
          {isDoctor ? <div className="form-field"><label htmlFor="doctor-user">Username</label><input id="doctor-user" autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required /></div>
            : <div className="form-field"><label htmlFor="patient-email">Email address</label><input id="patient-email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required /></div>}
          {!isDoctor && ['new', 'complete'].includes(mode) && <div className="form-field"><label htmlFor="patient-name">Full name</label><input id="patient-name" autoComplete="name" placeholder="Your name" value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} required /></div>}
          {!isDoctor && ['new', 'complete'].includes(mode) && <>
            <div className="form-grid"><div className="form-field"><label htmlFor="patient-age">Age</label><input id="patient-age" type="number" min="1" max="120" placeholder="Age" value={form.age} onChange={event => setForm({ ...form, age: event.target.value })} required /></div><div className="form-field"><label htmlFor="patient-gender">Gender</label><select id="patient-gender" value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })} required><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></div></div>
            <div className="form-field"><label htmlFor="patient-phone">Phone number</label><input id="patient-phone" type="tel" autoComplete="tel" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} title="Enter exactly 10 digits." placeholder="10-digit phone number" value={form.phoneNumber} onChange={event => setForm({ ...form, phoneNumber: event.target.value.replace(/\D/g, '').slice(0, 10) })} required /></div>
            <div className="form-field"><label htmlFor="patient-emergency">Emergency contact</label><input id="patient-emergency" placeholder="Contact name or number" value={form.emergencyContact} onChange={event => setForm({ ...form, emergencyContact: event.target.value })} required /></div>
          </>}
          {(isDoctor || mode !== 'forgot') && <div className="form-field"><label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={mode === 'new' && !isDoctor ? 'new-password' : 'current-password'} placeholder="Enter password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required /></div>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {notice && <div className="success-banner" role="status">{notice}</div>}
          {resetSent && <div className="success-banner" role="status">If a Firebase account exists for this email, a reset link has been sent. Open it to choose a new password.</div>}
          <button className="action-button auth-submit" disabled={loading || (mode === 'forgot' && resetSent)} type="submit">{loading ? 'Please wait…' : isDoctor ? 'Open clinician workspace →' : mode === 'forgot' ? 'Send reset link →' : mode === 'new' ? 'Create patient space →' : mode === 'complete' ? 'Restore patient profile →' : 'Sign in →'}</button>
        </form>
        {!isDoctor && mode === 'existing' && <button className="auth-home-link forgot-link" type="button" onClick={() => { setMode('forgot'); setError(''); setResetSent(false); }}>Forgot password?</button>}
        {!isDoctor && mode === 'forgot' && <button className="auth-home-link forgot-link" type="button" onClick={() => { setMode('existing'); setError(''); setResetSent(false); }}>Back to sign in</button>}
        {isDoctor && <p className="demo-credentials">Demo access: <strong>doctor</strong> / <strong>doctor123</strong></p>}
        <button className="auth-home-link" type="button" onClick={() => navigate('/')}>← Back to Therabot home</button>
      </div></section>
    </main>
  );
}
