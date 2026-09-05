import { Component, computed, inject, input, signal } from '@angular/core';
import {
  AnalysisResult,
  ArchitectureType,
  ComponentCategory,
  FindingCategoryStatus,
  SupportedLanguage,
} from './analysis-result.model';
import { AnalysisService } from './analysis.service';

/** Sección navegable del dashboard. */
type SeccionId =
  | 'resumen'
  | 'estructura'
  | 'componentes'
  | 'arquitectura'
  | 'hallazgos';

interface SeccionNav {
  id: SeccionId;
  etiqueta: string;
}

/**
 * Dashboard de resultados de la Interfaz Web (Task 17.4).
 *
 * Presenta el `Resultado_Analisis` en secciones diferenciadas y navegables:
 * **resumen, estructura, componentes, arquitectura inferida y hallazgos
 * adicionales** (Requisito 10.1). Los hallazgos se agrupan por los tres tipos
 * (vulnerabilidades, dependencias desactualizadas y endpoints de API) e indican
 * explícitamente la ausencia o la imposibilidad de análisis por categoría
 * (Requisitos 10.2, 10.3, 9.4, 9.5).
 *
 * Reglas de confianza:
 * - Muestra el nivel de confianza junto a los componentes con `confidence < 0.70`
 *   (Requisito 7.3).
 * - Marca la arquitectura como incierta y muestra la confianza cuando
 *   `confidencePct < 70` (Requisito 8.3).
 * - Muestra la confianza de la explicación funcional cuando `confidencePct < 100`
 *   (Requisito 6.2).
 *
 * Si no hay `Resultado_Analisis` disponible, muestra un mensaje de ausencia de
 * resultados manteniendo visibles las secciones (Requisito 10.4). Incluye un
 * botón para exportar a Markdown (Requisito 11.2). Todo el texto visible está en
 * español (Requisito 10.5) y el diseño es responsive y legible entre 320 y
 * 1920 px sin scroll horizontal ni solapamiento (Requisito 10.6).
 */
