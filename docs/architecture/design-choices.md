# Design Choices — RoadWatch

This document records and justifies the principal technical choices made in the RoadWatch monorepo. For each area it lists the rationale, pros, cons, and tradeoffs compared to reasonable alternatives.

**How to use**: Read sections relevant to the part of the stack you care about. Each section ends with a short tradeoffs summary.

**Language Choices**
- **TypeScript (primary app code)**: Used across the monorepo for web, backend packages, and chaincode (TypeScript-based chaincode). Rationale: gradual typing, superior DX (editor/IDE support), large ecosystem (npm), and compile-time checks reduce bugs. Pros: better maintainability, refactor safety, and compatibility with modern JS toolchains. Cons: build step, occasional type friction for complex generics, longer onboarding for pure-JS devs. Tradeoff: TypeScript chosen over plain JavaScript for safety; it costs build complexity but reduces runtime bugs.

- **Go (fabric chaincode / Fabric tooling)**: Fabric components and some chaincode use Go (see fabric/go.mod). Rationale: Fabric's native chaincode and SDKs have strong Go support; Go is performant and well-suited to small, statically linked binaries. Pros: strong performance, easy cross-compilation, first-class Fabric support. Cons: different language in the repo, tooling/install complexity for contributors. Tradeoff: Go kept for Fabric pieces where it’s the ecosystem default; TypeScript used elsewhere for developer ergonomics.

**Package manager & Monorepo Tooling**
- **pnpm**: Root declares `pnpm` and a `pnpm-workspace.yaml`. Rationale: fast installs, deterministic node_modules via symlinks, disk efficiency and excellent monorepo support. Pros: space and time savings, strictness that surfaces hoisting issues. Cons: some CI images or older docs assume `npm`/`yarn`; occasional tooling assumptions require pnpm-specific commands. Tradeoff: pnpm over npm/yarn because of monorepo scale and performance.

- **Turbo (turborepo)**: Used for running parallel tasks (`turbo run build`, `dev`). Rationale: caching, pipeline orchestration, and parallelism across packages. Pros: faster CI/builds with caching. Cons: learning curve and extra dependency. Tradeoff: Accepts complexity to gain faster iterative builds and CI caching.

**Frontend & UI**
- **React + Vite**: Frontend uses React and Vite (`frontend/package.json`). Rationale: React ubiquity and Vite's fast dev server and build. Pros: huge ecosystem, fast HMR, small config surface. Cons: React's API complexity for newcomers; Vite plugins occasionally differ from Webpack equivalents. Tradeoff: React chosen for broad talent pool and ecosystem; Vite chosen for DX and speed over Webpack.

- **React Native / mobile-host**: Mobile targets use the React ecosystem for reusing components and business logic. Pros: shared JS/TS code and faster cross-platform iteration. Cons: native build tooling complexity (Xcode/Android). Tradeoff: Faster cross-platform delivery vs native performance.

**Backend & API**
- **Node.js + Express**: The gateway API uses Express (`apps/gateway-api`). Rationale: lightweight HTTP handling, mature middleware. Pros: many libraries, fast to implement REST endpoints. Cons: single-threaded model requires care for CPU-heavy work. Tradeoff: Node chosen for developer productivity and ecosystem; alternatives (Go, Java, .NET) provide different performance/ops tradeoffs but increase team context switching.

- **TypeScript on backend**: Same advantages as above — type safety for APIs and shared types between packages and frontend.

**Distributed Ledger & Blockchain**
- **Hyperledger Fabric**: Fabric is used for the permissioned ledger (dependencies such as `@hyperledger/fabric-gateway`, `fabric-contract-api`, `fabric-shim`, and `fabric` folders). Rationale: permissioned blockchain suitable for enterprise and legal evidence (court-admissible receipt references in docs). Pros: mature enterprise features, identities and MSPs, private data collections, and governance. Cons: operational complexity, higher setup and maintenance cost compared to hosted blockchain services; learning curve for devs and operators. Tradeoff: Fabric chosen because project needs permissioned ledger features and auditability; not chosen if a public chain or a simple append-only store sufficed.

