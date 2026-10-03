import React, { useState, useEffect } from 'react';
import { api } from '../api';

const isAppointmentLive = (scheduledDate, scheduledTime, callEnded = false) => {
  if (callEnded) return false;
  const appointmentDate = new Date(`${scheduledDate}T${scheduledTime}`);
  if (Number.isNaN(appointmentDate.getTime())) return false;
  const now = Date.now();
  return now >= appointmentDate.getTime() - (2 * 60 * 1000) && now <= appointmentDate.getTime() + 60 * 60 * 1000;
};

const getAppointmentCountdown = (scheduledDate, scheduledTime, currentTime) => {
  const appointmentTime = new Date(`${scheduledDate}T${scheduledTime}`).getTime();
  if (!Number.isFinite(appointmentTime)) return '';
  const difference = appointmentTime - currentTime;
  if (difference <= 0 && difference > -(60 * 60 * 1000)) return 'Your consultation window is open.';
  if (difference <= 0) return '';
  const totalMinutes = Math.ceil(difference / 60000);
  if (totalMinutes < 60) return `Starts in ${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}.`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `Starts in ${hours}h${minutes ? ` ${minutes}m` : ''}.`;
};

const isNotificationRelevant = (notification, currentTime) => {
  const approvedSlot = String(notification?.message || '').match(/approved for (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2})/i);
  if (!approvedSlot) return true;
  const appointmentTime = new Date(`${approvedSlot[1]}T${approvedSlot[2]}`).getTime();
  return !Number.isFinite(appointmentTime) || appointmentTime + (60 * 60 * 1000) >= currentTime;
};