@Component({
  selector: 'app-result-dashboard',
  standalone: true,
  imports: [],
  template: `
    <section class="dashboard" aria-labelledby="titulo-dashboard">
      <header class="dashboard-cabecera">
        <h2 id="titulo-dashboard">Resultados del análisis</h2>
        <button
          type="button"
          class="exportar"
          [disabled]="result() === null || exportando()"
          (click)="exportar()"
        >
          {{ exportando() ? 'Exportando…' : 'Exportar a Markdown' }}
        </button>
      </header>

      @if (mensajeExportacion(); as msg) {
        <p class="aviso-exportacion" role="status">{{ msg }}</p>
      }

      @if (result() === null) {
        <p class="ausencia-global" role="status">
          No hay un resultado de análisis disponible. Las secciones se muestran a
          continuación y se completarán cuando exista un resultado.
        </p>
      }

      <nav class="nav-secciones" aria-label="Secciones del dashboard">
        <ul>
          @for (sec of secciones; track sec.id) {
            <li>
              <button
                type="button"
                class="nav-boton"
                [class.activa]="seccionActiva() === sec.id"
                [attr.aria-current]="seccionActiva() === sec.id ? 'true' : null"
                (click)="irASeccion(sec.id)"
              >
                {{ sec.etiqueta }}
              </button>
            </li>
          }
        </ul>
      </nav>

      <div class="secciones">
        <!-- Resumen -->
        <section
          id="seccion-resumen"
          class="tarjeta"
          [hidden]="seccionActiva() !== 'resumen'"
          aria-labelledby="titulo-resumen"
        >
          <h3 id="titulo-resumen">Resumen</h3>
          @if (result(); as r) {
            <p class="modo">Modo de análisis: {{ etiquetaModo(r.analysisMode) }}</p>
            @if (r.functionalSummary.determined) {
              <p class="texto-resumen">{{ r.functionalSummary.summary }}</p>
              @if (r.functionalSummary.confidencePct < 100) {
                <p class="confianza">
                  Nivel de confianza: {{ r.functionalSummary.confidencePct }}%
                </p>
              }
            } @else {
              <p class="sin-dato">
                No se pudo determinar la explicación funcional del repositorio.
                Nivel de confianza: {{ r.functionalSummary.confidencePct }}%.
              </p>
            }
            @if (r.notices.length > 0) {
              <div class="avisos" role="note">
                <h4>Avisos</h4>
                <ul>
                  @for (aviso of r.notices; track aviso) {
                    <li>{{ aviso }}</li>
                  }
                </ul>
              </div>
            }
          } @else {
            <p class="sin-dato">Sin resumen disponible.</p>
          }
        </section>

        <!-- Estructura -->
        <section
          id="seccion-estructura"
          class="tarjeta"
          [hidden]="seccionActiva() !== 'estructura'"
          aria-labelledby="titulo-estructura"
        >
          <h3 id="titulo-estructura">Estructura</h3>
          @if (result(); as r) {
            <p class="lenguaje-principal">
              Lenguaje principal:
              <strong>{{
                r.primaryLanguage
                  ? etiquetaLenguaje(r.primaryLanguage)
                  : 'no se detectaron lenguajes soportados'
              }}</strong>
            </p>
            @if (r.secondaryLanguages.length > 0) {
              <p class="lenguajes-secundarios">Lenguajes secundarios:</p>
              <ul class="lista-lenguajes">
                @for (lang of r.secondaryLanguages; track lang) {
                  <li>{{ etiquetaLenguaje(lang) }}</li>
                }
              </ul>
            } @else {
              <p class="sin-dato">No se detectaron lenguajes secundarios.</p>
            }
            @if (r.configReadNotes.length > 0) {
              <div class="notas-config">
                <h4>Notas de configuración</h4>
                <ul>
                  @for (nota of r.configReadNotes; track nota) {
                    <li>{{ nota }}</li>
                  }
                </ul>
              </div>
            } @else {
              <p class="sin-dato">Sin notas de configuración.</p>
            }
          } @else {
            <p class="sin-dato">Sin información de estructura disponible.</p>
          }
        </section>

        <!-- Componentes -->
        <section
          id="seccion-componentes"
          class="tarjeta"
          [hidden]="seccionActiva() !== 'componentes'"
          aria-labelledby="titulo-componentes"
        >
          <h3 id="titulo-componentes">Componentes clave</h3>
          @if (result(); as r) {
            @if (r.keyComponents.length > 0) {
              <ul class="lista-componentes">
                @for (comp of r.keyComponents; track comp.path) {
                  <li class="componente">
                    <span class="ruta">{{ comp.path }}</span>
                    <span class="categoria">{{ etiquetaCategoria(comp.category) }}</span>
                    @if (mostrarConfianzaComponente(comp.confidence)) {
                      <span class="confianza-componente">
                        Confianza: {{ formatearConfianza(comp.confidence) }}
                      </span>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="sin-dato">No se identificaron componentes clave.</p>
            }
          } @else {
            <p class="sin-dato">Sin componentes disponibles.</p>
          }
        </section>

        <!-- Arquitectura inferida -->
        <section
          id="seccion-arquitectura"
          class="tarjeta"
          [hidden]="seccionActiva() !== 'arquitectura'"
          aria-labelledby="titulo-arquitectura"
        >
          <h3 id="titulo-arquitectura">Arquitectura inferida</h3>
          @if (result(); as r) {
            @if (r.architecture.determined && r.architecture.type) {
              <p class="tipo-arquitectura">
                Tipo: <strong>{{ etiquetaArquitectura(r.architecture.type) }}</strong>
              </p>
              @if (r.architecture.confidencePct < 70) {
                <p class="incierta" role="note">
                  La inferencia de arquitectura es incierta. Nivel de confianza:
                  {{ r.architecture.confidencePct }}%.
                </p>
              } @else {
                <p class="confianza">Nivel de confianza: {{ r.architecture.confidencePct }}%.</p>
              }
              @if (r.architecture.evidence) {
                <p class="evidencia">Evidencia: {{ r.architecture.evidence }}</p>
              }
            } @else {
              <p class="sin-dato">
                No se pudo determinar la arquitectura por ausencia de evidencia
                estructural suficiente.
              </p>
            }
          } @else {
            <p class="sin-dato">Sin información de arquitectura disponible.</p>
          }
        </section>

        <!-- Hallazgos adicionales -->
        <section
          id="seccion-hallazgos"
          class="tarjeta"
          [hidden]="seccionActiva() !== 'hallazgos'"
          aria-labelledby="titulo-hallazgos"
        >
          <h3 id="titulo-hallazgos">Hallazgos adicionales</h3>
          @if (result(); as r) {
            <!-- Vulnerabilidades -->
            <div class="grupo-hallazgos">
              <h4>Vulnerabilidades</h4>
              @if (r.additionalFindings.vulnerabilities.status === 'CON_HALLAZGOS') {
                <ul class="lista-hallazgos">
                  @for (v of r.additionalFindings.vulnerabilities.items; track v.location) {
                    <li>
                      <span class="ubicacion">{{ v.location }}</span>
                      <span class="severidad">Severidad: {{ v.severity }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="ausencia-categoria">
                  {{ mensajeAusencia(r.additionalFindings.vulnerabilities.status) }}
                </p>
              }
            </div>

            <!-- Dependencias desactualizadas -->
            <div class="grupo-hallazgos">
              <h4>Dependencias desactualizadas</h4>
              @if (r.additionalFindings.outdatedDependencies.status === 'CON_HALLAZGOS') {
                <ul class="lista-hallazgos">
                  @for (d of r.additionalFindings.outdatedDependencies.items; track d.name) {
                    <li>
                      <span class="nombre-dep">{{ d.name }}</span>
                      <span class="version">
                        Detectada: {{ d.detectedVersion }} — Más reciente:
                        {{ d.latestVersion }}
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="ausencia-categoria">
                  {{ mensajeAusencia(r.additionalFindings.outdatedDependencies.status) }}
                </p>
              }
            </div>

            <!-- Endpoints de API -->
            <div class="grupo-hallazgos">
              <h4>Endpoints de API</h4>
              @if (r.additionalFindings.apiEndpoints.status === 'CON_HALLAZGOS') {
                <ul class="lista-hallazgos">
                  @for (e of r.additionalFindings.apiEndpoints.items; track e.path + e.method) {
                    <li>
                      <span class="metodo">{{ e.method }}</span>
                      <span class="ruta-endpoint">{{ e.path }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="ausencia-categoria">
                  {{ mensajeAusencia(r.additionalFindings.apiEndpoints.status) }}
                </p>
              }
            </div>
          } @else {
            <p class="sin-dato">
              Sin hallazgos disponibles. Se mostrarán las tres categorías cuando
              exista un resultado.
            </p>
          }
        </section>
      </div>
    </section>
  `,
  styles: [
    `
      .dashboard {
        width: 100%;
        max-width: 60rem;
        margin: 1rem auto 0;
        padding: 0 0.25rem;
        box-sizing: border-box;
      }

      .dashboard-cabecera {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      h2 {
        margin: 0;
        font-size: 1.25rem;
      }

      .exportar {
        padding: 0.5rem 0.9rem;
        border: none;
        border-radius: 0.25rem;
        background: #1a3c6e;
        color: #fff;
        cursor: pointer;
        font-size: 0.95rem;
      }

      .exportar:disabled {
        background: #7d93b3;
        cursor: not-allowed;
      }

      .aviso-exportacion {
        margin: 0.5rem 0 0;
        color: #1b5e20;
      }

      .ausencia-global {
        margin: 0.75rem 0;
        padding: 0.75rem 1rem;
        background: #fff8e1;
        border: 1px solid #e6c65b;
        border-radius: 0.25rem;
        color: #5b4700;
      }

      .nav-secciones {
        margin: 1rem 0;
      }

      .nav-secciones ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .nav-boton {
        padding: 0.45rem 0.8rem;
        border: 1px solid #1a3c6e;
        border-radius: 1rem;
        background: #fff;
        color: #1a3c6e;
        cursor: pointer;
        font-size: 0.9rem;
        white-space: nowrap;
      }

      .nav-boton.activa {
        background: #1a3c6e;
        color: #fff;
      }

      .tarjeta {
        border: 1px solid #d0d0d0;
        border-radius: 0.5rem;
        padding: 1.25rem;
        margin-bottom: 1rem;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      h3 {
        margin-top: 0;
        font-size: 1.1rem;
        color: #1a3c6e;
      }

      h4 {
        margin: 0.75rem 0 0.35rem;
        font-size: 1rem;
      }

      .sin-dato {
        color: #666;
        font-style: italic;
      }

      .ausencia-categoria {
        color: #555;
        margin: 0.25rem 0 0.5rem;
      }

      .modo {
        color: #444;
        font-size: 0.9rem;
      }

      .texto-resumen {
        line-height: 1.5;
      }

      .confianza,
      .confianza-componente {
        color: #7a5b00;
        font-size: 0.9rem;
      }

      .incierta {
        color: #a15c00;
        background: #fff3e0;
        border: 1px solid #e0b877;
        border-radius: 0.25rem;
        padding: 0.5rem 0.75rem;
      }

      ul {
        margin: 0.25rem 0;
        padding-left: 1.25rem;
      }

      .lista-componentes,
      .lista-hallazgos,
      .lista-lenguajes {
        list-style: none;
        padding-left: 0;
      }

      .componente,
      .lista-hallazgos li {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: baseline;
        padding: 0.5rem 0;
        border-bottom: 1px solid #eee;
      }

      .ruta,
      .nombre-dep,
      .ruta-endpoint {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow-wrap: anywhere;
      }

      .categoria,
      .severidad,
      .version {
        color: #555;
        font-size: 0.9rem;
      }

      .metodo {
        font-weight: 600;
        color: #1a3c6e;
      }

      .grupo-hallazgos {
        margin-bottom: 0.75rem;
      }

      /* Legibilidad en pantallas pequeñas (>=320px) sin scroll horizontal. */
      @media (max-width: 480px) {
        .dashboard-cabecera {
          align-items: stretch;
        }

        .exportar {
          width: 100%;
        }
      }
    `,
  ],
})
export class ResultDashboardComponent {
  private readonly analysis = inject(AnalysisService);

