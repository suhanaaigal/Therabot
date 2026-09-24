import axios from 'axios';

const configuredBackendUrl = import.meta.env.VITE_API_URL;
const hostedBackendUrl = configuredBackendUrl && !/^https?:\/\//i.test(configuredBackendUrl)
	? `https://${configuredBackendUrl}`
	: configuredBackendUrl;

export const backendUrl = hostedBackendUrl || `${window.location.protocol}//${window.location.hostname}:5000`;
export const api = axios.create({ baseURL: backendUrl });
