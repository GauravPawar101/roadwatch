import { describe, expect, it } from 'vitest';
import {
    ActionDestination,
    NetworkDegradationManager,
    NetworkState,
    type ComplaintPayload
} from './NetworkDegradationManager';

describe('NetworkDegradationManager', () => {
  const manager = new NetworkDegradationManager();

  const payload: ComplaintPayload = {
    id: 'c1',
    textData: '{"x":1}',
    images: [
      { id: 'img-webp', format: 'webp', sizeBytes: 900_000 },
      { id: 'img-jpg-big', format: 'jpg', sizeBytes: 2_000_000 },
      { id: 'img-jpg-small', format: 'jpg', sizeBytes: 100_000 }
    ],
    videos: [{ id: 'vid1', format: 'mp4', sizeBytes: 10_000_000 }]
  };

  it('queues everything when offline', () => {
    const q = manager.processPayload(payload, NetworkState.NONE);
    expect(q.textAction).toBe(ActionDestination.QUEUE_OUTBOX);
    expect(q.imageActions.every(a => a.action === ActionDestination.QUEUE_OUTBOX)).toBe(true);
    expect(q.videoActions.every(a => a.action === ActionDestination.QUEUE_OUTBOX)).toBe(true);
  });

  it('executes text and only small/webp images on 2G', () => {
    const q = manager.processPayload(payload, NetworkState.CELL_2G);
    expect(q.textAction).toBe(ActionDestination.EXECUTE_IMMEDIATELY);

    const img = new Map(q.imageActions.map(a => [a.id, a.action] as const));
    expect(img.get('img-webp')).toBe(ActionDestination.EXECUTE_IMMEDIATELY);
    expect(img.get('img-jpg-small')).toBe(ActionDestination.EXECUTE_IMMEDIATELY);
    expect(img.get('img-jpg-big')).toBe(ActionDestination.QUEUE_OUTBOX);

    expect(q.videoActions[0]?.action).toBe(ActionDestination.QUEUE_OUTBOX);
  });

  it('executes all on wifi/4g', () => {
    const q = manager.processPayload(payload, NetworkState.WIFI);
    expect(q.textAction).toBe(ActionDestination.EXECUTE_IMMEDIATELY);
    expect(q.imageActions.every(a => a.action === ActionDestination.EXECUTE_IMMEDIATELY)).toBe(true);
    expect(q.videoActions.every(a => a.action === ActionDestination.EXECUTE_IMMEDIATELY)).toBe(true);
  });
});
