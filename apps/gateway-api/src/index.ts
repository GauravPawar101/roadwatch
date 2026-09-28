import 'dotenv/config';
import { installProcessGuards } from '@roadwatch/core';
import { createApp } from './app.js';
import { initDb } from './db.js';
import { installGracefulShutdown } from './graceful-shutdown.js';
import { assertNoDevSecretsInProduction, assertRequiredInfrastructure, getEnv } from './env.js';
import { describeAllKafkaAuth } from '@roadwatch/kafka';
import { reportInfrastructure } from '@roadwatch/core';
import { closeRedisClient } from '@roadwatch/redis';
import { startKafkaEventRelay } from './kafka/outbox.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { closePool } from './postgres.js';
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

const stopNotificationDispatcher = startNotificationDispatcher();
const stopRetentionJobs = startRetentionJobs();
const stopKafkaEventRelay = await startKafkaEventRelay().catch(error => {
  console.error('[gateway-api] kafka outbox relay failed to start:', error instanceof Error ? error.message : String(error));
  return () => undefined;
});

// Managed tier first, then report what it fell back to, then serve. With
// INFRA_REQUIRE_MANAGED set, a misconfigured managed endpoint throws here
// rather than silently degrading to the in-cluster service.
reportInfrastructure('gateway-api');

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`[gateway-api] listening on http://${env.HOST}:${env.PORT}`);
  // Secret-free: reports which TLS mode and SASL mechanism each cluster resolved
  // to. Hosted Kafka refuses plaintext, so this answers "did the managed
  // endpoints actually take effect" at a glance.
  console.log(`[gateway-api] kafka: ${describeAllKafkaAuth()}`);
});

// A SIGTERM with no handler kills the process outright. On Kubernetes every
// rolling deploy, node drain, HPA scale-in and node termination sends one, so
// without this the deployment drops in-flight requests, leaves admission permits
// held in Redis until their TTL, and stops the outbox relay mid-publish. See
// ./graceful-shutdown.ts for the ordering and the timeouts.
installGracefulShutdown(server, {
  // How long to keep serving after readiness fails. Must exceed the load
  // balancer's probe interval or the pause is over before the balancer reacts.
  drainDelayMs: Number.parseInt(process.env.SHUTDOWN_DRAIN_DELAY_MS ?? '5000', 10) || 5000,
  requestTimeoutMs: Number.parseInt(process.env.SHUTDOWN_REQUEST_TIMEOUT_MS ?? '25000', 10) || 25_000,
  onReadinessFail: () => {
    // Fail readiness so the load balancer stops sending new requests while this
    // instance finishes what it has. Registered after listen(), so the endpoint
    // is guaranteed to exist by the time a signal can arrive.
    server.closeIdleConnections?.();
  },
  stopWorkers: [
    stopNotificationDispatcher,
    stopRetentionJobs,
    stopKafkaEventRelay,
  ],
  closeResources: async () => {
    await closePool();
    await closeRedisClient();
  },
});
