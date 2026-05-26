import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { assertRequiredInfrastructure, getEnv } from './env.js';
import { startKafkaEventRelay } from './kafka/outbox.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { startRetentionJobs } from './security/retention.js';
import { registerService } from './services/discovery.js';
const app = createApp();

const env = getEnv();

assertRequiredInfrastructure();

await initDb();

startNotificationDispatcher();
startRetentionJobs();
startKafkaEventRelay().catch(error => {
  console.error('[gateway-api] kafka outbox relay failed to start:', error instanceof Error ? error.message : String(error));
});

registerService({
  name: 'gateway-api',
  address: `http://127.0.0.1:${env.PORT}`,
  healthUrl: `http://127.0.0.1:${env.PORT}/health`,
  description: 'RoadWatch gateway and service registry'
});

app.listen(env.PORT, '127.0.0.1', () => {
  console.log(`[gateway-api] listening on http://127.0.0.1:${env.PORT}`);
});
