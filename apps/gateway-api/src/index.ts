import 'dotenv/config';
import { installProcessGuards } from '@roadwatch/core';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { assertNoDevSecretsInProduction, assertRequiredInfrastructure, getEnv } from './env.js';
import { describeAllKafkaAuth } from '@roadwatch/kafka';
import { reportInfrastructure } from '@roadwatch/core';
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

// Managed tier first, then report what it fell back to, then serve. With
// INFRA_REQUIRE_MANAGED set, a misconfigured managed endpoint throws here
// rather than silently degrading to the in-cluster service.
reportInfrastructure('gateway-api');

app.listen(env.PORT, env.HOST, () => {
  console.log(`[gateway-api] listening on http://${env.HOST}:${env.PORT}`);
  // Secret-free: reports which TLS mode and SASL mechanism each cluster resolved
  // to. Hosted Kafka refuses plaintext, so this answers "did the managed
  // endpoints actually take effect" at a glance.
  console.log(`[gateway-api] kafka: ${describeAllKafkaAuth()}`);
});
