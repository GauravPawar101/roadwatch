export interface BaseEntity {
  id: string;
  updatedAt: number;
}

export interface SyncPatch<T> {
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: T;
}

export interface OutboxRecord {
  id: string;
  type: 'TEXT' | 'MEDIA' | 'PROTOBUF';
  sizeBytes: number;
  payload: unknown;
  priority: number;
  createdAt: number;
}

export class SyncEngine {

  /**
   * Evaluates local array states vs server arrays utilizing timestamp watermarks.
   * Derives exact mathematical patches linearly to synchronize offline Device UI safely.
   */
  public diffLocalVsRemote<T extends BaseEntity>(localState: T[], remoteState: T[]): SyncPatch<T>[] {
    const patches: SyncPatch<T>[] = [];
    const localMap = new Map<string, T>();
    localState.forEach(item => localMap.set(item.id, item));

    for (const remote of remoteState) {
      const local = localMap.get(remote.id);
      
      if (!local) {
        // Exists purely remotely. Need to CREATE locally.
        patches.push({ action: 'CREATE', payload: remote });
      } else if (remote.updatedAt > local.updatedAt) {
        // Exists mutually, but remote telemetry is fresher. Need to UPDATE locally.
        patches.push({ action: 'UPDATE', payload: remote });
      }
      
      localMap.delete(remote.id);
    }

    // Anything physically remaining inside the local map no longer exists remotely
    for (const remainingLocal of localMap.values()) {
      patches.push({ action: 'DELETE', payload: remainingLocal });
    }

    return patches;
  }

  /**
   * Executes patches immutably against a targeted array state rendering new memory.
   */
  public applyPatch<T extends BaseEntity>(currentState: T[], patches: SyncPatch<T>[]): T[] {
    const stateMap = new Map<string, T>();
    currentState.forEach(item => stateMap.set(item.id, item));

    for (const patch of patches) {
      if (patch.action === 'CREATE' || patch.action === 'UPDATE') {
        stateMap.set(patch.payload.id, patch.payload);
      } else if (patch.action === 'DELETE') {
        stateMap.delete(patch.payload.id);
      }
    }

    return Array.from(stateMap.values());
  }

  /**
   * Sorts the offline action outbox strictly minimizing bandwidth consumption layers.
   * Priority: Protobufs/Text -> High Priority Timestamp -> Smallest Byte Weight -> Media
   */
  public prioritizeSync(outboxContent: OutboxRecord[]): OutboxRecord[] {
    // Logical weights: Smaller is 'higher priority resolution'
    const queueWeights: Record<string, number> = {
      'PROTOBUF': 1,
      'TEXT': 2,
      'MEDIA': 3
    };

    return [...outboxContent].sort((a, b) => {
      // 1. Sort inherently by fundamental structural weight
      const weightA = queueWeights[a.type] ?? 99;
      const weightB = queueWeights[b.type] ?? 99;
      
      if (weightA !== weightB) {
        return weightA - weightB;
      }
      
      // 2. If identical types, prioritize the smallest payload natively for speed
      if (a.sizeBytes !== b.sizeBytes) {
         return a.sizeBytes - b.sizeBytes;
      }

      // 3. FIFO fallback chronologically
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Packages sorted tasks into rigidly constrained transmission batches 
   * adhering strictly against typical Indian Edge 2G disconnection limitations.
   */
  public buildOutboxBatch(records: OutboxRecord[], maxBatchSizeBytes: number = 204800): OutboxRecord[] {
    const queue = this.prioritizeSync(records);
    const batch: OutboxRecord[] = [];
    let currentBytes = 0;

    for (const item of queue) {
      if (currentBytes + item.sizeBytes <= maxBatchSizeBytes) {
        batch.push(item);
        currentBytes += item.sizeBytes;
      } else {
        break; // Stop packing once memory thresholds intersect safely
      }
    }

    return batch;
  }
}
