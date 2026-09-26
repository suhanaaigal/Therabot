import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import PatientAuthPage from './pages/PatientAuthPage';
import PatientRegister from './pages/PatientRegister';
import PatientDashboard from './pages/PatientDashboard';
import DoctorAuthPage from './pages/DoctorAuthPage';
import DoctorDashboard from './pages/DoctorDashboard';
import VideoCallPage from './pages/VideoCallPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/patient" element={<PatientAuthPage />} />
        <Route path="/register" element={<PatientRegister />} />
        <Route path="/dashboard" element={<PatientDashboard />} />
        <Route path="/doctor" element={<DoctorAuthPage />} />
        <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
        <Route path="/call/:roomId" element={<VideoCallPage />} />
      </Routes>
    </HashRouter>
  );
}