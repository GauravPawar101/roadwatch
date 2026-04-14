import { Kafka, Partitioners } from 'kafkajs';
import { isDeterministicSeedEnabled, TEST_IDS } from './test-ids';

function getUpstashBaseUrl(): string | undefined {
   const url = process.env.UPSTASH_KAFKA_REST_URL?.trim();
   if (!url) return undefined;
   return url.replace(/\/$/, '');
}

function getUpstashBasicAuthToken(): string | undefined {
   const directToken = process.env.UPSTASH_KAFKA_REST_TOKEN?.trim();
   if (directToken) return directToken;

   const username = process.env.UPSTASH_KAFKA_REST_USERNAME?.trim();
   const password = process.env.UPSTASH_KAFKA_REST_PASSWORD?.trim();
   if (!username || !password) return undefined;
   return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

async function upstashProduceMany(messages: Array<{ topic: string; value: string; key?: string }>) {
   const baseUrl = getUpstashBaseUrl();
   const basicToken = getUpstashBasicAuthToken();
   if (!baseUrl) throw new Error('UPSTASH_KAFKA_REST_URL is required for Upstash Kafka REST mode');
   if (!basicToken)
      throw new Error(
         'UPSTASH_KAFKA_REST_TOKEN (preferred) or UPSTASH_KAFKA_REST_USERNAME + UPSTASH_KAFKA_REST_PASSWORD are required for Upstash Kafka REST mode'
      );

   const res = await fetch(`${baseUrl}/produce`, {
      method: 'POST',
      headers: {
         'content-type': 'application/json',
         authorization: `Basic ${basicToken}`
      },
      body: JSON.stringify(messages),
      keepalive: true
   });

   const json = await res.json().catch(() => undefined);
   if (!res.ok) {
      const errorMessage =
         typeof json?.error === 'string'
            ? json.error
            : typeof json?.message === 'string'
              ? json.message
              : `Upstash Kafka REST produce failed with HTTP ${res.status}`;
      throw new Error(errorMessage);
   }
}

/**
 * Massive Volume Backend Inference Seeder.
 * Dynamically pushes 1,000 structural algorithmic nodes directly across Local KRaft Broker Arrays natively.
 */
async function seedMachineLearningBus() {
   if (getUpstashBaseUrl()) {
      console.log('[Upstash Kafka REST Seeder]: Using UPSTASH_KAFKA_REST_URL mode.');
   }

   const brokers = (process.env.KAFKA_BROKERS ?? process.env.KAFKA_BROKER ?? 'localhost:9092')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

   const saslUsername = process.env.KAFKA_SASL_USERNAME;
   const saslPassword = process.env.KAFKA_SASL_PASSWORD;
   const saslMechanism = (process.env.KAFKA_SASL_MECHANISM ?? 'scram-sha-256') as
      | 'plain'
      | 'scram-sha-256'
      | 'scram-sha-512'
      | 'aws';

   const useUpstash = Boolean(getUpstashBaseUrl());
   const kafka = useUpstash
      ? undefined
      : new Kafka({
           clientId: process.env.KAFKA_CLIENT_ID || 'roadwatch-chaos-seeder',
           brokers,
           ssl: Boolean(process.env.KAFKA_SSL) || (Boolean(saslUsername) && Boolean(saslPassword)),
           sasl:
              saslUsername && saslPassword
                 ? { mechanism: saslMechanism, username: saslUsername, password: saslPassword }
                 : undefined
        });

   const producer = useUpstash
      ? undefined
      : kafka!.producer({
           // Explicitly bypasses legacy Partitioner warnings securely mathematically natively
           createPartitioner: Partitioners.DefaultPartitioner
        });

   if (!useUpstash) {
      await producer!.connect();
      console.log('[Kafka KRaft Seeder]: Physical connection executed mathematically perfectly.');
   }

   console.log('[Seeder]: Generating 1,000 structural telemetry streams...');

   const deterministic = isDeterministicSeedEnabled();
   const roadKeys = [TEST_IDS.roads.road1, TEST_IDS.roads.road2, TEST_IDS.roads.road3, TEST_IDS.roads.road4];
   const baseTimeMs = deterministic ? 1_700_000_000_000 : Date.now();

   const payloadMatrices = [];
   
   for (let i = 1; i <= 1000; i++) {
      const isStructurallyResolved = i % 3 === 0; // Exactly 33% resolution algorithms linearly mapped

      const roadKey = roadKeys[i % roadKeys.length] ?? `ROAD-${i % 4}`;
      const actionId = deterministic ? `EDGE-BLOCK-${i}` : `EDGE-BLOCK-${Date.now()}-${i}`;
      
      payloadMatrices.push({
         // Maps exact partition routing inherently guaranteeing data streams structurally cleanly natively
         key: roadKey,
         
         value: JSON.stringify({
             actionId,
             eventType: isStructurallyResolved ? 'ComplaintResolved' : 'ComplaintFiled',
             structuralPayload: {
                roadVectorId: roadKey,
                unixTimeTrigger: baseTimeMs - i * 86_400_000,
                userGuid: TEST_IDS.citizenId,
                // Algorithmic mapping pushing natively severe blocks efficiently
                severityScale: i % 5 + 1 
             }
         })
      });
   }

   const topic = 'roadwatch-complaints-backbone';
   if (useUpstash) {
      await upstashProduceMany(payloadMatrices.map((m) => ({ topic, key: m.key, value: m.value })));
   } else {
      // Fires 1,000 payload arrays across the infrastructure logically seamlessly explicitly.
      await producer!.send({
         topic,
         messages: payloadMatrices
      });
      await producer!.disconnect();
   }

   console.log('[Seeder]: Massive payload vectors injected.');
}

seedMachineLearningBus().catch(err => {
    console.error('Fatal Physical Connection Drop intercepted inherently:', err);
    process.exit(1);
});
