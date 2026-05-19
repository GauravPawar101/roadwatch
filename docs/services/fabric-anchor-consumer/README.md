# Fabric Anchor Consumer Service

## Overview
Kafka consumer service that processes complaint events, batches them into Merkle trees, and anchors the roots to Hyperledger Fabric blockchain for immutable audit trails. Provides cryptographic proof of complaint integrity.

## Architecture
- **Runtime**: Node.js with TypeScript
- **Event Streaming**: Kafka (KafkaJS or Upstash)
- **Blockchain**: Hyperledger Fabric Gateway SDK
- **Database**: Cassandra for proof storage (preferred). Legacy Postgres support exists for some scripts.
- **Cryptography**: SHA-256 Merkle trees
- **Deployment**: Docker container

## Key Features
- Batch processing of complaint events
- Merkle tree construction with cryptographic proofs
- Blockchain anchoring via Fabric Gateway
- Retry logic with exponential backoff
- Dead letter queue (DLQ) for failed events
- Idempotency protection
- Performance monitoring

## Core Components

### Kafka Consumer
- `LocalKafkaPollConsumer` - Local Kafka consumer implementation
- `UpstashPollConsumer` - Upstash Kafka consumer implementation
- `ConsumerManager` - Consumer lifecycle management
- `MessageProcessor` - Event processing logic

### Merkle Tree
- `MerkleTree` - Merkle tree construction and proof generation
- `MerkleProof` - Proof verification utilities
- `HashUtils` - SHA-256 hashing functions

### Fabric Integration
- `FabricGateway` - Fabric network connection
- `ContractInvoker` - Smart contract interaction
- `TransactionSubmitter` - Transaction submission and monitoring