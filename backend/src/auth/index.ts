/**
 * Punto de entrada de la capa de autenticación de Repo-Analyzer (Task 13.1).
 *
 * Reexporta el servicio de autenticación, la abstracción de almacenamiento de
 * usuarios y las constantes/utilidades relevantes, para que las capas superiores
 * (API/Auth) los consuman sin acoplarse a las rutas internas.
 */
export {
  DefaultAuthService,
  isAuthError,
  systemClock,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  AUTH_TIMEOUT_MS,
  GENERIC_AUTH_ERROR_MESSAGE,
  type Clock,
} from './auth-service.js';
export { InMemoryUserStore, type UserStore } from './user-store.js';

export {
  createDevelopmentDemoUser,
  DEVELOPMENT_DEMO_USERNAME,
  DEVELOPMENT_DEMO_PASSWORD,
} from './development-demo-user.js';
