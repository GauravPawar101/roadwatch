# Troubleshooting

Common issues and fixes for local development.

## Docker / infrastructure

### Containers not starting

```powershell
docker compose ps          # Check status
docker compose logs <name> # Check specific service logs
```

Common causes:
- Port conflict: another process using 15433, 16432, 9094, 9095, or 16379
- Insufficient memory: Kafka needs ~512MB per broker
- Docker Desktop not running

### Kafka not ready

Kafka takes 2–3 minutes on first start. Wait for healthcheck to pass:

```powershell
docker compose ps kafka-hlf kafka-events
# STATUS should show "healthy"
```

### Postgres connection refused

1. Check Postgres is running: `docker compose ps postgres`
2. Use correct port: PgBouncer `16432`, direct Postgres `15433`
3. Verify `DATABASE_URL` in `.env` files

## Application

### Gateway won't start

- Check `apps/gateway-api/.env` exists with `DATABASE_URL` and `JWT_SECRET`
- Ensure Postgres and Redis are healthy
- Check port 3100 is not in use: `netstat -ano | findstr 3100`

### Backend port conflict (Windows)

`start-all.ps1` auto-detects if port 4001 is blocked and falls back to 5001, setting `BACKEND_PORT` accordingly.

### OTP not working

- In dev, set `ALLOW_DEV_OTP_ECHO=true` — OTP is returned in the API response
- Check Redis is running (OTP stored in `otp:*` keys)
- Check rate limiting: `otp_rate:*` keys may block rapid requests

### Frontend can't reach API

- Verify `VITE_API_BASE=http://127.0.0.1:3100` in frontend env
- Check CORS: gateway must allow `http://127.0.0.1:5173`
- Ensure gateway is running on port 3100

## Fabric

### Fabric commands fail on Windows

Fabric scripts require WSL. Ensure:
- WSL 2 with Ubuntu is installed
- Docker Desktop WSL integration is enabled
- Fabric binaries are in WSL PATH

### Chaincode deploy fails

- Check network is running: `pnpm fabric:start`
- Bump `FABRIC_CC_VERSION` or `FABRIC_CC_SEQUENCE` for redeploy
- Check peer logs in WSL: `docker logs peer0.nhai.roadwatch.com`

### Anchor consumer not anchoring

1. Check kafka-hlf has messages: produce a test complaint
2. Verify fabric-anchor-consumer logs: `docker compose logs fabric-anchor-consumer`
3. Check Fabric credentials in `services/fabric-anchor-consumer/.env`
4. Check DLQ topic for failed events

## Kafka

### Topics not created

```powershell
pwsh -File scripts/init-messaging.ps1
```

### Consumer not receiving events

- Verify correct broker URL (9094 for HLF, 9095 for events)
- Check consumer group ID is unique per instance
- Reset consumer offset if needed (dev only)

## Data

### Need fresh database

```powershell
docker compose down --volumes   # WARNING: deletes all data
docker compose up -d
pnpm seed:demo
```

### Seed fails

- Ensure gateway is NOT running (seed connects directly to Postgres)
- Check Postgres is healthy
- Run with verbose: `pnpm seed:demo` and check output

## Getting help

1. Check [Monitoring](./monitoring.md) for health endpoints
2. Review service logs
3. Verify environment variables match [Environment variables](../getting-started/environment-variables.md)
4. Check [Ports reference](../reference/ports.md) for correct URLs
