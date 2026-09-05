import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guarda de ruta funcional que exige una sesión válida para acceder a las áreas
 * protegidas de la Interfaz Web (Requisito 13.1).
 *
 * Si el usuario no está autenticado, se le redirige a la pantalla de login. Se
 * preserva la URL solicitada como parámetro `returnUrl` para poder regresar tras
 * autenticarse.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
