import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import DashboardShell from '../components/DashboardShell';

const baseNavigation = [
  { id: 'overview', label: 'Overview', icon: '⌂' },
  { id: 'patients', label: 'Patients', icon: '♧' },
  { id: 'appointments', label: 'Appointments', icon: '▦' },
  { id: 'alerts', label: 'Alerts', icon: '!' }
];

export default function TherabotDoctorDashboard() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSection, setActiveSection] = useState('overview');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [patientAppointments, setPatientAppointments] = useState([]);
  const [patientNotifications, setPatientNotifications] = useState([]);
  const [patientReport, setPatientReport] = useState(null);
  const [patientSessions, setPatientSessions] = useState([]);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [search, setSearch] = useState('');
  const selectedPatientIdRef = useRef(null);
  const doctorName = localStorage.getItem('doctorName') || 'Dr. Suhana Aigal';
  const sortedPatients = [...patients].sort((first, second) => riskValue(first.currentRiskBand) - riskValue(second.currentRiskBand));
  const visiblePatients = sortedPatients.filter(patient => (patient.fullName || '').toLowerCase().includes(search.toLowerCase()));
  const upcomingCalls = [...requests, ...appointments]
    .filter(item => item.status === 'Approved' && item.roomUrl)
    .filter(isUpcomingConsultation)
    .filter((item, index, all) => all.findIndex(other => String(other._id) === String(item._id)) === index)
    .sort((first, second) => new Date(`${first.scheduledDate}T${first.scheduledTime}`) - new Date(`${second.scheduledDate}T${second.scheduledTime}`));
  const unreviewedAlertCount = notifications.filter(notification => !notification.reviewedAt).length;
  const navigation = baseNavigation.map(item => item.id === 'alerts' ? { ...item, count: unreviewedAlertCount } : item);

  useEffect(() => {
    if (localStorage.getItem('isDoctorAuthenticated') !== 'true') {
      navigate('/doctor');
      return undefined;
    }
    refreshAll();
    const timer = window.setInterval(refreshAll, 12000);
    return () => window.clearInterval(timer);
  }, [navigate]);

  async function refreshAll() {
    await Promise.all([fetchPatients(), fetchAppointments(), fetchRequests(), fetchNotifications(), fetchSessions()]);
  }

  async function fetchPatients() {
    try { const response = await api.get('/api/doctor/patients'); setPatients(response.data || []); }
    catch (error) { console.error('Could not load patients', error); }
  }
  async function fetchAppointments() {
    try { const response = await api.get('/api/appointment/all'); setAppointments(response.data || []); }
    catch (error) { console.error('Could not load appointments', error); }
  }
  async function fetchRequests() {
    try {
      const doctorId = localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId');
      if (!doctorId) return;
      const response = await api.get(`/api/appointment/doctor/${doctorId}/requests`);
      setRequests(response.data || []);
    } catch (error) { console.error('Could not load appointment requests', error); }
  }
  async function fetchNotifications() {
    try { const response = await api.get('/api/doctor/notifications'); setNotifications(response.data || []); }
    catch (error) { console.error('Could not load alerts', error); }
  }

  async function reviewNotification(notificationId) {
    try {
      await api.patch(`/api/doctor/notifications/${encodeURIComponent(notificationId)}/review`);
      setNotifications(previous => previous.map(notification => String(notification._id) === String(notificationId) ? { ...notification, reviewedAt: new Date().toISOString() } : notification));
    } catch (error) {
      window.alert(error?.response?.data?.error || 'Could not mark this alert as reviewed.');
    }
  }
  async function fetchSessions() {
    try {
      const response = await api.get('/api/appointment/sessions');
      setSessions(response.data || []);
      if (selectedPatientIdRef.current) setPatientSessions((response.data || []).filter(session => String(session.patientId) === String(selectedPatientIdRef.current)));
    } catch (error) { console.error('Could not load call sessions', error); }
  }

  async function inspectPatient(patientId) {
    try {
      const response = await api.get(`/api/doctor/patient/${patientId}`);
      const data = response.data;
      selectedPatientIdRef.current = patientId;
      setSelectedPatient(data.patient);
      setPatientHistory(data.checkIns || []);
      setPatientAppointments(data.appointments || []);
      setPatientNotifications(data.notifications || []);
      setPatientReport(data.report || null);
      setPatientSessions(data.callSessions || []);
      setDoctorNotes(data.patient?.doctorNotes || '');
      setSelectedSession((data.callSessions || [])[0] || null);
      setTranscriptText('');
      setActiveSection('patient-report');
    } catch (error) { window.alert(error?.response?.data?.error || 'Could not load this patient record.'); }
  }

  async function approveAppointment(id) {
    try {
      await api.patch(`/api/appointment/${id}/approve`, { doctorId: localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId') });
      await refreshAll();
    } catch (error) { window.alert(error?.response?.data?.error || 'Unable to approve appointment.'); }
  }
  async function declineAppointment(id) {
    try { await api.patch(`/api/appointment/${id}/decline`); await refreshAll(); }
    catch (error) { window.alert(error?.response?.data?.error || 'Unable to decline appointment.'); }
  }

  async function deletePatient(patient) {
    const confirmed = window.confirm(`Permanently delete ${patient.fullName}'s account and all associated check-ins, appointments, messages, and reports? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.delete(`/api/doctor/patient/${encodeURIComponent(patient._id)}`);
      if (String(selectedPatientIdRef.current) === String(patient._id)) {
        selectedPatientIdRef.current = null;
        setSelectedPatient(null);
        setPatientSessions([]);
        setActiveSection('patients');
      }
      await refreshAll();
    } catch (error) {
      window.alert(error?.response?.data?.error || 'Could not delete the patient account.');
    }
  }

  async function saveTranscript(event) {
    event.preventDefault();
    if (!selectedSession || !transcriptText.trim()) return;
    const transcript = transcriptText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const patientLine = line.match(/^Patient\s*[:\-]?\s*(.*)$/i);
      const doctorLine = line.match(/^Doctor\s*[:\-]?\s*(.*)$/i);
      return { author: patientLine ? 'Patient' : 'Doctor', message: (patientLine?.[1] || doctorLine?.[1] || line).trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    }).filter(item => item.message);
    try {
      const saved = await api.post('/api/appointment/session/transcript', { roomUrl: selectedSession.roomUrl, transcript, doctorName });
      const drafted = await api.post('/api/ai/clinical-note', { roomUrl: selectedSession.roomUrl, transcript, patientName: selectedPatient.fullName, doctorName });
      const updated = drafted.data.session || saved.data.session;
      setSelectedSession(updated);
      setPatientSessions(previous => previous.map(session => session._id === updated._id ? updated : session));
      setTranscriptText(transcript.map(item => `${item.author}: ${item.message}`).join('\n'));
      await fetchSessions();
    } catch (error) { window.alert(error?.response?.data?.error || 'Could not save the transcript or draft a report.'); }
  }

  async function saveDoctorNotes(event) {
    event.preventDefault();
    if (!selectedPatient || notesSaving) return;
    setNotesSaving(true);
    try {
      const response = await api.patch(`/api/doctor/patient/${encodeURIComponent(selectedPatient._id)}/notes`, { notes: doctorNotes });
      setDoctorNotes(response.data.notes || '');
      setSelectedPatient(previous => previous ? { ...previous, doctorNotes: response.data.notes || '' } : previous);
    } catch (error) {
      window.alert(error?.response?.data?.error || 'Could not save the patient note.');
    } finally {
      setNotesSaving(false);
    }
  }

  async function scheduleConsultation(event) {
    event.preventDefault();
    if (!selectedPatient) return;
    try {
      await api.post('/api/appointment/book', { patientId: selectedPatient._id, patientName: selectedPatient.fullName, doctorName });
      await refreshAll();
      await inspectPatient(selectedPatient._id);
    } catch (error) { window.alert(error?.response?.data?.error || 'Unable to schedule consultation.'); }
  }

  function downloadPatientReport() {
    if (!selectedPatient) return;
    const text = [
      'THERABOT PATIENT REPORT',
      `Patient: ${selectedPatient.fullName}`,
      `Age / gender: ${selectedPatient.age} / ${selectedPatient.gender}`,
      `Risk band: ${selectedPatient.currentRiskBand || 'Green'}`,
      '', 'DAILY CHECK-INS',
      ...patientHistory.map(item => `${new Date(item.date).toLocaleDateString()} | Sleep ${item.sleepHours}h | Mood ${item.moodScore}/10 | Anxiety ${item.anxietyLevel}/10 | ${item.journalText || 'No journal note'}`),
      '', 'DOCTOR NOTES', doctorNotes || 'No doctor notes recorded.',
      '', 'CONSULTATIONS',
      ...patientSessions.map(session => `${session.scheduledDate} ${session.scheduledTime}\n${session.clinicalNote?.text || session.summary || 'No report yet.'}`),
      '', `Generated ${new Date().toLocaleString()}`
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedPatient.fullName.replace(/\s+/g, '_')}_therabot_report.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const sectionHeading = selectedPatient && activeSection === 'patient-report'
    ? ['Patient record', 'A clinical overview of check-ins, appointments and consultation notes.']
    : {
      overview: ['Care overview', 'A clear view of today’s care activity and the people who need follow-up.'],
      patients: ['Patient directory', 'Review patient details, recent check-ins and consultation history.'],
      appointments: ['Appointments', 'Manage requests and join approved consultations.'],
      alerts: ['Alert center', 'Review notifications and elevated-risk follow-ups.']
    }[activeSection] || ['Care overview', ''];

  const content = activeSection === 'patient-report' && selectedPatient
    ? <PatientRecord {...{ selectedPatient, patientHistory, patientAppointments, patientNotifications, patientReport, patientSessions, selectedSession, setSelectedSession, transcriptText, setTranscriptText, saveTranscript, scheduleConsultation, downloadPatientReport, goBack: () => { setSelectedPatient(null); setActiveSection('patients'); } }} />
    : activeSection === 'patients' ? <PatientDirectory patients={visiblePatients} search={search} setSearch={setSearch} inspectPatient={inspectPatient} deletePatient={deletePatient} />
      : activeSection === 'appointments' ? <AppointmentView patients={patients} requests={requests} appointments={appointments} approve={approveAppointment} decline={declineAppointment} doctorId={localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId')} doctorName={doctorName} onBooked={refreshAll} />
        : activeSection === 'alerts' ? <AlertView notifications={notifications} reviewNotification={reviewNotification} />
          : <Overview {...{ patients: sortedPatients, upcomingCalls, requests, notifications, inspectPatient, setActiveSection, refreshAll, approve: approveAppointment, decline: declineAppointment, doctorName }} />;

  return (
    <DashboardShell role="Doctor" name={doctorName} active={activeSection === 'patient-report' ? 'patients' : activeSection} onNavigate={section => { setSelectedPatient(null); setActiveSection(section); }} items={navigation}>
      <div className="page-heading"><div><p className="page-eyebrow">Clinical workspace</p><h1 className="page-title">{sectionHeading[0]}</h1><p className="page-subtitle">{sectionHeading[1]}</p></div>{activeSection === 'patient-report' && selectedPatient && <div className="heading-actions"><button className="quiet-button" type="button" onClick={() => setActiveSection('patients')}>← Patients</button><button className="action-button" type="button" onClick={downloadPatientReport}>Download report ↓</button></div>}</div>
      {content}
      <nav className="mobile-nav" aria-label="Doctor navigation">{navigation.map(item => <button key={item.id} type="button" className={`rail-link ${activeSection === item.id || (activeSection === 'patient-report' && item.id === 'patients') ? 'is-active' : ''}`} onClick={() => { setSelectedPatient(null); setActiveSection(item.id); }}><span className="rail-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}</nav>
    </DashboardShell>
  );
}

function riskValue(band) { return ({ Red: 0, Orange: 1, Yellow: 2, Green: 3 })[band] ?? 4; }
function riskClass(band) { return String(band || 'Green').toLowerCase(); }
function initials(name) { return String(name || 'P').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase(); }

function isUpcomingConsultation(item) {
  if (item.callEnded) return false;
  if (['Urgent', 'Emergency'].includes(item.urgency)) return true;
  const appointmentTime = new Date(`${item.scheduledDate}T${item.scheduledTime}`).getTime();
  return !Number.isFinite(appointmentTime) || appointmentTime + (60 * 60 * 1000) >= Date.now();
}

function Overview({ patients, upcomingCalls, requests, notifications, inspectPatient, setActiveSection, refreshAll, approve, decline, doctorName }) {
  const urgentCount = patients.filter(patient => ['Red', 'Orange'].includes(patient.currentRiskBand)).length;
  return <div className="dash-section">
    <div className="metric-grid">
      <Metric label="Active patients" value={patients.length} foot="In your care directory" icon="♧" />
      <Metric label="Priority follow-up" value={urgentCount} foot="Red and orange bands" tone="coral" icon="!" />
      <Metric label="Upcoming calls" value={upcomingCalls.length} foot="Approved consultations" icon="▦" />
      <Metric label="Open alerts" value={notifications.length} foot="Review recent activity" icon="↗" />
    </div>
    <div className="doctor-overview-grid">
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="panel-title">Patient priority</h2><p className="panel-caption">Patients with the highest reported risk appear first.</p></div><button className="quiet-button" type="button" onClick={() => setActiveSection('patients')}>View all →</button></div>
        {patients.length ? <div className="data-list">{patients.slice(0, 5).map(patient => <div className="data-row" key={patient._id}><div className="patient-cell"><span className="avatar-badge">{initials(patient.fullName)}</span><span>{patient.fullName}</span></div><span className={`risk-badge ${riskClass(patient.currentRiskBand)}`}>{patient.currentRiskBand || 'Green'}</span><button className="text-action" type="button" onClick={() => inspectPatient(patient._id)}>Open record →</button></div>)}</div> : <div className="empty-state">No patients have been added yet.</div>}
      </section>
      <section className="panel panel-pad">
        <div className="panel-head"><div><h2 className="panel-title">Appointment requests</h2><p className="panel-caption">Respond to pending requests from patients.</p></div><span className="count-badge">{requests.filter(item => item.status === 'Pending').length}</span></div>
        {requests.filter(item => item.status === 'Pending').length ? requests.filter(item => item.status === 'Pending').slice(0, 4).map(item => <div className="request-item" key={item._id}><div className="data-main"><strong>{item.patientName}</strong><small>{item.scheduledDate} · {item.scheduledTime} · {item.urgency || 'Routine'}</small></div><div className="appointment-actions"><button className="tiny-action" type="button" onClick={() => approve(item._id)}>Accept</button><button className="tiny-action quiet" type="button" onClick={() => decline(item._id)}>Decline</button></div></div>) : <div className="empty-state">You’re all caught up.</div>}
      </section>
    </div>
    <section className="panel panel-pad">
      <div className="panel-head"><div><h2 className="panel-title">Upcoming consultations</h2><p className="panel-caption">Approved appointments and call room access.</p></div><button className="quiet-button" type="button" onClick={refreshAll}>↻ Refresh</button></div>
      <AppointmentList items={upcomingCalls} doctorName={doctorName} />
    </section>
  </div>;
}

function Metric({ label, value, foot, tone = '', icon }) {
  return <div className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-foot">{foot}</span></div>;
}

function PatientDirectory({ patients, search, setSearch, inspectPatient, deletePatient }) {
  return <section className="panel panel-pad"><div className="panel-head directory-head"><div><h2 className="panel-title">All patients <span className="count-badge">{patients.length}</span></h2><p className="panel-caption">Select a patient to view their complete history.</p></div><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a patient" aria-label="Search patients" /></label></div>
    {patients.length ? <div className="table-wrap"><table className="patient-table"><thead><tr><th>Patient</th><th>Email</th><th>Risk band</th><th>Age / gender</th><th>Phone</th><th>Emergency contact</th><th>Actions</th></tr></thead><tbody>{patients.map(patient => <tr key={patient._id}><td><div className="patient-cell"><span className="avatar-badge">{initials(patient.fullName)}</span>{patient.fullName || 'Unnamed patient'}</div></td><td>{patient.email || '—'}</td><td><span className={`risk-badge ${riskClass(patient.currentRiskBand)}`}>{patient.currentRiskBand || 'Green'}</span></td><td>{patient.age || '—'} · {patient.gender || '—'}</td><td>{patient.phoneNumber || '—'}</td><td>{patient.emergencyContact || '—'}</td><td><div className="patient-directory-actions"><button className="text-action" type="button" onClick={() => inspectPatient(patient._id)}>View record →</button><button className="delete-patient-button" type="button" onClick={() => deletePatient(patient)} aria-label={`Delete ${patient.fullName}`}>Delete</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state">No matching patients found.</div>}
  </section>;
}

function AppointmentView({ patients, requests, appointments, approve, decline, doctorId, doctorName, onBooked }) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState({ patientId: '', scheduledDate: '', scheduledTime: '' });
  const [bookingError, setBookingError] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const pending = requests.filter(item => item.status === 'Pending');
  const approved = [...appointments, ...requests].filter(item => item.status === 'Approved' && item.roomUrl).filter(isUpcomingConsultation).filter((item, index, all) => all.findIndex(other => String(other._id) === String(item._id)) === index);
  async function submitBooking(event) {
    event.preventDefault();
    const patient = patients.find(item => String(item._id) === String(booking.patientId));
    if (!patient) {
      setBookingError('Select a patient before booking.');
      return;
    }
    setBookingError('');
    setBookingLoading(true);
    try {
      await api.post('/api/appointment/book', {
        patientId: patient._id,
        patientName: patient.fullName,
        doctorId,
        doctorName,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime
      });
      setBooking({ patientId: '', scheduledDate: '', scheduledTime: '' });
      setBookingOpen(false);
      await onBooked();
    } catch (error) {
      setBookingError(error?.response?.data?.error || 'Could not book this appointment. Please try again.');
    } finally {
      setBookingLoading(false);
    }
  }

  return <div className="dash-section">
    <section className="panel panel-pad">
      <div className="panel-head"><div><h2 className="panel-title">Appointments</h2><p className="panel-caption">Book a visit for a patient or respond to incoming appointment requests.</p></div><button className="action-button" type="button" onClick={() => { setBookingOpen(value => !value); setBookingError(''); }}>{bookingOpen ? 'Cancel booking' : 'Book appointment +'}</button></div>
      {bookingOpen && <form className="doctor-booking-form" onSubmit={submitBooking}>
        <div className="panel-head"><div><h3 className="panel-title">New appointment</h3><p className="panel-caption">Choose a patient and schedule a consultation time.</p></div></div>
        <div className="form-grid">
          <div className="form-field full"><label htmlFor="doctor-book-patient">Patient</label><select id="doctor-book-patient" value={booking.patientId} onChange={event => setBooking(current => ({ ...current, patientId: event.target.value }))} required><option value="">Select a patient</option>{patients.map(patient => <option key={patient._id} value={patient._id}>{patient.fullName}{patient.email ? ` · ${patient.email}` : ''}</option>)}</select></div>
          <div className="form-field"><label htmlFor="doctor-book-date">Date</label><input id="doctor-book-date" type="date" min={new Date().toISOString().slice(0, 10)} value={booking.scheduledDate} onChange={event => setBooking(current => ({ ...current, scheduledDate: event.target.value }))} required /></div>
          <div className="form-field"><label htmlFor="doctor-book-time">Time</label><input id="doctor-book-time" type="time" value={booking.scheduledTime} onChange={event => setBooking(current => ({ ...current, scheduledTime: event.target.value }))} required /></div>
        </div>
        {bookingError && <div className="auth-error" role="alert">{bookingError}</div>}
        <div className="form-actions"><button className="action-button" type="submit" disabled={bookingLoading}>{bookingLoading ? 'Booking…' : 'Confirm appointment'}</button></div>
      </form>}
      <div className="panel-head"><div><h3 className="panel-title">Needs your response</h3><p className="panel-caption">Appointment requests waiting for review.</p></div><span className="count-badge">{pending.length}</span></div>
      {pending.length ? <div className="data-list">{pending.map(item => <div className="appointment-card" key={item._id}><div className="data-main"><strong>{item.patientName || 'Patient'}</strong><small>{item.scheduledDate} at {item.scheduledTime} · {item.urgency || 'Routine'}{item.isAvailable === false ? ' · Time conflict' : ''}</small></div><div className="appointment-actions"><button className="action-button" type="button" onClick={() => approve(item._id)}>Accept</button><button className="quiet-button" type="button" onClick={() => decline(item._id)}>Decline</button></div></div>)}</div> : <div className="empty-state">No pending appointment requests.</div>}
    </section>
    <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Approved consultations</h2><p className="panel-caption">Call rooms for upcoming appointments.</p></div></div><AppointmentList items={approved} doctorName={doctorName} /></section>
  </div>;
}

function AppointmentList({ items, doctorName }) {
  if (!items.length) return <div className="empty-state">No approved consultations scheduled.</div>;
  return <div className="data-list">{items.map(item => {
    const query = `role=doctor&name=${encodeURIComponent(doctorName)}&patient=${encodeURIComponent(item.patientName || 'Patient')}&date=${encodeURIComponent(item.scheduledDate)}&time=${encodeURIComponent(item.scheduledTime)}&appointmentId=${encodeURIComponent(item._id)}`;
    const room = encodeURIComponent(item.roomUrl);
    return <div className="appointment-card" key={item._id}><div className="appointment-date"><span>{new Date(`${item.scheduledDate}T${item.scheduledTime}`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><small>{item.scheduledTime}</small></div><div className="data-main"><strong>{item.patientName || 'Patient'}</strong><small>{item.scheduledDate} · {item.status || 'Approved'}</small></div><div className="appointment-actions"><a className="quiet-button" href={`/#/call/${room}?${query}`} target="_blank" rel="noreferrer">Open call ↗</a><a className="action-button" href={`/#/jitsi/${room}?${query}`} target="_blank" rel="noreferrer">Jitsi report ↗</a></div></div>;
  })}</div>;
}

