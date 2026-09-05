import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

/**
 * Configuración de la aplicación Angular (standalone).
 *
 * Task 17.1: se habilitan el enrutado (login + área protegida con guarda de
 * sesión) y el cliente HTTP con el interceptor que adjunta el token de sesión a
 * las peticiones protegidas.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
