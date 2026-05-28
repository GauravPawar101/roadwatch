# Event System Architecture

## Overview
The RoadWatch system uses event-driven architecture for loose coupling, scalability, and real-time processing. This document covers the event system design, patterns, and implementation.

## Event Architecture

### Event Flow Overview
```
Event Producers → Event Bus (Kafka) → Event Consumers
     ↓              ↓                    ↓
[Services]    [Topics/Partitions]   [Handlers]
```

### Core Event Components

#### Event Bus Interface
```typescript
interface EventBus {
  publish<T extends BaseEvent>(topic: string, event: T): Promise<void>;
  subscribe<T extends BaseEvent>(topic: string, handler: EventHandler<T>): Promise<void>;
  unsubscribe(topic: string, handlerId: string): Promise<void>;
}

interface BaseEvent {
  id: string;
  type: string;
  version: number;
  timestamp: string;
  source: string;
  idempotencyKey: string;
  correlationId?: string;
  causationId?: string;
}

type EventHandler<T extends BaseEvent> = (event: T) => Promise<void>;
```

#### Kafka Event Bus Implementation
```typescript
class KafkaEventBus implements EventBus {
  private producer: Producer;
  private consumers: Map<string, Consumer> = new Map();
  private handlers: Map<string, EventHandler<any>[]> = new Map();
  
  constructor(private kafka: Kafka) {
    this.producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      retries: {
        retries: 5,
        initialRetryTime: 100,
        maxRetryTime: 30000
      }
    });
  }
  
  async publish<T extends BaseEvent>(topic: string, event: T): Promise<void> {
    const message = {
      key: event.id,
      value: JSON.stringify({
        ...event,
        timestamp: event.timestamp || new Date().toISOString(),
        source: event.source || 'roadwatch-system'
      }),
      headers: {
        'event-type': event.type,
        'event-version': event.version.toString(),
        'idempotency-key': event.idempotencyKey
      }
    };
    
    await this.producer.send({
      topic,
      messages: [message]
    });
  }
  
  async subscribe<T extends BaseEvent>(
    topic: string, 
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): Promise<void> {
    const groupId = options?.groupId || `${topic}-consumer-group`;
    
    let consumer = this.consumers.get(groupId);
    if (!consumer) {
      consumer = this.kafka.consumer({ 
        groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000
      });
      
      await consumer.connect();
      this.consumers.set(groupId, consumer);
    }
    
    await consumer.subscribe({ topic });
    
    // Store handler
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
    }
    this.handlers.get(topic)!.push(handler);
    
    // Start consuming if not already running
    if (!consumer.paused()) {
      await this.startConsuming(consumer, topic);
    }
  }
  
  private async startConsuming(consumer: Consumer, topic: string): Promise<void> {
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const handlers = this.handlers.get(topic) || [];
        
        for (const handler of handlers) {
          try {
            const event = JSON.parse(message.value!.toString());
            await this.processEventWithRetry(handler, event);
          } catch (error) {
            await this.handleEventError(topic, message, error);
          }
        }
      }
    });
  }
  
  private async processEventWithRetry<T extends BaseEvent>(
    handler: EventHandler<T>,
    event: T,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await handler(event);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          await this.sleep(delay);
        }
      }
    }
    
    // All retries failed, send to DLQ
    await this.sendToDLQ(event, lastError!);
  }
}
```

## Event Types & Schemas

### Complaint Events
```typescript
// Complaint lifecycle events
interface ComplaintSubmittedEvent extends BaseEvent {
  type: 'complaint-submitted';
  complaintId: string;
  citizenId: string;
  district: string;
  zone: string;
  roadId: string;
  location: GeoCoordinate;
  description: string;
  severity: Severity;
  damageType: DamageType;
}

interface ComplaintStatusChangedEvent extends BaseEvent {
  type: 'complaint-status-changed';
  complaintId: string;
  oldStatus: ComplaintStatus;
  newStatus: ComplaintStatus;
  actorId: string;
  reason?: string;
  estimatedResolution?: string;
}

interface ComplaintAssignedEvent extends BaseEvent {
  type: 'complaint-assigned';
  complaintId: string;
  contractorId: string;
  assignedBy: string;
  expectedCompletionDate: string;
  slaDeadline: string;
}

interface ComplaintEscalatedEvent extends BaseEvent {
  type: 'complaint-escalated';
  complaintId: string;
  fromAuthorityId: string;
  toAuthorityId: string;
  escalationReason: string;
  escalationLevel: number;
}

interface ComplaintResolvedEvent extends BaseEvent {
  type: 'complaint-resolved';
  complaintId: string;
  resolvedBy: string;
  resolutionDescription: string;
  evidenceCids: string[];
  resolutionDate: string;
}
```