function AlertView({ notifications, reviewNotification }) {
  return <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Recent alerts</h2><p className="panel-caption">{notifications.filter(item => !item.reviewedAt).length} unreviewed alert{notifications.filter(item => !item.reviewedAt).length === 1 ? '' : 's'}. Review each update after following up.</p></div></div>{notifications.length ? <div className="alert-list">{notifications.map(item => <div className={`alert-row ${item.severity === 'critical' ? 'critical' : ''} ${item.reviewedAt ? 'is-reviewed' : ''}`} key={item._id}><div className="alert-row-head"><strong>{item.patientName || 'Patient'} · {item.severity || 'Update'}</strong>{item.reviewedAt ? <span className="reviewed-label">Reviewed</span> : <button className="text-action" type="button" onClick={() => reviewNotification(item._id)}>Mark reviewed</button>}</div><p>{item.message}</p></div>)}</div> : <div className="empty-state">No active alerts.</div>}</section>;
}

function weeklyMoodTrend(checkIns) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return Array.from({ length: 4 }, (_, index) => {
    const end = new Date(today);
    end.setDate(today.getDate() - ((3 - index) * 7));
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const entries = checkIns.filter(item => {
      const date = new Date(item.date);
      return date >= start && date <= end;
    });
    const average = entries.length ? (entries.reduce((sum, item) => sum + Number(item.moodScore || 0), 0) / entries.length).toFixed(1) : null;
    return { label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), average, count: entries.length };
  });
}

