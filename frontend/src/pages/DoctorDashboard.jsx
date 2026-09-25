import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import ChatRoom from '../components/ChatRoom';

const isAppointmentLive = (scheduledDate, scheduledTime, callEnded = false) => {
  if (callEnded) return false;
  const appointmentDate = new Date(`${scheduledDate}T${scheduledTime}`);
  if (Number.isNaN(appointmentDate.getTime())) return false;
  const now = Date.now();
  return now >= appointmentDate.getTime() - (2 * 60 * 1000) && now <= appointmentDate.getTime() + 60 * 60 * 1000;
};

export default function DoctorDashboard() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [patientAppointments, setPatientAppointments] = useState([]);
  const [patientNotifications, setPatientNotifications] = useState([]);
  const [patientReport, setPatientReport] = useState(null);
  const [patientCallSessions, setPatientCallSessions] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [doctorAppointments, setDoctorAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [callSessions, setCallSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [isDraftingNote, setIsDraftingNote] = useState(false);
  const [newConsultation, setNewConsultation] = useState({ date: '', time: '' });
  const [reportMode, setReportMode] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isDoctorAuthenticated') === 'true';
    if (!isAuthenticated) {
      navigate('/doctor');
      return;
    }

    fetchPatients();
    fetchAppointments();
    fetchNotifications();
    fetchCallSessions();
    fetchDoctorRequests();
    const timer = setInterval(() => {
      setNow(Date.now());
      fetchPatients();
      fetchAppointments();
      fetchDoctorRequests();
      fetchCallSessions();
    }, 10000);
    return () => clearInterval(timer);
  }, [navigate]);

  const fetchPatients = async () => {
    try {
      const res = await api.get('/api/doctor/patients');
      setPatients(res.data);
    } catch (err) {
      console.error('Error fetching patients', err);
    }
  };

  const fetchAppointments = async () => {
    try {
      const res = await api.get('/api/appointment/all');
      setAppointments(res.data);
    } catch (err) {
      console.error('Error fetching appointments', err);
    }
  };

  const fetchDoctorRequests = async () => {
    try {
      const doctorId = localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId');
      if (!doctorId) return;
      const res = await api.get(`/api/appointment/doctor/${doctorId}/requests`);
      setDoctorAppointments(res.data || []);
    } catch (err) {
      console.error('Error fetching doctor appointment requests', err);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/api/doctor/notifications');
      setNotifications(res.data);
    } catch (err) {
      console.error('Error fetching notifications', err);
    }
  };

  const fetchCallSessions = async () => {
    try {
      const res = await api.get('/api/appointment/sessions');
      setCallSessions(res.data);
    } catch (err) {
      console.error('Error fetching call sessions', err);
    }
  };

  const saveCallTranscript = async () => {
    if (!selectedSession || !transcriptText.trim()) {
      alert('Please select a session and add transcript text before saving.');
      return;
    }

    const transcript = transcriptText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map((line) => {
        const normalized = line.trim();
        const patientMatch = normalized.match(/^Patient\s*[:\-]?\s*(.*)$/i);
        const doctorMatch = normalized.match(/^Doctor\s*[:\-]?\s*(.*)$/i);

        if (patientMatch) {
          return { author: 'Patient', message: patientMatch[1].trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        }

        if (doctorMatch) {
          return { author: 'Doctor', message: doctorMatch[1].trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        }

        return {
          author: 'Doctor',
          message: normalized,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      })
      .filter(item => item.message && item.message.length > 0);

    if (!transcript.length) {
      alert('Please add at least one transcript line before saving.');
      return;
    }

    try {
      const res = await api.post('/api/appointment/session/transcript', {
        roomUrl: selectedSession.roomUrl,
        transcript,
        doctorName: localStorage.getItem('doctorName') || 'Doctor'
      });
      alert('Call transcript saved. Summary generated automatically from the conversation.');
      setTranscriptText('');
      setSelectedSession(res.data.session);
      setCallSessions(prev => prev.map(session => session._id === res.data.session._id ? res.data.session : session));
      if (selectedPatient && selectedPatient._id === res.data.session.patientId) {
        setPatientCallSessions(prev => [res.data.session, ...prev.filter(session => session._id !== res.data.session._id)]);
      }

      try {
        const noteResponse = await api.post('/api/ai/clinical-note', {
          roomUrl: selectedSession.roomUrl,
          transcript,
          patientName: selectedPatient?.fullName || selectedSession.patientName || 'the patient',
          doctorName: localStorage.getItem('doctorName') || selectedSession.doctorName || 'the clinician'
        });
        const updatedSession = noteResponse.data.session;
        setSelectedSession(updatedSession);
        setCallSessions(prev => prev.map(session => session._id === updatedSession._id ? updatedSession : session));
        setPatientCallSessions(prev => prev.map(session => session._id === updatedSession._id ? updatedSession : session));
        alert('Call transcript saved and SOAP note drafted. Please review it before using it clinically.');
      } catch (noteError) {
        alert(noteError?.response?.data?.error || 'Transcript saved, but the SOAP note could not be drafted. You can retry it below.');
      }
      fetchCallSessions();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to save transcript');
    }
  };

  const draftClinicalNote = async () => {
    if (!selectedSession || !transcriptText.trim()) {
      alert('Please select a session and add transcript text before drafting a SOAP note.');
      return;
    }

    const transcript = transcriptText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const patientMatch = line.match(/^Patient\s*[:\-]?\s*(.*)$/i);
        const doctorMatch = line.match(/^Doctor\s*[:\-]?\s*(.*)$/i);
        return {
          author: patientMatch ? 'Patient' : 'Doctor',
          message: (patientMatch?.[1] || doctorMatch?.[1] || line).trim(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      })
      .filter(item => item.message);

    setIsDraftingNote(true);
    try {
      const response = await api.post('/api/ai/clinical-note', {
        roomUrl: selectedSession.roomUrl,
        transcript,
        patientName: selectedPatient?.fullName || selectedSession.patientName || 'the patient',
        doctorName: localStorage.getItem('doctorName') || selectedSession.doctorName || 'the clinician'
      });
      const updatedSession = response.data.session;
      setSelectedSession(updatedSession);
      setCallSessions(prev => prev.map(session => session._id === updatedSession._id ? updatedSession : session));
      setPatientCallSessions(prev => prev.map(session => session._id === updatedSession._id ? updatedSession : session));
      alert('SOAP note drafted. Please review it before using it clinically.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to draft the SOAP note.');
    } finally {
      setIsDraftingNote(false);
    }
  };

  const inspectPatient = async (patientId) => {
    try {
      const res = await api.get(`/api/doctor/patient/${patientId}`);
      setSelectedPatient(res.data.patient);
      setPatientHistory(res.data.checkIns);
      setPatientAppointments(res.data.appointments || []);
      setPatientNotifications(res.data.notifications || []);
      setPatientReport(res.data.report || null);
      setPatientCallSessions(res.data.callSessions || []);
      setSelectedSession((res.data.callSessions || [])[0] || null);
      setTranscriptText('');
      setNewConsultation({ date: '', time: '' });
      setReportMode(true);
    } catch (err) {
      console.error('Error fetching patient history', err);
    }
  };

  const approveAppointment = async (appointmentId) => {
    try {
      const doctorId = localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId');
      await api.patch(`/api/appointment/${appointmentId}/approve`, { doctorId });
      alert('Appointment approved successfully. The patient has been notified.');
      fetchDoctorRequests();
      fetchAppointments();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to approve appointment.');
    }
  };

  const declineAppointment = async (appointmentId) => {
    try {
      await api.patch(`/api/appointment/${appointmentId}/decline`);
      alert('Appointment declined.');
      fetchDoctorRequests();
      fetchAppointments();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to decline appointment.');
    }
  };

  const startCall = async (appointmentId) => {
    try {
      const doctorId = localStorage.getItem('doctorAuthId') || localStorage.getItem('doctorId');
      const response = await api.patch(`/api/appointment/${appointmentId}/start-call`, { doctorId });
      alert(`Call started. Patient notified. Join: ${response.data.appointment.roomUrl}`);
      fetchDoctorRequests();
      fetchAppointments();
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to start call.');
    }
  };

  const scheduleConsultation = async (e) => {
    e.preventDefault();
    if (!selectedPatient || !newConsultation.date || !newConsultation.time) {
      alert('Select a patient and a valid date and time before scheduling the consultation.');
      return;
    }

    try {
      const response = await api.post('/api/appointment/book', {
        patientId: selectedPatient._id,
        patientName: selectedPatient.fullName,
        scheduledDate: newConsultation.date,
        scheduledTime: newConsultation.time
      });

      const roomUrl = response?.data?.appointment?.roomUrl;
      alert(`Consultation scheduled successfully. Join link: ${roomUrl || 'generated after booking'}`);
      setNewConsultation({ date: '', time: '' });
      fetchAppointments();
      fetchCallSessions();
      inspectPatient(selectedPatient._id);
    } catch (err) {
      alert(err?.response?.data?.error || 'Unable to schedule consultation.');
    }
  };

  const getBandColor = (band) => {
    switch (band) {
      case 'Red': return '#ef4444';
      case 'Orange': return '#f59e0b';
      case 'Yellow': return '#eab308';
      case 'Green': return '#22c55e';
      default: return '#94a3b8';
    }
  };

  const generatePatientReportText = () => {
    if (!selectedPatient) return '';

    const profileSummary = [
      'MENTAL HEALTH PATIENT REPORT',
      '===========================',
      `Patient: ${selectedPatient.fullName}`,
      `Age/Gender: ${selectedPatient.age} / ${selectedPatient.gender}`,
      `Phone: ${selectedPatient.phoneNumber}`,
      `Emergency Contact: ${selectedPatient.emergencyContact}`,
      `Current Risk Band: ${selectedPatient.currentRiskBand || 'Green'}`,
      '',
      'DAILY REPORTS',
      '-------------'
    ];

    const dailyReports = patientHistory.length
      ? patientHistory.map(chk => (
          `- ${new Date(chk.date).toLocaleDateString()}: Sleep ${chk.sleepHours} hrs, Mood ${chk.moodScore}/10, Anxiety ${chk.anxietyLevel}/10, Risk ${chk.calculatedBand}. Journal: ${chk.journalText || 'No journal entry'}`
        )).join('\n')
      : 'No daily check-ins recorded yet.';

    const consultationReports = patientCallSessions.length
      ? patientCallSessions.map(session => (
          `\n- ${session.scheduledDate} at ${session.scheduledTime}\n  Summary: ${session.summary || 'No transcript captured yet.'}\n  Transcript:\n${(session.transcript || []).map(item => `    ${item.author}: ${item.message}`).join('\n') || '    No transcript captured yet.'}`
        )).join('\n')
      : 'No consultation sessions saved for this patient yet.';

    return [
      ...profileSummary,
      dailyReports,
      '',
      'CONSULTATION SUMMARY',
      '--------------------',
      consultationReports,
      '',
      'Generated on: ' + new Date().toLocaleString()
    ].join('\n');
  };

  const handleDownloadReport = () => {
    if (!selectedPatient) return;
    const text = generatePatientReportText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedPatient.fullName.replace(/\s+/g, '_')}_report.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const upcomingCalls = [...doctorAppointments, ...appointments]
    .filter(appointment => appointment.status === 'Approved' && appointment.roomUrl)
    .filter((appointment, index, all) => all.findIndex(item => String(item._id) === String(appointment._id)) === index)
    .sort((first, second) => new Date(`${first.scheduledDate}T${first.scheduledTime}`).getTime() - new Date(`${second.scheduledDate}T${second.scheduledTime}`).getTime());

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f8fbff 0%, #f5f3ff 100%)',
      padding: '32px 18px'
    }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{
          background: '#fff',
          borderRadius: '22px',
          boxShadow: '0 12px 30px rgba(31, 41, 55, 0.08)',
          padding: '26px 28px',
          marginBottom: '26px'
        }}>
          <div style={{ fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', color: '#4f46e5', fontWeight: '700' }}>Doctor Triage</div>
          <h2 style={{ margin: '8px 0 6px', color: '#14213d' }}>Priority Command Center</h2>
          <p style={{ margin: 0, color: '#475569' }}>Critical patients are prioritized first from Red to Green.</p>
        </div>

        {reportMode && selectedPatient ? (
          <div style={{ display: 'grid', gap: '20px' }}>
            <div style={{ ...cardStyle, padding: '24px 26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <div>
                  <div style={{ fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', color: '#4f46e5', fontWeight: '700' }}>Patient Report</div>
                  <h3 style={{ margin: '8px 0 0', color: '#12263a' }}>{selectedPatient.fullName}</h3>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setReportMode(false)}
                    style={{ border: '1px solid #dfe7f3', borderRadius: '10px', padding: '10px 14px', background: '#fff', color: '#0f172a', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Back to Patients
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    style={{ border: 'none', borderRadius: '10px', padding: '10px 14px', background: '#0f172a', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Download Report
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                <div style={infoTile}><strong>Age / Gender:</strong><br />{selectedPatient.age} / {selectedPatient.gender}</div>
                <div style={infoTile}><strong>Phone:</strong><br />{selectedPatient.phoneNumber}</div>
                <div style={infoTile}><strong>Emergency Contact:</strong><br />{selectedPatient.emergencyContact}</div>
                <div style={infoTile}><strong>Current Risk:</strong><br /><span style={{ color: getBandColor(selectedPatient.currentRiskBand), fontWeight: '700' }}>{selectedPatient.currentRiskBand}</span></div>
              </div>

              <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #dbeafe', background: '#f8fbff', marginBottom: '20px' }}>
                <h4 style={{ marginTop: 0, color: '#12263a' }}>Patient File Summary</h4>
                <p style={{ margin: '6px 0', color: '#334155' }}>{patientReport?.notes || 'No patient summary available yet.'}</p>
                {patientReport?.averages && (
                  <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', color: '#475569', fontSize: '14px' }}>
                    <span>Average mood: <strong>{patientReport.averages.mood}</strong></span>
                    <span>Average anxiety: <strong>{patientReport.averages.anxiety}</strong></span>
                    <span>Average sleep: <strong>{patientReport.averages.sleep} hrs</strong></span>
                    <span>Appointments: <strong>{patientReport.appointmentCount ?? patientAppointments.length}</strong></span>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>Appointment History</h4>
                  {patientAppointments.length === 0 ? <p style={{ color: '#64748b' }}>No appointments recorded.</p> : (
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {patientAppointments.map(appointment => (
                        <div key={appointment._id} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                          <strong>{appointment.scheduledDate} at {appointment.scheduledTime}</strong>
                          <div style={{ color: '#475569', fontSize: '13px', marginTop: '4px' }}>Status: {appointment.status} | Priority: {appointment.urgency || 'Routine'}</div>
                          {appointment.callEnded && <div style={{ color: '#64748b', fontSize: '13px', marginTop: '4px' }}>Call ended</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>Patient Notifications</h4>
                  {patientNotifications.length === 0 ? <p style={{ color: '#64748b' }}>No notifications recorded.</p> : (
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {patientNotifications.slice(0, 5).map(notification => (
                        <div key={notification._id} style={{ padding: '9px', borderRadius: '8px', background: notification.severity === 'critical' ? '#fff1f2' : '#f8fafc', color: '#334155', fontSize: '13px' }}>
                          {notification.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>AI Conversation Summary</h4>
                  <p style={{ color: '#475569', lineHeight: 1.6, marginBottom: 0 }}>{patientReport?.aiSummary || 'No AI conversation captured yet.'}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>Daily Reports</h4>
                  {patientHistory.length === 0 ? (
                    <p style={{ color: '#64748b' }}>No daily check-ins recorded yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {patientHistory.map(chk => (
                        <div key={chk._id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', background: '#fbfdff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                            <strong>{new Date(chk.date).toLocaleDateString()}</strong>
                            <span style={{ background: getBandColor(chk.calculatedBand), color: '#fff', borderRadius: '999px', padding: '4px 8px', fontSize: '11px', fontWeight: '700' }}>{chk.calculatedBand}</span>
                          </div>
                          <div style={{ marginTop: '6px', color: '#475569' }}>Sleep: {chk.sleepHours} hrs | Mood: {chk.moodScore}/10 | Anxiety: {chk.anxietyLevel}/10</div>
                          <div style={{ marginTop: '6px', color: '#334155' }}>Journal: {chk.journalText || 'No journal entry'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>Consultation Summary</h4>
                  {patientCallSessions.length === 0 ? (
                    <p style={{ color: '#64748b' }}>No consultation sessions saved for this patient yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {patientCallSessions.map(session => (
                        <div key={session._id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', background: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                            <strong>{session.scheduledDate} at {session.scheduledTime}</strong>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSession(session);
                                  setTranscriptText((session.transcript || []).map(item => `${item.author || 'Doctor'}: ${item.message || ''}`).join('\n'));
                                }}
                                style={{ background: '#eef2ff', color: '#3730a3', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontWeight: 600 }}
                              >
                                {selectedSession && selectedSession._id === session._id ? 'Selected' : 'Add Transcript'}
                              </button>
                              {isAppointmentLive(session.scheduledDate, session.scheduledTime, now) ? (
                                <>
                                  <a href={`/call/${encodeURIComponent(session.roomUrl)}?role=doctor&name=${encodeURIComponent(localStorage.getItem('doctorName') || 'Doctor')}&patient=${encodeURIComponent(session.patientName || 'Patient')}&date=${encodeURIComponent(session.scheduledDate)}&time=${encodeURIComponent(session.scheduledTime)}&appointmentId=${encodeURIComponent(session.appointmentId || '')}`} target="_blank" rel="noreferrer" style={{ color: '#0f766e', fontWeight: '700' }}>Open In-App Call</a>
                                  <a href={session.roomUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: '700' }}>Open Jitsi</a>
                                </>
                              ) : (
                                <span style={{ color: '#64748b', fontSize: '13px' }}>Available at appointment time</span>
                              )}
                            </div>
                          </div>
                          <div style={{ marginTop: '8px', color: '#334155' }}><strong>Summary:</strong> {session.summary || 'No transcript captured yet.'}</div>
                          {session.clinicalNote?.text && <div style={{ marginTop: '8px', color: '#334155' }}><strong>SOAP note drafted:</strong> {new Date(session.clinicalNote.generatedAt).toLocaleString()}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {selectedSession && (
                <>
                  <div style={{ marginTop: '22px', ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                    <h4 style={{ marginTop: 0, color: '#12263a' }}>Record Call Transcript</h4>
                    <div style={{ fontSize: '13px', color: '#475569', marginBottom: '10px' }}>
                      Session: {selectedSession.scheduledDate} at {selectedSession.scheduledTime}
                    </div>
                    <textarea
                      value={transcriptText}
                      onChange={(e) => setTranscriptText(e.target.value)}
                      placeholder={'Patient: I feel overwhelmed\nDoctor: Let’s focus on one step at a time.'}
                      rows={8}
                      style={{ width: '100%', border: '1px solid #dfe7f3', borderRadius: '12px', padding: '12px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={draftClinicalNote}
                        disabled={isDraftingNote}
                        style={{ border: '1px solid #4f46e5', borderRadius: '10px', padding: '10px 16px', background: '#eef2ff', color: '#3730a3', fontWeight: '700', cursor: isDraftingNote ? 'wait' : 'pointer', marginRight: '10px' }}
                      >
                        {isDraftingNote ? 'Drafting SOAP Note...' : 'Draft SOAP Note'}
                      </button>
                      <button
                        type="button"
                        onClick={saveCallTranscript}
                        style={{ border: 'none', borderRadius: '10px', padding: '10px 16px', background: '#16a34a', color: '#fff', fontWeight: '700', cursor: 'pointer' }}
                      >
                        Save Transcript & Generate Summary
                      </button>
                    </div>
                    {selectedSession.clinicalNote?.text && (
                      <div style={{ marginTop: '18px', border: '1px solid #c7d2fe', borderRadius: '12px', padding: '14px', background: '#f8faff', whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#1e293b' }}>
                        <strong>Clinical Session Note (Draft)</strong>
                        <div style={{ marginTop: '8px' }}>{selectedSession.clinicalNote.text}</div>
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>LLM-generated draft. Clinician review and editing are required before clinical use.</div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div style={{ marginTop: '22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ ...cardStyle, padding: '18px', boxShadow: 'none', border: '1px solid #edf2f7' }}>
                  <h4 style={{ marginTop: 0, color: '#12263a' }}>Schedule Consultation</h4>
                  <form onSubmit={scheduleConsultation} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: '700' }}>Date</label>
                      <input type="date" value={newConsultation.date} onChange={(e) => setNewConsultation(prev => ({ ...prev, date: e.target.value }))} required style={{ width: '100%', border: '1px solid #dfe7f3', borderRadius: '10px', padding: '10px', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: '700' }}>Time</label>
                      <input type="time" value={newConsultation.time} onChange={(e) => setNewConsultation(prev => ({ ...prev, time: e.target.value }))} required style={{ width: '100%', border: '1px solid #dfe7f3', borderRadius: '10px', padding: '10px', boxSizing: 'border-box' }} />
                    </div>
                    <button type="submit" style={{ border: 'none', borderRadius: '10px', padding: '10px 14px', background: '#1d4ed8', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
                      Schedule
                    </button>
                  </form>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.9fr', gap: '24px' }}>
            <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#12263a' }}>Upcoming Calls</h3>
                  <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '13px' }}>Open an approved in-app call directly from the main dashboard.</p>
                </div>
                <button type="button" onClick={() => { fetchAppointments(); fetchCallSessions(); }} style={buttonStyle}>Refresh Calls</button>
              </div>
              {upcomingCalls.length === 0 ? (
                <p style={{ color: '#64748b', marginBottom: 0 }}>No approved calls scheduled.</p>
              ) : (
                <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
                  {upcomingCalls.map(appointment => (
                    <div key={appointment._id} style={{ border: '1px solid #dbeafe', borderRadius: '12px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap', background: '#f8fbff' }}>
                      <div>
                        <strong>{appointment.patientName || 'Patient'}</strong>
                        <div style={{ marginTop: '4px', color: '#475569' }}>{appointment.scheduledDate} at {appointment.scheduledTime}</div>
                        <div style={{ marginTop: '4px', color: isAppointmentLive(appointment.scheduledDate, appointment.scheduledTime) ? '#047857' : '#64748b', fontSize: '13px', fontWeight: 700 }}>
                          {appointment.callEnded ? 'Call ended' : isAppointmentLive(appointment.scheduledDate, appointment.scheduledTime) ? 'Live now' : 'Scheduled'}
                        </div>
                      </div>
                      {isAppointmentLive(appointment.scheduledDate, appointment.scheduledTime, appointment.callEnded) ? (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <a href={`/call/${encodeURIComponent(appointment.roomUrl)}?role=doctor&name=${encodeURIComponent(localStorage.getItem('doctorName') || 'Doctor')}&patient=${encodeURIComponent(appointment.patientName || 'Patient')}&date=${encodeURIComponent(appointment.scheduledDate)}&time=${encodeURIComponent(appointment.scheduledTime)}&appointmentId=${encodeURIComponent(appointment._id)}`} target="_blank" rel="noreferrer" style={{ ...buttonStyle, textDecoration: 'none', background: '#0f766e' }}>
                            Open In-App Call
                          </a>
                          <a href={appointment.roomUrl} target="_blank" rel="noreferrer" style={{ ...buttonStyle, textDecoration: 'none', background: '#2563eb' }}>
                            Open Jitsi
                          </a>
                        </div>
                      ) : <span style={{ color: '#64748b', fontSize: '13px' }}>Link available 2 minutes before</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, color: '#12263a' }}>Patients by Risk Priority</h3>
                <button type="button" onClick={fetchPatients} style={{ ...buttonStyle, marginRight: '8px' }}>
                  Refresh Patients
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('isDoctorAuthenticated');
                    navigate('/doctor');
                  }}
                  style={{ border: 'none', borderRadius: '10px', background: '#e2e8f0', color: '#0f172a', padding: '8px 12px', cursor: 'pointer', fontWeight: 700 }}
                >
                  Logout
                </button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={thStyle}>Risk</th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Age / Gender</th>
                      <th style={thStyle}>Phone</th>
                      <th style={thStyle}>Emergency</th>
                      <th style={thStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map(patient => {
                      const patientName = patient.fullName || patient.name || patient.patientName || 'Unnamed Patient';
                      return (
                      <tr key={patient._id || patientName} style={{ borderBottom: '1px solid #edf2f7' }}>
                        <td style={tdStyle}>
                          <span style={{
                            display: 'inline-block',
                            borderRadius: '999px',
                            padding: '6px 10px',
                            background: getBandColor(patient.currentRiskBand),
                            color: '#fff',
                            fontWeight: '700',
                            fontSize: '12px'
                          }}>
                            {patient.currentRiskBand || 'Green'}
                          </span>
                        </td>
                        <td style={tdStyle}>{patientName}</td>
                        <td style={tdStyle}>{patient.age || 'N/A'} / {patient.gender || 'Other'}</td>
                        <td style={tdStyle}>{patient.phoneNumber}</td>
                        <td style={tdStyle}>{patient.emergencyContact}</td>
                        <td style={tdStyle}>
                          <button onClick={() => inspectPatient(patient._id)} style={buttonStyle}>Inspect History</button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, color: '#12263a' }}>Emergency & Alert Center</h3>
              {notifications.length === 0 ? (
                <p style={{ color: '#64748b' }}>No active alerts.</p>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {notifications.map(item => (
                    <div key={item._id} style={{
                      border: '1px solid #fecaca',
                      background: item.severity === 'critical' ? '#fff1f2' : '#fff7ed',
                      borderRadius: '12px',
                      padding: '12px'
                    }}>
                      <div style={{ fontWeight: '700', color: '#111827' }}>{item.patientName}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', textTransform: 'uppercase' }}>{item.severity}</div>
                      <div style={{ marginTop: '8px', color: '#334155' }}>{item.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...cardStyle, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#12263a' }}>Appointment Requests</h3>
                  <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '13px' }}>Requests within 30 minutes of another booking require urgent or emergency priority.</p>
                </div>
                <button type="button" onClick={fetchDoctorRequests} style={buttonStyle}>Refresh Requests</button>
              </div>
              {doctorAppointments.length === 0 ? (
                <p style={{ color: '#64748b' }}>No appointment requests yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
                  {doctorAppointments.map(appointment => (
                    <div key={appointment._id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      <div>
                        <strong>{appointment.patientName || 'Patient'}</strong>
                        <div style={{ marginTop: '4px', color: '#475569' }}>{appointment.scheduledDate} at {appointment.scheduledTime} | {appointment.urgency || 'Routine'} | Status: {appointment.status}</div>
                        {appointment.isAvailable === false && appointment.status === 'Pending' && <div style={{ marginTop: '4px', color: '#b45309', fontSize: '13px' }}>Conflicts with another appointment within 30 minutes.</div>}
                      </div>
                      {appointment.status === 'Pending' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" onClick={() => approveAppointment(appointment._id)} style={{ ...buttonStyle, background: appointment.isAvailable === false && !['Urgent', 'Emergency'].includes(appointment.urgency) ? '#94a3b8' : '#16a34a' }}>Accept</button>
                          <button type="button" onClick={() => declineAppointment(appointment._id)} style={{ ...buttonStyle, background: '#dc2626' }}>Decline</button>
                        </div>
                      )}
                      {appointment.status === 'Approved' && appointment.roomUrl && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <a
                            href={`/call/${encodeURIComponent(appointment.roomUrl)}?role=doctor&name=${encodeURIComponent(localStorage.getItem('doctorName') || 'Doctor')}&patient=${encodeURIComponent(appointment.patientName || 'Patient')}&date=${encodeURIComponent(appointment.scheduledDate)}&time=${encodeURIComponent(appointment.scheduledTime)}&appointmentId=${encodeURIComponent(appointment._id)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ ...buttonStyle, textDecoration: 'none', background: '#0f766e' }}
                          >
                            Open In-App Call
                          </a>
                          <a
                            href={appointment.roomUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ ...buttonStyle, textDecoration: 'none', background: '#2563eb' }}
                          >
                            Open Jitsi
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle = {
  background: '#fff',
  borderRadius: '20px',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
  padding: '22px 20px'
};

const infoTile = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '12px 14px',
  color: '#1f2937',
  lineHeight: '1.6'
};

const thStyle = { padding: '12px 10px', textAlign: 'left', fontSize: '12px', color: '#475569', textTransform: 'uppercase' };
const tdStyle = { padding: '12px 10px', fontSize: '14px', color: '#1f2937' };
const buttonStyle = {
  border: 'none',
  borderRadius: '10px',
  padding: '8px 12px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: '600',
  cursor: 'pointer'
};