### Media Processing Events
```typescript
interface MediaCapturedEvent extends BaseEvent {
  type: 'media-captured';
  mediaId: string;
  complaintId: string;
  mediaType: 'photo' | 'video';
  originalSize: number;
  captureLocation: GeoCoordinate;
  captureTimestamp: string;
}

interface MediaCompressedEvent extends BaseEvent {
  type: 'media-compressed';
  mediaId: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  quality: number;
}

interface MediaUploadedEvent extends BaseEvent {
  type: 'media-uploaded';
  mediaId: string;
  uploadUrl: string;
  cdnUrl: string;
  fileHash: string;
  uploadDuration: number;
}

interface MediaAnalyzedEvent extends BaseEvent {
  type: 'media-analyzed';
  mediaId: string;
  analysisResults: {
    damageDetected: boolean;
    damageType?: DamageType;
    severity?: Severity;
    confidence: number;
    boundingBoxes?: BoundingBox[];
  };
}
```

### Blockchain Events
```typescript
interface ComplaintAnchoredEvent extends BaseEvent {
  type: 'complaint-anchored';
  complaintId: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
  fabricTxId: string;
  batchId: string;
  blockNumber: number;
}

interface BatchProcessedEvent extends BaseEvent {
  type: 'batch-processed';
  batchId: string;
  complaintIds: string[];
  merkleRoot: string;
  fabricTxId: string;
  processedAt: string;
  batchSize: number;
}

interface FabricEventReceived extends BaseEvent {
  type: 'fabric-event-received';
  fabricEventName: string;
  chaincodeName: string;
  txId: string;
  blockNumber: number;
  payload: any;
}
```

### Notification Events
```typescript
interface NotificationSendEvent extends BaseEvent {
  type: 'notification-send';
  notificationId: string;
  recipientId: string;
  channel: 'fcm' | 'sms' | 'email' | 'in-app';
  title: string;
  body: string;
  data?: Record<string, any>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  scheduledFor?: string;
}

interface NotificationDeliveredEvent extends BaseEvent {
  type: 'notification-delivered';
  notificationId: string;
  channel: string;
  deliveredAt: string;
  deliveryDuration: number;
  success: boolean;
  errorMessage?: string;
}

interface NotificationClickedEvent extends BaseEvent {
  type: 'notification-clicked';
  notificationId: string;
  userId: string;
  clickedAt: string;
  actionTaken?: string;
}
```

## Event Handlers & Processors

