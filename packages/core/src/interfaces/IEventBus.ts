export type PublishOptions = {
  key?: string;
  headers?: Record<string, string>;
};

export interface IEventBus {
  publish(topic: string, event: unknown, options?: PublishOptions): Promise<void>;
  publishMany(
    events: Array<{ topic: string; event: unknown; key?: string; headers?: Record<string, string> }>
  ): Promise<void>;
  disconnect(): Promise<void>;
}
