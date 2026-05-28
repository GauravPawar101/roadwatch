# Monitoring & Observability

## Overview
The RoadWatch system implements comprehensive monitoring and observability to ensure system health, performance tracking, and rapid issue detection across all services.

## Monitoring Stack

### Metrics Collection
- **Prometheus** - Time-series metrics collection
- **Grafana** - Metrics visualization and dashboards
- **Node Exporter** - System-level metrics
- **Custom Metrics** - Application-specific metrics

### Logging
- **Winston** - Structured logging for Node.js services
- **ELK Stack** - Elasticsearch, Logstash, Kibana for log aggregation
- **Fluentd** - Log forwarding and processing
- **Log Levels** - DEBUG, INFO, WARN, ERROR, FATAL

### Tracing
- **Jaeger** - Distributed tracing
- **OpenTelemetry** - Tracing instrumentation
- **Correlation IDs** - Request tracking across services

### Alerting
- **Alertmanager** - Alert routing and management
- **PagerDuty** - Incident management
- **Slack Integration** - Team notifications
- **Email Alerts** - Critical issue notifications

## Logging Implementation

### Structured Logging
```typescript
// Logger configuration
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'roadwatch',
    version: process.env.SERVICE_VERSION || '1.0.0'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});
```

### Request Logging Middleware
```typescript
// Express request logging
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.headers['x-correlation-id'] || generateUUID();
  req.correlationId = correlationId;
  
  const startTime = Date.now();
  
  logger.info('Request started', {
    correlationId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      correlationId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('Content-Length')
    });
  });
  
  next();
};
```

### Service-Specific Logging
```typescript
// Complaint service logging
export class ComplaintService {
  async createComplaint(data: CreateComplaintRequest): Promise<Complaint> {
    const correlationId = data.correlationId;
    
    logger.info('Creating complaint', {
      correlationId,
      category: data.category,
      location: data.location
    });
    
    try {
      const complaint = await this.repository.create(data);
      
      logger.info('Complaint created successfully', {
        correlationId,
        complaintId: complaint.id,
        status: complaint.status
      });
      
      return complaint;
    } catch (error) {
      logger.error('Failed to create complaint', {
        correlationId,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
}
```

## Metrics Implementation

### Custom Metrics
```typescript
// Prometheus metrics setup
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Request metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

// Business metrics
export const complaintsTotal = new Counter({
  name: 'complaints_total',
  help: 'Total number of complaints created',
  labelNames: ['category', 'status']
});

export const activeComplaints = new Gauge({
  name: 'complaints_active',
  help: 'Number of active complaints',
  labelNames: ['category']
});

// Database metrics
export const dbConnectionsActive = new Gauge({
  name: 'db_connections_active',
  help: 'Number of active database connections'
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries',
  labelNames: ['operation', 'table']
});
```

### Metrics Middleware
```typescript
// Express metrics middleware
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    
    httpRequestsTotal
      .labels(req.method, req.route?.path || req.path, res.statusCode.toString())
      .inc();
    
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path)
      .observe(duration);
  });
  
  next();
};
```

### Business Metrics
```typescript
// Service metrics tracking
export class ComplaintService {
  async createComplaint(data: CreateComplaintRequest): Promise<Complaint> {
    const complaint = await this.repository.create(data);
    
    // Track business metrics
    complaintsTotal
      .labels(complaint.category, complaint.status)
      .inc();
    
    activeComplaints
      .labels(complaint.category)
      .inc();
    
    return complaint;
  }
  
  async updateComplaintStatus(id: string, status: ComplaintStatus): Promise<void> {
    const complaint = await this.repository.findById(id);
    
    if (complaint.status === 'ACTIVE' && status !== 'ACTIVE') {
      activeComplaints
        .labels(complaint.category)
        .dec();
    }
    
    await this.repository.updateStatus(id, status);
  }
}
```

## Health Checks

