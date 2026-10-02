import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/TherabotHomePage';
import PatientRegister from './pages/PatientRegister';
import PatientDashboard from './pages/TherabotPatientDashboard';
import DoctorDashboard from './pages/TherabotDoctorDashboard';
import TherabotAuthPage from './pages/TherabotAuthPage';
import VideoCallPage from './pages/VideoCallPage';
import JitsiConsultationPage from './pages/JitsiConsultationPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/patient" element={<TherabotAuthPage role="patient" />} />
        <Route path="/register" element={<PatientRegister />} />
        <Route path="/dashboard" element={<PatientDashboard />} />
        <Route path="/doctor" element={<TherabotAuthPage role="doctor" />} />
        <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
        <Route path="/call/:roomId" element={<VideoCallPage />} />
        <Route path="/jitsi/:roomUrl" element={<JitsiConsultationPage />} />
      </Routes>
    </HashRouter>
  );
}