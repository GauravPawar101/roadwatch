import 'dotenv/config';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
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

const numCPUs = Number.parseInt(process.env.CLUSTER_WORKERS ?? String(availableParallelism()), 10);

if (cluster.isPrimary && numCPUs > 1) {
  console.log(`[gateway-api] Starting cluster with ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[gateway-api] Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
    cluster.fork();
  });

  // Handle graceful shutdown for primary
  const shutdown = (signal: string) => {
    console.log(`[gateway-api] Primary received ${signal}, shutting down workers...`);
    for (const id in cluster.workers) {
      cluster.workers[id]?.kill();
    }
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

} else {
  // Worker process (or single-process mode when numCPUs <= 1)
  const app = createApp();

  const env = getEnv();

  assertNoDevSecretsInProduction(env);
  assertRequiredInfrastructure();

  installProcessGuards({ serviceName: 'gateway-api' });

  await initDb();

  const stopNotificationDispatcher = startNotificationDispatcher();
  const stopRetentionJobs = startRetentionJobs();
  const stopKafkaEventRelay = await startKafkaEventRelay().catch(error => {
    console.error('[gateway-api] kafka outbox relay failed to start:', error instanceof Error ? error.message : String(error));
    return () => undefined;
  });

  reportInfrastructure('gateway-api');

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`[gateway-api] Worker ${process.pid} listening on http://${env.HOST}:${env.PORT}`);
    console.log(`[gateway-api] kafka: ${describeAllKafkaAuth()}`);
  });

  installGracefulShutdown(server, {
    drainDelayMs: Number.parseInt(process.env.SHUTDOWN_DRAIN_DELAY_MS ?? '5000', 10) || 5000,
    requestTimeoutMs: Number.parseInt(process.env.SHUTDOWN_REQUEST_TIMEOUT_MS ?? '25000', 10) || 25_000,
    onReadinessFail: () => {
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
}
