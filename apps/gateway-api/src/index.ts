import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { assertRequiredInfrastructure, getEnv } from './env.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { startRetentionJobs } from './security/retention.js';
const app = createApp();

const env = getEnv();

assertRequiredInfrastructure();

await initDb();

startNotificationDispatcher();
startRetentionJobs();

app.listen(env.PORT, '127.0.0.1', () => {
  console.log(`[gateway-api] listening on http://127.0.0.1:${env.PORT}`);
});
