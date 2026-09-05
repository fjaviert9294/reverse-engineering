/**
 * Router HTTP de la capa API/Auth de Repo-Analyzer (Task 15.1).
 *
 * Expone los endpoints de autenticación y preferencias, y protege las rutas que
 * lo requieren con el middleware de sesión:
 *
 * - `POST /auth/login` — autenticación básica; establece una sesión y devuelve el
 *   token de sesión. Con credenciales inválidas responde `401` con un error
 *   genérico que NO revela qué campo fue incorrecto (Requisitos 13.1, 13.2, 13.3).
 * - `PUT /preferences/ai` — (protegida) activa/desactiva y conserva el uso de IA
 *   del usuario autenticado (Requisito 3.3).
 *
 * Además de los endpoints de la Task 15.1, el router integra los endpoints de
 * análisis de la Task 15.2 (`POST /analyses`, `GET /analyses/{id}/status`,
 * `GET /analyses/{id}`, `POST /analyses/{id}/export`), todos protegidos por el
 * middleware de sesión y atendidos por el `AnalysisRouteHandler` inyectado. Las
 * rutas no reconocidas devuelven `false` para que el servidor aplique su
 * comportamiento por defecto (404), sin acoplar este router al andamiaje de
 * `server.ts`.
 *
 * Los endpoints de análisis son opcionales en el cableado: solo se activan
 * cuando se inyecta `analysisRouter` en las dependencias, de modo que el router
 * de la Task 15.1 siga funcionando sin ellos (p. ej. en pruebas de auth).
 *
 * El router depende solo de abstracciones (`AuthService`, `PreferenceRepository`),
 * de modo que los respaldos concretos se inyectan y pueden sustituirse en
 * pruebas.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthError, Session } from '../domain/index.js';
import { authenticateRequest, type SessionValidator } from './auth-middleware.js';
import { readJsonBody, sendError, sendJson, BodyParseError } from './http-helpers.js';
import type { AnalysisRouteHandler } from './analysis-router.js';

/**
 * Puerto de autenticación que consume la API. Lo satisface `DefaultAuthService`
 * (Task 13.1). `login` devuelve una `Session` o un `AuthError` genérico; el
 * router traduce el error a `401` sin revelar el campo incorrecto (Req 13.3).
 */
export interface AuthService extends SessionValidator {
  login(username: string, password: string): Promise<Session | AuthError>;
}

/**
 * Puerto de persistencia de la preferencia de uso de IA que consume la API. Lo
 * satisface `SqlPreferenceRepository` (Task 3.4).
 */
export interface PreferenceRepository {
  setUseAI(userId: string, useAI: boolean): Promise<void>;
  getUseAI(userId: string): Promise<boolean>;
}

/** Dependencias inyectadas del router de la API. */
export interface ApiDependencies {
  authService: AuthService;
  preferenceRepository: PreferenceRepository;
  /**
   * Manejador de las rutas de análisis (Task 15.2). Opcional: cuando se inyecta,
   * el router expone `POST /analyses`, `GET /analyses/{id}/status`,
   * `GET /analyses/{id}` y `POST /analyses/{id}/export`, todos protegidos por el
   * middleware de sesión. Se construye con `createAnalysisRouter`.
   */
  analysisRouter?: AnalysisRouteHandler;
}

/** Type guard: distingue un `AuthError` de una `Session` en el resultado de `login`. */
function isAuthError(result: Session | AuthError): result is AuthError {
  return (result as AuthError).error === true;
}

/**
 * Crea el manejador de rutas de la API. Devuelve una función que intenta atender
 * la petición; si la ruta/método corresponde a un endpoint de esta capa, la
 * atiende y resuelve a `true`. Si no reconoce la ruta, resuelve a `false` para
 * que el llamador (servidor) aplique su comportamiento por defecto.
 */
export function createApiRouter(
  deps: ApiDependencies,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { authService, preferenceRepository, analysisRouter } = deps;

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof BodyParseError) {
        sendError(res, 400, 'peticion_invalida', err.message);
        return;
      }
      throw err;
    }

    const { username, password } = (body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };

    // Faltan credenciales: se requiere autenticación básica (Req 13.1). Se usa el
    // mismo mensaje genérico que un fallo de credenciales para no filtrar qué
    // campo faltaba (Req 13.3).
    if (typeof username !== 'string' || typeof password !== 'string') {
      sendError(res, 401, 'credenciales_invalidas', 'Usuario o contraseña incorrectos.');
      return;
    }

    const result = await authService.login(username, password);

    if (isAuthError(result)) {
      // Credenciales inválidas o cuenta bloqueada: acceso denegado con el mensaje
      // genérico del servicio, sin revelar el campo incorrecto (Req 13.3).
      sendJson(res, 401, { status: 'credenciales_invalidas', message: result.message });
      return;
    }

    // Credenciales válidas: se concede el acceso y se establece la sesión,
    // devolviendo el token de sesión (Req 13.2).
    sendJson(res, 200, {
      status: 'ok',
      token: result.token,
      userId: result.userId,
      username: result.username,
      expiresAt: result.expiresAt,
    });
  }

  async function handleSetAiPreference(
    req: IncomingMessage,
    res: ServerResponse,
    session: Session,
  ): Promise<void> {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof BodyParseError) {
        sendError(res, 400, 'peticion_invalida', err.message);
        return;
      }
      throw err;
    }

    const { useAI } = (body ?? {}) as { useAI?: unknown };
    if (typeof useAI !== 'boolean') {
      sendError(
        res,
        400,
        'peticion_invalida',
        'El campo "useAI" es obligatorio y debe ser booleano.',
      );
      return;
    }

    // Se conserva la preferencia del usuario autenticado para aplicarla en los
    // análisis posteriores hasta que la modifique (Req 3.3). La preferencia está
    // acotada al usuario de la sesión, no a un identificador arbitrario del
    // cuerpo.
    await preferenceRepository.setUseAI(session.userId, useAI);
    sendJson(res, 200, { status: 'ok', useAI });
  }

  return async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method ?? 'GET';
    // Se ignora la query string para el emparejamiento de rutas.
    const path = (req.url ?? '/').split('?')[0];

    if (method === 'POST' && path === '/auth/login') {
      await handleLogin(req, res);
      return true;
    }

    if (method === 'PUT' && path === '/preferences/ai') {
      // Ruta protegida: exige una sesión válida (Req 13.1). Sin ella, 401.
      const auth = authenticateRequest(req, authService);
      if (!auth.authenticated) {
        sendError(
          res,
          401,
          'no_autenticado',
          'Se requiere una sesión válida para acceder a este recurso.',
        );
        return true;
      }
      await handleSetAiPreference(req, res, auth.session);
      return true;
    }

    // Endpoints de análisis (Task 15.2): rutas protegidas. Solo se atienden si se
    // inyectó el manejador de análisis. Se exige una sesión válida (Req 13.1)
    // antes de delegar; sin ella, 401.
    if (analysisRouter !== undefined && path.split('/').filter((s) => s.length > 0)[0] === 'analyses') {
      const auth = authenticateRequest(req, authService);
      if (!auth.authenticated) {
        sendError(
          res,
          401,
          'no_autenticado',
          'Se requiere una sesión válida para acceder a este recurso.',
        );
        return true;
      }
      return analysisRouter(req, res, auth.session);
    }

    return false;
  };
}
