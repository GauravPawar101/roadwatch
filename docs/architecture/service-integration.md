# Service Integration Patterns

## Overview
This document explains how different services in the RoadWatch system communicate and integrate with each other. It covers synchronous and asynchronous communication patterns, data flow, and integration best practices.

## Integration Architecture

### Communication Patterns

#### 1. Synchronous Communication (REST APIs)
Direct HTTP communication between services for immediate responses.

```typescript
// API Gateway as central hub
class APIGateway {
  // Client requests → Gateway → Backend Services
  async handleComplaintSubmission(req: Request): Promise<Response> {
    // 1. Validate request
    const validation = await this.validateRequest(req);
    if (!validation.valid) {
      return this.errorResponse(400, validation.errors);
    }
    
    // 2. Call complaint service
    const complaint = await this.complaintService.create(req.body);
    
    // 3. Trigger async processes
    await this.eventBus.publish('complaint-submitted', complaint);
    
    // 4. Return immediate response
    return this.successResponse(201, { complaintId: complaint.id });
  }
}

// Service-to-service communication
class ComplaintService {
  constructor(
    private userService: UserService,
    private roadService: RoadService,
    private notificationService: NotificationService
  ) {}
  
  async create(data: ComplaintData): Promise<Complaint> {
    // Call user service to validate citizen
    const user = await this.userService.getById(data.citizenId);
    if (!user) {
      throw new Error('Invalid citizen ID');
    }
    
    // Call road service to validate location
    const road = await this.roadService.findNearestRoad(data.location);
    if (!road) {
      throw new Error('No road found near location');
    }
    
    // Create complaint
    const complaint = await this.repository.create({
      ...data,
      roadId: road.id,
      status: ComplaintStatus.PENDING
    });
    
    // Notify user (async)
    this.notificationService.sendComplaintConfirmation(user, complaint)
      .catch(error => console.error('Notification failed:', error));
    
    return complaint;
  }
}
```

#### 2. Asynchronous Communication (Event-Driven)
Event-based communication for loose coupling and scalability.

```typescript
// Event bus for async communication
interface EventBus {
  publish<T>(topic: string, event: T): Promise<void>;
  subscribe<T>(topic: string, handler: EventHandler<T>): Promise<void>;
}

// Kafka-based event bus implementation
class KafkaEventBus implements EventBus {
  async publish<T>(topic: string, event: T): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{
        key: event.id || crypto.randomUUID(),
        value: JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
          version: 1
        })
      }]
    });
  }
  
  async subscribe<T>(topic: string, handler: EventHandler<T>): Promise<void> {
    await this.consumer.subscribe({ topic });
    
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const event = JSON.parse(message.value!.toString());
          await handler(event);
        } catch (error) {
          console.error(`Error processing event from ${topic}:`, error);
          // Send to DLQ
          await this.sendToDLQ(topic, message, error);
        }
      }
    });
  }
}

// Event handlers in different services
class NotificationService {
  async initialize(): Promise<void> {
    const eventBus = new KafkaEventBus();
    
    // Subscribe to complaint events
    await eventBus.subscribe('complaint-submitted', this.handleComplaintSubmitted.bind(this));
    await eventBus.subscribe('complaint-status-changed', this.handleStatusChanged.bind(this));
    await eventBus.subscribe('escalation-due', this.handleEscalationDue.bind(this));
  }
  
  private async handleComplaintSubmitted(event: ComplaintSubmittedEvent): Promise<void> {
    // Send confirmation to citizen
    await this.sendNotification({
      userId: event.citizenId,
      type: 'COMPLAINT_SUBMITTED',
      title: 'Complaint Submitted Successfully',
      body: `Your complaint ${event.complaintId} has been submitted and is being processed.`,
      data: { complaintId: event.complaintId }
    });
    
    // Notify relevant authorities
    const authorities = await this.getAuthoritiesForLocation(event.district, event.zone);
    for (const authority of authorities) {
      await this.sendNotification({
        userId: authority.id,
        type: 'NEW_COMPLAINT',
        title: 'New Complaint Assigned',
        body: `A new complaint has been assigned to your jurisdiction.`,
        data: { complaintId: event.complaintId }
      });
    }
  }
}

class FabricAnchorService {
  async initialize(): Promise<void> {
    const eventBus = new KafkaEventBus();
    
    // Subscribe to complaint events for blockchain anchoring
    await eventBus.subscribe('complaint-submitted', this.handleComplaintSubmitted.bind(this));
    await eventBus.subscribe('complaint-status-changed', this.handleStatusChanged.bind(this));
  }
  
  private async handleComplaintSubmitted(event: ComplaintSubmittedEvent): Promise<void> {
    // Add to batch for Merkle tree anchoring
    await this.addToBatch({
      complaintId: event.complaintId,
      dataHash: this.calculateHash(event),
      timestamp: event.occurredAt
    });
    
    // Process batch if it reaches threshold
    if (await this.shouldProcessBatch()) {
      await this.processBatch();
    }
  }
}
```

