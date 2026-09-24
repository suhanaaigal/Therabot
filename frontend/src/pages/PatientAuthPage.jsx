import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function PatientAuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('new');
  const [form, setForm] = useState({
    fullName: '',
    phoneNumber: '',
    age: '',
    gender: '',
    emergencyContact: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'new') {
        const payload = {
          fullName: form.fullName,
          age: Number(form.age),
          gender: form.gender,
          phoneNumber: form.phoneNumber,
          emergencyContact: form.emergencyContact,
          password: form.password
        };

        const res = await api.post('/api/auth/register-simple', payload);
        localStorage.setItem('patientId', res.data.patientId || 'demo-patient-id');
        localStorage.setItem('patientName', res.data.patientName || form.fullName);
        alert('Account created successfully!');
        navigate('/dashboard');
      } else {
        const res = await api.post('/api/auth/login', {
          fullName: form.fullName,
          password: form.password
        });

        localStorage.setItem('patientId', res.data.patientId || 'demo-patient-id');
        localStorage.setItem('patientName', res.data.patientName || form.fullName);
        alert('Login successful!');
        navigate('/dashboard');
      }
    } catch (err) {
      alert(err?.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px',
      background: 'linear-gradient(135deg, #f0fdfa 0%, #eff6ff 60%, #fdf2f8 100%)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '520px',
        background: '#fff',
        borderRadius: '24px',
        boxShadow: '0 20px 60px rgba(37, 99, 235, 0.12)',
        padding: '28px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', letterSpacing: '1.8px', textTransform: 'uppercase', color: '#3b82f6', fontWeight: '700' }}>Patient Access</div>
          <h2 style={{ margin: '10px 0 8px', color: '#0f172a' }}>Welcome</h2>
          <p style={{ margin: 0, color: '#475569' }}>Choose whether you are a new patient or returning user.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', background: '#f8fafc', padding: '6px', borderRadius: '12px' }}>
          <button
            type="button"
            onClick={() => setMode('new')}
            style={{
              flex: 1,
              border: 'none',
              borderRadius: '10px',
              padding: '12px 14px',
              background: mode === 'new' ? '#2563eb' : 'transparent',
              color: mode === 'new' ? '#fff' : '#334155',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            New User
          </button>
          <button
            type="button"
            onClick={() => setMode('existing')}
            style={{
              flex: 1,
              border: 'none',
              borderRadius: '10px',
              padding: '12px 14px',
              background: mode === 'existing' ? '#7c3aed' : 'transparent',
              color: mode === 'existing' ? '#fff' : '#334155',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Existing User
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
          <input
            style={inputStyle}
            type="text"
            placeholder="Full Name"
            value={form.fullName}
            onChange={e => setForm({ ...form, fullName: e.target.value })}
            required
          />

          {mode === 'new' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <input style={inputStyle} type="number" placeholder="Age" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })} required />
                <select style={inputStyle} value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} required>
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <input style={inputStyle} type="text" placeholder="Phone Number" value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} required />
              <input style={inputStyle} type="text" placeholder="Emergency Contact" value={form.emergencyContact} onChange={e => setForm({ ...form, emergencyContact: e.target.value })} required />
            </>
          )}

          <input
            style={inputStyle}
            type="password"
            placeholder="Set / Enter Password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            required
          />

          <button type="submit" disabled={loading} style={primaryButtonStyle}>
            {loading ? 'Please wait...' : mode === 'new' ? 'Create Account' : 'Login'}
          </button>
        </form>

        <button type="button" onClick={() => navigate('/')} style={{ marginTop: '18px', width: '100%', border: '1px solid #dbeafe', background: '#fff', borderRadius: '12px', padding: '11px', cursor: 'pointer', color: '#1e3a8a', fontWeight: 700 }}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  border: '1px solid #dfe7f3',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '15px',
  boxSizing: 'border-box',
  outline: 'none'
};

const primaryButtonStyle = {
  border: 'none',
  borderRadius: '12px',
  padding: '12px 14px',
  background: 'linear-gradient(135deg, #0ea5e9, #7c3aed)',
  color: '#fff',
  fontWeight: '700',
  cursor: 'pointer'
};
