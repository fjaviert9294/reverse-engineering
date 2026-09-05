import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { LoginComponent } from './auth/login.component';
import { HomeComponent } from './home/home.component';

/**
 * Rutas de la Interfaz Web (Task 17.1).
 *
 * - `/login` es pública (pantalla de autenticación).
 * - El resto del área es protegida por `authGuard`, que exige una sesión válida y
 *   redirige a `/login` a los usuarios no autenticados (Requisito 13.1).
 */
export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
