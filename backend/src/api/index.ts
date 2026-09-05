/**
 * Punto de entrada de la capa API/Auth de Repo-Analyzer (Tasks 15.1, 15.2).
 *
 * Reexporta el router HTTP (auth/preferencias y análisis), el middleware de
 * autenticación y las utilidades HTTP para que el arranque del servidor y las
 * capas superiores los consuman sin acoplarse a las rutas internas.
 */
export {
  createApiRouter,
  type ApiDependencies,
  type AuthService,
  type PreferenceRepository,
} from './api-router.js';
export {
  createAnalysisRouter,
  type AnalysisDependencies,
  type AnalysisClock,
  type AnalysisRouteHandler,
} from './analysis-router.js';
export {
  authenticateRequest,
  extractBearerToken,
  type AuthResult,
  type SessionValidator,
} from './auth-middleware.js';
export {
  readJsonBody,
  sendJson,
  sendError,
  BodyParseError,
  MAX_BODY_BYTES,
} from './http-helpers.js';
