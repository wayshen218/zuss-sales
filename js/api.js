import { API_URL } from './config.js';

const KEY = 'zuss.apiUrl';
export const getApiUrl = () => (localStorage.getItem(KEY) || API_URL || '').trim();
export const setApiUrl = url => localStorage.setItem(KEY, String(url || '').trim());

export class NetworkError extends Error {}

// Apps Script web apps accept "simple" POSTs (text/plain) without a CORS preflight.
export async function call(action, payload = {}, timeoutMs = 30000) {
  const url = getApiUrl();
  if (!url) throw new NetworkError('Server link not set');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
      redirect: 'follow'
    });
  } catch (e) {
    throw new NetworkError(navigator.onLine ? 'Cannot reach server' : 'Offline');
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new NetworkError('Server error ' + res.status);
  let data;
  try { data = await res.json(); } catch (e) { throw new NetworkError('Unexpected server reply. Check the server link.'); }
  return data;
}