#### 3. Database Integration Patterns
Shared database access and data consistency patterns.

```typescript
// Shared database with service-specific schemas
class DatabaseIntegration {
  // Each service has its own schema/namespace
  private complaintRepo = new ComplaintRepository('complaints');
  private userRepo = new UserRepository('users');
  private analyticsRepo = new AnalyticsRepository('analytics');
  
  // Cross-service queries with proper joins
  async getComplaintWithUserDetails(complaintId: string): Promise<ComplaintWithUser> {
    return await this.db.query(`
      SELECT 
        c.*,
        u.phone_masked,
        u.role,
        u.districts,
        u.zones
      FROM complaints c
      JOIN users u ON c.citizen_id = u.id
      WHERE c.id = $1
    `, [complaintId]);
  }
  
  // Transactional operations across services
  async updateComplaintWithAudit(
    complaintId: string, 
    updates: Partial<Complaint>,
    actorId: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Update complaint
      await tx.query(
        'UPDATE complaints SET status = $1, updated_at = NOW() WHERE id = $2',
        [updates.status, complaintId]
      );
      
      // Insert audit log
      await tx.query(
        'INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
        [actorId, 'STATUS_UPDATE', 'complaint', complaintId, JSON.stringify(updates)]
      );
      
      // Update analytics
      await tx.query(
        'INSERT INTO analytics_events (type, complaint_id, actor_id, properties) VALUES ($1, $2, $3, $4)',
        ['COMPLAINT_STATUS_CHANGED', complaintId, actorId, JSON.stringify(updates)]
      );
    });
  }
}
```

## Service Communication Matrix

### Gateway API ↔ Other Services

```typescript
// Gateway API acts as orchestrator
class GatewayAPIIntegration {
  // → Mobile App (REST API)
  async serveMobileRequests(): Promise<void> {
    this.app.post('/api/citizen/complaints', async (req, res) => {
      const complaint = await this.complaintService.create(req.body);
      res.json({ complaintId: complaint.id });
    });
  }
  
  // → Authority Portal (REST API + SSE)
  async serveAuthorityRequests(): Promise<void> {
    this.app.get('/api/authority/complaints', async (req, res) => {
      const complaints = await this.complaintService.getByJurisdiction(req.user.districts);
      res.json({ complaints });
    });
    
    // Real-time updates via Server-Sent Events
    this.app.get('/api/events', (req, res) => {
      this.sseService.addClient(req.user.id, res);
    });
  }
  
  // → Fabric Anchor Consumer (Kafka Events)
  async publishToFabric(): Promise<void> {
    await this.eventBus.publish('complaint-submitted', {
      complaintId: 'RW-001',
      dataHash: 'abc123',
      timestamp: new Date().toISOString()
    });
  }
  
  // → Redis (Caching)
  async cacheFrequentData(): Promise<void> {
    await this.redis.set('complaints:district:Delhi', complaints, 300);
  }
}
```

### Mobile App ↔ Gateway API

```typescript
// Mobile app service integration
class MobileAppIntegration {
  // Offline-first with sync
  async submitComplaint(data: ComplaintData): Promise<string> {
    const complaintId = this.generateOfflineId();
    
    // Store locally first
    await this.localStorage.store('complaint', complaintId, {
      ...data,
      status: 'PENDING_SYNC'
    });
    
    // Attempt sync if online
    if (await this.networkService.isOnline()) {
      try {
        await this.syncComplaint(complaintId);
      } catch (error) {
        console.log('Sync failed, will retry later');
      }
    }
    
    return complaintId;
  }
  
  private async syncComplaint(id: string): Promise<void> {
    const complaint = await this.localStorage.get('complaint', id);
    
    const response = await fetch('/api/citizen/complaints', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await this.getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(complaint)
    });
    
    if (response.ok) {
      const result = await response.json();
      await this.localStorage.update('complaint', id, {
        status: 'SYNCED',
        serverId: result.complaintId
      });
    }
  }
}
```

