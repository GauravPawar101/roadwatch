# RoadWatch Deployment Guide

This is a monorepo with multiple applications and services. Deploy components based on your needs - start minimal and scale up.

## Architecture Overview

**Core Applications:**
- `frontend/` - Web dashboard (Vite + React)
- `apps/gateway-api` - Main REST API (Node.js + Express)
- `apps/mobile-host` - React Native mobile app

**Background Services:**
- `services/scheduler` - Cron jobs and scheduled tasks
- `services/webhook-handler` - Kafka event consumer
- `services/fabric-anchor-consumer` - Blockchain integration

**Infrastructure:**
- PostgreSQL database
- Redis cache
- Kafka message queue
- Hyperledger Fabric (optional)

## Deployment Strategy

### Minimal Setup (Start Here)

Deploy only the essential components:

1. **Frontend** → Vercel/Netlify
2. **Gateway API** → Render/Railway/Fly.io
3. **Database** → Neon/Supabase PostgreSQL
4. **Cache** → Local Redis (Docker)

### Full Production Setup

Add background services for complete functionality:

5. **Message Queue** → Local Kafka (Docker)
6. **Background Services** → Same host as API or separate containers
7. **Blockchain** → Hyperledger Fabric network (optional)

## Step-by-Step Deployment

### 1. Deploy the Frontend

**Target:** `frontend/` folder

**Platform:** Vercel (recommended)

**Build Configuration:**
- Root Directory: `frontend`
- Build Command: `pnpm build`
- Output Directory: `dist`

**Environment Variables:**
```bash
VITE_API_BASE=https://your-api-domain.com
```

**Build Commands:**
```bash
pnpm install --frozen-lockfile
pnpm --filter roadwatch-frontend build
```

### 2. Deploy the Gateway API

**Target:** `apps/gateway-api`

**Platform:** Render, Railway, or Fly.io

**Build Configuration:**
- Root Directory: `apps/gateway-api`
- Build Command: `pnpm build`
- Start Command: `pnpm start`

**Required Environment Variables:**
```bash
# Server
PORT=3100
NODE_ENV=production

# Database (PgBouncer-backed PostgreSQL endpoint)
DATABASE_URL=postgresql://user:pass@host:5432/roadwatch

# Auth
JWT_SECRET=your-secure-jwt-secret
OTP_TTL_SECONDS=300

# Redis (for caching)
REDIS_URL=redis://user:pass@host:6379/0

# Kafka (for events)
KAFKA_BROKER=host:9092
```

**Optional LLM Configuration:**
```bash
# Gemini (recommended)
GEMINI_API_KEY=your-api-key
GEMINI_MODEL=gemini-2.0-flash

# Fallbacks
OLLAMA_BASE_URL=http://localhost:11434
LLAMACPP_BASE_URL=http://localhost:8080
LLM_FALLBACK_ORDER=gemini,ollama,llamacpp
```

**Build Commands:**
```bash
pnpm install --frozen-lockfile
pnpm --filter @roadwatch/gateway-api build
pnpm --filter @roadwatch/gateway-api start
```

### 3. Set Up Database

**Platform:** Neon, Supabase, or managed PostgreSQL

**Schema Setup:**
1. Create a PostgreSQL database named `roadwatch`
2. Run the schema from `docker/postgres/init.sql`
3. Set `DATABASE_URL` in your API environment

**Seeding (Optional):**
```bash
pnpm seed:backend  # Basic data
pnpm seed:demo     # Demo data
```

### 4. Deploy Background Services (Optional)

Only deploy these if you need async processing:

#### Scheduler Service
**Target:** `services/scheduler`
**Purpose:** Runs cron jobs (SLA checks, cleanup, reports)

#### Webhook Handler
**Target:** `services/webhook-handler`
**Purpose:** Processes Kafka events

#### Fabric Anchor Consumer
**Target:** `services/fabric-anchor-consumer`
**Purpose:** Blockchain integration

**Deployment Options:**
- Same host as Gateway API
- Separate containers (Docker)
- Serverless functions (for scheduler only)

### 5. Mobile App Deployment

**Target:** `apps/mobile-host`

**Platform:** App Store / Google Play

**Build Process:**
```bash
# iOS
pnpm --filter @roadwatch/mobile-host ios

# Android
pnpm --filter @roadwatch/mobile-host android
```

**Configuration:**
- Update API endpoints in app config
- Configure push notifications
- Set up app store credentials

## Environment Configuration

### Development
Use `.env.example` as a template:
```bash
cp .env.example .env
# Edit .env with your values
```

### Production
Set these environment variables in your hosting platform:

**Required:**
- `DATABASE_URL`
- `JWT_SECRET`
- `REDIS_URL`

**Optional but Recommended:**
- `KAFKA_BROKER` or `KAFKA_BROKERS`
- `GEMINI_API_KEY`

**Fabric (Advanced):**
- `FABRIC_PEER_ENDPOINT`
- `FABRIC_MSP_ID`
- `FABRIC_CHANNEL=roadwatch-india`
- `FABRIC_CHAINCODE=complaint-anchor`

## Scaling Considerations

### Start Small
1. Frontend + Gateway API + Managed Database
2. Add Redis for caching
3. Add Kafka for events

### Scale Up
1. Add background services
2. Enable Fabric blockchain
3. Add monitoring and logging
4. Implement load balancing

### Cost Optimization
- **Free Tier:** Vercel + Render + Neon + Upstash
- **Low Cost:** Railway + Supabase + Upstash
- **Self-Hosted:** VPS + Docker Compose

## Monitoring & Health Checks

**Health Endpoints:**
- Gateway API: `GET /health`
- Database: Built-in health checks in `docker-compose.yml`

**Logging:**
- Application logs via Morgan middleware
- Database query logs
- Kafka consumer logs

## Troubleshooting

**Common Issues:**
1. **Database Connection:** Check `DATABASE_URL` format
2. **Redis Connection:** Verify Redis URL and credentials
3. **Kafka Issues:** Ensure topic creation and consumer groups
4. **Build Failures:** Check Node.js version (requires Node 18+)

**Debug Commands:**
```bash
# Check service health
curl https://your-api.com/health

# View logs
pnpm --filter @roadwatch/gateway-api dev

# Test database connection
psql $DATABASE_URL
```

## Security Checklist

- [ ] Use strong `JWT_SECRET`
- [ ] Enable HTTPS for all services
- [ ] Restrict database access
- [ ] Use environment variables for secrets
- [ ] Enable CORS properly
- [ ] Set up rate limiting
- [ ] Configure proper authentication

This deployment guide reflects the current codebase structure and active services. Start with the minimal setup and add components as needed.