export default function AppointmentBooking({ patientName }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [urgency, setUrgency] = useState('Routine');
  const [now, setNow] = useState(Date.now());
  const [doctorId, setDoctorId] = useState(localStorage.getItem('assignedDoctorId') || '');
  const [slotStatus, setSlotStatus] = useState(null);
  const [myAppointments, setMyAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const patientId = localStorage.getItem('patientId') || 'demo-patient-id';

  useEffect(() => {
    fetchDoctors();
    fetchAppointments();
    fetchNotifications();
    const timer = setInterval(() => {
      setNow(Date.now());
      fetchAppointments();
      fetchNotifications();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const fetchDoctors = async () => {
    try {
      const res = await api.get('/api/appointment/doctors');
      const doctors = res.data || [];
      if (doctors.length > 0) {
        const assignedDoctorId = localStorage.getItem('assignedDoctorId') || doctors[0]._id;
        setDoctorId(assignedDoctorId);
      }
    } catch (err) {
      console.error('Error fetching doctors', err);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await api.get(`/api/appointment/patient/${patientId}/notifications`);
      setNotifications(res.data || []);
    } catch (err) {
      console.error('Error fetching patient notifications', err);
    }
  };

  useEffect(() => {
    if (!doctorId || !date || !time) {
      setSlotStatus(null);
      return;
    }

    const timeout = setTimeout(() => {
      checkAvailability();
    }, 300);

    return () => clearTimeout(timeout);
  }, [doctorId, date, time]);

  const fetchAppointments = async () => {
    try {
      const res = await api.get(`/api/appointment/patient/${patientId}`);
      setMyAppointments((res.data || []).filter(appointment => appointment?.scheduledDate));
    } catch (err) {
      console.error('Error fetching appointments', err);
    }
  };

  const checkAvailability = async () => {
    try {
      const res = await api.get('/api/appointment/check-availability', {
        params: { doctorId, scheduledDate: date, scheduledTime: time }
      });
      setSlotStatus(res.data);
    } catch (err) {
      setSlotStatus({ available: false, conflict: { patientName: 'Doctor' } });
    }
  };

  const handleBook = async (e) => {
    e.preventDefault();

    if (!date || !time) {
      alert('Please select a date and time.');
      return;
    }
    if (slotStatus && !slotStatus.available) {
      alert('That time is no longer available. Please choose another time.');
      return;
    }

    let currentDoctorId = localStorage.getItem('assignedDoctorId') || doctorId;

    if (!currentDoctorId) {
      try {
        const fallbackDoctor = await api.get('/api/appointment/doctors');
        const fallbackId = fallbackDoctor?.data?.[0]?._id || 'doctor-default';
        currentDoctorId = fallbackId;
        setDoctorId(fallbackId);
      } catch (err) {
        const fallbackId = 'doctor-default';
        currentDoctorId = fallbackId;
        setDoctorId(fallbackId);
      }
    }

    try {
      const response = await api.post('/api/appointment/request', {
        patientId: patientId || 'demo-patient-id',
        patientName: patientName || 'Patient',
        doctorId: currentDoctorId,
        doctorName: localStorage.getItem('doctorName') || 'Doctor',
        scheduledDate: date,
        scheduledTime: time,
        urgency
      });

      const successMessage = response?.data?.message || `Appointment requested successfully. Waiting for doctor approval on ${date} at ${time}.`;
      alert(successMessage);
      setDoctorId(currentDoctorId);
      setDate('');
      setTime('');
      setUrgency('Routine');
      setSlotStatus(null);
      await fetchAppointments();
    } catch (err) {
      const message = err?.response?.data?.error || 'Error booking appointment';
      alert(message);
    }
  };

  const isCurrentAppointment = appointment => {
    if (!['Pending', 'Approved'].includes(appointment.status) || appointment.callEnded) return false;
    const appointmentDate = new Date(`${appointment.scheduledDate}T${appointment.scheduledTime}`).getTime();
    return appointment.status === 'Pending' || !Number.isFinite(appointmentDate) || appointmentDate + (60 * 60 * 1000) >= now;
  };
  const currentAppointments = myAppointments.filter(isCurrentAppointment);
  const appointmentHistory = myAppointments.filter(appointment => !isCurrentAppointment(appointment));
  const visibleNotifications = notifications
    .filter(notification => notification?.message)
    .filter(notification => isNotificationRelevant(notification, now))
    .filter((notification, index, all) => all.findIndex(item => item.message === notification.message) === index)
    .slice(0, 1);

  return (
    <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', maxWidth: '500px', margin: '20px auto', background: '#fdfdfd' }}>
      <h3>Schedule Video Consultation</h3>
      {visibleNotifications.map(notification => (
        <div key={notification._id} style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '8px', background: notification.severity === 'warning' ? '#fff7ed' : '#ecfeff', border: `1px solid ${notification.severity === 'warning' ? '#fed7aa' : '#a5f3fc'}`, color: '#164e63' }}>
          <strong>{notification.severity === 'warning' ? 'Appointment update' : 'Appointment approved'}</strong>
          <div style={{ marginTop: '4px' }}>{notification.message}</div>
        </div>
      ))}
      <form onSubmit={handleBook}>
        <label>Select Date:</label><br/>
        <input type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={e => setDate(e.target.value)} required style={{ width: '100%', padding: '6px', marginBottom: '10px' }} /><br/>

        <label>Select Time:</label><br/>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} required style={{ width: '100%', padding: '6px', marginBottom: '12px' }} /><br/>

        <label>Priority:</label><br/>
        <select value={urgency} onChange={e => setUrgency(e.target.value)} style={{ width: '100%', padding: '6px', marginBottom: '12px' }}>
          <option value="Routine">Routine</option>
          <option value="Urgent">Urgent</option>
          <option value="Emergency">Emergency</option>
        </select><br/>

        {slotStatus && (
          <div role="status" style={{ marginBottom: '12px', padding: '9px 10px', borderRadius: '6px', background: slotStatus.available ? '#ecfdf5' : '#fff1f2', border: `1px solid ${slotStatus.available ? '#a7f3d0' : '#fecdd3'}`, color: slotStatus.available ? '#166534' : '#9f1239', fontSize: '13px' }}>
            {slotStatus.available ? 'This time is available.' : 'This time is already booked. Please choose another time.'}
          </div>
        )}

        <button
          type="submit"
          disabled={Boolean(slotStatus && !slotStatus.available)}
          style={{
            width: '100%',
            padding: '10px',
            background: slotStatus && !slotStatus.available ? '#94a3b8' : '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: slotStatus && !slotStatus.available ? 'not-allowed' : 'pointer'
          }}
        >
          Request Appointment
        </button>
      </form>

      <h4 style={{ marginTop: '25px' }}>Your Consultations:</h4>
      <ul style={{ paddingLeft: '20px' }}>
        {currentAppointments.length === 0 ? (
          <li style={{ color: '#64748b' }}>No appointments yet.</li>
        ) : (
          currentAppointments.map(app => (
            <li key={app._id} style={{ marginBottom: '18px' }}>
              <div><strong>{app.doctorName || 'Doctor'}</strong> — {app.scheduledDate} at {app.scheduledTime}</div>
              <div style={{ fontSize: '13px', color: '#475569' }}>Status: {app.status}</div>
              {app.status === 'Approved' && !app.callEnded && getAppointmentCountdown(app.scheduledDate, app.scheduledTime, now) && (
                <div style={{ marginTop: '6px', color: '#0f766e', fontSize: '13px', fontWeight: '700' }}>{getAppointmentCountdown(app.scheduledDate, app.scheduledTime, now)}</div>
              )}
              {app.status === 'Declined' ? (
                <div style={{ marginTop: '8px', color: '#9f1239', fontWeight: '700' }}>
                  Doctor declined this routine appointment. Please book another time.
                </div>
              ) : app.status === 'Approved' && app.roomUrl ? (
                <div style={{ marginTop: '8px' }}>
                  {app.callEnded ? (
                    <div style={{ color: '#64748b', fontSize: '13px' }}>This consultation has ended. The report is available in the doctor&apos;s patient record.</div>
                  ) : isAppointmentLive(app.scheduledDate, app.scheduledTime) ? (
                    <>
                      <a href={`/#/call/${encodeURIComponent(app.roomUrl)}?role=patient&name=${encodeURIComponent(patientName || 'Patient')}&patient=${encodeURIComponent(patientName || 'Patient')}&date=${encodeURIComponent(app.scheduledDate)}&time=${encodeURIComponent(app.scheduledTime)}&appointmentId=${encodeURIComponent(app._id)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0f766e', fontWeight: 'bold', marginRight: '12px' }}>
                        Join In-App Call
                      </a>
                      <a href={`/#/jitsi/${encodeURIComponent(app.roomUrl)}?role=patient&name=${encodeURIComponent(patientName || 'Patient')}&patient=${encodeURIComponent(patientName || 'Patient')}&date=${encodeURIComponent(app.scheduledDate)}&time=${encodeURIComponent(app.scheduledTime)}&appointmentId=${encodeURIComponent(app._id)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', fontWeight: 'bold' }}>
                        Join Jitsi + Auto Report
                      </a>
                    </>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: '13px' }}>
                      <a
                        href={`/#/jitsi/${encodeURIComponent(app.roomUrl)}?role=patient&name=${encodeURIComponent(patientName || 'Patient')}&patient=${encodeURIComponent(patientName || 'Patient')}&date=${encodeURIComponent(app.scheduledDate)}&time=${encodeURIComponent(app.scheduledTime)}&appointmentId=${encodeURIComponent(app._id)}`}
                        onClick={event => event.preventDefault()}
                        aria-disabled="true"
                        style={{ color: '#64748b', fontWeight: '700', cursor: 'not-allowed', marginRight: '8px' }}
                      >
                        Join Jitsi + Auto Report
                      </a>
                      Link activates 2 minutes before the appointment and remains available for one hour.
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {appointmentHistory.length > 0 && (
        <div style={{ marginTop: '18px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
          <button type="button" onClick={() => setShowHistory(value => !value)} style={{ border: 0, padding: 0, background: 'transparent', color: '#475569', cursor: 'pointer', fontWeight: '700' }}>
            {showHistory ? 'Hide consultation history' : `Show consultation history (${appointmentHistory.length})`}
          </button>
          {showHistory && (
            <ul style={{ paddingLeft: '20px', marginBottom: 0 }}>
              {appointmentHistory.map(app => (
                <li key={app._id} style={{ marginTop: '12px', color: '#475569' }}>
                  <div><strong>{app.doctorName || 'Doctor'}</strong> — {app.scheduledDate} at {app.scheduledTime}</div>
                  <div style={{ fontSize: '13px' }}>Status: {app.callEnded ? 'Completed' : app.status}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ marginTop: '12px', fontSize: '13px', color: '#475569' }}>
        Only the assigned doctor and patient can access the Jitsi room for this consultation.
      </div>
    </div>
  );
}