  /**
   * Resultado a mostrar. Cuando es `null`, el dashboard muestra el mensaje de
   * ausencia de resultados manteniendo visibles las secciones (Requisito 10.4).
   */
  readonly result = input<AnalysisResult | null>(null);

  /** Sección actualmente visible en la navegación (Requisito 10.1). */
  readonly seccionActiva = signal<SeccionId>('resumen');

  /** Indica si hay una exportación en curso. */
  readonly exportando = signal(false);

  /** Mensaje de finalización o error de la exportación (Requisitos 11.2, 11.4). */
  readonly mensajeExportacion = signal<string | null>(null);

  /** Umbral por debajo del cual se muestra la confianza de un componente (Req 7.3). */
  private static readonly UMBRAL_CONFIANZA_COMPONENTE = 0.7;

  /** Secciones navegables del dashboard (Requisito 10.1). */
  readonly secciones: readonly SeccionNav[] = [
    { id: 'resumen', etiqueta: 'Resumen' },
    { id: 'estructura', etiqueta: 'Estructura' },
    { id: 'componentes', etiqueta: 'Componentes' },
    { id: 'arquitectura', etiqueta: 'Arquitectura inferida' },
    { id: 'hallazgos', etiqueta: 'Hallazgos adicionales' },
  ];

  /** Identificador del resultado, disponible para acciones (exportación). */
  private readonly resultId = computed(() => this.result()?.id ?? null);

