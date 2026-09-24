import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function DoctorAuthPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: 'doctor', password: 'doctor123' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await api.post('/api/auth/doctor-login', form);
      localStorage.setItem('doctorAuthId', res.data.doctorId || '');
      localStorage.setItem('doctorId', res.data.doctorId || '');
      localStorage.setItem('doctorName', res.data.doctorName || 'Doctor');
      localStorage.setItem('doctorUsername', res.data.username || form.username);
      localStorage.setItem('isDoctorAuthenticated', 'true');
      navigate('/doctor-dashboard');
    } catch (err) {
      alert(err?.response?.data?.error || 'Doctor login failed');
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
      background: 'linear-gradient(135deg, #eef2ff 0%, #ecfeff 100%)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        background: '#fff',
        boxShadow: '0 20px 60px rgba(79, 70, 229, 0.12)',
        borderRadius: '22px',
        padding: '30px 26px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <div style={{ fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#4f46e5', fontWeight: '700' }}>Doctor Access</div>
          <h2 style={{ margin: '10px 0 8px', color: '#0f172a' }}>Clinical Login</h2>
          <p style={{ margin: 0, color: '#475569' }}>Secure access to patient health data.</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'grid', gap: '14px' }}>
          <input
            type="text"
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="Doctor Username"
            style={inputStyle}
            required
          />
          <input
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            placeholder="Password"
            style={inputStyle}
            required
          />
          <button type="submit" disabled={loading} style={primaryButtonStyle}>
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>

        <div style={{ marginTop: '18px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px 12px', color: '#334155' }}>
          Demo doctor account: <strong>doctor</strong> / <strong>doctor123</strong>
        </div>
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
  boxSizing: 'border-box'
};

const primaryButtonStyle = {
  border: 'none',
  borderRadius: '12px',
  padding: '12px 16px',
  background: 'linear-gradient(135deg, #4f46e5, #0ea5e9)',
  color: '#fff',
  fontWeight: '700',
  cursor: 'pointer'
};
