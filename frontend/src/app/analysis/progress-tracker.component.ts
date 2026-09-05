import {
  Component,
  inject,
  input,
  signal,
  effect,
  computed,
  DestroyRef,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {
  AnalysisService,
  AnalysisStage,
  ProgressSnapshot,
} from './analysis.service';

/**
 * Seguimiento de progreso del análisis por consulta periódica (Task 17.3).
 *
 * Dado el `jobId` de un análisis aceptado, este componente sondea el estado del
 * job mediante `AnalysisService.pollStatus`, que consulta
 * `GET /analyses/{id}/status` con una actualización al menos cada 2 segundos
 * (Requisito 12.1). La vista muestra el porcentaje 0-100 y la etapa actual
 * mientras el análisis está en cola o en ejecución.
 *
 * Al finalizar correctamente, notifica al usuario que el análisis se completó y
 * muestra 100% (Requisito 12.4). Si el análisis falla, detiene la actualización
 * del progreso e informa con un mensaje de que no pudo completarse, conservando
 * el último progreso mostrado (Requisito 12.5).
 *
 * Cuando el análisis termina con éxito emite `completed` con el `jobId`, para que
 * el contenedor pueda cargar el dashboard de resultados (Task 17.4).
 *
 * Todo el texto visible está en español (Requisito 10.5).
 */
@Component({
  selector: 'app-progress-tracker',
  standalone: true,
  imports: [],
  template: `
    <section class="progreso" aria-labelledby="titulo-progreso">
      <h2 id="titulo-progreso">Progreso del análisis</h2>

      @switch (snapshot().estado) {
        @case ('completado') {
          <p class="completado" role="status">
            El análisis se completó correctamente.
          </p>
          <div
            class="barra"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="100"
            aria-label="Progreso del análisis"
          >
            <div class="relleno" [style.width.%]="100"></div>
          </div>
          <p class="porcentaje">100%</p>
        }
        @case ('fallido') {
          <p class="fallido" role="alert">{{ mensajeFallo() }}</p>
        }
        @default {
          <p class="etapa" role="status">
            {{ etiquetaEstado() }}
          </p>
          <div
            class="barra"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="porcentaje()"
            aria-label="Progreso del análisis"
          >
            <div class="relleno" [style.width.%]="porcentaje()"></div>
          </div>
          <p class="porcentaje">{{ porcentaje() }}%</p>
        }
      }
    </section>
  `,
  styles: [
    `
      .progreso {
        width: 100%;
        max-width: 40rem;
        padding: 1.25rem 1.5rem;
        border: 1px solid #d0d0d0;
        border-radius: 0.5rem;
        margin-top: 1rem;
      }

      h2 {
        margin-top: 0;
        font-size: 1.15rem;
      }

      .etapa {
        margin: 0.25rem 0 0.75rem;
        color: #333;
      }

      .completado {
        margin: 0.25rem 0 0.75rem;
        color: #1b5e20;
        font-weight: 600;
      }

      .fallido {
        margin: 0.25rem 0;
        color: #b00020;
        font-weight: 600;
      }

      .barra {
        width: 100%;
        height: 0.75rem;
        background: #e6e6e6;
        border-radius: 0.5rem;
        overflow: hidden;
      }

      .relleno {
        height: 100%;
        background: #1a3c6e;
        transition: width 0.3s ease;
      }

      .porcentaje {
        margin: 0.5rem 0 0;
        font-variant-numeric: tabular-nums;
        color: #333;
      }
    `,
  ],
})
export class ProgressTrackerComponent {
  private readonly analysis = inject(AnalysisService);
  private readonly destroyRef = inject(DestroyRef);

  /** Identificador del análisis cuyo progreso se sigue. */
  readonly jobId = input.required<string>();

  /** Emite el `jobId` cuando el análisis se completa (para el dashboard, 17.4). */
  readonly completed = output<string>();

  /** Última instantánea de progreso recibida del servicio. */
  readonly snapshot = signal<ProgressSnapshot>({ estado: 'consultando' });

  /** Suscripción activa al polling; se cancela al reiniciar o destruir. */
  private subscription: Subscription | null = null;

  constructor() {
    // Reinicia el seguimiento cada vez que cambia el `jobId` de entrada. La
    // suscripción se limpia sola al destruirse el componente (takeUntilDestroyed)
    // y también manualmente al cambiar de job para no dejar sondeos huérfanos.
    effect(() => {
      const id = this.jobId();
      this.subscription?.unsubscribe();
      this.snapshot.set({ estado: 'consultando' });
      this.subscription = this.analysis
        .pollStatus(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((snapshot) => {
          this.snapshot.set(snapshot);
          if (snapshot.estado === 'completado') {
            this.completed.emit(id);
          }
        });
    });
  }

  /** Porcentaje a mostrar en la barra y la etiqueta (0-100). */
  readonly porcentaje = computed(() => {
    const snap = this.snapshot();
    if (snap.estado === 'en_curso') {
      return snap.progress;
    }
    if (snap.estado === 'completado') {
      return 100;
    }
    return 0;
  });

  /** Etiqueta en español del estado/etapa actual mientras el análisis avanza. */
  readonly etiquetaEstado = computed(() => {
    const snap = this.snapshot();
    if (snap.estado === 'consultando') {
      return 'Consultando el estado del análisis…';
    }
    if (snap.estado === 'en_curso') {
      if (snap.jobStatus === 'EN_COLA') {
        return 'El análisis está en cola.';
      }
      return `Analizando: ${ETIQUETAS_ETAPA[snap.stage]}`;
    }
    return '';
  });

  /** Mensaje de fallo, incluyendo el módulo afectado si el backend lo informó. */
  readonly mensajeFallo = computed(() => {
    const snap = this.snapshot();
    if (snap.estado !== 'fallido') {
      return '';
    }
    if (snap.errorModule !== null) {
      return `${snap.message} Módulo afectado: ${snap.errorModule}.`;
    }
    return snap.message;
  });
}

/** Etiquetas legibles en español para cada etapa del pipeline (Requisito 10.5). */
const ETIQUETAS_ETAPA: Record<AnalysisStage, string> = {
  INGESTA: 'ingesta del repositorio',
  ANALISIS_ESTATICO: 'análisis estático',
  INFERENCIA_IA: 'inferencia con IA',
  PERSISTENCIA: 'guardado de resultados',
  FINALIZADO: 'finalizando',
};
