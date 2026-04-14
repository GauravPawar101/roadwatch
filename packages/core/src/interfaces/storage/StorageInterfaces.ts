import type { Complaint, GeoLocation, Road } from '../../domain/Entities';

export interface ILocalStore {
  /**
   * Initializes the native SQLite/LevelDB local store.
   */
  initialize(): Promise<void>;

  /**
   * Persists a complaint to local offline storage immediately.
   */
  saveComplaint(complaint: Complaint): Promise<void>;

  /**
   * Retrieves a specific complaint directly from local cache.
   */
  getComplaint(id: string): Promise<Complaint | null>;

  /**
   * Queries local complaints, optionally bounded by geographical region.
   */
  queryComplaints(boundingBox?: { topLeft: GeoLocation; bottomRight: GeoLocation }): Promise<Complaint[]>;

  /**
   * Updates offline cache of road profiles.
   */
  saveRoad(road: Road): Promise<void>;
}

export interface IBlockchainStore {
  /**
   * Anchors the SHA-256 hash of a complaint to a blockchain for immutable auditing.
   * Tolerates varying network states by returning transaction promises.
   */
  anchorComplaintHash(complaintId: string, payloadHash: string): Promise<string>;

  /**
   * Compares the live blockchain hash against a local payload hash.
   */
  verifyComplaintHash(complaintId: string, payloadHash: string): Promise<boolean>;

  /**
   * Retrieves a full transaction trace to display to authorities.
   */
  getTransactionReceipt(transactionId: string): Promise<Record<string, unknown> | null>;
}

export interface OutboxTask {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly retryCount: number;
}

export interface IOutboxQueue {
  /**
   * Appends an action payload to the local offline synchronization queue.
   */
  enqueueTask(type: string, payload: Record<string, unknown>): Promise<void>;

  /**
   * Peeks at pending tasks formatted for automatic background-worker execution.
   */
  peekTasks(limit?: number): Promise<OutboxTask[]>;

  /**
   * Safely clears a successful task from the queue.
   */
  dequeueTask(id: string): Promise<void>;

  /**
   * Marks a failed execution attempt and backs off sequentially.
   */
  incrementRetry(id: string): Promise<void>;
}

export interface IVectorIndex {
  /**
   * Indexes a normalized text embedding into local semantic memory.
   */
  indexDocument(id: string, vector: readonly number[], metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Queries nearest neighbors to locate similar historical complaints via cosine similarity.
   */
  queryNearest(vector: readonly number[], limit?: number): Promise<Array<{ id: string; score: number }>>;

  /**
   * Evicts a document from the real-time vector index.
   */
  deleteDocument(id: string): Promise<void>;
}

export type AgentMemoryScope = 'citizen' | 'authority';

export interface AgentMemoryRecord<T = unknown> {
  readonly id: string;
  readonly scope: AgentMemoryScope;
  readonly type: string;
  readonly payload: T;
  readonly createdAt: number;
  readonly lastAccessAt: number;
  /** When set, the record is eligible for eviction after this time (ms since epoch). */
  readonly expiresAt: number | null;
  /** Higher means keep longer under pressure. */
  readonly importance: number;
}

export interface AgentMemoryPutOptions {
  /** When set, the record is eligible for eviction after this time (ms since epoch). */
  expiresAt?: number | null;
  /** Higher means keep longer under pressure. Default 0. */
  importance?: number;
}

export interface AgentMemoryPruneOptions {
  /** Max records to keep in the store (post-expiration). */
  maxRecords?: number;
  /** Max ciphertext bytes to keep in the store (post-expiration). */
  maxBytes?: number;
}

export interface AgentMemoryBackupOptions {
  /** Restrict backup to a single scope (default: all). */
  scope?: AgentMemoryScope;
}

/**
 * Cross-session memory store for the on-device agent.
 *
 * Security contract:
 * - All payloads MUST be encrypted before persistence.
 * - The encryption key MUST be stored in an OS-backed secret store (Keychain/Keystore).
 * - Any export/sync payload MUST be end-to-end encrypted; plaintext must never leave the device.
 */
export interface IAgentMemoryStore {
  initialize(): Promise<void>;

  put<T = unknown>(scope: AgentMemoryScope, type: string, id: string, payload: T, options?: AgentMemoryPutOptions): Promise<void>;
  get<T = unknown>(id: string): Promise<AgentMemoryRecord<T> | null>;
  list<T = unknown>(scope: AgentMemoryScope, type?: string, limit?: number): Promise<Array<AgentMemoryRecord<T>>>;
  delete(id: string): Promise<void>;

  /** Deletes expired records and optionally enforces store limits. */
  prune(options?: AgentMemoryPruneOptions): Promise<void>;
  wipeAll(): Promise<void>;

  /**
   * Creates an end-to-end encrypted backup blob that can be synced/stored remotely.
   * The returned value is an opaque base64 string.
   */
  exportEncryptedBackup(passphrase: string, options?: AgentMemoryBackupOptions): Promise<string>;

  /**
   * Restores a backup created by exportEncryptedBackup().
   * If `replace` is true, existing records are removed first.
   */
  importEncryptedBackup(passphrase: string, backupBlobBase64: string, replace?: boolean): Promise<void>;
}
