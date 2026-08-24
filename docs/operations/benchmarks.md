# RoadWatch Benchmark Report

Generated from real measurement artifacts only. Missing values stay `n/a` instead of being estimated.

## Sources
- k6 before: /home/Gaurav/Desktop/roadwatch/logs/stress/k6-summary-before.json
- k6 after: /home/Gaurav/Desktop/roadwatch/logs/stress/k6-summary-after.json
- coverage unit: /home/Gaurav/Desktop/roadwatch/packages/core/coverage
- coverage integration: /home/Gaurav/Desktop/roadwatch/apps/gateway-api/coverage
- coverage api: /home/Gaurav/Desktop/roadwatch/backend-api/coverage
- Prometheus: http://127.0.0.1:30090
- incident start: 2026-08-24T08:01:47.547Z
- incident detection before: 2026-08-24T08:01:49.941Z
- incident detection after: 2026-08-24T08:02:54.941Z

## Metrics

| Benchmark | Actual data | Evidence |
| --- | --- | --- |
| Requests/day or requests/sec + N services | 197.81 req/s (17,090,682 req/day soak-equivalent), N=5 | k6 summary /home/Gaurav/Desktop/roadwatch/logs/stress/k6-summary-after.json |
| p95 API response time, before vs after Kafka decoupling | before: 60,000.65 ms; after: 56.41 ms | k6 summaries /home/Gaurav/Desktop/roadwatch/logs/stress/k6-summary-before.json / /home/Gaurav/Desktop/roadwatch/logs/stress/k6-summary-after.json |
| % database load reduction from Redis caching | 5.96% (before: 437.78, after: 411.67) | cache A/B snapshots + Prometheus sum(rate(pg_stat_database_tup_fetched{datname="roadwatch"}[5m])) |
| Uptime % under load from KEDA autoscaling test | 78.33% | k6 health_ok and Prometheus avg_over_time(up{job="gateway-admission"}[15m]) * 100 |
| Test coverage % (unit + integration) | 15.93% | unit: /home/Gaurav/Desktop/roadwatch/packages/core/coverage/clover.xml ; unit: /home/Gaurav/Desktop/roadwatch/packages/core/coverage/lcov.info ; integration: /home/Gaurav/Desktop/roadwatch/apps/gateway-api/coverage/clover.xml ; integration: /home/Gaurav/Desktop/roadwatch/apps/gateway-api/coverage/lcov.info |
| % traffic restored after fixing the auth bug | 100.00% (before: 0.00, after: 1.00) | k6 complaint_create_ok auth-before/after |
| Incident detection time, before vs after Grafana/Prometheus | before: 0.04 min; after: 1.12 min | 2026-08-24T08:01:47.547Z / 2026-08-24T08:01:49.941Z / 2026-08-24T08:02:54.941Z |

## Notes

- Reused existing core + gateway clover coverage; skipped verbose backend coverage.
