# Shared Dependency Strategy

This note addresses the current problem where multiple services depend on the same shared utilities during local development and deployment, which makes failures harder to trace.

The repo currently mixes:

- direct source imports from shared workspace packages, especially `packages/core`
- runtime coupling through shared database, Kafka, and service discovery assumptions
- service-specific startup code that still relies on common helper logic

That is convenient early on, but it becomes painful when one shared change breaks several services at once.

## What I recommend

Do not copy everything blindly into each service package.

Use a hybrid approach:

1. Keep only stable, reusable logic shared.
2. Move service-specific behavior into the service itself.
3. Build shared packages as explicit versioned units with clear public entrypoints.
4. Copy only small utility code when the debugging cost is higher than the duplication cost.

That gives you fewer surprise breakages without throwing away all reuse.

## Decision Guide

| Approach | Best when | Main tradeoff |
|---|---|---|
| Copy code into each service | You need fast debugging and the code is small or volatile | Duplication and drift |
| Keep workspace shared packages | Logic is stable and truly common | Harder tracing if boundaries are loose |
| Publish shared packages versioned | You want deploy-time isolation and clear rollouts | Extra release process |
| Split contracts from implementation | Services need shared types but different behavior | Requires refactoring |
| Generate code from schemas | The shared part is mostly data shapes or clients | Schema and generator maintenance |

## Option 1: Copy Shared Utilities Into Each Service

This is the simplest mental model and usually the easiest way to debug.

### When to choose it

- The utility is small.
- The utility changes often.
- The utility is used by only one or two services.
- You care more about local clarity than reuse.

### What to do step by step

1. Identify the exact shared functions, types, or helpers that are causing confusion.
2. Copy only the needed code into the service package, not the entire shared package.
3. Rename the copied module so the service owns it clearly, for example `service-config.ts`, `service-crypto.ts`, or `service-validation.ts`.
4. Replace imports from `packages/core` or similar shared paths with local imports.
5. Add a short service-local README note explaining that the code is intentionally duplicated.
6. Remove the original shared dependency from that service once the copy is complete.
7. Add one test in the service package that covers the copied logic so drift is visible.
8. Repeat the copy only if the same logic is still small and still hard to trace.

### Pros

- Easy to debug.
- Fewer cross-package surprises.
- Each service becomes self-contained.

### Cons

- Duplicate bug fixes.
- Risk of divergence between services.
- More files to maintain.

### My rule of thumb

If the code is under a few hundred lines and not a core domain rule, copying is acceptable.
If it is business-critical, duplication becomes expensive fast.

## Option 2: Keep Shared Packages, But Make Them Strict

This is the best default if you still want reuse.

The problem is usually not sharing itself. The problem is unrestricted sharing.

### When to choose it

- The logic is genuinely common.
- You want one source of truth.
- You are willing to enforce package boundaries.

### What to do step by step

1. Define a public API for each shared package.
2. Stop importing deep internal files from shared packages unless that is explicitly allowed.
3. Add package entrypoints such as `src/index.ts` and export only the supported surface.
4. Separate pure logic from I/O so the shared package is easier to test.
5. Add package-level tests for shared behavior.
6. Add service-level tests that assert the shared package still behaves the way the service expects.
7. Make package boundaries obvious in documentation and code review.
8. If a helper is only useful to one service, move it out of the shared package instead of expanding the shared API.

### Pros

- Reuse stays real.
- Fixes apply everywhere.
- Less duplication.

### Cons

- Harder debugging if the boundaries are not strict.
- A shared bug can affect many services at once.
- Requires discipline in imports and exports.

### Best practice here

Treat shared packages like internal libraries, not a dumping ground for every helper.

## Option 3: Publish Shared Packages As Versioned Artifacts

This is the best option when deployment isolation matters more than convenience.

Instead of depending on live workspace source, each service depends on a built package version.

### When to choose it

- You want deploy-time reproducibility.
- You want to know exactly which shared version a service used.
- You want to reduce accidental breakage from workspace edits.

### What to do step by step

