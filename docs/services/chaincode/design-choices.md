**Component: chaincode**

Summary
- Language/runtime: TypeScript for chaincode (JS chaincode) and Go for Fabric-native chaincode where present. The repo contains a `chaincode` package and Fabric Go modules under `fabric/`.

Why these choices
- **TypeScript chaincode**: enables reuse of JS/TS tooling and faster developer iteration during chaincode development and testing.
- **Go chaincode**: used where Fabric-native performance or ecosystem compatibility is desired (see `fabric/go.mod`).

Pros
- TS chaincode: faster iteration and shared types with app code. Go chaincode: better performance and first-class Fabric support.

Cons / Tradeoffs
- Multiple chaincode languages increase maintenance and contributor ramp-up. Testing and CI must accommodate both runtimes.

Files of interest
- `chaincode/package.json` — TypeScript chaincode dependencies (`fabric-contract-api`, `fabric-shim` for JS/TS chaincode).
- `fabric/go.mod` — Go chaincode modules and Fabric-Go dependencies.

Recommendation / Alternatives
- Standardize on one language for chaincode if operational simplicity is more important than developer preference. Keep both only if clear benefits exist for each.

Tradeoffs summary: dual-language approach trades operational complexity for developer productivity and ecosystem fit where needed.
