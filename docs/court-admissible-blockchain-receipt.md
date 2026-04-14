# Court-admissible blockchain receipt (export format)

This document is **not legal advice**. Admissibility depends on jurisdiction, court rules, and how the system is operated. The goal here is to define a practical export format that is easy to verify and preserves chain-of-custody.

RoadWatch uses Hyperledger Fabric in the architecture and stores `fabric_txid` pointers in the operational database (`complaints.fabric_txid` and `audit_log.fabric_txid`).

## What makes a “blockchain receipt” usable in legal workflows

A blockchain transaction ID by itself is usually **not sufficient** for legal use. A court-ready evidence package should:

- Identify *what was asserted* (the record / statement)
- Include a *cryptographic commitment* to the asserted content (hash)
- Provide the *ledger anchoring proof* (transaction, block header, endorsements)
- Preserve *chain-of-custody* from capture → export → filing
- Make verification possible by a neutral third party

## Recommended evidence bundle (ZIP)

RoadWatch exports an evidence ZIP (see `GET /rti/:id/evidence.zip`). For legal use, the bundle should contain:

1) `manifest.json`
- Schema version
- SHA-256 hash for every file in the bundle
- Generation timestamp

2) Business records (human-readable + machine-readable)
- `complaint/complaint.json`
- `complaint/audit-log.json`
- `rti/rti.json`
- `rti/events.json`
- `rti/responses.json`
- `rti/attachments.json`

3) Ledger receipts (minimum)
- `blockchain/receipts.json`
  - Includes all known `fabricTxids` for the case

4) Optional but strongly recommended for “court-grade” proofs
- `blockchain/tx/<txid>.json`
  - Full Fabric transaction envelope (as provided by the Fabric gateway/peer)
- `blockchain/block/<blockNumber>.json`
  - Block header + metadata that links the transaction into an immutable block
- `blockchain/endorsements/<txid>.json`
  - Endorsement identities + signatures
- `blockchain/certs/<mspid>/*.pem`
  - Certificate chain used to validate endorsements (or references to your CA)

5) Human verification instructions
- `VERIFY.txt`
  - Steps to recompute SHA-256 hashes
  - Steps to retrieve the Fabric transaction/block proof from the network

## File format guidance

- JSON should be pretty-printed UTF-8.
- PDFs (when generated) should prefer PDF/A if you later need archival constraints.
- Prefer including both:
  - a human-readable PDF summary
  - and the raw JSON receipts + hashes

## Chain-of-custody recommendations

Operational controls matter as much as format:

- Ensure the evidence capture pipeline records stable hashes (SHA-256) at capture time.
- Avoid re-compression or transformations after hashing.
- If media is stored off-ledger (IPFS/R2), store:
  - content hash
  - URI/CID
  - timestamp
  - access control logs
- Consider digitally signing the manifest at export time (e.g., hardware-backed signing key).

## Current implementation status

- The gateway evidence ZIP currently includes:
  - all relevant business JSON
  - all known `fabric_txid` values
  - a manifest of SHA-256 hashes

To make it fully self-contained for court, extend the exporter to fetch and embed the Fabric transaction/block/endorsement artifacts listed above.
