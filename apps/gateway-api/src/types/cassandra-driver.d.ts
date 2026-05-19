declare module 'cassandra-driver' {
  export const types: any;
  export class Client {
    constructor(opts?: any);
    connect(): Promise<void>;
    shutdown(): Promise<void>;
    execute(cql: string, params?: any[], options?: any): Promise<any>;
    batch(queries: Array<{ query: string; params?: any[] }>, options?: any): Promise<any>;
  }
  export default Client;
}
