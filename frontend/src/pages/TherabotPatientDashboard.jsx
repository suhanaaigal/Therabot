import React, { useEffect, useState } from 'react';
import { api } from '../api';
import AppointmentBooking from '../components/AppointmentBooking';
import ChatRoom from '../components/ChatRoom';
import DashboardShell from '../components/DashboardShell';
import MindRelief from '../components/MindRelief';
import MoodTrendDashboard from '../components/MoodTrendDashboard';
import ScreeningQuestionnaires from '../components/ScreeningQuestionnaires';
import { appointmentTimestamp } from '../utils/appointmentTime';

const navItems = [
  { id: 'overview', label: 'Overview', icon: '⌂' },
  { id: 'checkin', label: 'Daily check-in', icon: '＋' },
  { id: 'mood-trends', label: 'Mood trends', icon: '⌁' },
  { id: 'screenings', label: 'Screening', icon: '▤' },
  { id: 'appointments', label: 'Appointments', icon: '▦' },
  { id: 'companion', label: 'AI companion', icon: '✳' },
  { id: 'relief', label: 'Mind relief', icon: '◌' }
];

const sectionCopy = {
  overview: ['Your care, at your pace', 'Thoughtful support for today, whenever you need it.'],
  checkin: ['Daily check-in', 'Take a quiet moment to note how you are feeling today.'],
  'mood-trends': ['Mood trends', 'Notice patterns in the check-ins you’ve chosen to record.'],
  screenings: ['Screening', ''],
  appointments: ['Appointments', 'Plan a conversation with your care team.'],
  companion: ['AI companion', 'A supportive place to put your thoughts into words.'],
  relief: ['Mind relief', 'Choose a gentle exercise and take a few minutes for yourself.']
};

