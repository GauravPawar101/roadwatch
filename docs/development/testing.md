# Testing

Testing strategy and commands for RoadWatch.

## Frameworks

| Framework | Used in | Purpose |
|-----------|---------|---------|
| **Vitest** | core, gateway-api, backend-api, fabric tests | Primary test runner |
| **Supertest** | gateway-api | HTTP integration tests |
| **Go test** | Fabric chaincodes | Chaincode unit tests |

## Running tests

```powershell
pnpm test              # All packages via Turbo
pnpm test:unit         # @roadwatch/core only
pnpm test:api          # Gateway API
pnpm test:backend      # Backend API
pnpm test:fabric       # Fabric integration (requires running network)
pnpm test:prompts      # LLM prompt regression
pnpm test:coverage     # Core package with coverage report
```

### Watch mode

```powershell
pnpm test:watch:api     # Gateway API watch
pnpm test:watch:core    # Core package watch
```

## Test locations

| Package | Test files |
|---------|------------|
| `@roadwatch/core` | `packages/core/src/engines/*.test.ts` |
| `@roadwatch/gateway-api` | `apps/gateway-api/src/app.test.ts`, `anomaly.test.ts`, `proposals-intelligence.integration.test.ts` |
| `@roadwatch/backend-api` | `backend-api/src/routes/complaints.test.ts`, `backend-api/src/services/*.test.ts` |
| Fabric chaincodes | `fabric/chaincode/*/..._test.go` |
| Fabric integration | `tests/fabric/chaincode.integration.test.ts` |

## Fabric integration tests

Requires a running Fabric network:

```powershell
pnpm fabric:start
pnpm fabric:deploy
pnpm test:fabric
```

Config: `tests/fabric/vitest.config.ts`

## Prompt tests

LLM prompt regression tests for the AI agent:

```powershell
pnpm test:prompts
```

Runs `tools/prompt-tests/run.ts`. Requires configured LLM provider (Gemini or Ollama).

## Writing tests

- Place unit tests next to source files (`*.test.ts`).
- Use Vitest `describe`/`it`/`expect` API.
- For API tests, use Supertest against the Express app factory.
- Mock external services (Kafka, Redis, Fabric) in unit tests.
- Integration tests may require running infrastructure.

## CI expectations

When submitting a PR:

1. Run the narrowest test suite for your changes.
2. At minimum: `pnpm test:unit` for core changes, `pnpm test:api` for gateway changes.
3. Note any tests not run and remaining risk in the PR description.

## Not yet implemented

The following are documented in older plans but not present in the repo:

- Playwright / E2E browser tests
- Detox / mobile E2E tests
- Testcontainers for integration tests
- Jest (replaced by Vitest)

## Related docs

- [Scripts and commands](./scripts-and-commands.md)
- [Local development](../getting-started/local-development.md)