### Authority Portal ↔ Gateway API

```typescript
// Authority portal real-time integration
class AuthorityPortalIntegration {
  // Real-time updates via SSE
  async connectToRealTimeUpdates(): Promise<void> {
    const eventSource = new EventSource('/api/events', {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleRealTimeUpdate(data);
    };
    
    eventSource.onerror = () => {
      // Reconnect logic
      setTimeout(() => this.connectToRealTimeUpdates(), 5000);
    };
  }
  
  private handleRealTimeUpdate(data: any): void {
    switch (data.type) {
      case 'complaint_created':
        this.addComplaintToList(data.complaint);
        this.showNotification('New complaint received');
        break;
      case 'complaint_updated':
        this.updateComplaintInList(data.complaint);
        break;
      case 'escalation_due':
        this.highlightOverdueComplaint(data.complaintId);
        break;
    }
  }
  
  // Batch operations for performance
  async updateMultipleComplaints(updates: ComplaintUpdate[]): Promise<void> {
    const response = await fetch('/api/authority/complaints/batch', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ updates })
    });
    
    if (!response.ok) {
      throw new Error('Batch update failed');
    }
  }
}
```

### Fabric Anchor Consumer ↔ Blockchain

```typescript
// Blockchain integration patterns
class FabricIntegration {
  // Batch processing for efficiency
  async processBatch(complaints: ComplaintEvent[]): Promise<void> {
    // Build Merkle tree
    const merkleTree = this.buildMerkleTree(complaints);
    
    // Submit to blockchain
    const txId = await this.fabricGateway.submitTransaction(
      'SubmitMerkleRoot',
      merkleTree.root,
      complaints.length.toString(),
      'batch-' + Date.now()
    );
    
    // Store proofs in database
    for (let i = 0; i < complaints.length; i++) {
      const proof = merkleTree.getProof(i);
      await this.storeProof(complaints[i].complaintId, {
        merkleRoot: merkleTree.root,
        proof,
        fabricTxId: txId,
        batchId: 'batch-' + Date.now()
      });
    }
    
    // Publish anchored events
    for (const complaint of complaints) {
      await this.eventBus.publish('complaint-anchored', {
        complaintId: complaint.complaintId,
        merkleRoot: merkleTree.root,
        fabricTxId: txId
      });
    }
  }
}
```

## Cross-Service Data Flow

### Complaint Lifecycle Integration

```typescript
// End-to-end complaint flow
class ComplaintLifecycleIntegration {
  // 1. Submission (Mobile → Gateway → Database → Kafka)
  async submitComplaint(data: ComplaintData): Promise<string> {
    // Gateway API receives request
    const complaint = await this.complaintService.create(data);
    
    // Publish event for async processing
    await this.eventBus.publish('complaint-submitted', {
      complaintId: complaint.id,
      citizenId: data.citizenId,
      district: data.district,
      zone: data.zone,
      location: data.location,
      description: data.description
    });
    
    return complaint.id;
  }
  
  // 2. Processing (Kafka → Multiple Services)
  async processComplaintSubmission(event: ComplaintSubmittedEvent): Promise<void> {
    // Notification Service: Send confirmations
    await this.notificationService.sendComplaintConfirmation(event);
    
    // Analytics Service: Record metrics
    await this.analyticsService.recordComplaintSubmission(event);
    
    // Fabric Service: Add to blockchain batch
    await this.fabricService.addToBatch(event);
    
    // Authority Service: Auto-assign based on location
    await this.authorityService.autoAssign(event);
  }
  
  // 3. Status Updates (Authority Portal → Gateway → Kafka → Blockchain)
  async updateComplaintStatus(
    complaintId: string, 
    newStatus: ComplaintStatus,
    actorId: string
  ): Promise<void> {
    // Update in database
    await this.complaintService.updateStatus(complaintId, newStatus, actorId);
    
    // Publish status change event
    await this.eventBus.publish('complaint-status-changed', {
      complaintId,
      oldStatus: 'PENDING',
      newStatus,
      actorId,
      timestamp: new Date().toISOString()
    });
    
    // Real-time update to connected clients
    await this.sseService.broadcast('complaint_updated', {
      complaintId,
      status: newStatus
    });
  }
  
  // 4. Blockchain Anchoring (Fabric Consumer → Blockchain → Database)
  async anchorToBlockchain(events: ComplaintEvent[]): Promise<void> {
    // Process batch on blockchain
    const result = await this.fabricGateway.anchorBatch(events);
    
    // Update database with blockchain references
    for (const event of events) {
      await this.complaintService.updateBlockchainRef(
        event.complaintId,
        result.txId,
        result.merkleRoot
      );
    }
    
    // Notify completion
    await this.eventBus.publish('complaints.anchored', {
      complaintIds: events.map(e => e.complaintId),
      txId: result.txId,
      merkleRoot: result.merkleRoot
    });
  }
}
```

