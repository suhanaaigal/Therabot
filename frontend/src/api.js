import axios from 'axios';

const configuredBackendUrl = import.meta.env.VITE_API_URL;
const hostedBackendUrl = configuredBackendUrl && !/^https?:\/\//i.test(configuredBackendUrl)
	? `https://${configuredBackendUrl}`
	: configuredBackendUrl;

const localDevelopmentBackendUrl = import.meta.env.DEV
	? 'https://therabot-backend-go2r.onrender.com'
	: `${window.location.protocol}//${window.location.hostname}:5000`;

export const backendUrl = hostedBackendUrl || localDevelopmentBackendUrl;
export const api = axios.create({ baseURL: backendUrl });
api.interceptors.request.use(config => {
	const doctorSessionToken = localStorage.getItem('doctorSessionToken');
	if (doctorSessionToken) config.headers.Authorization = `Bearer ${doctorSessionToken}`;
	return config;
});