### Complaint Event Handlers
```typescript
// Notification handler for complaint events
class ComplaintNotificationHandler {
  async handleComplaintSubmitted(event: ComplaintSubmittedEvent): Promise<void> {
    // Send confirmation to citizen
    await this.notificationService.send({
      recipientId: event.citizenId,
      channel: 'fcm',
      title: 'Complaint Submitted',
      body: `Your complaint ${event.complaintId} has been submitted successfully.`,
      data: { complaintId: event.complaintId }
    });
    
    // Notify relevant authorities
    const authorities = await this.getAuthoritiesForLocation(event.district, event.zone);
    for (const authority of authorities) {
      await this.notificationService.send({
        recipientId: authority.id,
        channel: 'fcm',
        title: 'New Complaint',
        body: `New complaint in ${event.district}, ${event.zone}`,
        data: { complaintId: event.complaintId }
      });
    }
  }
  
  async handleComplaintStatusChanged(event: ComplaintStatusChangedEvent): Promise<void> {
    const complaint = await this.complaintService.getById(event.complaintId);
    
    // Notify citizen of status change
    await this.notificationService.send({
      recipientId: complaint.citizenId,
      channel: 'fcm',
      title: 'Complaint Status Updated',
      body: `Your complaint status changed to ${event.newStatus}`,
      data: { 
        complaintId: event.complaintId,
        newStatus: event.newStatus
      }
    });
    
    // Send real-time update to connected clients
    await this.sseService.broadcast('complaint_updated', {
      complaintId: event.complaintId,
      status: event.newStatus,
      updatedAt: event.timestamp
    });
  }
}

// Analytics handler for complaint events
class ComplaintAnalyticsHandler {
  async handleComplaintSubmitted(event: ComplaintSubmittedEvent): Promise<void> {
    await this.analyticsService.record({
      type: 'COMPLAINT_SUBMITTED',
      timestamp: event.timestamp,
      properties: {
        complaintId: event.complaintId,
        district: event.district,
        zone: event.zone,
        severity: event.severity,
        damageType: event.damageType,
        location: event.location
      }
    });
    
    // Update district statistics
    await this.updateDistrictStats(event.district, 'complaints_submitted', 1);
    
    // Check for hotspot patterns
    await this.checkHotspotPattern(event.location, event.district);
  }
  
  async handleComplaintResolved(event: ComplaintResolvedEvent): Promise<void> {
    const complaint = await this.complaintService.getById(event.complaintId);
    const resolutionTime = new Date(event.resolutionDate).getTime() - 
                          new Date(complaint.createdAt).getTime();
    
    await this.analyticsService.record({
      type: 'COMPLAINT_RESOLVED',
      timestamp: event.timestamp,
      properties: {
        complaintId: event.complaintId,
        resolutionTimeMs: resolutionTime,
        resolvedBy: event.resolvedBy,
        district: complaint.district,
        zone: complaint.zone
      }
    });
    
    // Update performance metrics
    await this.updatePerformanceMetrics(complaint.district, resolutionTime);
  }
}
```

### Blockchain Event Handlers
```typescript
// Fabric event handler
class FabricEventHandler {
  async handleComplaintAnchored(event: ComplaintAnchoredEvent): Promise<void> {
    // Update complaint with blockchain reference
    await this.complaintService.updateBlockchainRef(event.complaintId, {
      fabricTxId: event.fabricTxId,
      merkleRoot: event.merkleRoot,
      blockNumber: event.blockNumber,
      anchoredAt: event.timestamp
    });
    
    // Store Merkle proof for verification
    await this.proofService.store(event.complaintId, {
      merkleRoot: event.merkleRoot,
      proof: event.merkleProof,
      batchId: event.batchId
    });
    
    // Notify citizen of blockchain anchoring
    const complaint = await this.complaintService.getById(event.complaintId);
    await this.notificationService.send({
      recipientId: complaint.citizenId,
      channel: 'fcm',
      title: 'Complaint Secured',
      body: 'Your complaint has been secured on the blockchain',
      data: { 
        complaintId: event.complaintId,
        txId: event.fabricTxId
      }
    });
  }
  
  async handleBatchProcessed(event: BatchProcessedEvent): Promise<void> {
    // Update batch processing metrics
    await this.metricsService.record({
      metric: 'blockchain_batch_processed',
      value: event.batchSize,
      tags: { batchId: event.batchId }
    });
    
    // Log successful batch processing
    console.log(`Batch ${event.batchId} processed: ${event.batchSize} complaints anchored`);
  }
}
```

## Event Sourcing Pattern

