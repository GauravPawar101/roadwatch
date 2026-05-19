# RoadWatch Complete Service Inventory

## Overview

This document provides a comprehensive inventory of all services in the RoadWatch system, including their responsibilities, dependencies, ports, and health status.

**Generated:** May 8, 2026  
**System Status:** Transitioning from Upstash to local Docker-based Kafka + Zookeeper  
**Container Orchestration:** Docker Compose with resource limits and health checks

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│              RoadWatch System Services                   │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────┐  │
│  │ Gateway API │────▶│  Cassandra   │◀────│ Scheduler│  │
│  │  (3000)     │     │   (9042)     │     │ (cron)   │  │
│  └──────┬──────┘     └──────────────┘     └──────────┘  │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────────────────────────────────────┐         │
│  │ Kafka (9094) ◀──▶ Zookeeper (2181)          │         │
│  │                                              │         │
│  ├──────────────────────┬──────────────────────┤         │
│  │                      │                      │         │
│  ▼                      ▼                      ▼         │
│┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
││ Webhook      │   │ Fabric Anchor│   │    Fabric    │   │
││ Handler      │   │  Consumer    │   │   Network    │   │
│└──────────────┘   └──────────────┘   └──────────────┘   │
│                                                           │
│  ┌──────────────┐                                        │
│  │ Redis (opt)  │                                        │
│  │  (6379)      │                                        │
│  └──────────────┘                                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Core Services

### 1. **Cassandra** (Database)
- **Container:** `roadwatch_cassandra`
- **Image:** `cassandra:4.1`
- **Port:** 9042 → 9042
- **Status:** Always running ✅
- **Responsibilities:**
  - Core data persistence (complaints, users, repairs, etc.)
  - Job state (scheduler cron tasks)
  - Event logs and audit trails
  - Service metrics and health data
- **Dependencies:** None (foundational)
- **Health Check:** cqlsh readiness / Cassandra health endpoint
- **Resource Limits:** 1 CPU, 1GB RAM minimum recommended
- **Data Volume:** `cassandra_data:/var/lib/cassandra`
- **Environment:**
  ```
  CASSANDRA_CONTACT_POINTS: cassandra:9042
  CASSANDRA_KEYSPACE: roadwatch
  CASSANDRA_LOCAL_DC: datacenter1
  ```

**API Endpoints Using This:**
- All routes in `apps/gateway-api`
- All background services (scheduler, webhook-handler, fabric-anchor-consumer)

---

### 2. **Zookeeper** (Kafka Coordinator)
- **Container:** `roadwatch_zookeeper`
- **Image:** `confluentinc/cp-zookeeper:7.7-alpine`
- **Port:** 2181
- **Status:** Running on `kafka` profile
- **Responsibilities:**
  - Kafka broker coordination
  - Consumer group management
  - Leader election for Kafka cluster
- **Dependencies:** None
- **Health Check:** Manual verify (no built-in health check for Zookeeper)
- **Resource Limits:** 0.5 CPU, 256MB RAM (reserved: 0.25 CPU, 128MB)
- **Environment:**
  ```
  ZK_SERVER_HEAP: "-Xms128m -Xmx256m"
  ZOOKEEPER_CLIENT_PORT: 2181
  ZOOKEEPER_TICK_TIME: 2000
  ZOOKEEPER_SYNC_LIMIT: 5
  ZOOKEEPER_INIT_LIMIT: 10
  ```

---

### 3. **Kafka** (Message Queue)
- **Container:** `roadwatch_kafka`
- **Image:** `confluentinc/cp-kafka:7.7-alpine`
- **Ports:** 
  - External: 9094
  - Internal (container-to-container): 29092
- **Status:** Running on `kafka` profile
- **Responsibilities:**
  - Event streaming (complaints, verifications, notifications)
  - Decoupling services (async event processing)
  - Audit trail for state changes
- **Dependencies:** Zookeeper (must start first)
- **Health Check:** `kafka-broker-api-versions.sh` every 10s
- **Resource Limits:** 1 CPU, 512MB RAM (reserved: 0.5 CPU, 256MB)
- **Topics Created:**
  - `complaint.submitted` — New complaints from citizens
  - `complaint.anchored` — HLF blockchain anchoring confirmation
  - `complaint.status.changed` — Status updates (submitted→assigned→resolved)
  - `media.captured` — Photo capture events
  - `media.uploaded` — Pinata upload completion
  - `media.analyzed` — AI verification results
  - `escalation.due` — SLA breach alerts
  - `notification.send` — Notification dispatch events
  - `authority.action` — Authority verifications/rejections
  - `dlq.events` — Dead letter queue for failed messages
