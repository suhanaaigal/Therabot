import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function TherabotAuthPage({ role }) {
  const isDoctor = role === 'doctor';
  const navigate = useNavigate();
  const [mode, setMode] = useState('new');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

      const response = mode === 'new'
        ? await api.post('/api/auth/register-simple', {
          fullName: form.fullName,
          email: form.email,
          age: Number(form.age),
          gender: form.gender,
          phoneNumber: form.phoneNumber,
          emergencyContact: form.emergencyContact,
          password: form.password
        })
        : await api.post('/api/auth/login', { email: form.email, password: form.password });
      localStorage.setItem('patientId', response.data.patientId);
      localStorage.setItem('patientName', response.data.patientName || form.fullName);
      navigate('/dashboard');
    } catch (requestError) {
      const serverMessage = requestError?.response?.data?.error;
      setError(serverMessage || requestError.message || 'We could not complete this request. Please try again.');
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
        <h2>{isDoctor ? 'Welcome back' : mode === 'new' ? 'Create your space' : 'Welcome back'}</h2>
        <p>{isDoctor ? 'Sign in to review your care workspace.' : mode === 'new' ? 'A few details to get your wellbeing space ready.' : 'Sign in to continue your wellbeing journey.'}</p>
        {!isDoctor && <div className="auth-toggle"><button className={mode === 'new' ? 'is-active' : ''} type="button" onClick={() => { setMode('new'); setError(''); }}>New patient</button><button className={mode === 'existing' ? 'is-active' : ''} type="button" onClick={() => { setMode('existing'); setError(''); }}>Returning</button></div>}
        <form className="auth-fields" onSubmit={handleSubmit}>
          {isDoctor ? <div className="form-field"><label htmlFor="doctor-user">Username</label><input id="doctor-user" autoComplete="username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required /></div>
            : <div className="form-field"><label htmlFor="patient-email">Email address</label><input id="patient-email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required /></div>}
          {!isDoctor && mode === 'new' && <div className="form-field"><label htmlFor="patient-name">Full name</label><input id="patient-name" autoComplete="name" placeholder="Your name" value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} required /></div>}
          {!isDoctor && mode === 'new' && <>
            <div className="form-grid"><div className="form-field"><label htmlFor="patient-age">Age</label><input id="patient-age" type="number" min="1" max="120" placeholder="Age" value={form.age} onChange={event => setForm({ ...form, age: event.target.value })} required /></div><div className="form-field"><label htmlFor="patient-gender">Gender</label><select id="patient-gender" value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })} required><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></div></div>
            <div className="form-field"><label htmlFor="patient-phone">Phone number</label><input id="patient-phone" type="tel" autoComplete="tel" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} title="Enter exactly 10 digits." placeholder="10-digit phone number" value={form.phoneNumber} onChange={event => setForm({ ...form, phoneNumber: event.target.value.replace(/\D/g, '').slice(0, 10) })} required /></div>
            <div className="form-field"><label htmlFor="patient-emergency">Emergency contact</label><input id="patient-emergency" placeholder="Contact name or number" value={form.emergencyContact} onChange={event => setForm({ ...form, emergencyContact: event.target.value })} required /></div>
          </>}
          <div className="form-field"><label htmlFor="account-password">Password</label><input id="account-password" type="password" minLength={!isDoctor && mode === 'new' ? 8 : undefined} maxLength={128} autoComplete={mode === 'new' && !isDoctor ? 'new-password' : 'current-password'} placeholder="Enter password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required /></div>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="action-button auth-submit" disabled={loading} type="submit">{loading ? 'Please wait…' : isDoctor ? 'Open clinician workspace →' : mode === 'new' ? 'Create patient space →' : 'Sign in →'}</button>
        </form>
        {isDoctor && <p className="demo-credentials">Demo access: <strong>doctor</strong> / <strong>doctor123</strong></p>}
        <button className="auth-home-link" type="button" onClick={() => navigate('/')}>← Back to Therabot home</button>
      </div></section>
    </main>
  );
}
