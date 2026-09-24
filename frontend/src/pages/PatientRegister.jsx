import React, { useState } from 'react';
import { api } from '../api';

export default function PatientRegister() {
  const [form, setForm] = useState({ fullName: '', age: '', gender: '', phoneNumber: '', emergencyContact: '' });
  const [step, setStep] = useState(1);
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/auth/register', form);
      if (res.data.demoOtp) {
        setDemoOtp(res.data.demoOtp);
        alert(`Demo OTP: ${res.data.demoOtp}`);
      } else {
        alert('OTP sent to your phone!');
      }
      setStep(2);
    } catch (err) {
      alert(err?.response?.data?.error || 'Error sending OTP');
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/auth/verify-otp', { phoneNumber: form.phoneNumber, otpCode: otp });
      localStorage.setItem('patientId', res.data.patientId);
      localStorage.setItem('patientName', res.data.patientName || form.fullName);
      alert('Login Successful!');
      window.location.href = '/dashboard';
    } catch (err) {
      alert(err?.response?.data?.error || 'Invalid OTP');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #eff9ff 0%, #f8f1ff 100%)',
      padding: '32px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        background: '#ffffff',
        borderRadius: '20px',
        boxShadow: '0 18px 40px rgba(65, 92, 186, 0.12)',
        padding: '32px 28px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '18px' }}>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#1d3557' }}>MHM Platform</div>
          <div style={{ color: '#4a5d75', marginTop: '8px' }}>Patient Registration & Verification</div>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRegister} style={{ display: 'grid', gap: '14px' }}>
            <input style={inputStyle} type="text" placeholder="Full Name" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} required />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <input style={inputStyle} type="number" placeholder="Age" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })} required />
              <select style={inputStyle} value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} required>
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <input style={inputStyle} type="text" placeholder="Phone Number (+91...)" value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} required />
            <input style={inputStyle} type="text" placeholder="Emergency Contact" value={form.emergencyContact} onChange={e => setForm({ ...form, emergencyContact: e.target.value })} required />
            <button type="submit" style={primaryButtonStyle}>Register & Send OTP</button>
          </form>
        ) : (
          <form onSubmit={handleVerify} style={{ display: 'grid', gap: '14px' }}>
            <div style={{ background: '#f3f7ff', border: '1px solid #dfe9ff', borderRadius: '10px', padding: '12px', color: '#324d7a' }}>
              {demoOtp ? <strong>Demo OTP:</strong> : <strong>OTP sent to your phone.</strong>} {demoOtp || 'Please enter the 6-digit code.'}
            </div>
            <input
              style={inputStyle}
              type="text"
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              required
            />
            <button type="submit" style={primaryButtonStyle}>Verify OTP</button>
            <button type="button" onClick={() => setStep(1)} style={secondaryButtonStyle}>Edit details</button>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  border: '1px solid #dfe7f3',
  borderRadius: '10px',
  padding: '12px 14px',
  fontSize: '15px',
  boxSizing: 'border-box',
  outline: 'none'
};

const primaryButtonStyle = {
  border: 'none',
  borderRadius: '10px',
  padding: '12px 14px',
  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  color: '#fff',
  fontSize: '15px',
  fontWeight: '700',
  cursor: 'pointer'
};

const secondaryButtonStyle = {
  border: '1px solid #dfe7f3',
  borderRadius: '10px',
  padding: '12px 14px',
  background: '#fff',
  color: '#1d3557',
  fontSize: '15px',
  fontWeight: '600',
  cursor: 'pointer'
};