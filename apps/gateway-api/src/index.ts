import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { assertRequiredInfrastructure, getEnv } from './env.js';
import { startKafkaEventRelay } from './kafka/outbox.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { startRetentionJobs } from './security/retention.js';

const app = createApp();

const env = getEnv();

assertRequiredInfrastructure();

await initDb();

startNotificationDispatcher();
startRetentionJobs();
startKafkaEventRelay().catch(error => {
  console.error('[gateway-api] kafka outbox relay failed to start:', error instanceof Error ? error.message : String(error));
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`[gateway-api] listening on http://${env.HOST}:${env.PORT}`);
});
