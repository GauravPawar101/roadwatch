import { describe, expect, it } from 'vitest';
import { SyncEngine, type BaseEntity } from './SyncEngine';

describe('SyncEngine', () => {
  it('diffLocalVsRemote produces create/update/delete patches', () => {
    const engine = new SyncEngine();

    const local: BaseEntity[] = [
      { id: 'a', updatedAt: 10 },
      { id: 'b', updatedAt: 10 }
    ];

    const remote: BaseEntity[] = [
      { id: 'a', updatedAt: 20 },
      { id: 'c', updatedAt: 5 }
    ];

    const patches = engine.diffLocalVsRemote(local, remote);
    expect(patches).toEqual([
      { action: 'UPDATE', payload: { id: 'a', updatedAt: 20 } },
      { action: 'CREATE', payload: { id: 'c', updatedAt: 5 } },
      { action: 'DELETE', payload: { id: 'b', updatedAt: 10 } }
    ]);
  });

  it('buildOutboxBatch packs prioritized items under size limit', () => {
    const engine = new SyncEngine();

    const batch = engine.buildOutboxBatch(
      [
        { id: 'm1', type: 'MEDIA', sizeBytes: 50_000, payload: {}, priority: 0, createdAt: 3 },
        { id: 't1', type: 'TEXT', sizeBytes: 10_000, payload: {}, priority: 0, createdAt: 1 },
        { id: 'p1', type: 'PROTOBUF', sizeBytes: 20_000, payload: {}, priority: 0, createdAt: 2 },
        { id: 'm2', type: 'MEDIA', sizeBytes: 500_000, payload: {}, priority: 0, createdAt: 4 }
      ],
      80_000
    );

    // PROTOBUF + TEXT first, then smallest MEDIA that fits.
    expect(batch.map(r => r.id)).toEqual(['p1', 't1', 'm1']);
  });
});
