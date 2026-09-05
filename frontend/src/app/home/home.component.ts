import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RepoUploadComponent } from '../analysis/repo-upload.component';
import { ProgressTrackerComponent } from '../analysis/progress-tracker.component';
import { ResultDashboardComponent } from '../analysis/result-dashboard.component';
import { AnalysisService } from '../analysis/analysis.service';
import { AnalysisResult } from '../analysis/analysis-result.model';

/**
 * Área protegida de la Interfaz Web (Task 17.1).
 *
 * Contenedor accesible solo con sesión válida (protegido por `authGuard`).
 * Aloja el formulario de carga de repositorio (Task 17.2) y, una vez iniciado
 * un análisis, el seguimiento de progreso por consulta periódica (Task 17.3). La
 * tarea posterior (17.4) añadirá el dashboard de resultados. Todo el texto
 * visible está en español (Requisito 10.5).
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RepoUploadComponent,
    ProgressTrackerComponent,
    ResultDashboardComponent,
  ],
  template: `
    <main class="home">
      <header class="cabecera">
        <h1>Repo-Analyzer</h1>
        <button type="button" (click)="cerrarSesion()">Cerrar sesión</button>
      </header>
      <p>Sesión iniciada como <strong>{{ nombreUsuario() }}</strong>.</p>

      <app-repo-upload (analysisStarted)="onAnalisisIniciado($event)" />

      @if (jobIniciado(); as jobId) {
        <app-progress-tracker
          [jobId]="jobId"
          (completed)="onAnalisisCompletado($event)"
        />
      }

      @if (mostrarDashboard()) {
        @if (mensajeResultado(); as msg) {
          <p class="aviso-resultado" role="status">{{ msg }}</p>
        }
        <app-result-dashboard [result]="resultado()" />
      }
    </main>
  `,
  styles: [
    `
      .home {
        padding: 1rem;
      }

      .cabecera {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      button {
        padding: 0.5rem 0.75rem;
        border: 1px solid #1a3c6e;
        border-radius: 0.25rem;
        background: #fff;
        color: #1a3c6e;
        cursor: pointer;
      }

      .aviso-resultado {
        max-width: 60rem;
        margin: 1rem auto 0;
        padding: 0.75rem 1rem;
        background: #fdecea;
        border: 1px solid #e6a8a1;
        border-radius: 0.25rem;
        color: #b00020;
      }
    `,
  ],
})
export class HomeComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly analysis = inject(AnalysisService);

  /** Identificador del análisis iniciado, cuyo progreso se sigue (17.3). */
  readonly jobIniciado = signal<string | null>(null);

  /** Resultado del análisis a mostrar en el dashboard (Task 17.4), o null. */
  readonly resultado = signal<AnalysisResult | null>(null);

  /** Indica si el dashboard de resultados debe mostrarse (tras completar). */
  readonly mostrarDashboard = signal(false);

  /** Mensaje de error al recuperar el resultado, en español (Requisito 10.4). */
  readonly mensajeResultado = signal<string | null>(null);

  /** Nombre del usuario autenticado para mostrarlo en la cabecera. */
  nombreUsuario(): string {
    return this.auth.session()?.username ?? '';
  }

  /** Recibe el identificador del análisis aceptado por el backend. */
  onAnalisisIniciado(jobId: string): void {
    this.jobIniciado.set(jobId);
    // Un nuevo análisis reinicia el dashboard previo.
    this.mostrarDashboard.set(false);
    this.resultado.set(null);
    this.mensajeResultado.set(null);
  }

  /**
   * Se invoca cuando el seguimiento detecta que el análisis se completó. Recupera
   * el `Resultado_Analisis` persistido y lo muestra en el dashboard (Task 17.4).
   * Si no puede recuperarse, se muestra el dashboard con el mensaje de ausencia
   * de resultados manteniendo visibles las secciones (Requisito 10.4).
   */
  onAnalisisCompletado(id: string): void {
    this.mostrarDashboard.set(true);
    this.mensajeResultado.set(null);
    this.analysis.getResult(id).subscribe((outcome) => {
      if (outcome.ok) {
        this.resultado.set(outcome.result);
        this.mensajeResultado.set(null);
        return;
      }
      // El dashboard permanece visible con sus secciones y un resultado nulo,
      // acompañado del mensaje de ausencia/error (Requisito 10.4).
      this.resultado.set(null);
      this.mensajeResultado.set(outcome.message);
    });
  }

  /** Cierra la sesión y vuelve a la pantalla de login. */
  cerrarSesion(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