**Datastore Choices**
- **PostgreSQL (`pg`)**: Present as a dependency in core packages. Rationale: relational data, strong querying, transactions, extensions. Pros: ACID, familiar SQL, robust tooling. Cons: requires migrations and operational management. Tradeoff: PostgreSQL for structured, relational data and predictable queries vs NoSQL for flexible schemas.

- **Redis**: Used as cache / ephemeral storage. Rationale: low-latency cache and pub/sub primitives. Pros: speed and simple data structures. Cons: eventual persistence complexities and operational costs. Tradeoff: Redis for caching and fast lookups; not a primary durable store.

- **sql.js (in-browser SQLite)**: Used in frontend for local/demo persistence. Pros: offline and demo-friendly. Cons: limited persistence model and size. Tradeoff: good for client-side demos, not for production server data.

**Messaging & Async**
- **Kafka**: Present in providers. Rationale: durable, scalable event streaming for load and backbone integration. Pros: at-least-once delivery, partitioning, high throughput. Cons: operational complexity, ZooKeeper/KRaft management. Tradeoff: Kafka for high-throughput streaming; simpler systems (RabbitMQ, SNS/SQS) would be easier to operate but may not scale as well.

**Containerization & Local Dev**
- **Docker & docker-compose**: Repo includes `docker-compose.yml` and many scripts. Rationale: reproducible local dev and repeatable infra for Fabric network and services. Pros: consistent environments, easy orchestration for multi-container dev. Cons: developers need Docker installed; composition orchestration when moving to k8s requires adaptation. Tradeoff: Docker Compose for local reproducibility vs full Kubernetes for production orchestration.

**Chaincode choices**
- **TypeScript chaincode** (repo `chaincode`): Rationale: reuse TS skills and types; simplifies local testing with the JS ecosystem. Pros: shared language, rapid iteration. Cons: some Fabric toolchains expect Go; performance differences vs Go. Tradeoff: TS chaincode for developer productivity; Go kept where Fabric-first features or performance matters.

**Testing & Tooling**
- **Vitest**: Used as the test runner (`vitest` in devDeps). Rationale: fast tests, good TypeScript support and Vite alignment. Pros: speed, V8-based coverage option, modern DX. Cons: ecosystem smaller than Jest but rapidly growing. Tradeoff: Vitest chosen for speed and integration with Vite/TS.

- **Supertest**: For HTTP integration tests (used in backend packages). Rationale: lightweight HTTP assertions. Tradeoff: simple and effective for Express apps.

**Validation & Safety**
- **Zod**: Validation library used in `gateway-api`. Rationale: runtime validation with TypeScript inference. Pros: good DX, composable schemas, minimal boilerplate. Cons: runtime cost and extra dependency. Tradeoff: Zod chosen for runtime safety with type inference.

**AI / Langchain**
- **LangChain / LangGraph references**: Project uses `@langchain/langgraph`. Rationale: integrate LLM workflows. Pros: accelerates building LLM-driven features. Cons: external dependencies, cost and unpredictability when relying on models. Tradeoff: Useful for advanced features; keep domain logic decoupled from models.

**CI / CD & Caching**
- **Turborepo caching**: Caches builds/artifacts across CI runs to speed up the pipeline. Tradeoff: complexity in setup vs notable speedups in large monorepos.

**Security & Secrets**
- **`.env` + dotenv**: Used for local env loading. Rationale: developer convenience. Tradeoff: avoid committing secrets; prefer vaults/Key Vault in production.

**General tradeoffs summary**
- The repo favors developer productivity and strong typing (TypeScript, Vite, pnpm, turbo) while using Fabric and Kafka where enterprise-grade durability and streaming are required. This combines two different priorities: fast iteration and enterprise-grade infra. That mix adds onboarding friction (multiple runtimes: Node/TS, Go, Docker) but enables both rapid feature development and production-level guarantees.

If you want, I can:
- split this into separate files per-category under `docs/choices/` (languages.md, infra.md, packages.md),
- or expand any section with links to the exact files in this repo that reflect the choice (package.json lines, fabric/go.mod references),
and I can also open a short PR with these files and update README links.

---
Generated by the developer documentation task on the RoadWatch repo.
