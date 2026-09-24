import React, { useState, useEffect } from 'react';
import { api } from '../api';

const isAppointmentLive = (scheduledDate, scheduledTime, callEnded = false) => {
  if (callEnded) return false;
  const appointmentDate = new Date(`${scheduledDate}T${scheduledTime}`);
  if (Number.isNaN(appointmentDate.getTime())) return false;
  const now = Date.now();
  return now >= appointmentDate.getTime() - (2 * 60 * 1000) && now <= appointmentDate.getTime() + 60 * 60 * 1000;
};

export default function AppointmentBooking({ patientName }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [urgency, setUrgency] = useState('Routine');
  const [now, setNow] = useState(Date.now());
  const [doctorId, setDoctorId] = useState('');
  const [slotStatus, setSlotStatus] = useState(null);
  const [myAppointments, setMyAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
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
        const assignedDoctorId = localStorage.getItem('singleDoctorId') || doctors[0]._id;
        localStorage.setItem('singleDoctorId', assignedDoctorId);
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

    let currentDoctorId = doctorId || localStorage.getItem('singleDoctorId');

    if (!currentDoctorId) {
      try {
        const fallbackDoctor = await api.get('/api/appointment/doctors');
        const fallbackId = fallbackDoctor?.data?.[0]?._id || 'doctor-default';
        localStorage.setItem('singleDoctorId', fallbackId);
        currentDoctorId = fallbackId;
        setDoctorId(fallbackId);
      } catch (err) {
        const fallbackId = 'doctor-default';
        localStorage.setItem('singleDoctorId', fallbackId);
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

  const declinedNotification = myAppointments.find(item => item.status === 'Declined' && item.urgency === 'Routine');
  const upcomingAppointments = myAppointments;

  return (
    <div style={{ border: '1px solid #ccc', padding: '20px', borderRadius: '8px', maxWidth: '500px', margin: '20px auto', background: '#fdfdfd' }}>
      <h3>Schedule Video Consultation</h3>
      {declinedNotification && (
        <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '8px', background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239', fontWeight: '700' }}>
          Doctor is busy at this time. Please book a different time.
        </div>
      )}
      {notifications.slice(0, 3).map(notification => (
        <div key={notification._id} style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '8px', background: notification.severity === 'warning' ? '#fff7ed' : '#ecfeff', border: `1px solid ${notification.severity === 'warning' ? '#fed7aa' : '#a5f3fc'}`, color: '#164e63' }}>
          <strong>{notification.severity === 'warning' ? 'Appointment update' : 'Appointment approved'}</strong>
          <div style={{ marginTop: '4px' }}>{notification.message}</div>
        </div>
      ))}
      <form onSubmit={handleBook}>
        <label>Select Date:</label><br/>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required style={{ width: '100%', padding: '6px', marginBottom: '10px' }} /><br/>

        <label>Select Time:</label><br/>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} required style={{ width: '100%', padding: '6px', marginBottom: '12px' }} /><br/>

        <label>Priority:</label><br/>
        <select value={urgency} onChange={e => setUrgency(e.target.value)} style={{ width: '100%', padding: '6px', marginBottom: '12px' }}>
          <option value="Routine">Routine</option>
          <option value="Urgent">Urgent</option>
          <option value="Emergency">Emergency</option>
        </select><br/>

        <button
          type="submit"
          style={{
            width: '100%',
            padding: '10px',
            background: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Request Appointment
        </button>
      </form>

      <h4 style={{ marginTop: '25px' }}>Your Consultations:</h4>
      <ul style={{ paddingLeft: '20px' }}>
        {upcomingAppointments.length === 0 ? (
          <li style={{ color: '#64748b' }}>No appointments yet.</li>
        ) : (
          upcomingAppointments.map(app => (
            <li key={app._id} style={{ marginBottom: '18px' }}>
              <div><strong>{app.doctorName || 'Doctor'}</strong> — {app.scheduledDate} at {app.scheduledTime}</div>
              <div style={{ fontSize: '13px', color: '#475569' }}>Status: {app.status}</div>
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
                      <a href={`/call/${encodeURIComponent(app.roomUrl)}?role=patient&name=${encodeURIComponent(patientName || 'Patient')}&patient=${encodeURIComponent(patientName || 'Patient')}&date=${encodeURIComponent(app.scheduledDate)}&time=${encodeURIComponent(app.scheduledTime)}&appointmentId=${encodeURIComponent(app._id)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0f766e', fontWeight: 'bold', marginRight: '12px' }}>
                        Join In-App Call
                      </a>
                      <a href={app.roomUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#007bff', fontWeight: 'bold' }}>
                        Join Jitsi
                      </a>
                    </>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: '13px' }}>
                      <a
                        href={app.roomUrl}
                        onClick={event => event.preventDefault()}
                        aria-disabled="true"
                        style={{ color: '#64748b', fontWeight: '700', cursor: 'not-allowed', marginRight: '8px' }}
                      >
                        Join Jitsi
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

      <div style={{ marginTop: '12px', fontSize: '13px', color: '#475569' }}>
        Only the assigned doctor and patient can access the Jitsi room for this consultation.
      </div>
    </div>
  );
}