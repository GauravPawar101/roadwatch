/**
 * services.ts
 *
 * Mounts the sidecar-auth service registry router.
 * All route logic (register, list, get, token) now lives in @roadwatch/sidecar-auth.
 */
import { createSidecarServiceRoutes } from '../services/discovery.js';

export default createSidecarServiceRoutes();
