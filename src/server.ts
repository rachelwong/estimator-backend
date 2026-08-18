import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);
const httpServer = http.createServer(app);

httpServer.listen(config.port, () => {
  console.log(`Jira poker backend listening on port ${config.port}`);
});
