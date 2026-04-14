export type SqliteQueryResult = { rows?: any[] };

export type SqliteLike = {
  executeSql?: (sql: string, params: any[]) => Promise<{ rows: { _array: any[] } }>;
  exec?: (sql: string) => Promise<void>;
  run?: (sql: string, params?: any[]) => Promise<void>;
  get?: (sql: string, params?: any[]) => Promise<any>;
  all?: (sql: string, params?: any[]) => Promise<any[]>;
};

export class SqliteAdapter {
  constructor(private readonly db: SqliteLike) {}

  async exec(sql: string): Promise<void> {
    if (this.db.exec) return this.db.exec(sql);
    if (this.db.executeSql) {
      await this.db.executeSql(sql, []);
      return;
    }
    throw new Error('SqliteAdapter: db.exec/executeSql missing');
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    if (this.db.run) return this.db.run(sql, params);
    if (this.db.executeSql) {
      await this.db.executeSql(sql, params);
      return;
    }
    throw new Error('SqliteAdapter: db.run/executeSql missing');
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    if (this.db.get) return (await this.db.get(sql, params)) ?? null;
    if (this.db.executeSql) {
      const res = await this.db.executeSql(sql, params);
      return (res.rows._array[0] as T) ?? null;
    }
    throw new Error('SqliteAdapter: db.get/executeSql missing');
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (this.db.all) return (await this.db.all(sql, params)) as T[];
    if (this.db.executeSql) {
      const res = await this.db.executeSql(sql, params);
      return res.rows._array as T[];
    }
    throw new Error('SqliteAdapter: db.all/executeSql missing');
  }
}
