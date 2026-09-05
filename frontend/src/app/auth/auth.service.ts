import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';

/**
 * Sesión autenticada tal como la devuelve `POST /auth/login` del backend
 * (Task 15.1). Contiene únicamente metadatos de sesión; nunca credenciales en
 * claro. Coincide con el contrato de `Session` del dominio del backend.
 */
export interface AuthSession {
  token: string;
  userId: string;
  username: string;
  expiresAt: string;
}

/** Resultado de un intento de login. */
export type LoginResult =
  | { ok: true; session: AuthSession }
  | { ok: false; message: string };

/** Clave de almacenamiento del token de sesión en `localStorage`. */
const SESSION_STORAGE_KEY = 'repo-analyzer.session';

/**
 * Mensaje genérico de credenciales inválidas, en español (Requisito 10.5). Es el
 * mismo con independencia del campo incorrecto, consistente con el backend, que
 * no revela qué campo falló (Requisito 13.3).
 */
export const MENSAJE_CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos.';

/** Mensaje genérico ante errores de red o del servidor, en español. */
export const MENSAJE_ERROR_CONEXION =
  'No se pudo conectar con el servidor. Inténtelo de nuevo.';

/**
 * Servicio de autenticación de la Interfaz Web (Task 17.1).
 *
 * Consume `POST /auth/login` con usuario y contraseña. Ante credenciales válidas
 * establece una sesión autenticada guardando el token devuelto; ante credenciales
 * inválidas expone un mensaje genérico en español sin revelar el campo incorrecto
 * (Requisitos 13.1, 13.3, 10.5).
 *
 * La sesión se conserva en `localStorage` para sobrevivir a recargas de página, y
 * se expone reactivamente mediante señales para que las guardas y la vista
 * reaccionen a cambios de autenticación.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /** Estado reactivo de la sesión actual (null si no hay sesión). */
  private readonly sessionSignal = signal<AuthSession | null>(this.readStoredSession());

  /** Indica si hay una sesión válida establecida. */
  readonly isAuthenticated = computed(() => this.sessionSignal() !== null);

  /** Sesión actual, o null si el usuario no está autenticado. */
  readonly session = computed(() => this.sessionSignal());

  /**
   * Intenta autenticar con las credenciales dadas contra `POST /auth/login`.
   * Devuelve un `LoginResult` con la sesión en caso de éxito, o un mensaje
   * genérico en español en caso de fallo. Nunca revela qué campo fue incorrecto.
   */
  login(username: string, password: string): Observable<LoginResult> {
    return this.http.post<LoginBackendResponse>('/auth/login', { username, password }).pipe(
      map((response): LoginResult => {
        if (response.status === 'ok' && typeof response.token === 'string') {
          const session: AuthSession = {
            token: response.token,
            userId: response.userId ?? '',
            username: response.username ?? username,
            expiresAt: response.expiresAt ?? '',
          };
          this.establishSession(session);
          return { ok: true, session };
        }
        return { ok: false, message: MENSAJE_CREDENCIALES_INVALIDAS };
      }),
      catchError((error: unknown) => {
        // Un 401 significa credenciales inválidas o cuenta bloqueada: se muestra
        // siempre el mismo mensaje genérico para no revelar el campo (Req 13.3).
        // Otros errores (red, servidor) muestran un mensaje de conexión.
        const status = (error as { status?: number }).status;
        if (status === 401) {
          return of<LoginResult>({ ok: false, message: MENSAJE_CREDENCIALES_INVALIDAS });
        }
        return of<LoginResult>({ ok: false, message: MENSAJE_ERROR_CONEXION });
      }),
    );
  }

  /** Cierra la sesión actual y limpia el token almacenado. */
  logout(): void {
    this.sessionSignal.set(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Almacenamiento no disponible: la sesión en memoria ya se limpió.
    }
  }

  /** Devuelve el token de sesión actual, o null si no hay sesión. */
  getToken(): string | null {
    return this.sessionSignal()?.token ?? null;
  }

  /** Establece la sesión en memoria y la persiste para sobrevivir a recargas. */
  private establishSession(session: AuthSession): void {
    this.sessionSignal.set(session);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Si el almacenamiento no está disponible, la sesión sigue en memoria.
    }
  }

  /** Lee la sesión persistida al iniciar el servicio, si existe y es válida. */
  private readStoredSession(): AuthSession | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (raw === null) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      if (typeof parsed.token === 'string' && parsed.token.length > 0) {
        return {
          token: parsed.token,
          userId: parsed.userId ?? '',
          username: parsed.username ?? '',
          expiresAt: parsed.expiresAt ?? '',
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

/** Forma de la respuesta de `POST /auth/login` del backend (Task 15.1). */
interface LoginBackendResponse {
  status: string;
  token?: string;
  userId?: string;
  username?: string;
  expiresAt?: string;
  message?: string;
}
