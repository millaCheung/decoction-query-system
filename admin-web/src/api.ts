import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 10000 });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('decoction_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(r => r, e => {
  if (e.response?.status === 401) { localStorage.removeItem('decoction_token'); localStorage.removeItem('decoction_user'); location.reload(); }
  return Promise.reject(e);
});
