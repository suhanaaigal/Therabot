import React, { useState } from 'react';
import { api } from '../api';
import MindRelief from '../components/MindRelief';
import ChatRoom from '../components/ChatRoom';
import AppointmentBooking from '../components/AppointmentBooking';

const sections = ['Home', 'Check-in', 'Mind Relief', 'Appointments', 'AI Companion'];

export default function PatientDashboard() {
  const [activeSection, setActiveSection] = useState('Home');
  const [form, setForm] = useState({
    sleepHours: '',
    moodScore: '',
    anxietyLevel: '',
    journalText: ''
  });
  const [resultBand, setResultBand] = useState(null);
  const patientId = localStorage.getItem('patientId') || 'demo-patient-room';
  const patientName = localStorage.getItem('patientName') || 'Patient';

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/patient/checkin', {
        patientId,
        ...form
      });
      setResultBand(res.data.band);
      alert(`Check-in submitted! Status Band: ${res.data.band}`);
    } catch (err) {
      alert(err?.response?.data?.error || 'Error submitting check-in');
    }
  };

  const renderSection = () => {
    if (activeSection === 'Home') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          <FeatureCard title="Daily Check-in" description="Track sleep, mood, and anxiety in a few seconds." action={() => setActiveSection('Check-in')} color="#3b82f6" />
          <FeatureCard title="Schedule Visit" description="Request a consultation with your doctor in a simple flow." action={() => setActiveSection('Appointments')} color="#14b8a6" />
          <FeatureCard title="AI Companion" description="Chat with a supportive AI guide for emotional check-ins." action={() => setActiveSection('AI Companion')} color="#8b5cf6" />
          <FeatureCard title="Mind Relief" description="Access guided grounding and calming exercises." action={() => setActiveSection('Mind Relief')} color="#f59e0b" />
        </div>
      );
    }

    if (activeSection === 'Check-in') {
      return (
        <div style={cardStyle}>
          <h3 style={sectionTitleStyle}>Daily Check-In</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Hours slept last night</label>
              <input style={inputStyle} type="number" step="0.5" value={form.sleepHours} onChange={e => setForm({ ...form, sleepHours: e.target.value })} required />
            </div>

            <div>
              <label style={labelStyle}>Mood score (1 = worst, 10 = best)</label>
              <input style={inputStyle} type="number" min="1" max="10" value={form.moodScore} onChange={e => setForm({ ...form, moodScore: e.target.value })} required />
            </div>

            <div>
              <label style={labelStyle}>Anxiety level (1 = low, 10 = severe)</label>
              <input style={inputStyle} type="number" min="1" max="10" value={form.anxietyLevel} onChange={e => setForm({ ...form, anxietyLevel: e.target.value })} required />
            </div>

            <div>
              <label style={labelStyle}>Journal / reflection</label>
              <textarea style={{ ...inputStyle, minHeight: '110px', resize: 'vertical' }} value={form.journalText} onChange={e => setForm({ ...form, journalText: e.target.value })} />
            </div>

            <button type="submit" style={primaryButtonStyle}>Submit Daily Check-In</button>
          </form>

          {resultBand && (
            <div style={{
              marginTop: '18px',
              borderRadius: '14px',
              padding: '16px 18px',
              background: resultBand === 'Red' ? '#ffe6e6' : resultBand === 'Orange' ? '#fff0d9' : resultBand === 'Yellow' ? '#fff9d9' : '#e8f7ea',
              color: '#1d3557',
              fontWeight: '700'
            }}>
              Current risk band: <span style={{ color: resultBand === 'Red' ? '#d62f2f' : resultBand === 'Orange' ? '#d88400' : resultBand === 'Yellow' ? '#b88b00' : '#1d9a5f' }}>{resultBand}</span>
            </div>
          )}
        </div>
      );
    }

    if (activeSection === 'Mind Relief') {
      return (
        <div style={{ display: 'grid', gap: '20px' }}>
          <MindRelief />
        </div>
      );
    }

    if (activeSection === 'Appointments') {
      return (
        <div style={{ display: 'grid', gap: '20px' }}>
          <AppointmentBooking patientName={patientName} />
        </div>
      );
    }

    return (
      <div style={{ display: 'grid', gap: '20px' }}>
        <ChatRoom roomId={patientId} senderName={patientName} mode="ai" />
      </div>
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #eaf6ff 0%, #eefaf5 100%)',
      padding: '24px 18px'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          background: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 12px 32px rgba(31, 41, 55, 0.08)',
          padding: '22px 24px',
          marginBottom: '24px'
        }}>
          <div>
            <div style={{ fontSize: '12px', color: '#5085d8', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase' }}>Patient Portal</div>
            <h2 style={{ margin: '8px 0 0', color: '#1d3557' }}>Welcome, {patientName}</h2>
          </div>

          <div style={{
            background: '#edf5ff',
            color: '#2357ad',
            borderRadius: '999px',
            padding: '10px 16px',
            fontWeight: '700'
          }}>
            Mental Wellness Dashboard
          </div>
        </header>

        <nav style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          background: '#ffffff',
          borderRadius: '18px',
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.06)',
          padding: '12px',
          marginBottom: '24px'
        }}>
          {sections.map(section => (
            <button
              key={section}
              type="button"
              onClick={() => setActiveSection(section)}
              style={{
                border: 'none',
                borderRadius: '12px',
                padding: '12px 18px',
                background: activeSection === section ? '#1d4ed8' : '#f3f7ff',
                color: activeSection === section ? '#ffffff' : '#1f2937',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {section}
            </button>
          ))}
        </nav>

        {renderSection()}
      </div>
    </div>
  );
}

function FeatureCard({ title, description, action, color }) {
  return (
    <button type="button" onClick={action} style={{
      textAlign: 'left',
      border: 'none',
      borderRadius: '20px',
      padding: '22px 18px',
      background: `linear-gradient(135deg, ${color}, #ffffff)`,
      color: '#0f172a',
      boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
      cursor: 'pointer',
      minHeight: '160px'
    }}>
      <div style={{ fontSize: '12px', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase', color: '#334155' }}>Quick Access</div>
      <h3 style={{ margin: '12px 0 8px', fontSize: '22px' }}>{title}</h3>
      <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#334155' }}>{description}</div>
    </button>
  );
}

const pageGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1.1fr 0.9fr',
  gap: '20px'
};

const cardStyle = {
  background: '#fff',
  borderRadius: '20px',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
  padding: '22px 20px'
};

const sectionTitleStyle = { marginTop: 0, color: '#17375d', fontSize: '26px' };
const labelStyle = { display: 'block', marginBottom: '8px', color: '#334155', fontWeight: '600', fontSize: '14px' };
const inputStyle = {
  width: '100%',
  border: '1px solid #dfe7f3',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '15px',
  boxSizing: 'border-box',
  background: '#fbfdff'
};
const primaryButtonStyle = {
  border: 'none',
  borderRadius: '12px',
  padding: '12px 16px',
  background: 'linear-gradient(135deg, #2a9d8f, #3b82f6)',
  color: '#fff',
  fontWeight: '700',
  cursor: 'pointer'
};