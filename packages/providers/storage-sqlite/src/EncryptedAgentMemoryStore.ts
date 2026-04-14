import type {
    AgentMemoryBackupOptions,
    AgentMemoryPruneOptions,
    AgentMemoryPutOptions,
    AgentMemoryRecord,
    AgentMemoryScope,
    IAgentMemoryStore
} from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';

import { scrypt } from 'scrypt-js';
import nacl from 'tweetnacl';
import {
    AGENT_MEMORY_DEK_BYTES,
    AGENT_MEMORY_NONCE_BYTES,
    b64Decode,
    b64Encode,
    bytesToUtf8,
    decryptJson,
    encryptJson,
    randomBytes,
    utf8ToBytes
} from './AgentMemoryCrypto';
import type { KeyStore } from './KeyStore';
import { InMemoryKeyStore, ReactNativeKeychainKeyStore } from './KeyStore';
import type { SqliteLike } from './SqliteAdapter';
import { SqliteAdapter } from './SqliteAdapter';

type StoredRow = {
  id: string;
  scope: AgentMemoryScope;
  type: string;
  created_at: number;
  last_access_at: number;
  expires_at: number | null;
  importance: number;
  nonce_b64: string;
  ciphertext_b64: string;
};

type EncryptedPayload = {
  v: 1;
  id: string;
  scope: AgentMemoryScope;
  type: string;
  createdAt: number;
  lastAccessAt: number;
  expiresAt: number | null;
  importance: number;
  payload: unknown;
};

type BackupEnvelope = {
  v: 1;
  kdf: 'scrypt';
  saltB64: string;
  nonceB64: string;
  encDekB64: string;
  scope?: AgentMemoryScope;
  rows: Array<Omit<StoredRow, 'last_access_at'> & { last_access_at: number }>;
};

export interface EncryptedAgentMemoryStoreOptions {
  /** Restrict the keystore service namespace (useful for multi-app builds). */
  keychainService?: string;
  /** Optional keystore override (useful for tests). */
  keyStore?: KeyStore;
  /** DB connection; can be react-native-quick-sqlite style (executeSql) or a {exec/run/get/all} binding. */
  db: SqliteLike;
}

const DEFAULT_KEYCHAIN_SERVICE = 'roadwatch.agent-memory';
const DEK_KEY_ID = 'dek.v1';

export class EncryptedAgentMemoryStore implements IAgentMemoryStore {
  private readonly sql: SqliteAdapter;
  private readonly keyStore: KeyStore;
  private dek: Uint8Array | null = null;

  constructor(options: EncryptedAgentMemoryStoreOptions) {
    this.sql = new SqliteAdapter(options.db);
    this.keyStore =
      options.keyStore ??
      new ReactNativeKeychainKeyStore(options.keychainService ?? DEFAULT_KEYCHAIN_SERVICE);
  }

