Complaint Anchor chaincode notes
--------------------------------

- This chaincode uses CouchDB Mango rich queries for `GetEscalationHistory` to efficiently query escalation records by `complaintId` and sort by `timestamp`.
- The Fabric peer(s) that will host this chaincode MUST be configured to use CouchDB as the state database. If the peer(s) use LevelDB, the Mango query will not be supported and runtime errors will occur.
- A CouchDB index is provided under `META-INF/statedb/couchdb/indexes/complaintid_timestamp_index.json` to support efficient queries. Ensure this file is included in your chaincode package when installing/approving the chaincode.
- When deploying the Fabric network, set `CORE_LEDGER_STATE_STATEDATABASE=couchdb` and provide the CouchDB service configuration for the peer(s).
