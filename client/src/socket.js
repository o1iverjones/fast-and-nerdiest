import { io } from 'socket.io-client';

const URL = import.meta.env.PROD ? '/' : 'http://localhost:3000';

// Stable per-tab player id that survives socket reconnects (and page reloads
// within the same tab). socket.id changes on every reconnect, so the server
// uses this pid as the canonical player identity.
function getPid() {
  let pid = sessionStorage.getItem('fan_pid');
  if (!pid) {
    pid = (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem('fan_pid', pid);
  }
  return pid;
}

export const pid = getPid();

const socket = io(URL, { autoConnect: true });

export default socket;