- **Configuration:**
  ```
  KAFKA_BROKER_ID: 1
  KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,PLAINTEXT_INTERNAL://0.0.0.0:29092
  KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9094,PLAINTEXT_INTERNAL://kafka:29092
  KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT_INTERNAL
  KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false'
  KAFKA_LOG_RETENTION_HOURS: 24
  KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
  ```

**Switching from Upstash to Local Kafka:**
- Previously: `UPSTASH_KAFKA_REST_URL` + polling
- Now: Native Kafka broker (faster, lower latency, no HTTP overhead)
- Connection string (container-to-container): `kafka:29092`
- Connection string (localhost): `localhost:9094`

---

### 4. **Redis** (Cache Layer - Optional)
- **Container:** `roadwatch_redis`
- **Image:** `redis:7.2-alpine`
- **Port:** 6379
- **Status:** Running on `redis` profile (optional)
- **Responsibilities:**
  - Session caching (optional)
  - Rate limiting (optional)
  - Real-time leaderboards (optional)
- **Dependencies:** None
- **Health Check:** `redis-cli ping` every 10s
- **Resource Limits:** 0.5 CPU, 256MB RAM (reserved: 0.25 CPU, 128MB)
- **Configuration:** Max memory 256MB, eviction policy: allkeys-lru
- **Enable:** `docker-compose --profile redis up`

---

## Background Services

### 5. **Scheduler** (Cron Jobs & Background Tasks)
- **Container:** `roadwatch_scheduler`
- **Build:** `services/scheduler/Dockerfile`
- **Type:** Node.js + node-cron
- **Status:** Always running ✅
- **Responsibilities:**
  - **Sync offline queue** (every 5 minutes)
    - Processes queued complaints/actions from offline clients
    - Updates database status field
  - **Recalculate karma scores** (every hour)
    - Computes user reputation based on complaint resolution rate
    - Awards/penalizes users based on behavior
  - **SLA breach detection** (every 30 seconds)
    - Monitors complaint age vs. SLA threshold (24 hours)
    - Escalates overdue complaints to supervisors
  - **Audit log cleanup** (daily at 2 AM)
    - Deletes audit logs older than 90 days
    - Maintains database performance
  - **Generate reports** (daily at 1 AM)
    - Compiles daily summary statistics
    - Stores in `daily_reports` table
- **Dependencies:** Cassandra (health check)
- **Resource Limits:** 0.5 CPU, 256MB RAM
- **Health Check:** Process alive (exit code 0)
- **Environment Variables:**
  ```
  CASSANDRA_CONTACT_POINTS: cassandra:9042
  CASSANDRA_KEYSPACE: roadwatch_local
  CASSANDRA_LOCAL_DC: datacenter1
  SERVICE_NAME: scheduler
  CRON_SYNC_QUEUE: "*/5 * * * *"
  CRON_KARMA_RECALC: "0 * * * *"
  CRON_SLA_CHECK: "*/30 * * * * *"
  CRON_AUDIT_CLEANUP: "0 2 * * *"
  CRON_REPORT_GENERATION: "0 1 * * *"
  ```
- **Database Schema Required:**
  - `offline_queue` (synced=bool, retry_count=int)
  - `users` (karma_score, karma_updated_at)
  - `complaints` (status, created_at, escalation_status)
  - `audit_logs` (created_at)
  - `daily_reports` (report_date, report_data)

---

### 6. **Webhook Handler** (Event Processor)
- **Container:** `roadwatch_webhook_handler`
- **Build:** `services/webhook-handler/Dockerfile`
- **Type:** Node.js + kafkajs
- **Status:** Always running ✅
- **Responsibilities:**
  - Consumes Kafka events and processes them
  - Updates complaint state based on events
  - Sends notifications to affected users
  - Logs all authority actions
- **Subscribed Topics:**
  - `complaint.submitted` → Updates metadata, logs event
  - `complaint.anchored` → Updates anchored_at, anchored_tx_hash
  - `complaint.status.changed` → Propagates status, notifies users
  - `notification.send` → Marks notification as sent
  - `authority.action` → Logs action, notifies citizen
- **Dependencies:** Cassandra, Kafka (health checks)
- **Resource Limits:** 0.5 CPU, 256MB RAM
- **Health Check:** Process alive
- **Environment Variables:**
  ```
  CASSANDRA_CONTACT_POINTS: cassandra:9042
  CASSANDRA_KEYSPACE: roadwatch_local
  CASSANDRA_LOCAL_DC: datacenter1
  KAFKA_BROKERS: kafka:29092
  KAFKA_GROUP_ID: webhook-handler
  KAFKA_CONSUMER_TIMEOUT: 3000
  SERVICE_NAME: webhook-handler
  LOG_LEVEL: info
  ```