### Event Store Implementation
```typescript
// Event store for maintaining event history
class EventStore {
  async append(streamId: string, events: BaseEvent[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const event of events) {
        await tx.query(`
          INSERT INTO event_store (
            stream_id, event_id, event_type, event_data, 
            version, timestamp, correlation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          streamId,
          event.id,
          event.type,
          JSON.stringify(event),
          event.version,
          event.timestamp,
          event.correlationId
        ]);
      }
    });
  }
  
  async getEvents(streamId: string, fromVersion?: number): Promise<BaseEvent[]> {
    const query = fromVersion 
      ? 'SELECT * FROM event_store WHERE stream_id = $1 AND version >= $2 ORDER BY version'
      : 'SELECT * FROM event_store WHERE stream_id = $1 ORDER BY version';
    
    const params = fromVersion ? [streamId, fromVersion] : [streamId];
    const result = await this.db.query(query, params);
    
    return result.rows.map(row => JSON.parse(row.event_data));
  }
  
  async getEventsByType(eventType: string, limit?: number): Promise<BaseEvent[]> {
    const query = limit
      ? 'SELECT * FROM event_store WHERE event_type = $1 ORDER BY timestamp DESC LIMIT $2'
      : 'SELECT * FROM event_store WHERE event_type = $1 ORDER BY timestamp DESC';
    
    const params = limit ? [eventType, limit] : [eventType];
    const result = await this.db.query(query, params);
    
    return result.rows.map(row => JSON.parse(row.event_data));
  }
}

// Aggregate root with event sourcing
abstract class AggregateRoot {
  protected events: BaseEvent[] = [];
  protected version: number = 0;
  
  protected addEvent(event: BaseEvent): void {
    this.events.push({
      ...event,
      version: this.version + 1,
      timestamp: new Date().toISOString()
    });
    this.version++;
  }
  
  getUncommittedEvents(): BaseEvent[] {
    return [...this.events];
  }
  
  markEventsAsCommitted(): void {
    this.events = [];
  }
  
  abstract applyEvent(event: BaseEvent): void;
  
  loadFromHistory(events: BaseEvent[]): void {
    events.forEach(event => {
      this.applyEvent(event);
      this.version = event.version;
    });
  }
}

// Complaint aggregate with event sourcing
class ComplaintAggregate extends AggregateRoot {
  private id: string;
  private status: ComplaintStatus;
  private citizenId: string;
  private district: string;
  private zone: string;
  
  static create(data: ComplaintData): ComplaintAggregate {
    const aggregate = new ComplaintAggregate();
    
    aggregate.addEvent({
      id: crypto.randomUUID(),
      type: 'complaint-submitted',
      version: 1,
      timestamp: new Date().toISOString(),
      source: 'complaint-service',
      idempotencyKey: `complaint-${data.id}-submitted`,
      complaintId: data.id,
      citizenId: data.citizenId,
      district: data.district,
      zone: data.zone,
      // ... other properties
    } as ComplaintSubmittedEvent);
    
    return aggregate;
  }
  
  updateStatus(newStatus: ComplaintStatus, actorId: string): void {
    if (!this.canTransitionTo(newStatus)) {
      throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
    }
    
    this.addEvent({
      id: crypto.randomUUID(),
      type: 'complaint-status-changed',
      version: this.version + 1,
      timestamp: new Date().toISOString(),
      source: 'complaint-service',
      idempotencyKey: `complaint-${this.id}-status-${newStatus}`,
      complaintId: this.id,
      oldStatus: this.status,
      newStatus,
      actorId
    } as ComplaintStatusChangedEvent);
  }
  
  applyEvent(event: BaseEvent): void {
    switch (event.type) {
      case 'complaint-submitted':
        this.applyComplaintSubmitted(event as ComplaintSubmittedEvent);
        break;
      case 'complaint-status-changed':
        this.applyStatusChanged(event as ComplaintStatusChangedEvent);
        break;
      // Handle other event types...
    }
  }
  
  private applyComplaintSubmitted(event: ComplaintSubmittedEvent): void {
    this.id = event.complaintId;
    this.citizenId = event.citizenId;
    this.district = event.district;
    this.zone = event.zone;
    this.status = ComplaintStatus.PENDING;
  }
  
  private applyStatusChanged(event: ComplaintStatusChangedEvent): void {
    this.status = event.newStatus;
  }
}
```

## Event Processing Patterns

### Saga Pattern for Complex Workflows
```typescript
// Saga for complaint processing workflow
class ComplaintProcessingSaga {
  private steps: SagaStep[] = [];
  
