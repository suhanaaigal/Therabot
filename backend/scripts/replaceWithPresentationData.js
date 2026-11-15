const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const DailyCheckIn = require('../models/DailyCheckIn');
const Appointment = require('../models/Appointment');
const CallSession = require('../models/CallSession');
const Notification = require('../models/Notification');
const StressReading = require('../models/StressReading');
const Questionnaire = require('../models/Questionnaire');
const ChatMessage = require('../models/ChatMessage');
const { hashPatientPassword } = require('../patientPassword');
const {
  demoPatients,
  demoCheckIns,
  demoAppointments,
  demoQuestionnaires,
  seedDemoPatients
} = require('../demoStore');

const presentationPatientIds = [
  'patient-anjali-rao',
  'patient-kabir-shah',
  'patient-meera-nair',
  'patient-rohan-mehta',
  'patient-sara-iyer'
];

const replaceWithPresentationData = async ({ patientPassword }) => {
  if (typeof patientPassword !== 'string' || patientPassword.length < 8 || patientPassword.length > 128) {
    throw new Error('The presentation patient password must be between 8 and 128 characters.');
  }

  const Doctor = require('../models/Doctor');
  const doctor = await Doctor.findOne({ username: 'doctor' });
  if (!doctor) throw new Error('The production doctor account was not found.');

  const originalNodeEnv = process.env.NODE_ENV;
  const originalDemoPassword = process.env.DEMO_DOCTOR_PASSWORD;
  process.env.NODE_ENV = 'development';
  process.env.DEMO_DOCTOR_PASSWORD = 'presentation-seed-only';
  await seedDemoPatients();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDemoPassword === undefined) delete process.env.DEMO_DOCTOR_PASSWORD;
  else process.env.DEMO_DOCTOR_PASSWORD = originalDemoPassword;

  const password = await hashPatientPassword(patientPassword);
  const patientIds = new Map();
  const patients = presentationPatientIds.map(presentationId => {
    const source = demoPatients.get(presentationId);
    if (!source) throw new Error(`Missing presentation patient: ${presentationId}`);
    const id = new mongoose.Types.ObjectId();
    patientIds.set(presentationId, String(id));
    const { _id, ...profile } = source;
    return {
      ...profile,
      _id: id,
      assignedDoctorId: String(doctor._id),
      password,
      passwordResetCodeHash: '',
      passwordResetExpiresAt: null
    };
  });

  await Promise.all([
    DailyCheckIn.deleteMany({}),
    Appointment.deleteMany({}),
    CallSession.deleteMany({}),
    Notification.deleteMany({}),
    StressReading.deleteMany({}),
    Questionnaire.deleteMany({}),
    ChatMessage.deleteMany({}),
    Patient.deleteMany({})
  ]);

  const checkIns = presentationPatientIds.flatMap(presentationId =>
    (demoCheckIns.get(presentationId) || []).map(checkIn => {
      const { _id, ...entry } = checkIn;
      return { ...entry, patientId: patientIds.get(presentationId) };
    })
  );
  const questionnaires = presentationPatientIds.flatMap(presentationId =>
    (demoQuestionnaires.get(presentationId) || []).map(questionnaire => {
      const { _id, ...entry } = questionnaire;
      return { ...entry, patientId: patientIds.get(presentationId) };
    })
  );
  const appointments = demoAppointments
    .filter(appointment => patientIds.has(String(appointment.patientId)))
    .map(appointment => {
      const { _id, ...entry } = appointment;
      return {
        ...entry,
        patientId: patientIds.get(String(appointment.patientId)),
        doctorId: String(doctor._id),
        doctorName: doctor.fullName
      };
    });

  await Promise.all([
    Patient.insertMany(patients),
    DailyCheckIn.insertMany(checkIns),
    Questionnaire.insertMany(questionnaires),
    Appointment.insertMany(appointments)
  ]);

  return {
    patients: patients.length,
    checkIns: checkIns.length,
    questionnaires: questionnaires.length,
    appointments: appointments.length
  };
};

module.exports = { replaceWithPresentationData };