- **Database Schema Required:**
  - `notifications` (user_id, type, sent_at, delivery_status)
  - `event_logs` (event_type, entity_id, event_data)
  - `notification_delivery_logs` (notification_id, channel, status)
  - `authority_action_logs` (complaint_id, authority_id, action_type)

---

### 7. **Fabric Anchor Consumer** (Blockchain Integration)
- **Container:** `roadwatch_fabric_anchor_consumer`
- **Build:** `services/fabric-anchor-consumer/Dockerfile`
- **Type:** Node.js + kafkajs + hyperledger/fabric-gateway
- **Status:** Always running ✅
- **Responsibilities:**
  - Consumes `complaint.submitted` events from Kafka
  - Anchors complaint hash to Hyperledger Fabric blockchain
  - Verifies anchor transaction
  - Publishes `complaint.anchored` event with transaction hash
  - Handles errors and dead-letter queue
- **Input Event:** Complaint submitted by citizen
- **Output Event:** complaint.anchored (with HLF txHash)
**Dependencies:** Cassandra, Kafka, Fabric network (health checks)
- **Resource Limits:** 1 CPU, 512MB RAM (largest due to HLF SDK overhead)
- **Health Check:** Process alive
- **Environment Variables:**
  ```
  CASSANDRA_CONTACT_POINTS: cassandra:9042
  CASSANDRA_KEYSPACE: roadwatch_local
  CASSANDRA_LOCAL_DC: datacenter1
  KAFKA_BROKERS: kafka:29092
  FABRIC_PEER_ENDPOINT: peer0.nhai.example.com:7051
  FABRIC_MSP_ID: NHAIMSP
  FABRIC_CHANNEL_NAME: roadwatch-india
  FABRIC_CHAINCODE_NAME: complaint-anchor
  ```
- **Fabric Network Configuration:**
  - Channel: `roadwatch-india`
  - Chaincode: `complaint-anchor` (v0.0.1, sequence 1)
  - Organizations: NHAIMSP, RoadWatchMSP
  - Consensus: SOLO orderer (dev only)
  - State DB: LevelDB (lightweight, no CouchDB overhead)

---

## Fabric (Hyperledger) Network

### 8. **Fabric Orderer** (Consensus Service)
- **Type:** Hyperledger Fabric Orderer
- **Port:** 7050 (external), 7050 (internal)
- **Status:** Part of Fabric network stack
- **Responsibilities:**
  - Ordering consensus for blockchain transactions
  - Block creation and validation
  - Ledger persistence
- **Network:** Custom Fabric docker-compose
- **State DB:** LevelDB
- **Dependencies:** None (foundational for Fabric)

### 9. **Fabric Peers** (2 Orgs)
- **Org 1:** NHAIMSP (peer0.nhai:7051)
- **Org 2:** RoadWatchMSP (peer0.roadwatch:9051)
- **Type:** Hyperledger Fabric Peer
- **Responsibilities:**
  - Chaincode execution (complaint anchoring logic)
  - Ledger maintenance
  - Event broadcasting
  - Smart contract state management
- **State DB:** LevelDB (default, no CouchDB overhead)
- **Dependencies:** Orderer

### 10. **Fabric CAs** (2 Orgs)
- **CA NHAI:** ca.nhai:7054
- **CA RoadWatch:** ca.roadwatch:8054
- **Type:** Hyperledger Fabric Certificate Authority
- **Responsibilities:**
  - User enrollment
  - Certificate issuance
  - Identity management
- **Dependencies:** None

---

## Health Check Endpoints

### Gateway API Health Checks

#### `GET /health`
Basic health check (always responds if server is running)
```bash
curl http://localhost:3100/health
# {"status":"ok"}
```

