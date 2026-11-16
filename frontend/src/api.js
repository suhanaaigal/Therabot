import axios from 'axios';

const configuredBackendUrl = import.meta.env.VITE_API_URL;
const hostedBackendUrl = configuredBackendUrl && !/^https?:\/\//i.test(configuredBackendUrl)
	? `https://${configuredBackendUrl}`
	: configuredBackendUrl;

const sameOriginBackendUrl = `${window.location.protocol}//${window.location.hostname}:5000`;

export const backendUrl = hostedBackendUrl || sameOriginBackendUrl;
export const api = axios.create({ baseURL: backendUrl });
const isDoctorRequest = url => {
	const path = String(url || '');
	return path.startsWith('/api/doctor') ||
		path.includes('/api/appointment/all') ||
		path.includes('/api/appointment/doctor/') ||
		path.includes('/api/appointment/session/') ||
		/\/api\/appointment\/[^/]+\/(?:approve|decline|end-call)$/.test(path);
};
api.interceptors.request.use(config => {
	const doctorToken = localStorage.getItem('doctorSessionToken');
	const patientToken = localStorage.getItem('patientSessionToken');
	const sessionToken = isDoctorRequest(config.url) ? doctorToken : (patientToken || doctorToken);
	if (sessionToken) config.headers.Authorization = `Bearer ${sessionToken}`;
	return config;
});
