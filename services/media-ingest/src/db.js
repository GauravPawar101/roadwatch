const { Client, types } = require('cassandra-driver')

const contactPointsEnv = process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1:9042'
const contactPoints = contactPointsEnv.split(',').map(s => s.split(':')[0])
const localDC = process.env.CASSANDRA_LOCAL_DC || 'datacenter1'
const keyspace = process.env.CASSANDRA_KEYSPACE || 'roadwatch'

const client = new Client({ contactPoints, localDataCenter: localDC })

async function ensureSchema() {
  // create keyspace if not exists
  await client.connect()
  await client.execute(`CREATE KEYSPACE IF NOT EXISTS ${keyspace} WITH replication = {'class':'SimpleStrategy','replication_factor':1}`)

  // create tables used by media-ingest
  await client.execute(`CREATE TABLE IF NOT EXISTS ${keyspace}.media (
    upload_id text PRIMARY KEY,
    object_key text,
    sha256 text,
    metadata text,
    hf_result text,
    created_at timestamp
  )`)

  await client.execute(`CREATE TABLE IF NOT EXISTS ${keyspace}.embeddings (
    upload_id text PRIMARY KEY,
    embedding text,
    created_at timestamp
  )`)

  await client.execute(`CREATE TABLE IF NOT EXISTS ${keyspace}.pinata_webhook_retries (
    id timeuuid PRIMARY KEY,
    cid text,
    payload text,
    attempts int,
    last_error text,
    next_attempt timestamp,
    created_at timestamp
  )`)

  // set keyspace on client for simpler queries elsewhere
  client.keyspace = keyspace
}

module.exports = { client, ensureSchema, types }