#### `GET /health/status`
Comprehensive health report (returns 503 if any critical service is down)
```bash
curl http://localhost:3100/health/status
```
Response:
```json
{
  "timestamp": "2026-05-08T10:30:00Z",
  "overallStatus": "healthy",
  "services": {
    "gateway-api": {
      "name": "gateway-api",
      "status": "healthy",
      "lastCheck": "2026-05-08T10:30:00Z",
      "message": "Running",
      "dependencies": ["postgres", "kafka"]
    },
    "postgres": {
      "name": "postgres",
      "status": "healthy",
      "lastCheck": "2026-05-08T10:30:00Z",
      "message": "Connected at 2026-05-08 10:30:00",
      "dependencies": []
    },
    "kafka": {
      "name": "kafka",
      "status": "healthy",
      "lastCheck": "2026-05-08T10:30:00Z",
      "message": "Broker available",
      "dependencies": ["zookeeper"]
    },
    "scheduler": {
      "name": "scheduler",
      "status": "healthy",
      "message": "Cron jobs running",
      "dependencies": ["postgres"]
    },
    "webhook-handler": {
      "name": "webhook-handler",
      "status": "healthy",
      "message": "Processing events: 142",
      "dependencies": ["postgres", "kafka"]
    },
    "fabric-anchor-consumer": {
      "name": "fabric-anchor-consumer",
      "status": "healthy",
      "message": "Recent anchors: 5",
      "dependencies": ["postgres", "kafka", "fabric"]
    }
  },
  "uptime": 3600.5,
  "version": "0.0.0"
}
```

#### `GET /health/services`
Service dependency graph
```bash
curl http://localhost:3100/health/services
```
Response:
```json
{
  "services": {
    "gateway-api": ["postgres", "kafka"],
    "postgres": [],
    "kafka": ["zookeeper"],
    "zookeeper": [],
    "scheduler": ["postgres"],
    "webhook-handler": ["postgres", "kafka"],
    "fabric-anchor-consumer": ["postgres", "kafka", "fabric"],
    "fabric": ["orderer", "peers"]
  },
  "timestamp": "2026-05-08T10:30:00Z"
}
```

---

## Startup Order & Dependency Graph

```
1. PostgreSQL
   ↓
2. Zookeeper (kafka profile)
   ↓
3. Kafka (kafka profile)
   ├→ 4. Scheduler (depends: postgres)
   ├→ 5. Webhook Handler (depends: postgres, kafka)
   ├→ 6. Fabric Anchor Consumer (depends: postgres, kafka, fabric)
   └→ 7. Gateway API (depends: postgres, kafka)
```

### Startup Commands

```bash
# Start core services only (postgres always runs)
docker-compose up

# Start with Kafka and message services
docker-compose --profile kafka up

# Start with Redis cache layer
docker-compose --profile redis up

# Start with all services
docker-compose --profile kafka --profile redis up

# Start with Fabric network (separate compose file)
docker-compose -f fabric/network/docker/docker-compose.yaml up
```

---

## Service Verification Checklist

### Before Deployment

- [ ] PostgreSQL health check: `curl http://localhost:3100/health/status | grep postgres`
- [ ] Kafka broker connectivity: Check docker logs `roadwatch_kafka` for "started"
- [ ] Zookeeper quorum: Check docker logs `roadwatch_zookeeper` for "binding"
- [ ] Scheduler initialized: Check docker logs `roadwatch_scheduler` for "All cron jobs initialized"
- [ ] Webhook handler subscribed: Check docker logs `roadwatch_webhook_handler` for "Subscribed to topics"
- [ ] Fabric anchor consumer ready: Check docker logs `roadwatch_fabric_anchor_consumer` for "initialized"
- [ ] Overall system health: `curl http://localhost:3100/health/status` returns 200 with overallStatus="healthy"

### Post-Deployment

- [ ] Create test complaint (submit via `/citizen/complaints`)
- [ ] Verify Kafka event published (check webhook-handler logs)
- [ ] Verify Fabric anchoring (check fabric-anchor-consumer logs)
- [ ] Verify notification queued (query `notifications` table)
- [ ] Check scheduler ran sync job (check `offline_queue` table)
- [ ] Check karma recalculation (query `users` table for karma_updated_at > now - 1 hour)

---

## Troubleshooting Guide

### Service Won't Start

**Problem:** Container exits immediately
- Check logs: `docker logs roadwatch_service_name`
- Check environment variables in docker-compose.yml
- Check database connectivity: `docker exec roadwatch_postgres pg_isready`

**Problem:** Port already in use
- Current ports: 5433 (postgres), 2181 (zk), 9094 (kafka), 6379 (redis), 7050 (fabric)
- Change port in docker-compose.yml if conflicting

### Services Running but Unhealthy

**Problem:** Kafka consumer not receiving messages
- Check Kafka broker: `docker logs roadwatch_kafka`
- Verify topic exists: `docker exec roadwatch_kafka kafka-topics.sh --list --bootstrap-server kafka:29092`
- Check consumer group: `docker exec roadwatch_kafka kafka-consumer-groups.sh --bootstrap-server kafka:29092 --group webhook-handler --describe`

**Problem:** Scheduler cron jobs not running
- Check node-cron logs: `docker logs roadwatch_scheduler`
- Verify database connection: `docker exec roadwatch_postgres psql -U roadwatch_admin -d roadwatch_local -c "SELECT 1"`
- Check cron expression syntax (uses `node-cron` format)