  /** Cambia la sección visible. */
  irASeccion(id: SeccionId): void {
    this.seccionActiva.set(id);
  }

  /**
   * Indica si debe mostrarse la confianza junto a un componente: cuando existe y
   * es menor que 0.70 (Requisito 7.3).
   */
  mostrarConfianzaComponente(confidence: number | undefined): boolean {
    return (
      typeof confidence === 'number' &&
      confidence < ResultDashboardComponent.UMBRAL_CONFIANZA_COMPONENTE
    );
  }

  /** Formatea la confianza de un componente en la escala 0.00–1.00. */
  formatearConfianza(confidence: number | undefined): string {
    if (typeof confidence !== 'number') {
      return '';
    }
    return confidence.toFixed(2);
  }

  /** Mensaje de ausencia por categoría de hallazgos (Requisitos 9.4, 9.5, 10.3). */
  mensajeAusencia(status: FindingCategoryStatus): string {
    if (status === 'NO_ANALIZABLE') {
      return 'Esta categoría no pudo analizarse.';
    }
    return 'No se encontraron hallazgos en esta categoría.';
  }

  /** Etiqueta legible en español del modo de análisis. */
  etiquetaModo(mode: AnalysisResult['analysisMode']): string {
    return mode === 'ESTATICO_MAS_IA'
      ? 'estático enriquecido con IA'
      : 'solo estático';
  }

