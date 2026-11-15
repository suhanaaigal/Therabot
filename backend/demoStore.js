const demoPatients = new Map();
const demoCheckIns = new Map();
const demoDoctors = new Map();
const demoAppointments = [];
const demoCallSessions = [];
const demoNotifications = [];
const demoStressReadings = new Map();
const demoQuestionnaires = new Map();
const demoChatMessages = new Map();

const createSampleCheckIns = (patientId, profile) => Array.from({ length: 10 }, (_, index) => {
  const date = new Date(Date.now() - (9 - index) * 3 * 24 * 60 * 60 * 1000);
  const moodScore = Math.min(10, Math.max(1, profile.moodStart + index * profile.moodStep));
  const anxietyLevel = Math.min(10, Math.max(1, profile.anxietyStart - index * profile.anxietyStep));
  return {
    patientId,
    sleepHours: Number((profile.sleepStart + index * profile.sleepStep).toFixed(1)),
    moodScore,
    anxietyLevel,
    journalText: profile.journals[index % profile.journals.length],
    calculatedBand: profile.band,
    riskReasons: [],
    riskSource: 'rules',
    stressProbability: null,
    physiologyStressProbability: null,
    topWords: [],
    mlAnalysis: null,
    date
  };
});

const createSampleQuestionnaires = (patientId, profile) => [
  {
    patientId,
    type: 'PHQ-9',
    answers: profile.phqAnswers,
    total: profile.phqAnswers.reduce((total, answer) => total + answer, 0),
    band: profile.phqBand,
    crisisFlag: false,
    gadDifficulty: '',
    date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)
  },
  {
    patientId,
    type: 'GAD-7',
    answers: profile.gadAnswers,
    total: profile.gadAnswers.reduce((total, answer) => total + answer, 0),
    band: profile.gadBand,
    crisisFlag: false,
    gadDifficulty: profile.gadDifficulty,
    date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)
  }
];

const getFutureDateFields = daysFromNow => {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { scheduledDate: `${fields.year}-${fields.month}-${fields.day}`, scheduledTime: '10:30' };
};

const ensureDefaultDoctor = async () => {
  const existing = demoDoctors.get('doctor-default') || [...demoDoctors.values()].find(item => item.username === 'doctor');
  if (existing) return existing;
  if (process.env.NODE_ENV === 'production' || !process.env.DEMO_DOCTOR_PASSWORD) return null;

  const doctor = {
    _id: 'doctor-default',
    username: 'doctor',
    password: await require('./patientPassword').hashPatientPassword(process.env.DEMO_DOCTOR_PASSWORD),
    fullName: 'Dr. Suhana Aigal',
    specialty: 'Mental Wellness',
    createdAt: new Date()
  };

  demoDoctors.set(doctor._id, doctor);
  return doctor;
};

