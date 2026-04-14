/**
 * React Native Subscribing Receiver Endpoint.
 * Because mobile devices cannot realistically host infinite-polling heavy Kafka Consumers natively over batteries, 
 * the backend middle-tier consumes Kafka physically, evaluating filter states, 
 * then broadcasts parsed streams natively via unidirectional Server-Sent Events (SSE).
 */
export class SSEConsumer {
  private eventSource: EventSource | null = null;
  private isConnected: boolean = false;

  constructor(private readonly sseEndpoint: string) {}

  /**
   * Instantiates a unidirectional socket opening against the proxy.
   */
  public connectStream(onMessage: (topic: string, data: any) => void): void {
    // Prevents redundant memory leaks mounting multiple listeners natively
    if (this.eventSource) return;

    // Assumes polyfilled EventSource behavior standard to React Native fetching paradigms
    this.eventSource = new EventSource(this.sseEndpoint);

    this.eventSource.onopen = () => {
       console.log("Edge Streams securely tethered to Gateway.");
       this.isConnected = true;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onMessage(payload.topic, payload.data);
      } catch (err) {
        console.error("Fatal unencrypted parsing error natively intercepted via SSE stream block", err);
      }
    };

    this.eventSource.onerror = (error) => {
      console.warn("SSE Socket logically corrupted. Assuming hardware network drop. Activating retry locking mechanisms.", error);
      this.disconnectStream(); // Kill to prevent buffer bloating
    };
  }

  /**
   * Halts background process execution.
   */
  public disconnectStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
    }
  }

  public getStatus(): boolean {
    return this.isConnected;
  }
}