  /** Etiqueta legible en español de un lenguaje soportado. */
  etiquetaLenguaje(lang: SupportedLanguage): string {
    return ETIQUETAS_LENGUAJE[lang];
  }

  /** Etiqueta legible en español de una categoría de componente. */
  etiquetaCategoria(categoria: ComponentCategory): string {
    return ETIQUETAS_CATEGORIA[categoria];
  }

  /** Etiqueta legible en español de un tipo de arquitectura. */
  etiquetaArquitectura(tipo: ArchitectureType): string {
    return ETIQUETAS_ARQUITECTURA[tipo];
  }

  /**
   * Solicita la exportación a Markdown y ofrece el documento como descarga al
   * usuario, notificando la finalización (Requisitos 11.1, 11.2). Ante fallo,
   * muestra un mensaje en español sin alterar el resultado (Requisito 11.4).
   */
  exportar(): void {
    const id = this.resultId();
    if (id === null) {
      return;
    }
    this.exportando.set(true);
    this.mensajeExportacion.set(null);
    this.analysis.exportMarkdown(id).subscribe((outcome) => {
      this.exportando.set(false);
      if (outcome.ok) {
        this.descargarMarkdown(outcome.filename, outcome.mediaType, outcome.content);
        this.mensajeExportacion.set(
          `Exportación completada. El documento "${outcome.filename}" está disponible para su descarga.`,
        );
        return;
      }
      this.mensajeExportacion.set(outcome.message);
    });
  }

  /**
   * Materializa el contenido Markdown como una descarga en el navegador. Se crea
   * un enlace temporal con un `Blob` y se dispara el clic; el objeto URL se
   * libera a continuación.
   */
  private descargarMarkdown(filename: string, mediaType: string, content: string): void {
    const blob = new Blob([content], { type: mediaType });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = filename;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }
}

/** Etiquetas legibles en español para lenguajes soportados (Requisito 10.5). */
const ETIQUETAS_LENGUAJE: Record<SupportedLanguage, string> = {
  JAVA: 'Java',
  TYPESCRIPT: 'TypeScript',
  JAVASCRIPT: 'JavaScript',
  PYTHON: 'Python',
};

/** Etiquetas legibles en español para categorías de componente (Requisito 10.5). */
const ETIQUETAS_CATEGORIA: Record<ComponentCategory, string> = {
  modulo: 'Módulo',
  servicio: 'Servicio',
  controlador: 'Controlador',
  modelo: 'Modelo',
  punto_de_entrada: 'Punto de entrada',
  configuracion: 'Configuración',
};

/** Etiquetas legibles en español para tipos de arquitectura (Requisito 10.5). */
const ETIQUETAS_ARQUITECTURA: Record<ArchitectureType, string> = {
  monolito: 'Monolito',
  microservicios: 'Microservicios',
  mvc: 'MVC',
  hexagonal: 'Hexagonal',
  por_capas: 'Por capas',
  otro: 'Otro',
};
