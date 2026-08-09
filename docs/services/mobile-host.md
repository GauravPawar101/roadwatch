# Mobile Host

React Native 0.73 shell for the citizen mobile experience: map, complaint filing, AI agent chat, and onboarding.

## Details

| Property | Value |
|----------|-------|
| Package | `@roadwatch/mobile-host` |
| Entry | `apps/mobile-host/index.js` → `App.tsx` |
| Dev command | `pnpm mobile` |

## Screens

| Screen | Package | Purpose |
|--------|---------|---------|
| Onboarding | `apps/mobile-host/src/onboarding/` | First-run setup, permissions |
| Map | `@roadwatch/feature-map` | Road map with complaint markers |
| Complaint | `@roadwatch/feature-complaint` | File complaint with photo + GPS |
| Agent Chat | `@roadwatch/feature-agent` | On-device AI assistant |

## Architecture

- Dependency injection via `@roadwatch/config`
- Encrypted SQLite for agent memory (`@roadwatch/storage-sqlite`)
- API calls to gateway via `API_GATEWAY_URL`
- Supabase for media uploads

## Commands

| Command | Action |
|---------|--------|
| `pnpm mobile` | Start Metro bundler |
| `pnpm mobile:android` | Run on Android emulator/device |
| `pnpm mobile:ios` | Run on iOS simulator (macOS only) |
| `pnpm mobile:pods` | Install iOS CocoaPods |
| `pnpm mobile:clean` | Clean build artifacts |
| `pnpm typecheck:mobile` | TypeScript check |
| `pnpm lint:mobile` | ESLint |

## Environment

| Variable | Purpose |
|----------|---------|
| `API_GATEWAY_URL` | Gateway API base URL |
| `GEMINI_API_KEY` | On-device AI (restrict in production) |
| `SUPABASE_URL` | Media storage |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_STORAGE_BUCKET` | Upload bucket |

## Platform setup

### Android

1. Install Android Studio with SDK 34+.
2. Set `ANDROID_HOME` environment variable.
3. Create an emulator or connect a device.
4. Run `pnpm mobile:android`.

### iOS (macOS only)

1. Install Xcode 15+.
2. Run `pnpm mobile:pods`.
3. Run `pnpm mobile:ios`.

## Offline support

The mobile app queues complaints locally when offline and syncs when connectivity returns. Agent memory persists in encrypted SQLite.

## Related docs

- [Complaint lifecycle](../workflows/complaint-lifecycle.md)
- [AI agent](../workflows/ai-agent.md)
- [Shared packages](./shared-packages.md)
