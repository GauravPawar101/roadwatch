**Service: mobile-host**

Summary
- Language/runtime: React Native (TypeScript/JS ecosystem).
- Purpose: mobile application host that reuses `@roadwatch` packages, offline storage, and native capabilities.

Why these choices
- **React Native**: enables cross-platform mobile development using shared JS/TS code from the monorepo. The project depends on `react-native`, `react-native-quick-sqlite`, `react-native-config`, and native modules for secure storage.

Pros
- Shared business logic with web and backend via `@roadwatch/*` packages.
- Faster cross-platform delivery compared to fully native implementations.

Cons / Tradeoffs
- Native build toolchain (Xcode/Android SDK) complexity; platform-specific bugs and dependency management (pods, native modules).

Files of interest
- `apps/mobile-host/package.json` — shows native deps and workspace package links.

Recommendation / Alternatives
- If maximum native performance or advanced platform-specific UIs are required, consider native modules or rewriting critical portions in native code.

Tradeoffs summary: React Native chosen for shared code and speed-to-market, trading native complexity and occasional performance gaps.
