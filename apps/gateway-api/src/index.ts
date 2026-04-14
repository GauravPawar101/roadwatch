import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { getEnv } from './env.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { startRetentionJobs } from './security/retention.js';
const app = createApp();

const env = getEnv();
await initDb();

startNotificationDispatcher();
startRetentionJobs();

app.listen(env.PORT, () => {
  console.log(`[gateway-api] listening on http://localhost:${env.PORT}`);
});