1. Split the shared logic into a package with a real build step.
2. Make sure the package emits compiled output and type declarations.
3. Give the package a clear versioning strategy.
4. Publish it to a private registry or install it from a built artifact.
5. Change services to depend on the published package version instead of live source paths.
6. Pin versions in each service and update them deliberately.
7. Add a release note whenever the shared package changes in a way that affects services.
8. In CI, test the shared package before promoting it to services.

### Pros

- Strong deployment isolation.
- Clearer rollbacks.
- Easier to reason about what code a service used.

### Cons

- More release process.
- More package version management.
- Slower iteration than live workspace links.

### Good fit for this repo

This is useful for logic that is stable but widely reused, such as shared validation, common auth helpers, and protocol adapters.

## Option 4: Split Contracts From Implementation

This is the cleanest architecture when services need shared types but should own their own logic.

### When to choose it

- Multiple services need the same request or event shapes.
- The service logic should still be independent.
- You want to reduce accidental coupling.

### What to do step by step

1. Identify the shared contract types: DTOs, event schemas, request/response payloads, and config shapes.
2. Move those contracts into a small package or schema folder.
3. Keep only the types and validation schemas shared.
4. Reimplement service behavior locally in each service.
5. Update imports so services consume contracts, not implementation helpers.
6. Add tests that validate contract compatibility between producer and consumer.
7. If possible, generate types or validators from the contract source.
8. Keep the contract package tiny and stable.

### Pros

- Much less shared runtime behavior.
- Easier service ownership.
- Better long-term boundaries.

### Cons

- Initial refactor cost.
- More code in services.
- Requires discipline to keep implementation local.

### This is usually the best compromise

If the pain comes from tracing bugs across services, contracts-only sharing is often better than sharing implementation.

## Option 5: Generate Shared Code From Schemas

This is a good fit when the shared area is mostly shapes and clients rather than business rules.

### When to choose it

- The shared logic is mostly API schemas or event contracts.
- You want consistency without manual copying.
- You already have OpenAPI, Zod, protobuf, JSON Schema, or similar sources.

### What to do step by step

1. Pick a single schema source.
2. Move the schema definitions there.
3. Generate types, validators, or clients from that source.
4. Commit the generator output if you want easier debugging, or generate on build if you prefer smaller repos.
5. Make each service depend on the generated output instead of handwritten shared code.
6. Add a regeneration check in CI so generated code does not drift.
7. Keep handwritten business logic out of the generated layer.

### Pros

- Consistent shapes.
- Less manual duplication.
- Easier to trace contract changes.

### Cons

- Tooling overhead.
- Another build step.
- Not a good fit for complex business logic.

## My Suggested Path For This Repo

If I were simplifying this repository, I would do it in this order:

1. Stop deep-importing shared internals where possible.
2. Split shared code into two categories: contracts and implementation.
3. Keep contracts shared.
4. Move volatile helper logic into the owning service.
5. Copy only tiny utilities that are causing debugging pain and are not worth centralizing.
6. For the remaining shared code, give it a real build and versioning story.

That gets you most of the debugging benefit of copy-paste without turning the repo into a maintenance trap.

## Practical Rule Set

Use this decision rule for each helper:

- If it is a contract, share it.
- If it is stable business logic used in many places, share it as a strict package.
- If it is small and volatile, copy it locally.
- If it is mostly data shape generation, generate it.
- If it is tied to one service’s behavior, move it into that service.

## What I Would Do First

1. Make a list of every import that reaches into `packages/core` or any other shared package.
2. Mark each import as contract, stable logic, or service-specific helper.
3. Move service-specific helpers into the owning service first.
4. Leave only the truly shared logic in the shared package.
5. Add package boundaries so deep imports become harder over time.
6. Decide whether the remaining shared packages should stay as workspace links or become versioned artifacts.

## Bottom Line

Copying shared utilities into each service is a valid fix for debugging pain, but only for small and volatile code.
For everything else, the better answer is to split contracts from implementation and enforce strict package boundaries.

That gives you clearer ownership, better deploy isolation, and much easier error tracing.
