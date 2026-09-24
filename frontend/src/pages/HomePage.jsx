import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #ecfeff 0%, #eef2ff 45%, #fdf2f8 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '980px',
        background: '#ffffff',
        borderRadius: '28px',
        boxShadow: '0 24px 60px rgba(59, 130, 246, 0.12)',
        overflow: 'hidden'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
          color: '#fff',
          padding: '42px 32px 30px'
        }}>
          <div style={{ fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', opacity: 0.8 }}>Mental Health Platform</div>
          <h1 style={{ margin: '12px 0 10px', fontSize: '42px', lineHeight: 1.1 }}>A calmer way to care for your mental well-being.</h1>
          <p style={{ margin: 0, maxWidth: '620px', fontSize: '18px', opacity: 0.9 }}>
            Track mood, reflect daily, talk with an AI wellness companion, and connect with support whenever you need it.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px', padding: '32px' }}>
          <div style={cardStyle}>
            <div style={iconStyle}>🧠</div>
            <h3 style={titleStyle}>Patient Portal</h3>
            <p style={textStyle}>Register, log in, complete daily check-ins, and speak with a supportive AI companion.</p>
            <button style={primaryButtonStyle} onClick={() => navigate('/patient')}>Open Patient Portal</button>
          </div>

          <div style={cardStyle}>
            <div style={iconStyle}>👨‍⚕️</div>
            <h3 style={titleStyle}>Doctor Dashboard</h3>
            <p style={textStyle}>View patient risk bands, review daily reflections, and track appointments and progress.</p>
            <button style={secondaryButtonStyle} onClick={() => navigate('/doctor')}>Open Doctor Portal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '20px',
  padding: '26px 22px',
  textAlign: 'center'
};

const iconStyle = { fontSize: '42px', marginBottom: '10px' };
const titleStyle = { margin: '0 0 10px', color: '#0f172a', fontSize: '24px' };
const textStyle = { margin: '0 0 18px', color: '#475569', lineHeight: 1.6 };
const primaryButtonStyle = {
  width: '100%',
  border: 'none',
  borderRadius: '12px',
  padding: '12px 18px',
  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
};
const secondaryButtonStyle = {
  width: '100%',
  border: '1px solid #cbd5e1',
  borderRadius: '12px',
  padding: '12px 18px',
  background: '#fff',
  color: '#0f172a',
  fontWeight: 700,
  cursor: 'pointer'
};
