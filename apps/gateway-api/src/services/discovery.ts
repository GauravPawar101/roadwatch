/**
 * discovery.ts
 *
 * Thin adapter over @roadwatch/sidecar-auth that:
 *  - Exposes a module-level singleton service registry (so callers don't need to
 *    thread a registry instance around).
 *  - Re-exports every symbol the gateway previously imported from its own
 *    hand-rolled discovery module so that all existing importers continue to work
 *    without changes to their import paths.
 *  - Adds the `requireRegistrySecret` standalone middleware (backed by sidecar-auth)
 *    that admin.ts uses.
 */
import {
    createServiceRegistry,
    createSidecarServiceRoutes,
    registerServiceWithGateway,
    requestServiceAccessToken,
    requireRegistrySecret as _requireRegistrySecret,
    signServiceAccessToken as _signServiceAccessToken,
    signServiceRegistrationToken,
    verifyServiceAccessToken,
    verifyServiceRegistrationToken,
} from '@roadwatch/sidecar-auth';

// ── Re-export types ────────────────────────────────────────────────────────────
export type {
    RegisteredService,
    ServiceAccessClaims,
    ServiceRegistrationClaims,
    ServiceRegistrationInput,
    SidecarServiceRoutesOptions,
} from '@roadwatch/sidecar-auth';

// ── Re-export token helpers ────────────────────────────────────────────────────
export {
    createSidecarServiceRoutes,
    registerServiceWithGateway,
    requestServiceAccessToken,
    signServiceRegistrationToken,
    verifyServiceAccessToken,
    verifyServiceRegistrationToken,
};

// ── Singleton registry ─────────────────────────────────────────────────────────
// createServiceRegistry() returns a scoped instance.  We create one here at
// module load time so the whole gateway process shares a single registry.
const _registry = createServiceRegistry();

export const serviceRegistry = _registry;
export const registerService     = _registry.registerService;
export const listRegisteredServices = _registry.listRegisteredServices;
export const getRegisteredService   = _registry.getRegisteredService;

// ── signServiceAccessToken ─────────────────────────────────────────────────────
// Sidecar's signature requires an explicit targetAddress; discovery.ts
// previously looked it up automatically.  Preserve that convenience here.
export function signServiceAccessToken(
    callerService: string,
    targetService: string,
    options: { method?: string; path?: string; ttlSeconds?: number } = {}
): string {
    const target = _registry.getRegisteredService(targetService);
    if (!target) {
        throw new Error(`Target service '${targetService}' not found in registry`);
    }
    return _signServiceAccessToken(callerService, targetService, target.address, options);
}

// ── requireRegistrySecret ──────────────────────────────────────────────────────
// Sidecar exports this as a factory (requireRegistrySecret(options)) so that the
// secret can be injected.  admin.ts uses it as plain Express middleware, so we
// expose it in the same shape as before: a direct middleware function.
export const requireRegistrySecret = _requireRegistrySecret();