## Integration Patterns & Best Practices

### 1. Circuit Breaker Pattern
```typescript
class ServiceIntegrationWithCircuitBreaker {
  private circuitBreaker = new CircuitBreaker(this.callExternalService.bind(this), {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  });
  
  async callServiceSafely<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.circuitBreaker.fire(operation);
    } catch (error) {
      // Fallback logic
      return this.getFallbackResponse();
    }
  }
}
```

### 2. Retry with Exponential Backoff
```typescript
class ResilientServiceIntegration {
  async callWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) break;
        
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }
}
```

### 3. Saga Pattern for Distributed Transactions
```typescript
class ComplaintSubmissionSaga {
  async execute(data: ComplaintData): Promise<void> {
    const sagaId = crypto.randomUUID();
    const steps: SagaStep[] = [];
    
    try {
      // Step 1: Create complaint
      const complaint = await this.complaintService.create(data);
      steps.push({ service: 'complaint', action: 'create', id: complaint.id });
      
      // Step 2: Send notification
      await this.notificationService.send(complaint.citizenId, 'COMPLAINT_CREATED');
      steps.push({ service: 'notification', action: 'send', id: complaint.id });
      
      // Step 3: Record analytics
      await this.analyticsService.record('COMPLAINT_SUBMITTED', complaint);
      steps.push({ service: 'analytics', action: 'record', id: complaint.id });
      
      // Step 4: Add to blockchain batch
      await this.fabricService.addToBatch(complaint);
      steps.push({ service: 'fabric', action: 'batch', id: complaint.id });
      
    } catch (error) {
      // Compensate in reverse order
      await this.compensate(steps.reverse());
      throw error;
    }
  }
  
  private async compensate(steps: SagaStep[]): Promise<void> {
    for (const step of steps) {
      try {
        await this.executeCompensation(step);
      } catch (error) {
        console.error(`Compensation failed for step ${step.service}:${step.action}`, error);
      }
    }
  }
}
```

### 4. Event Sourcing Integration
```typescript
class EventSourcedIntegration {
  // All state changes as events
  async processCommand(command: Command): Promise<void> {
    const events = await this.commandHandler.handle(command);
    
    // Store events
    for (const event of events) {
      await this.eventStore.append(event);
    }
    
    // Publish for other services
    for (const event of events) {
      await this.eventBus.publish(event.type, event);
    }
    
    // Update read models
    await this.projectionService.project(events);
  }
  
  // Rebuild state from events
  async rebuildProjection(streamId: string): Promise<void> {
    const events = await this.eventStore.getEvents(streamId);
    await this.projectionService.rebuild(streamId, events);
  }
}
```

## Monitoring & Observability

### Service Integration Monitoring
```typescript
class IntegrationMonitoring {
  // Track service-to-service calls
  async trackServiceCall(
    fromService: string,
    toService: string,
    operation: string,
    duration: number,
    success: boolean
  ): Promise<void> {
    await this.metricsService.record({
      metric: 'service_integration_call',
      tags: { fromService, toService, operation },
      value: duration,
      success
    });
  }
  
  // Monitor event processing
  async trackEventProcessing(
    topic: string,
    handler: string,
    duration: number,
    success: boolean
  ): Promise<void> {
    await this.metricsService.record({
      metric: 'event_processing',
      tags: { topic, handler },
      value: duration,
      success
    });
  }
  
  // Health checks for integrations
  async checkIntegrationHealth(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabaseConnection(),
      this.checkKafkaConnection(),
      this.checkRedisConnection(),
      this.checkFabricConnection()
    ]);
    
    return {
      healthy: checks.every(check => check.status === 'fulfilled'),
      details: checks.map((check, index) => ({
        service: ['database', 'kafka', 'redis', 'fabric'][index],
        status: check.status,
        error: check.status === 'rejected' ? check.reason : undefined
      }))
    };
  }
}
```