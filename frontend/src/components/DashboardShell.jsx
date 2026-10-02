import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function DashboardShell({ role, name, active, onNavigate, items, children }) {
  const navigate = useNavigate();
  const initials = name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();

  const signOut = () => {
    if (role === 'Doctor') {
      localStorage.removeItem('isDoctorAuthenticated');
      navigate('/doctor');
      return;
    }
    localStorage.removeItem('patientId');
    localStorage.removeItem('patientName');
    navigate('/patient');
  };

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
          <div className="topbar-profile"><span className="avatar-badge">{initials || 'T'}</span><span className="profile-name">{name}</span></div>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}