  public async initialize(): Promise<void> {
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_access_at INTEGER NOT NULL,
        expires_at INTEGER,
        importance INTEGER NOT NULL,
        nonce_b64 TEXT NOT NULL,
        ciphertext_b64 TEXT NOT NULL
      );
    `);
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_agent_memory_scope_type ON agent_memory (scope, type);`);
    await this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_agent_memory_eviction ON agent_memory (expires_at, importance, last_access_at);`);
    await this.ensureDekLoaded();
  }

  public async put<T = unknown>(
    scope: AgentMemoryScope,
    type: string,
    id: string,
    payload: T,
    options: AgentMemoryPutOptions = {}
  ): Promise<void> {
    const dek = await this.ensureDekLoaded();
    const now = Date.now();
    const importance = options.importance ?? 0;
    const expiresAt = options.expiresAt ?? null;
    const nonce = randomBytes(AGENT_MEMORY_NONCE_BYTES);

    const boxedPayload: EncryptedPayload = {
      v: 1,
      id,
      scope,
      type,
      createdAt: now,
      lastAccessAt: now,
      expiresAt,
      importance,
      payload
    };

    const { nonceB64, ciphertextB64 } = encryptJson(boxedPayload, dek, nonce);

    await this.sql.run(
      `INSERT OR REPLACE INTO agent_memory (id, scope, type, created_at, last_access_at, expires_at, importance, nonce_b64, ciphertext_b64)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [id, scope, type, now, now, expiresAt, importance, nonceB64, ciphertextB64]
    );
  }

  public async get<T = unknown>(id: string): Promise<AgentMemoryRecord<T> | null> {
    const row = await this.sql.get<StoredRow>(`SELECT * FROM agent_memory WHERE id = ? LIMIT 1`, [id]);
    if (!row) return null;

    const dek = await this.ensureDekLoaded();
    const decoded = decryptJson<EncryptedPayload>(row.ciphertext_b64, row.nonce_b64, dek);

    if (decoded.v !== 1 || decoded.id !== row.id || decoded.scope !== row.scope || decoded.type !== row.type) {
      throw new Error('AgentMemory: Record header mismatch (possible tamper)');
    }

    await this.sql.run(`UPDATE agent_memory SET last_access_at = ? WHERE id = ?`, [Date.now(), id]);

    return {
      id: row.id,
      scope: row.scope,
      type: row.type,
      payload: decoded.payload as T,
      createdAt: row.created_at,
      lastAccessAt: Date.now(),
      expiresAt: row.expires_at,
      importance: row.importance
    };
  }

  public async list<T = unknown>(scope: AgentMemoryScope, type?: string, limit: number = 50): Promise<Array<AgentMemoryRecord<T>>> {
    const params: any[] = [scope];
    let sql = `SELECT * FROM agent_memory WHERE scope = ?`;
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY last_access_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.sql.all<StoredRow>(sql, params);
    const dek = await this.ensureDekLoaded();

    const out: Array<AgentMemoryRecord<T>> = [];
    for (const row of rows) {
      try {
        const decoded = decryptJson<EncryptedPayload>(row.ciphertext_b64, row.nonce_b64, dek);
        if (decoded.v !== 1 || decoded.id !== row.id || decoded.scope !== row.scope || decoded.type !== row.type) {
          continue;
        }
        out.push({
          id: row.id,
          scope: row.scope,
          type: row.type,
          payload: decoded.payload as T,
          createdAt: row.created_at,
          lastAccessAt: row.last_access_at,
          expiresAt: row.expires_at,
          importance: row.importance
        });
      } catch {
        // If a row is corrupted/tampered, skip it.
      }
    }
    return out;
  }

  public async delete(id: string): Promise<void> {
    await this.sql.run(`DELETE FROM agent_memory WHERE id = ?`, [id]);
  }

  public async prune(options: AgentMemoryPruneOptions = {}): Promise<void> {
    const now = Date.now();
    await this.sql.run(`DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at <= ?`, [now]);

    const maxRecords = options.maxRecords;
    const maxBytes = options.maxBytes;

    if (!maxRecords && !maxBytes) return;

    // Enforce record count.
    if (maxRecords) {
      const countRow = await this.sql.get<{ c: number }>(`SELECT COUNT(*) as c FROM agent_memory`, []);
      const count = countRow?.c ?? 0;
      if (count > maxRecords) {
        const toDelete = count - maxRecords;
        await this.sql.run(
          `DELETE FROM agent_memory WHERE id IN (
             SELECT id FROM agent_memory
             ORDER BY importance ASC, last_access_at ASC
             LIMIT ?
           )`,
          [toDelete]
        );
      }
    }

    // Enforce ciphertext byte budget (approx).
    if (maxBytes) {
      const rows = await this.sql.all<{ id: string; importance: number; last_access_at: number; bytes: number }>(
        `SELECT id, importance, last_access_at, LENGTH(ciphertext_b64) + LENGTH(nonce_b64) as bytes FROM agent_memory
         ORDER BY importance ASC, last_access_at ASC`,
        []
      );
      let total = rows.reduce((acc, r) => acc + (r.bytes ?? 0), 0);
      for (const row of rows) {
        if (total <= maxBytes) break;
        await this.delete(row.id);
        total -= row.bytes ?? 0;
      }
    }
  }

  public async wipeAll(): Promise<void> {
    await this.sql.run(`DELETE FROM agent_memory`, []);
    await this.keyStore.remove(DEK_KEY_ID);
    this.dek = null;
  }

  public async exportEncryptedBackup(passphrase: string, options: AgentMemoryBackupOptions = {}): Promise<string> {
    const dek = await this.ensureDekLoaded();
    const scope = options.scope;

    const rows = scope
      ? await this.sql.all<StoredRow>(`SELECT * FROM agent_memory WHERE scope = ?`, [scope])
      : await this.sql.all<StoredRow>(`SELECT * FROM agent_memory`, []);

    const salt = randomBytes(16);
    const derived = await this.deriveBackupKey(passphrase, salt);
    const nonce = randomBytes(AGENT_MEMORY_NONCE_BYTES);
    const encDek = nacl.secretbox(dek, nonce, derived);

    const envelope: BackupEnvelope = {
      v: 1,
      kdf: 'scrypt',
      saltB64: b64Encode(salt),
      nonceB64: b64Encode(nonce),
      encDekB64: b64Encode(encDek),
      scope,
      rows
    };

    return b64Encode(utf8ToBytes(JSON.stringify(envelope)));
  }

  public async importEncryptedBackup(passphrase: string, backupBlobBase64: string, replace: boolean = false): Promise<void> {
    const envelopeJson = bytesToUtf8(b64Decode(backupBlobBase64));
    const envelope = JSON.parse(envelopeJson) as BackupEnvelope;

    if (envelope.v !== 1 || envelope.kdf !== 'scrypt') {
      throw new Error('AgentMemory: Unsupported backup format');
    }

    const salt = b64Decode(envelope.saltB64);
    const derived = await this.deriveBackupKey(passphrase, salt);
    const nonce = b64Decode(envelope.nonceB64);
    const encDek = b64Decode(envelope.encDekB64);
    const openedDek = nacl.secretbox.open(encDek, nonce, derived);
    if (!openedDek) {
      throw new Error('AgentMemory: Backup passphrase incorrect or backup tampered');
    }

    if (replace) {
      await this.sql.run(`DELETE FROM agent_memory`, []);
    }

    await this.persistDek(openedDek);
    this.dek = openedDek;

    for (const row of envelope.rows) {
      await this.sql.run(
        `INSERT OR REPLACE INTO agent_memory (id, scope, type, created_at, last_access_at, expires_at, importance, nonce_b64, ciphertext_b64)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.scope,
          row.type,
          row.created_at,
          row.last_access_at,
          row.expires_at,
          row.importance,
          row.nonce_b64,
          row.ciphertext_b64
        ]
      );
    }
  }

  private async ensureDekLoaded(): Promise<Uint8Array> {
    if (this.dek) return this.dek;

    let dekB64 = await this.keyStore.get(DEK_KEY_ID);
    if (!dekB64) {
      const dek = randomBytes(AGENT_MEMORY_DEK_BYTES);
      dekB64 = b64Encode(dek);
      await this.keyStore.set(DEK_KEY_ID, dekB64);
      this.dek = dek;
      return dek;
    }

    const dek = b64Decode(dekB64);
    if (dek.length !== AGENT_MEMORY_DEK_BYTES) {
      // Corrupted keystore entry; generate a new key (existing ciphertext becomes undecryptable).
      const fresh = randomBytes(AGENT_MEMORY_DEK_BYTES);
      await this.keyStore.set(DEK_KEY_ID, b64Encode(fresh));
      this.dek = fresh;
      return fresh;
    }

    this.dek = dek;
    return dek;
  }

  private async persistDek(dek: Uint8Array): Promise<void> {
    await this.keyStore.set(DEK_KEY_ID, b64Encode(dek));
  }

  private async deriveBackupKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
    // N=16384 r=8 p=1 is a reasonable mobile compromise.
    const passBytes = utf8ToBytes(passphrase);
    const out = await scrypt(passBytes, salt, 16384, 8, 1, 32);
    return new Uint8Array(out);
  }
}

/**
 * Helper for tests/dev environments where react-native-keychain isn't available.
 */
export function createInsecureInMemoryAgentMemoryStore(db: SqliteLike): EncryptedAgentMemoryStore {
  return new EncryptedAgentMemoryStore({ db, keyStore: new InMemoryKeyStore(), keychainService: 'insecure' });
}