function followUpStatus(checkIns, appointments) {
  const latestCheckIn = checkIns[0] ? new Date(checkIns[0].date).getTime() : 0;
  const checkInOverdue = !latestCheckIn || Date.now() - latestCheckIn > 7 * 24 * 60 * 60 * 1000;
  const missedAppointments = appointments.filter(item => {
    const appointmentTime = new Date(`${item.scheduledDate}T${item.scheduledTime}`).getTime();
    return item.status === 'Approved' && !item.callEnded && Number.isFinite(appointmentTime) && appointmentTime < Date.now() - 60 * 60 * 1000;
  }).length;
  return { checkInOverdue, missedAppointments };
}

function PatientRecord({ selectedPatient, patientHistory, patientAppointments, patientNotifications, patientReport, patientSessions, selectedSession, setSelectedSession, transcriptText, setTranscriptText, saveTranscript, scheduleConsultation, downloadPatientReport, goBack }) {
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryCodeExpiry, setRecoveryCodeExpiry] = useState('');
  const [recoveryCodeError, setRecoveryCodeError] = useState('');
  const [recoveryCodeLoading, setRecoveryCodeLoading] = useState(false);
  const weeklyTrend = weeklyMoodTrend(patientHistory);
  const followUp = followUpStatus(patientHistory, patientAppointments);

  async function createRecoveryCode() {
    if (!window.confirm(`Create a one-time password recovery code for ${selectedPatient.fullName}? Give it only to the patient after verifying their identity.`)) return;
    setRecoveryCode('');
    setRecoveryCodeError('');
    setRecoveryCodeLoading(true);
    try {
      const response = await api.post(`/api/doctor/patient/${encodeURIComponent(selectedPatient._id)}/password-reset`);
      setRecoveryCode(response.data.recoveryCode);
      setRecoveryCodeExpiry(response.data.expiresAt);
    } catch (error) {
      setRecoveryCodeError(error?.response?.data?.error || 'Could not create a recovery code. Please try again.');
    } finally {
      setRecoveryCodeLoading(false);
    }
  }

  return <div className="dash-section"><section className="patient-record-banner panel"><div className="patient-record-avatar">{initials(selectedPatient.fullName)}</div><div className="record-identity"><h2>{selectedPatient.fullName}</h2><p>{selectedPatient.email || 'No email listed'}</p><p>{selectedPatient.age || 'Age not listed'} · {selectedPatient.gender || 'Gender not listed'} · {selectedPatient.phoneNumber || 'No phone listed'} · Emergency: {selectedPatient.emergencyContact || 'Not listed'}</p></div><span className={`risk-badge ${riskClass(selectedPatient.currentRiskBand)}`}>{selectedPatient.currentRiskBand || 'Green'} risk</span><button className="quiet-button record-back-mobile" type="button" onClick={goBack}>← Patient list</button></section>
    <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Patient account access</h2><p className="panel-caption">Create a single-use recovery code after verifying the patient’s identity. Deliver it privately; it expires in 30 minutes.</p></div><button className="quiet-button" type="button" disabled={recoveryCodeLoading} onClick={createRecoveryCode}>{recoveryCodeLoading ? 'Creating…' : 'Create recovery code'}</button></div>{recoveryCodeError && <div className="auth-error" role="alert">{recoveryCodeError}</div>}{recoveryCode && <div className="success-banner" role="status"><strong>One-time code:</strong> <code>{recoveryCode}</code><br />Expires {new Date(recoveryCodeExpiry).toLocaleString()}. This code is shown only here; create a new one if it is lost.</div>}</section>
    <div className="metric-grid"><Metric label="Average mood" value={patientReport?.averages?.mood ?? '—'} foot="Out of 10" icon="☼" /><Metric label="Average anxiety" value={patientReport?.averages?.anxiety ?? '—'} foot="Out of 10" tone="coral" icon="◌" /><Metric label="Average sleep" value={patientReport?.averages?.sleep ?? '—'} foot="Hours per night" icon="◷" /><Metric label="Care activity" value={patientAppointments.length + patientSessions.length} foot="Appointments and calls" icon="▦" /></div>
    <section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">Weekly mood trend</h3><p className="panel-caption">Average mood score for the last four weeks.</p></div></div><div className="weekly-trend-grid">{weeklyTrend.map(week => <div className="weekly-trend-item" key={week.label}><div className="weekly-trend-bar-wrap"><div className="weekly-trend-bar" style={{ height: `${week.average ? Math.max(8, Number(week.average) * 10) : 4}%` }} /></div><strong>{week.average || '—'}</strong><small>{week.label}</small><span>{week.count} check-in{week.count === 1 ? '' : 's'}</span></div>)}</div></section>
    {(followUp.checkInOverdue || followUp.missedAppointments > 0) && <section className="alert-row" role="status"><div className="alert-row-head"><strong>Follow-up needed</strong><span className="reviewed-label">Care task</span></div><p>{followUp.checkInOverdue ? 'No check-in has been recorded in the last 7 days.' : ''}{followUp.checkInOverdue && followUp.missedAppointments > 0 ? ' ' : ''}{followUp.missedAppointments > 0 ? `${followUp.missedAppointments} approved consultation${followUp.missedAppointments === 1 ? '' : 's'} may need follow-up.` : ''}</p></section>}
    {patientReport?.notes && <section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">Clinical snapshot</h3><p className="panel-caption">Summary from recorded check-ins.</p></div></div><p className="snapshot-text">{patientReport.notes}</p></section>}
    <div className="report-columns"><section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">Daily check-ins</h3><p className="panel-caption">Newest reflections and wellbeing signals.</p></div></div>{patientHistory.length ? <div className="data-list">{patientHistory.map(item => <article className="history-item" key={item._id || item.date}><div className="history-date">{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}<span className={`risk-badge ${riskClass(item.calculatedBand)}`}>{item.calculatedBand}</span></div><div className="history-metrics">Mood <strong>{item.moodScore}/10</strong><span>·</span> Anxiety <strong>{item.anxietyLevel}/10</strong><span>·</span> Sleep <strong>{item.sleepHours}h</strong></div>{item.journalText && <p className="history-journal">{item.journalText}</p>}</article>)}</div> : <div className="empty-state">No check-ins recorded.</div>}</section>
      <section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">Consultations & reports</h3><p className="panel-caption">Transcripts and clinician-review drafts.</p></div><span className="count-badge">{patientSessions.filter(session => session.clinicalNote?.text).length} reports</span></div>{patientSessions.length ? <div className="data-list">{patientSessions.map(session => <article className="session-item" key={session._id}><div className="panel-head"><div><strong>{session.scheduledDate} · {session.scheduledTime}</strong><small className="session-state">{session.transcript?.length ? 'Conversation captured' : 'No transcript'} · {session.clinicalNote?.text ? 'Report ready' : 'No report yet'}</small></div><button className="quiet-button" type="button" onClick={() => { setSelectedSession(session); setTranscriptText((session.transcript || []).map(item => `${item.author}: ${item.message}`).join('\n')); }}>{selectedSession?._id === session._id ? 'Selected' : 'Review'}</button></div><p className="session-summary">{session.summary || 'Summary appears after a conversation is captured.'}</p>{session.clinicalNote?.text && <details><summary className="details-trigger">View clinical report</summary><div className="report-note">{session.clinicalNote.text}</div><small className="review-note">Draft for clinician review before use.</small></details>}{session.transcript?.length > 0 && <details className="transcript-details"><summary className="details-trigger muted">View transcript ({session.transcript.length} segment{session.transcript.length === 1 ? '' : 's'})</summary><div className="transcript-list">{session.transcript.map((entry, index) => <p key={`${session._id}-${index}`}><strong>{entry.author}:</strong> {entry.message}</p>)}</div></details>}</article>)}</div> : <div className="empty-state">No consultation history recorded.</div>}</section></div>
    <section className="panel panel-pad doctor-notes-panel"><div className="panel-head"><div><h3 className="panel-title">Patient notes</h3><p className="panel-caption">Write private notes about this patient. Notes are saved to the patient record.</p></div><span className="notes-label">Private clinician notes</span></div><form onSubmit={saveDoctorNotes}><textarea className="doctor-notes-input" aria-label="Patient notes" value={doctorNotes} onChange={event => setDoctorNotes(event.target.value)} placeholder="Write observations, follow-up reminders, or care notes here..." /><div className="form-actions"><button className="action-button" type="submit" disabled={notesSaving}>{notesSaving ? 'Saving…' : 'Save notes'}</button></div></form></section>
    {(patientAppointments.length > 0 || patientNotifications.length > 0) && <section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">Appointments & alerts</h3><p className="panel-caption">Recent scheduling activity for this patient.</p></div></div><div className="report-columns"><div className="data-list">{patientAppointments.map(item => <div className="data-row" key={item._id}><div className="data-main"><strong>{item.scheduledDate} · {item.scheduledTime}</strong><small>{item.status} · {item.urgency || 'Routine'}</small></div></div>)}</div><div className="alert-list">{patientNotifications.map(item => <div className={`alert-row ${item.severity === 'critical' ? 'critical' : ''}`} key={item._id}><strong>{item.severity || 'Update'}</strong><p>{item.message}</p></div>)}</div></div></section>}
  </div>;
}
