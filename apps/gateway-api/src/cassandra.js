import { Client, types } from 'cassandra-driver';

const contactEnv = process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042';
const contactPoints = contactEnv.split(',').map((s) => s.trim());
const localDataCenter = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';

export const client = new Client({ contactPoints, localDataCenter, keyspace });

export async function connect() {
  return client.connect();
}

export function execute(query, params = [], options = {}) {
  return client.execute(query, params, options);
}

export const cassandraTypes = types;

export default client;
