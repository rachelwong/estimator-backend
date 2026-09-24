import { SESSION_SWEEP_INTERVAL_MS, sweepExpiredSessions } from '../sessionStore.js';
import type { AppServer } from './events.js';

// The memory half of the TTL: sessionStore.ts expires a session the moment
// anyone looks it up, which makes the deadline exact, but a session nobody
// looks at again would sit in the Map until the next deploy. This sweeps those
// out on a timer and disconnects the sockets still sitting in their rooms —
// the only part of the TTL that needs Socket.IO, which is why it lives here
// rather than in the store.
export function startSessionSweeper(
  io: AppServer,
  intervalMs: number = SESSION_SWEEP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    // Every other entry point in this app has an error boundary — REST has
    // middleware/errorHandler.ts, WS has withErrorHandling — and a timer
    // callback needs one for a blunter reason: a throw here is an uncaught
    // exception, which kills the process and wipes every live session with it.
    // A memory-hygiene sweep failing must never cost more than the sweep.
    try {
      const expiredSessionIds = sweepExpiredSessions();
      if (expiredSessionIds.length === 0) {
        return;
      }
      for (const sessionId of expiredSessionIds) {
        io.in(sessionId).disconnectSockets(true);
      }
      // Count only — never ids or names, the same restraint the rest of this
      // app's logging keeps.
      console.log(`Swept ${expiredSessionIds.length} expired session(s)`);
    } catch (error) {
      console.error('Session sweep failed', error);
    }
  }, intervalMs);

  // An unref'd timer never holds the process (or a test run) open on its own.
  timer.unref();

  return () => clearInterval(timer);
}
