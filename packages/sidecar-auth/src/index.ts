export {
    extractUserContext, optionalSidecarAuth, requireUserContext,
    requireUserRole, sidecarAuth, validateServiceAuth, type AuthenticatedRequest, type ServiceJwtPayload,
    type UserContext
} from './middleware.js';

export {
    SidecarAuthClient,
    type ServiceInfo,
    type ServiceRegistrationOptions
} from './client.js';

export {
    createServiceRegistry,
    createSidecarServiceRoutes,
    signServiceAccessToken,
    signServiceRegistrationToken,
    verifyServiceAccessToken,
    verifyServiceRegistrationToken,
    type RegisteredService,
    type ServiceAccessClaims,
    type ServiceRegistrationClaims,
    type ServiceRegistrationInput,
    type SidecarServiceRoutesOptions
} from './routes.js';

