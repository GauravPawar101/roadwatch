/**
 * Kafka Http Proxy Client specially designed for Edge/Mobile Devices.
 * Because TCP Native Kafka libraries (like librdkafka) are too heavy and fragile on flaky 4G,
 * this client bypasses those drivers entirely, shooting standard HTTPS JSON payload streams 
 * securely into a backend Confluent REST Proxy or edge-aware API Gateway.
 */
export class KafkaIngressClient {
  constructor(private readonly proxyEndpoint: string, private readonly apiKey: string) {}

  /**
   * Dispatches a standardized Kafka message stream via REST.
   */
  async produceEvent(topic: string, key: string, payloadBufferBase64: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.proxyEndpoint}/topics/${topic}`, {
        method: 'POST',
        headers: {
          // Instructs the Confluent gateway to decode Base64 encoded binary records directly.
          'Content-Type': 'application/vnd.kafka.binary.v2+json', 
          'Accept': 'application/vnd.kafka.v2+json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          records: [
             // The physical structural payload requirement mirroring Kafka Producer formatting
             { key: key, value: payloadBufferBase64 }
          ]
        })
      });
      
      if (!response.ok) {
        console.warn(`Kafka Broker rejected HTTP dispatch on topic [${topic}]`);
        return false;
      }
      
      return true;
    } catch (e) {
      console.error('Kafka Proxy Handshake Hardware/Network Fault:', e);
      return false;
    }
  }
}
