import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Interceptor HTTP funcional que adjunta el token de sesión como
 * `Authorization: Bearer <token>` a las peticiones salientes cuando hay una
 * sesión establecida, tal como espera el middleware del backend (Task 15.1).
 *
 * La propia petición de login (`/auth/login`) no lleva token, ya que su objetivo
 * es obtenerlo.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/auth/login')) {
    return next(req);
  }

  const token = inject(AuthService).getToken();
  if (token === null) {
    return next(req);
  }

  const authorized = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
  return next(authorized);
};
