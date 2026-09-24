const demoPatients = new Map();
const demoCheckIns = new Map();
const demoDoctors = new Map();
const demoAppointments = [];
const demoCallSessions = [];
const demoNotifications = [];

const ensureDefaultDoctor = () => {
  const existing = demoDoctors.get('doctor-default') || [...demoDoctors.values()][0];
  if (existing) return existing;

  const doctor = {
    _id: 'doctor-default',
    username: 'doctor',
    password: 'doctor123',
    fullName: 'Dr. Aisha Khan',
    specialty: 'Mental Wellness',
    createdAt: new Date()
  };

  demoDoctors.set(doctor._id, doctor);
  return doctor;
};

module.exports = {
  demoPatients,
  demoCheckIns,
  demoDoctors,
  demoAppointments,
  demoCallSessions,
  demoNotifications,
  ensureDefaultDoctor
};