  async execute(event: ComplaintSubmittedEvent): Promise<void> {
    const sagaId = crypto.randomUUID();
    
    try {
      // Step 1: Validate complaint
      await this.validateComplaint(event);
      this.steps.push({ action: 'validate', complaintId: event.complaintId });
      
      // Step 2: Assign to authority
      await this.assignToAuthority(event);
      this.steps.push({ action: 'assign', complaintId: event.complaintId });
      
      // Step 3: Send notifications
      await this.sendNotifications(event);
      this.steps.push({ action: 'notify', complaintId: event.complaintId });
      
      // Step 4: Schedule SLA monitoring
      await this.scheduleSLAMonitoring(event);
      this.steps.push({ action: 'schedule_sla', complaintId: event.complaintId });
      
    } catch (error) {
      // Compensate in reverse order
      await this.compensate(this.steps.reverse());
      throw error;
    }
  }
  
  private async compensate(steps: SagaStep[]): Promise<void> {
    for (const step of steps) {
      try {
        await this.executeCompensation(step);
      } catch (error) {
        console.error(`Compensation failed for step ${step.action}:`, error);
      }
    }
  }
}
```

### CQRS with Event Projections
```typescript
// Read model projections from events
class ComplaintProjectionHandler {
  async handleComplaintSubmitted(event: ComplaintSubmittedEvent): Promise<void> {
    // Update complaint read model
    await this.complaintReadModel.create({
      id: event.complaintId,
      citizenId: event.citizenId,
      district: event.district,
      zone: event.zone,
      status: ComplaintStatus.PENDING,
      createdAt: event.timestamp,
      updatedAt: event.timestamp
    });
    
    // Update district statistics
    await this.districtStatsReadModel.increment(event.district, 'total_complaints');
    
    // Update real-time dashboard
    await this.dashboardReadModel.addComplaint(event);
  }
  
  async handleComplaintStatusChanged(event: ComplaintStatusChangedEvent): Promise<void> {
    // Update complaint read model
    await this.complaintReadModel.update(event.complaintId, {
      status: event.newStatus,
      updatedAt: event.timestamp
    });
    
    // Update status statistics
    await this.statusStatsReadModel.updateCounts(
      event.oldStatus,
      event.newStatus
    );
  }
}
```

## Error Handling & Resilience

### Dead Letter Queue (DLQ)
```typescript
class DeadLetterQueueHandler {
  async sendToDLQ(originalEvent: BaseEvent, error: Error): Promise<void> {
    const dlqEvent: DlqEvent = {
      id: crypto.randomUUID(),
      type: 'dlq-event',
      version: 1,
      timestamp: new Date().toISOString(),
      source: 'event-system',
      idempotencyKey: `dlq-${originalEvent.id}`,
      originalEvent,
      error: {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      },
      retryCount: 0,
      maxRetries: 3
    };
    
    await this.eventBus.publish('dlq-events', dlqEvent);
  }
  
  async processDLQEvent(event: DlqEvent): Promise<void> {
    if (event.retryCount >= event.maxRetries) {
      // Send to manual review queue
      await this.sendToManualReview(event);
      return;
    }
    
    try {
      // Attempt to reprocess original event
      await this.reprocessEvent(event.originalEvent);
    } catch (error) {
      // Increment retry count and send back to DLQ
      event.retryCount++;
      await this.eventBus.publish('dlq-events', event);
    }
  }
}
```

### Event Replay & Recovery
```typescript
class EventReplayService {
  async replayEvents(
    streamId: string,
    fromTimestamp: string,
    toTimestamp?: string
  ): Promise<void> {
    const events = await this.eventStore.getEventsByTimeRange(
      streamId,
      fromTimestamp,
      toTimestamp
    );
    
    for (const event of events) {
      try {
        await this.eventBus.publish(this.getTopicForEvent(event.type), event);
      } catch (error) {
        console.error(`Failed to replay event ${event.id}:`, error);
      }
    }
  }
  
  async rebuildProjection(projectionName: string, fromVersion?: number): Promise<void> {
    const events = await this.eventStore.getAllEvents(fromVersion);
    const projection = this.getProjection(projectionName);
    
    // Clear existing projection
    await projection.clear();
    
    // Rebuild from events
    for (const event of events) {
      await projection.handle(event);
    }
  }
}
```