**Problem:** Fabric anchor consumer fails to connect
- Check Fabric network running: `docker-compose -f fabric/network/docker/docker-compose.yaml ps`
- Verify peer endpoint in env vars matches actual peer
- Check certificate paths exist on container
- Verify HLF network on same docker network as main services

### Database Issues

**Problem:** No tables created
- Run migrations: `docker exec roadwatch_gateway_api pnpm run migrate:up`
- Check migrations exist in `apps/gateway-api/migrations/`

**Problem:** Out of disk space
- Check volume: `docker volume ls | grep pg_data`
- Clean old logs: Run scheduler cleanup job (or trigger manually)
- Archive audit logs to external storage if needed

---

## Performance Monitoring

### Recommended Metrics to Track

1. **Kafka Consumer Lag**
   - Monitor via webhook-handler logs or Kafka UI
   - Alert if lag > 1000 messages

2. **Database Connections**
   - Query: `SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname`
   - Alert if > 80 of max 100 connections

3. **Cron Job Execution Time**
   - Track via `audit_logs` table
   - Alert if sync job > 30 seconds

4. **Complaint Anchoring Latency**
   - Measure time from `complaint.submitted` to `complaint.anchored`
   - Target: < 5 seconds (currently Fabric SOLO consensus)

5. **Memory Usage**
   - Monitor Docker container stats: `docker stats`
   - All services should stay well under resource limits

---

## Security Considerations

### Service-to-Service Communication
- All services on same `roadwatch` docker network
- No external port exposure (except gateway-api:3000)
- Database password in `.env` (not committed)
- JWT secret in env vars

### Database Backups
- Volume-based: `docker run --rm -v pg_data:/data -v $(pwd):/backup postgres:16-alpine tar czf /backup/pg_backup.tar.gz /data`
- SQL-based: `docker exec roadwatch_postgres pg_dump -U roadwatch_admin roadwatch_local > backup.sql`

### Fabric Identity Management
- Separate CAs for each organization
- Certificates in volume mounted from host
- Update FABRIC_*_PATH env vars per environment

---

## Deployment Environments

### Development (Current)
- ✅ All services in docker-compose.yml
- ✅ Alpine images (lightweight)
- ✅ LevelDB for Fabric (no CouchDB overhead)
- ✅ Local Kafka broker (not Upstash)
- ✅ Health checks every 10-30s

### Production Recommendations
- [ ] Use managed PostgreSQL (AWS RDS, Azure Database)
- [ ] Use managed Kafka (Confluent Cloud, AWS MSK)
- [ ] Use managed Hyperledger (Azure Blockchain Service or similar)
- [ ] Increase resource limits by 2-3x
- [ ] Add Redis for caching (mandatory)
- [ ] Add separate logging service (ELK stack or CloudWatch)
- [ ] Use secrets manager (AWS Secrets Manager, Azure KeyVault)
- [ ] Enable TLS for all inter-service communication
- [ ] Add rate limiting and DDoS protection (API Gateway)
- [ ] Implement database replication and failover

---

## Service Contact Matrix

| Service | Owner | Slack | On-Call |
|---------|-------|-------|---------|
| gateway-api | Backend | #backend | @on-call-backend |
| scheduler | Platform | #platform | @on-call-platform |
| webhook-handler | Platform | #platform | @on-call-platform |
| fabric-anchor-consumer | Blockchain | #blockchain | @on-call-blockchain |
| postgres | Infrastructure | #infra | @on-call-infra |
| kafka | Infrastructure | #infra | @on-call-infra |

---

## Next Steps

1. **Full Seeding** (pending)
   - Delhi 30 roads + metadata
   - Contractor assignments
   - Authority directory
   - Test complaints and verifications
   - Pinata media uploads
   - HLF anchoring of all test data

2. **Integration Testing** (pending)
   - End-to-end complaint lifecycle
   - Offline-to-online sync validation
   - Karma score calculation
   - SLA breach detection
   - Fabric event processing

3. **Performance Testing** (pending)
   - Load test complaint submission (1000s/minute)
   - Measure Kafka latency
   - Test database query performance
   - Verify memory usage under load

4. **Monitoring & Alerting** (pending)
   - Set up Prometheus + Grafana
   - Configure alerts for service health
   - Add distributed tracing (Jaeger)
   - Set up log aggregation (ELK stack)

---

**Last Updated:** May 8, 2026  
**Version:** 1.0.0  
**Status:** ✅ All background services implemented and docker-integrated
