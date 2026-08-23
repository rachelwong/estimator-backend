import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { registerSocketHandlers } from './ws/handlers.js';
import { createIoServer } from './ws/ioServer.js';

const config = loadConfig();
const app = createApp(config);
const httpServer = http.createServer(app);

const io = createIoServer(httpServer, config);
registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`Jira poker backend listening on port ${config.port}`);
});
