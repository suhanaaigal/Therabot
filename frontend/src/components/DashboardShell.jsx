import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function DashboardShell({ role, name, active, onNavigate, items, children }) {
  const navigate = useNavigate();
  const profileRef = useRef(null);
  const initials = String(name || 'Patient').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({
    fullName: name || 'Patient',
    email: '',
    age: '',
    gender: '',
    phoneNumber: '',
    emergencyContact: ''
  });

  useEffect(() => {
    if (role !== 'Patient') return;

    let activeRequest = true;
    api.get('/api/patient/profile')
      .then(response => {
        if (!activeRequest) return;
        const nextProfile = response.data || {};
        setProfile({
          fullName: nextProfile.fullName || name || 'Patient',
          email: nextProfile.email || '',
          age: nextProfile.age ?? '',
          gender: nextProfile.gender || '',
          phoneNumber: nextProfile.phoneNumber || '',
          emergencyContact: nextProfile.emergencyContact || ''
        });
      })
      .catch(() => {
        if (!activeRequest) return;
        setProfile({
          fullName: name || 'Patient',
          email: '',
          age: '',
          gender: '',
          phoneNumber: '',
          emergencyContact: ''
        });
      });

    return () => {
      activeRequest = false;
    };
  }, [name, role]);

  useEffect(() => {
    if (!profileOpen) return;

    const handlePointerDown = event => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = event => {
      if (event.key === 'Escape') setProfileOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen]);

  const signOut = () => {
    if (role === 'Doctor') {
      localStorage.removeItem('isDoctorAuthenticated');
      localStorage.removeItem('doctorSessionToken');
      navigate('/doctor');
      return;
    }
    localStorage.removeItem('patientId');
    localStorage.removeItem('patientName');
    localStorage.removeItem('patientSessionToken');
    localStorage.removeItem('assignedDoctorId');
    navigate('/patient');
  };

  const profileContent = (
    <div className="topbar-profile-wrap" ref={profileRef}>
      <button className="topbar-profile" type="button" onClick={() => setProfileOpen(current => !current)} aria-expanded={profileOpen} aria-label={profileOpen ? 'Hide patient details' : `Show details for ${profile.fullName}`}>
        <span className="avatar-badge">{initials || 'T'}</span>
        <span className="profile-name">{name}</span>
      </button>
      {profileOpen && (
        <div className="profile-card" role="dialog" aria-label="Patient details">
          <div className="profile-card-header">
            <span className="avatar-badge profile-card-avatar">{initials || 'T'}</span>
            <div>
              <strong>{profile.fullName}</strong>
              <span>{profile.email || 'No email linked'}</span>
            </div>
          </div>
          <dl className="profile-details">
            <div><dt>Age</dt><dd>{profile.age || 'Not provided'}</dd></div>
            <div><dt>Gender</dt><dd>{profile.gender || 'Not provided'}</dd></div>
            <div><dt>Phone</dt><dd>{profile.phoneNumber || 'Not provided'}</dd></div>
            <div><dt>Emergency</dt><dd>{profile.emergencyContact || 'Not provided'}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );

  return (
    <div className={`app-shell ${role.toLowerCase()}-shell`}>
      <aside className="side-rail">
        <button className="brand-lockup" type="button" onClick={() => navigate('/')} aria-label="Therabot home">
          <span className="brand-mark">t</span>
          <span className="brand-name">therabot<span>.</span></span>
        </button>
        <div className="rail-label">Workspace</div>
        <nav className="rail-nav" aria-label={`${role} navigation`}>
          {items.map(item => (
            <button className={`rail-link ${active === item.id ? 'is-active' : ''}`} key={item.id} onClick={() => onNavigate(item.id)} type="button">
              <span className="rail-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.count > 0 && <span className="rail-count">{item.count}</span>}
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <div className="rail-note"><span className="status-dot" /> Your care space is private</div>
          <button className="rail-link signout-link" onClick={signOut} type="button"><span className="rail-icon" aria-hidden="true">↪</span><span>Sign out</span></button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-topbar">
          <div className="mobile-brand"><span className="brand-mark">t</span><span className="brand-name">therabot<span>.</span></span></div>
          <div className="topbar-context"><span className="topbar-kicker">{role} workspace</span><span className="topbar-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
          {role === 'Patient' ? profileContent : <div className="topbar-profile"><span className="avatar-badge">{initials || 'T'}</span><span className="profile-name">{name}</span></div>}
        </header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}