const seedDemoPatients = async () => {
  if (process.env.NODE_ENV === 'production' || !process.env.DEMO_DOCTOR_PASSWORD) return;
  const doctor = await ensureDefaultDoctor();
  if (!doctor) return;
  const samples = [
    { _id: 'patient-anjali-rao', fullName: 'Anjali Rao', email: 'anjali.rao@example.com', age: 24, gender: 'Female', phoneNumber: '9277689375', currentRiskBand: 'Green', moodStart: 5, moodStep: 0.4, anxietyStart: 6, anxietyStep: 0.3, sleepStart: 6.2, sleepStep: 0.1, journals: ['A busy day, but I made time to rest.', 'Feeling more balanced today.'], phqAnswers: [1, 0, 1, 1, 0, 0, 1, 0, 0], phqBand: 'Mild', gadAnswers: [1, 1, 0, 1, 0, 1, 0], gadBand: 'Mild', gadDifficulty: 'Somewhat difficult' },
    { _id: 'patient-kabir-shah', fullName: 'Kabir Shah', email: 'kabir.shah@example.com', age: 29, gender: 'Male', phoneNumber: '8862417093', currentRiskBand: 'Yellow', moodStart: 4, moodStep: 0.2, anxietyStart: 7, anxietyStep: 0.1, sleepStart: 5.4, sleepStep: 0.1, journals: ['Work felt demanding today.', 'I am trying a short walk when I feel tense.'], phqAnswers: [2, 1, 2, 2, 1, 1, 1, 1, 0], phqBand: 'Moderate', gadAnswers: [2, 2, 1, 2, 1, 1, 1], gadBand: 'Moderate', gadDifficulty: 'Very difficult' },
    { _id: 'patient-meera-nair', fullName: 'Meera Nair', email: 'meera.nair@example.com', age: 32, gender: 'Female', phoneNumber: '7985142630', currentRiskBand: 'Orange', moodStart: 3, moodStep: 0.1, anxietyStart: 8, anxietyStep: 0.05, sleepStart: 5, sleepStep: 0.05, journals: ['Sleep was difficult last night.', 'I noted my feelings and plan to discuss them.'], phqAnswers: [2, 2, 2, 2, 1, 2, 1, 1, 0], phqBand: 'Moderate', gadAnswers: [2, 2, 2, 2, 1, 2, 1], gadBand: 'Moderate', gadDifficulty: 'Very difficult' },
    { _id: 'patient-rohan-mehta', fullName: 'Rohan Mehta', email: 'rohan.mehta@example.com', age: 27, gender: 'Male', phoneNumber: '8136492751', currentRiskBand: 'Green', moodStart: 6, moodStep: 0.3, anxietyStart: 5, anxietyStep: 0.2, sleepStart: 6.5, sleepStep: 0.1, journals: ['A productive day with some time away from screens.', 'I felt supported by friends today.'], phqAnswers: [0, 1, 0, 1, 0, 0, 0, 0, 0], phqBand: 'Minimal', gadAnswers: [1, 0, 1, 0, 0, 1, 0], gadBand: 'Mild', gadDifficulty: 'Not difficult at all' },
    { _id: 'patient-sara-iyer', fullName: 'Sara Iyer', email: 'sara.iyer@example.com', age: 26, gender: 'Female', phoneNumber: '9642785316', currentRiskBand: 'Yellow', moodStart: 4, moodStep: 0.3, anxietyStart: 6, anxietyStep: 0.2, sleepStart: 5.8, sleepStep: 0.1, journals: ['I am working on a steadier evening routine.', 'Today felt a little easier than yesterday.'], phqAnswers: [1, 1, 1, 1, 1, 0, 1, 0, 0], phqBand: 'Mild', gadAnswers: [1, 2, 1, 1, 0, 1, 1], gadBand: 'Moderate', gadDifficulty: 'Somewhat difficult' }
  ];
  const password = await require('./patientPassword').hashPatientPassword('demo-patient-password');
  samples.forEach(sample => {
    const { moodStart, moodStep, anxietyStart, anxietyStep, sleepStart, sleepStep, journals, ...patientProfile } = sample;
    if (!demoPatients.has(sample._id)) {
      demoPatients.set(sample._id, {
        ...patientProfile,
        assignedDoctorId: String(doctor._id),
        password,
        privacyConsentAt: new Date(),
        privacyConsentVersion: '2026-11-04',
        emergencyContactConsent: false
      });
    }
    if (!demoCheckIns.has(sample._id)) {
      demoCheckIns.set(sample._id, createSampleCheckIns(sample._id, sample));
    }
    if (!demoQuestionnaires.has(sample._id)) {
      demoQuestionnaires.set(sample._id, createSampleQuestionnaires(sample._id, sample));
    }
    if (!demoAppointments.some(appointment => String(appointment.patientId) === sample._id)) {
      const { scheduledDate, scheduledTime } = getFutureDateFields(2 + samples.indexOf(sample));
      demoAppointments.push({
        _id: `appointment-${sample._id}`,
        patientId: sample._id,
        patientName: sample.fullName,
        doctorId: String(doctor._id),
        doctorName: doctor.fullName,
        scheduledDate,
        scheduledTime,
        scheduledAt: new Date(`${scheduledDate}T${scheduledTime}:00+05:30`),
        urgency: 'Routine',
        status: 'Approved',
        roomUrl: `https://meet.jit.si/therabot-${sample._id}`,
        callStarted: false,
        callEnded: false,
        createdAt: new Date()
      });
    }
  });
};

module.exports = {
  demoPatients,
  demoCheckIns,
  demoDoctors,
  demoAppointments,
  demoCallSessions,
  demoNotifications,
  demoStressReadings,
  demoQuestionnaires,
  demoChatMessages,
  ensureDefaultDoctor,
  seedDemoPatients
};
