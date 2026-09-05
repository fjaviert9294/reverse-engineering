import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Pantalla de login de la Interfaz Web (Task 17.1).
 *
 * Consume `POST /auth/login` a través de `AuthService` con usuario y contraseña.
 * Ante credenciales válidas establece la sesión y navega al área protegida
 * (o a la URL solicitada previamente). Ante credenciales inválidas muestra un
 * mensaje genérico en español, sin revelar qué campo fue incorrecto
 * (Requisitos 13.1, 13.3, 10.5). Todo el texto visible está en español.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <main class="login">
      <section class="tarjeta" aria-labelledby="titulo-login">
        <h1 id="titulo-login">Iniciar sesión</h1>
        <p class="descripcion">
          Introduzca sus credenciales para acceder a Repo-Analyzer.
        </p>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
          <label class="campo">
            <span>Usuario</span>
            <input
              type="text"
              formControlName="username"
              autocomplete="username"
              [attr.aria-invalid]="isInvalid('username')"
            />
          </label>

          <label class="campo">
            <span>Contraseña</span>
            <input
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [attr.aria-invalid]="isInvalid('password')"
            />
          </label>

          @if (errorMessage()) {
            <p class="error" role="alert">{{ errorMessage() }}</p>
          }

          <button type="submit" [disabled]="submitting()">
            {{ submitting() ? 'Accediendo…' : 'Acceder' }}
          </button>
        </form>
      </section>
    </main>
  `,
  styles: [
    `
      .login {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 2rem 1rem;
      }

      .tarjeta {
        width: 100%;
        max-width: 24rem;
        padding: 1.5rem;
        border: 1px solid #d0d0d0;
        border-radius: 0.5rem;
      }

      h1 {
        margin-top: 0;
        font-size: 1.5rem;
      }

      .descripcion {
        color: #555;
        margin-bottom: 1.5rem;
      }

      .campo {
        display: block;
        margin-bottom: 1rem;
      }

      .campo span {
        display: block;
        margin-bottom: 0.25rem;
        font-weight: 600;
      }

      .campo input {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid #b0b0b0;
        border-radius: 0.25rem;
        font-size: 1rem;
      }

      .error {
        color: #b00020;
        margin: 0.5rem 0 1rem;
      }

      button {
        width: 100%;
        padding: 0.6rem;
        font-size: 1rem;
        border: none;
        border-radius: 0.25rem;
        background: #1a3c6e;
        color: #fff;
        cursor: pointer;
      }

      button:disabled {
        background: #7d93b3;
        cursor: not-allowed;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Formulario reactivo con usuario y contraseña obligatorios. */
  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  /** Mensaje de error (en español) a mostrar tras un intento fallido. */
  readonly errorMessage = signal<string | null>(null);

  /** Indica si hay una petición de login en curso. */
  readonly submitting = signal(false);

  /** Envía las credenciales al backend y gestiona el resultado. */
  onSubmit(): void {
    this.errorMessage.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Introduzca usuario y contraseña.');
      return;
    }

    const { username, password } = this.form.getRawValue();
    this.submitting.set(true);

    this.auth.login(username, password).subscribe((result) => {
      this.submitting.set(false);
      if (result.ok) {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        void this.router.navigateByUrl(returnUrl);
        return;
      }
      // Mensaje genérico en español; no revela el campo incorrecto (Req 13.3).
      this.errorMessage.set(result.message);
    });
  }

  /** Indica si un control ha sido tocado y es inválido, para accesibilidad. */
  isInvalid(controlName: 'username' | 'password'): boolean {
    const control = this.form.get(controlName);
    return control !== null && control.invalid && control.touched;
  }
}
