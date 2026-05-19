const { Client: PgClient } = require('pg');
const cassandra = require('cassandra-driver');

async function migrate({ mappings, dryRun = false, batchSize = 500 }) {
  const pgConn = process.env.PG_CONNECTION_STRING;
  if (!pgConn) throw new Error('PG_CONNECTION_STRING env var required');

  const pg = new PgClient({ connectionString: pgConn });
  await pg.connect();

  const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042').split(',').map(s => s.trim().split(':')[0]);
  const localDC = process.env.CASSANDRA_LOCAL_DC || 'datacenter1';
  const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch';
  const cassandraClient = new cassandra.Client({ contactPoints, localDataCenter: localDC, keyspace });
  await cassandraClient.connect();

  try {
    for (const mapping of mappings) {
      console.log(`Migrating ${mapping.name}...`);
      let offset = 0;
      while (true) {
        const select = `${mapping.selectSql} LIMIT $1 OFFSET $2`;
        const res = await pg.query({ text: select, values: [batchSize, offset] });
        if (!res.rows || res.rows.length === 0) break;
        for (const row of res.rows) {
          const params = mapping.transform(row);
          if (dryRun) continue;
          try {
            await cassandraClient.execute(mapping.insertCql, params, { prepare: true });
          } catch (err) {
            console.error(`Insert failed for ${mapping.name} id=${params[0]}:`, err.message || err);
          }
        }
        offset += res.rows.length;
        console.log(`  ${mapping.name}: migrated ${offset} rows`);
        if (res.rows.length < batchSize) break;
      }
    }
  } finally {
    await cassandraClient.shutdown();
    await pg.end();
  }
}

module.exports = { migrate };
