import 'dotenv/config';
import { installProcessGuards } from '@roadwatch/core';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { assertNoDevSecretsInProduction, assertRequiredInfrastructure, getEnv } from './env.js';
import { startKafkaEventRelay } from './kafka/outbox.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { startRetentionJobs } from './security/retention.js';

const app = createApp();

const env = getEnv();

assertNoDevSecretsInProduction(env);
assertRequiredInfrastructure();

// Availability guards. Without these, a single request whose handler rejects
// outside its own try/catch (e.g. a Postgres constraint violation) becomes an
// unhandled rejection and terminates the whole API — one bad request took the
// service down. Installed before initDb so startup failures are guarded too.
installProcessGuards({ serviceName: 'gateway-api' });

await initDb();

startNotificationDispatcher();
startRetentionJobs();
startKafkaEventRelay().catch(error => {
  console.error('[gateway-api] kafka outbox relay failed to start:', error instanceof Error ? error.message : String(error));
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`[gateway-api] listening on http://${env.HOST}:${env.PORT}`);
});
