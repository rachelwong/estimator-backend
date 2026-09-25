import type { AppServer } from './ws/events.js';

// If shutdown takes longer than this, exit anyway.
export const FORCE_EXIT_AFTER_MS = 10 * 1000;

// Returns the function server.ts runs on SIGTERM/SIGINT: stop the sweeper,
// close all sockets and the HTTP server, then exit.
//
// io.close() also closes the HTTP server, so we don't call httpServer.close().
// This lives outside server.ts so it can be tested.
export function createShutdown(
  io: AppServer,
  stopSweeper: () => void,
  exit: (code: number) => void = (code) => process.exit(code),
  forceExitAfterMs: number = FORCE_EXIT_AFTER_MS,
): (signal: string) => void {
  let shuttingDown = false;

  return (signal) => {
    // Ignore any signal after the first.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    // Force exit if closing gets stuck. unref() so this timer alone doesn't
    // keep the process running.
    setTimeout(() => {
      console.error(`Shutdown did not finish within ${forceExitAfterMs}ms, forcing exit`);
      exit(1);
    }, forceExitAfterMs).unref();

    stopSweeper();
    void io.close((error) => {
      if (error) {
        console.error('Error while closing the server', error);
        exit(1);
        return;
      }
      exit(0);
    });
  };
}
