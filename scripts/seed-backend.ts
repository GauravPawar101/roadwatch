import { Kafka, Partitioners } from 'kafkajs';
import { isDeterministicSeedEnabled, TEST_IDS } from './test-ids';

/**
 * Massive Volume Backend Inference Seeder.
 * Dynamically pushes 1,000 structural algorithmic nodes directly across Local KRaft Broker Arrays natively.
 */
async function seedMachineLearningBus() {
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

   const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'roadwatch-chaos-seeder',
      brokers,
      ssl: Boolean(process.env.KAFKA_SSL) || (Boolean(saslUsername) && Boolean(saslPassword)),
      sasl:
         saslUsername && saslPassword
            ? { mechanism: saslMechanism, username: saslUsername, password: saslPassword }
            : undefined
   });

   const producer = kafka.producer({
      // Explicitly bypasses legacy Partitioner warnings securely mathematically natively
      createPartitioner: Partitioners.DefaultPartitioner
   });

   await producer.connect();
   console.log('[Kafka KRaft Seeder]: Physical connection executed mathematically perfectly.');

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
   // Fires 1,000 payload arrays across the infrastructure logically seamlessly explicitly.
   await producer.send({
      topic,
      messages: payloadMatrices
   });
   await producer.disconnect();

   console.log('[Seeder]: Massive payload vectors injected.');
}

seedMachineLearningBus().catch(err => {
    console.error('Fatal Physical Connection Drop intercepted inherently:', err);
    process.exit(1);
});
