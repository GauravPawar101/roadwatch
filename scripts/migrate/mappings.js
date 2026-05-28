// Define mappings between Postgres source queries and Cassandra inserts.
// Each mapping: { name, selectSql, insertCql, transform }
// transform(row) should return an array of insert params in the same order
// as `insertCql` placeholders.

module.exports = [
  {
    name: 'users',
    selectSql: 'SELECT id, email, phone, username, password_hash, signup_method, role, districts, zones, fabric_verified, created_at, updated_at FROM users ORDER BY id',
    insertCql: 'INSERT INTO users (id, email, phone, username, password_hash, signup_method, role, districts, zones, fabric_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    transform: (r) => [r.id, r.email || null, r.phone || null, r.username || null, r.password_hash || null, r.signup_method || null, r.role || null, r.districts || [], r.zones || [], r.fabric_verified || false, r.created_at || null, r.updated_at || null]
  },
  {
    name: 'complaints',
    selectSql: 'SELECT id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid FROM complaints ORDER BY id',
    insertCql: 'INSERT INTO complaints (id, district, zone, status, description, lat, lng, created_at, updated_at, fabric_txid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    transform: (r) => [r.id, r.district || null, r.zone || null, r.status || null, r.description || null, r.lat || null, r.lng || null, r.created_at || null, r.updated_at || null, r.fabric_txid || null]
  },
  {
    name: 'image_submissions',
    selectSql: 'SELECT id, request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at, exif_timestamp, exif_latitude, exif_longitude, device_latitude, device_longitude, nonce, phash, verified_status, storage_path, metadata, created_by_id FROM image_submissions ORDER BY id',
    insertCql: 'INSERT INTO image_submissions (id, request_id, uploader_id_encrypted, uploader_pseudonym, server_received_at, exif_timestamp, exif_latitude, exif_longitude, device_latitude, device_longitude, nonce, phash, verified_status, storage_path, metadata, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    transform: (r) => [r.id, r.request_id || null, r.uploader_id_encrypted || null, r.uploader_pseudonym || null, r.server_received_at || null, r.exif_timestamp || null, r.exif_latitude || null, r.exif_longitude || null, r.device_latitude || null, r.device_longitude || null, r.nonce || null, r.phash || null, r.verified_status || null, r.storage_path || null, r.metadata ? JSON.stringify(r.metadata) : null, r.created_by_id || null]
  },
  {
    name: 'audit_log',
    selectSql: 'SELECT id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at FROM audit_log ORDER BY id',
    insertCql: 'INSERT INTO audit_log (id, actor_user_id, actor_phone_hash, actor_phone_masked, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    transform: (r) => [r.id, r.actor_user_id || null, r.actor_phone_hash || null, r.actor_phone_masked || null, r.action || null, r.target_type || null, r.target_id || null, r.details ? JSON.stringify(r.details) : null, r.created_at || null]
  }
];
