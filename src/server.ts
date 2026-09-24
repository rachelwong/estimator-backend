import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { registerSocketHandlers } from './ws/handlers.js';
import { createIoServer } from './ws/ioServer.js';
import { startSessionSweeper } from './ws/sessionSweeper.js';

const config = loadConfig();
const app = createApp(config);
const httpServer = http.createServer(app);

const io = createIoServer(httpServer, config);
registerSocketHandlers(io);
// Returns a stop() that part 3's graceful shutdown will call; nothing needs it
// while the only way this process stops is being killed.
startSessionSweeper(io);

httpServer.listen(config.port, () => {
  console.log(`Jira poker backend listening on port ${config.port}`);
});