export default function TherabotPatientDashboard() {
  const [activeSection, setActiveSection] = useState('overview');
  const [form, setForm] = useState({ sleepHours: '', moodScore: '', anxietyLevel: '', journalText: '' });
  const [resultBand, setResultBand] = useState('');
  const [resultReasons, setResultReasons] = useState([]);
  const [message, setMessage] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [checkIns, setCheckIns] = useState([]);
  const [checkInsLoading, setCheckInsLoading] = useState(true);
  const [checkInsError, setCheckInsError] = useState('');
  const [stressReplayStatus, setStressReplayStatus] = useState('not_running');
  const [stressReplayMessage, setStressReplayMessage] = useState('');
  const [stressReplayLoading, setStressReplayLoading] = useState(false);
  const [showFirstCheckInPrompt, setShowFirstCheckInPrompt] = useState(false);
  const now = Date.now();
  const patientId = localStorage.getItem('patientId') || 'demo-patient-room';
  const patientName = localStorage.getItem('patientName') || 'Patient';
  const firstName = patientName.split(' ')[0];
  const nextAppointment = [...appointments]
    .filter(appointment => {
      const startsAt = appointmentTimestamp(appointment);
      return ['Pending', 'Approved'].includes(appointment.status) && !appointment.callEnded && Number.isFinite(startsAt) && startsAt > now - 60 * 60 * 1000;
    })
    .sort((first, second) => appointmentTimestamp(first) - appointmentTimestamp(second))[0];

  useEffect(() => {
    let mounted = true;
    api.get(`/api/patient/${encodeURIComponent(patientId)}/checkins`)
      .then(response => {
        if (mounted) setCheckIns(response.data || []);
      })
      .catch(error => {
        if (mounted) setCheckInsError(error?.response?.data?.error || 'We could not load your check-in history.');
      })
      .finally(() => {
        if (mounted) setCheckInsLoading(false);
      });
    api.get(`/api/appointment/patient/${patientId}`)
      .then(response => {
        if (mounted) setAppointments(response.data || []);
      })
      .catch(error => console.error('Could not load patient appointments', error))
      .finally(() => {
        if (mounted) setAppointmentsLoaded(true);
      });
    return () => { mounted = false; };
  }, [patientId]);

  useEffect(() => {
    let mounted = true;
    const refreshStatus = () => api.get('/api/stress/replay/status')
      .then(response => {
        if (mounted) {
          setStressReplayStatus(response.data?.status || 'not_running');
          setStressReplayMessage(response.data?.lastError || '');
        }
      })
      .catch(() => { if (mounted) setStressReplayStatus('unavailable'); });
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!checkInsLoading && !checkInsError && checkIns.length === 0) {
      setShowFirstCheckInPrompt(true);
    }
  }, [checkIns, checkInsError, checkInsLoading]);

  const handleSubmit = async event => {
    event.preventDefault();
    setMessage('');
    try {
      const response = await api.post('/api/patient/checkin', { patientId, ...form });
      setResultBand(response.data.band);
      setMessage(response.data.message || 'Your check-in is saved.');
      setResultReasons(response.data.reasons || []);
      setForm({ sleepHours: '', moodScore: '', anxietyLevel: '', journalText: '' });
      try {
        const historyResponse = await api.get(`/api/patient/${encodeURIComponent(patientId)}/checkins`);
        setCheckIns(historyResponse.data || []);
        setCheckInsError('');
      } catch {
        setCheckInsError('Your check-in was saved, but we could not refresh the trend yet.');
      }
    } catch (error) {
      setMessage(error?.response?.data?.error || 'We could not save your check-in. Please try again.');
    }
  };

  const toggleStressReplay = async () => {
    setStressReplayLoading(true);
    setStressReplayMessage('');
    try {
      if (stressReplayStatus === 'running') {
        await api.post('/api/stress/replay/stop');
        setStressReplayStatus('not_running');
        setStressReplayMessage('Simulated replay stopped.');
      } else {
        const response = await api.post('/api/stress/replay/start');
        setStressReplayStatus(response.data?.status || 'running');
        setStressReplayMessage(response.data?.message || 'Simulated replay started.');
      }
    } catch (error) {
      setStressReplayMessage(error?.response?.data?.error || 'The simulated wearable replay could not be started.');
    } finally {
      setStressReplayLoading(false);
    }
  };

  const renderOverview = () => (
    <>
      <section className="patient-hero">
        <div className="hero-copy">
          <div className="hero-kicker">A little space for you</div>
          <h2 className="hero-title">Good to have you here, {firstName}.</h2>
          <p className="hero-text">Some days call for a conversation. Others call for a quiet moment. Find support that fits today.</p>
          <button className="action-button" type="button" onClick={() => setActiveSection('companion')}>Talk it through <span aria-hidden="true">→</span></button>
        </div>
        <div className="next-visit" aria-live="polite">
          <div className="next-visit-top"><span className="next-visit-icon" aria-hidden="true">▦</span><span className="next-visit-label">Your care calendar</span></div>
          {nextAppointment ? <>
            <span className="next-visit-kicker">{nextAppointment.status === 'Approved' ? 'Next visit' : 'Request sent'}</span>
            <strong className="next-visit-date">{new Date(appointmentTimestamp(nextAppointment)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' })}</strong>
            <span className="next-visit-time">{nextAppointment.scheduledTime}{nextAppointment.status === 'Pending' ? ' · Awaiting confirmation' : ' · Confirmed'}</span>
          </> : <>
            <span className="next-visit-kicker">{appointmentsLoaded ? 'Nothing scheduled' : 'Checking your calendar'}</span>
            <strong className="next-visit-date">{appointmentsLoaded ? 'Your next step' : 'One moment'}</strong>
            <span className="next-visit-time">{appointmentsLoaded ? 'You can request a visit whenever you’re ready.' : 'Loading your upcoming visits.'}</span>
          </>}
          <button className="next-visit-link" type="button" onClick={() => setActiveSection('appointments')}>{nextAppointment ? 'View appointments' : 'Find a time to talk'} <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="panel-title">Simulated wearable replay</h2><p className="panel-caption">Demo only: replays wrist sensor features from WESAD subject S17. This is not a live wearable, diagnosis, or anxiety measurement.</p></div><button className="action-button" type="button" disabled={stressReplayLoading || stressReplayStatus === 'unavailable'} onClick={toggleStressReplay}>{stressReplayLoading ? 'Please wait…' : stressReplayStatus === 'running' ? 'Stop replay' : stressReplayStatus === 'completed' ? 'Replay again' : 'Start replay'}</button></div>
        <p role="status">{stressReplayMessage || `Replay status: ${stressReplayStatus.replaceAll('_', ' ')}.`}</p>
      </section>

      <section className="overview-services" aria-label="Support options">
        <div className="overview-section-head"><div><p className="page-eyebrow">Choose what feels right</p><h2>Your wellbeing, in one place</h2></div><p>Take your time. Start anywhere.</p></div>
        <div className="overview-service-grid">
          <button className="overview-service daily-checkin-service" type="button" onClick={() => setActiveSection('checkin')}>
            <span className="overview-service-top"><span className="overview-service-symbol checkin-symbol">＋</span><span className="overview-service-arrow" aria-hidden="true">↗</span></span><span className="overview-service-copy"><strong>Daily check-in</strong><small>Record how you’re feeling and notice your patterns over time.</small></span>
          </button>
          <button className="overview-service" type="button" onClick={() => setActiveSection('appointments')}>
            <span className="overview-service-top"><span className="overview-service-symbol appointment-symbol">▦</span><span className="overview-service-arrow" aria-hidden="true">↗</span></span><span className="overview-service-copy"><strong>Appointments</strong><small>See your visits or request a time to talk with your doctor.</small></span>
          </button>
          <button className="overview-service" type="button" onClick={() => setActiveSection('companion')}>
            <span className="overview-service-top"><span className="overview-service-symbol companion-symbol">✳</span><span className="overview-service-arrow" aria-hidden="true">↗</span></span><span className="overview-service-copy"><strong>AI companion</strong><small>Put your thoughts into words in a supportive conversation.</small></span>
          </button>
          <button className="overview-service" type="button" onClick={() => setActiveSection('relief')}>
            <span className="overview-service-top"><span className="overview-service-symbol relief-symbol">◌</span><span className="overview-service-arrow" aria-hidden="true">↗</span></span><span className="overview-service-copy"><strong>Mind relief</strong><small>Explore guided grounding and calming activities.</small></span>
          </button>
        </div>
      </section>

      <div className="overview-bottom-grid overview-bottom-single">
        <section className="overview-note-panel">
          <div className="overview-note-mark" aria-hidden="true">✳</div>
          <div><p className="page-eyebrow">Keep in mind</p><h3>You can take this one step at a time.</h3><p>Your check-in, calming activities, and care team are here whenever you need them.</p></div>
        </section>
      </div>
    </>
  );

  const content = activeSection === 'overview' ? renderOverview()
    : activeSection === 'checkin' ? <section className="panel panel-pad checkin-panel"><CheckinForm form={form} setForm={setForm} onSubmit={handleSubmit} message={message} resultBand={resultBand} reasons={resultReasons} /></section>
      : activeSection === 'mood-trends' ? <MoodTrendDashboard checkIns={checkIns} loading={checkInsLoading} error={checkInsError} onCheckIn={() => setActiveSection('checkin')} />
        : activeSection === 'screenings' ? <ScreeningQuestionnaires />
      : activeSection === 'appointments' ? <section className="panel panel-pad service-panel"><AppointmentBooking patientName={patientName} /></section>
        : activeSection === 'relief' ? <section className="panel panel-pad service-panel"><MindRelief /></section>
          : <section className="panel panel-pad service-panel"><ChatRoom roomId={patientId} senderName={patientName} mode="ai" /></section>;

  return (
    <DashboardShell role="Patient" name={patientName} active={activeSection} onNavigate={setActiveSection} items={navItems}>
      <div className="page-heading"><div><p className="page-eyebrow">{activeSection === 'screenings' ? 'Assessments' : 'Patient care'}</p><h1 className="page-title">{sectionCopy[activeSection][0]}</h1>{sectionCopy[activeSection][1] && <p className="page-subtitle">{sectionCopy[activeSection][1]}</p>}</div></div>
      {content}
      <nav className="mobile-nav" aria-label="Patient navigation">{navItems.map(item => <button key={item.id} type="button" className={`rail-link ${activeSection === item.id ? 'is-active' : ''}`} onClick={() => setActiveSection(item.id)}><span className="rail-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}</nav>
      {showFirstCheckInPrompt && (
        <div className="checkin-prompt-backdrop" role="presentation">
          <section className="checkin-prompt" role="dialog" aria-modal="true" aria-labelledby="first-checkin-title">
            <button className="checkin-prompt-close" type="button" aria-label="Close check-in prompt" onClick={() => setShowFirstCheckInPrompt(false)}>×</button>
            <p className="page-eyebrow">A small first step</p>
            <h2 id="first-checkin-title">How are you feeling today?</h2>
            <p>Write or speak a few sentences about how you are feeling. Optional ratings can help compare your self-report with the automated estimate.</p>
            <div className="checkin-prompt-actions">
              <button className="action-button" type="button" onClick={() => { setShowFirstCheckInPrompt(false); setActiveSection('checkin'); }}>Start check-in <span aria-hidden="true">→</span></button>
              <button className="quiet-button" type="button" onClick={() => setShowFirstCheckInPrompt(false)}>Not now</button>
            </div>
          </section>
        </div>
      )}
    </DashboardShell>
  );
}

function CheckinForm({ form, setForm, onSubmit, message, resultBand, reasons = [], compact = false }) {
  return (
    <>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="form-field full">
            <label htmlFor="journal-text">Your check-in</label>
            <textarea id="journal-text" required maxLength={2000} placeholder="How are you feeling today? Write a few sentences…" value={form.journalText} onChange={event => setForm({ ...form, journalText: event.target.value })} />
          </div>
        </div>
        <details style={{ marginTop: 16 }}>
          <summary>Optional self-ratings</summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="form-field"><label htmlFor="sleep-hours">Sleep last night (hours)</label><input id="sleep-hours" type="number" min="0" max="24" step="0.5" placeholder="Optional" value={form.sleepHours} onChange={event => setForm({ ...form, sleepHours: event.target.value })} /></div>
            <div className="form-field"><label htmlFor="mood-score">Mood today (1–10)</label><input id="mood-score" type="number" min="1" max="10" placeholder="Optional" value={form.moodScore} onChange={event => setForm({ ...form, moodScore: event.target.value })} /></div>
            <div className="form-field"><label htmlFor="anxiety-level">Anxiety today (1–10)</label><input id="anxiety-level" type="number" min="1" max="10" placeholder="Optional" value={form.anxietyLevel} onChange={event => setForm({ ...form, anxietyLevel: event.target.value })} /></div>
          </div>
        </details>
        <div className="form-actions"><button className="action-button" type="submit">Save check-in <span aria-hidden="true">→</span></button></div>
      </form>
      {message && <div className="success-banner" role="status">{message}{resultBand && <> Current status: <strong>{resultBand}</strong>.</>}{reasons.length > 0 && <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}</div>}
      {resultBand === 'Red' && (
        <div className="alert-row critical" role="alert" style={{ marginTop: '12px' }}>
          <strong>Please reach out for immediate support.</strong>
          <p>If you may be in immediate danger, contact local emergency services now. Otherwise, contact your doctor or a trusted person and let them know how you are feeling.</p>
        </div>
      )}
    </>
  );
}
