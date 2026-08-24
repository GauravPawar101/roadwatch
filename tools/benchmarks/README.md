# RoadWatch Benchmarks

This folder is the benchmark setup for the seven metrics you asked for.

## What it does

- Reads real k6 summary JSON for requests/sec, requests/day, and p95 latency.
- Aggregates LCOV coverage from unit and integration test runs.
- Queries Prometheus for DB load reduction, uptime, and traffic restoration.
- Computes incident detection time from real timestamps.

## Generate the report

1. Copy [roadwatch-benchmarks.example.json](./roadwatch-benchmarks.example.json) to your own config file and replace every placeholder with real values.
2. Produce coverage artifacts:

```bash
pnpm benchmarks:coverage
```

3. Run the k6 tests that capture your before/after summaries and keep the exported JSON files.
4. Make sure Prometheus is reachable, then record the exact queries you already trust for each metric.
5. Generate the report:

```bash
pnpm benchmarks:report -- --config tools/benchmarks/your-benchmarks.json --out docs/operations/benchmarks.md
```

## Artifact locations

- k6 summaries: `logs/stress/k6-summary-*.json`
- coverage: `packages/core/coverage`, `apps/gateway-api/coverage`, `backend-api/coverage`
- report output: any markdown file you choose

## Notes

- The generator never invents numbers. Missing inputs stay `n/a`.
- If you want the report in `README.md`, point `--out` there after you are happy with the measured values.