### Service Health Endpoints
```typescript
// Health check implementation
export class HealthCheckService {
  async checkHealth(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkKafka(),
      this.checkExternalAPIs()
    ]);
    
    const results = checks.map((check, index) => ({
      name: ['database', 'redis', 'kafka', 'external-apis'][index],
      status: check.status === 'fulfilled' ? 'healthy' : 'unhealthy',
      details: check.status === 'fulfilled' ? check.value : check.reason
    }));
    
    const overallStatus = results.every(r => r.status === 'healthy') 
      ? 'healthy' 
      : 'unhealthy';
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results
    };
  }
  
  private async checkDatabase(): Promise<any> {
    const start = Date.now();
    await this.dataSource.query('SELECT 1');
    const duration = Date.now() - start;
    
    return {
      status: 'connected',
      responseTime: `${duration}ms`
    };
  }
  
  private async checkRedis(): Promise<any> {
    const start = Date.now();
    await this.redis.ping();
    const duration = Date.now() - start;
    
    return {
      status: 'connected',
      responseTime: `${duration}ms`
    };
  }
}
```

### Kubernetes Health Probes
```yaml
# Kubernetes deployment with health checks
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway-api
spec:
  template:
    spec:
      containers:
      - name: gateway-api
        image: roadwatch/gateway-api:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Alerting Rules

### Prometheus Alerting Rules
```yaml
# alerts.yml
groups:
- name: roadwatch.rules
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status_code=~"5.."}[5m]) > 0.1
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} errors per second"
  
  - alert: HighResponseTime
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High response time detected"
      description: "95th percentile response time is {{ $value }} seconds"
  
  - alert: DatabaseConnectionsHigh
    expr: db_connections_active > 80
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High database connection usage"
      description: "Database connections: {{ $value }}"
  
  - alert: ServiceDown
    expr: up == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Service is down"
      description: "{{ $labels.instance }} has been down for more than 1 minute"
```

### Alertmanager Configuration
```yaml
# alertmanager.yml
global:
  slack_api_url: 'https://hooks.slack.com/services/...'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'
  routes:
  - match:
      severity: critical
    receiver: 'pagerduty'
  - match:
      severity: warning
    receiver: 'slack'

receivers:
- name: 'web.hook'
  webhook_configs:
  - url: 'http://127.0.0.1:5001/'

- name: 'slack'
  slack_configs:
  - channel: '#roadwatch-alerts'
    title: 'RoadWatch Alert'
    text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'

- name: 'pagerduty'
  pagerduty_configs:
  - service_key: 'your-pagerduty-service-key'
```

## Dashboards

### Grafana Dashboard Configuration
```json
{
  "dashboard": {
    "title": "RoadWatch System Overview",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{ method }} {{ route }}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status_code=~\"5..\"}[5m])",
            "legendFormat": "5xx Errors"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "Active Complaints",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(complaints_active)",
            "legendFormat": "Total Active"
          }
        ]
      }
    ]
  }
}
```

## Performance Monitoring

### Application Performance Monitoring (APM)
```typescript
// APM integration
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'roadwatch-gateway-api',
  serviceVersion: '1.0.0'
});

sdk.start();
```

### Custom Tracing
```typescript
// Custom span creation
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('roadwatch-service');

export class ComplaintService {
  async createComplaint(data: CreateComplaintRequest): Promise<Complaint> {
    return tracer.startActiveSpan('complaint.create', async (span) => {
      try {
        span.setAttributes({
          'complaint.category': data.category,
          'complaint.location': JSON.stringify(data.location)
        });
        
        const complaint = await this.repository.create(data);
        
        span.setAttributes({
          'complaint.id': complaint.id,
          'complaint.status': complaint.status
        });
        
        return complaint;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

## Best Practices

### Monitoring Guidelines
- Monitor business metrics, not just technical metrics
- Set up alerts for symptoms, not causes
- Use correlation IDs for request tracing
- Implement circuit breakers for external dependencies
- Monitor SLA/SLO compliance

### Log Management
- Use structured logging (JSON format)
- Include correlation IDs in all log entries
- Log at appropriate levels (avoid debug in production)
- Implement log rotation and retention policies
- Sanitize sensitive data from logs

### Performance Optimization
- Monitor and optimize database query performance
- Track memory usage and garbage collection
- Monitor API response times and throughput
- Implement caching strategies
- Use connection pooling for databases