import { Component, inject, signal, computed, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { AnalysisService, AnalysisInput } from './analysis.service';

/** Método de entrada seleccionado en el formulario. */
export type InputMethod = 'zip' | 'url';

/**
 * Formulario de carga de repositorio de la Interfaz Web (Task 17.2).
 *
 * Permite iniciar un análisis aportando EXACTAMENTE una de las dos entradas
 * admitidas: la subida de un archivo ZIP (Requisito 1.1) o la introducción de
 * una `URL_GitHub` de un repositorio público (Requisito 15.1). Un conmutador
 * decide si se usa la inferencia por IA, cuya preferencia se conserva en el
 * backend (Requisito 3.3).
 *
 * Validación:
 * - Debe elegirse exactamente un método (ZIP o URL), nunca ambos ni ninguno.
 * - En modo ZIP, debe seleccionarse un archivo `.zip`.
 * - En modo URL, la URL es obligatoria (el backend valida que sea de GitHub).
 *
 * Ante un fallo de ingesta o de descarga (ZIP inválido, URL mal formada/no
 * GitHub, repo inaccesible, fallo de red), se muestra el error y se mantiene el
 * formulario para permitir reintentar la carga (Requisito 15.7).
 *
 * Todo el texto visible está en español (Requisito 10.5).
 */
@Component({
  selector: 'app-repo-upload',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="carga" aria-labelledby="titulo-carga">
      <h2 id="titulo-carga">Analizar un repositorio</h2>
      <p class="descripcion">
        Suba un archivo ZIP del proyecto o indique la URL de un repositorio
        público de GitHub. Solo debe elegir una de las dos opciones.
      </p>

      <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
        <fieldset class="metodo">
          <legend>Método de carga</legend>

          <label class="opcion">
            <input
              type="radio"
              name="metodo"
              value="zip"
              [checked]="method() === 'zip'"
              (change)="seleccionarMetodo('zip')"
            />
            <span>Subir archivo ZIP</span>
          </label>

          <label class="opcion">
            <input
              type="radio"
              name="metodo"
              value="url"
              [checked]="method() === 'url'"
              (change)="seleccionarMetodo('url')"
            />
            <span>URL de GitHub</span>
          </label>
        </fieldset>

        @if (method() === 'zip') {
          <label class="campo">
            <span>Archivo ZIP</span>
            <input
              type="file"
              accept=".zip,application/zip"
              (change)="onFileSelected($event)"
              [attr.aria-invalid]="zipInvalid()"
            />
          </label>
          @if (fileName()) {
            <p class="archivo-seleccionado">Archivo seleccionado: {{ fileName() }}</p>
          }
        }

        @if (method() === 'url') {
          <label class="campo">
            <span>URL del repositorio de GitHub</span>
            <input
              type="url"
              formControlName="url"
              placeholder="https://github.com/usuario/repositorio"
              autocomplete="off"
              [attr.aria-invalid]="urlInvalid()"
            />
          </label>
        }

        <label class="conmutador">
          <input type="checkbox" formControlName="useAI" />
          <span>Usar inteligencia artificial para enriquecer el análisis</span>
        </label>

        @if (validationMessage()) {
          <p class="error" role="alert">{{ validationMessage() }}</p>
        }

        @if (errorMessage()) {
          <div class="error-ingesta" role="alert">
            <p>{{ errorMessage() }}</p>
            <button type="button" class="reintentar" (click)="reintentar()">
              Reintentar
            </button>
          </div>
        }

        <button type="submit" [disabled]="submitting()">
          {{ submitting() ? 'Iniciando análisis…' : 'Iniciar análisis' }}
        </button>
      </form>
    </section>
  `,
  styles: [
    `
      .carga {
        width: 100%;
        max-width: 40rem;
        padding: 1.5rem;
        border: 1px solid #d0d0d0;
        border-radius: 0.5rem;
      }

      h2 {
        margin-top: 0;
        font-size: 1.25rem;
      }

      .descripcion {
        color: #555;
        margin-bottom: 1.25rem;
      }

      .metodo {
        border: 1px solid #d0d0d0;
        border-radius: 0.25rem;
        margin: 0 0 1rem;
        padding: 0.75rem;
      }

      .metodo legend {
        font-weight: 600;
        padding: 0 0.25rem;
      }

      .opcion {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.25rem 0;
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

      .campo input[type='url'] {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid #b0b0b0;
        border-radius: 0.25rem;
        font-size: 1rem;
      }

      .archivo-seleccionado {
        margin: -0.5rem 0 1rem;
        color: #333;
        font-size: 0.9rem;
      }

      .conmutador {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .error {
        color: #b00020;
        margin: 0.5rem 0 1rem;
      }

      .error-ingesta {
        border: 1px solid #b00020;
        border-radius: 0.25rem;
        padding: 0.75rem;
        margin-bottom: 1rem;
        background: #fdecea;
      }

      .error-ingesta p {
        color: #b00020;
        margin: 0 0 0.5rem;
      }

      .reintentar {
        padding: 0.4rem 0.75rem;
        border: 1px solid #b00020;
        border-radius: 0.25rem;
        background: #fff;
        color: #b00020;
        cursor: pointer;
      }

      button[type='submit'] {
        width: 100%;
        padding: 0.6rem;
        font-size: 1rem;
        border: none;
        border-radius: 0.25rem;
        background: #1a3c6e;
        color: #fff;
        cursor: pointer;
      }

      button[type='submit']:disabled {
        background: #7d93b3;
        cursor: not-allowed;
      }
    `,
  ],
})
export class RepoUploadComponent {
  private readonly fb = inject(FormBuilder);
  private readonly analysis = inject(AnalysisService);

  /** Emite el `jobId` cuando el análisis se ha aceptado (para el seguimiento 17.3). */
  readonly analysisStarted = output<string>();

  /** Método de entrada elegido: subida de ZIP o URL de GitHub. */
  readonly method = signal<InputMethod>('zip');

  /** Nombre del archivo ZIP seleccionado, para mostrarlo al usuario. */
  readonly fileName = signal<string | null>(null);

  /** Contenido del ZIP en base64 (lo que espera el backend), o null. */
  private readonly zipBase64 = signal<string | null>(null);

  /** Mensaje de validación local (entrada incompleta), en español. */
  readonly validationMessage = signal<string | null>(null);

  /** Mensaje de error de ingesta/servidor (permite reintentar), en español. */
  readonly errorMessage = signal<string | null>(null);

  /** Indica si hay una solicitud de análisis en curso. */
  readonly submitting = signal(false);

  /** Formulario reactivo: la URL y la opción de IA. El ZIP se gestiona aparte. */
  readonly form = this.fb.nonNullable.group({
    url: [''],
    useAI: [false],
  });

  /** Verdadero si el modo ZIP no tiene un archivo seleccionado y se intentó enviar. */
  readonly zipInvalid = computed(
    () => this.method() === 'zip' && this.validationMessage() !== null && this.zipBase64() === null,
  );

  /** Verdadero si el modo URL no tiene URL y se intentó enviar. */
  readonly urlInvalid = computed(
    () =>
      this.method() === 'url' &&
      this.validationMessage() !== null &&
      this.form.controls.url.value.trim().length === 0,
  );

  /** Cambia el método de entrada y limpia el estado de la opción no elegida. */
  seleccionarMetodo(method: InputMethod): void {
    this.method.set(method);
    this.validationMessage.set(null);
    this.errorMessage.set(null);
    if (method === 'zip') {
      this.form.controls.url.setValue('');
    } else {
      this.fileName.set(null);
      this.zipBase64.set(null);
    }
  }

  /** Lee el archivo ZIP seleccionado y lo codifica en base64. */
  onFileSelected(event: Event): void {
    this.validationMessage.set(null);
    this.errorMessage.set(null);
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file === null) {
      this.fileName.set(null);
      this.zipBase64.set(null);
      return;
    }
    this.fileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        // `readAsDataURL` produce "data:...;base64,XXXX"; se conserva solo la
        // parte base64 que el backend decodifica.
        const comma = result.indexOf(',');
        this.zipBase64.set(comma >= 0 ? result.slice(comma + 1) : result);
      }
    };
    reader.onerror = () => {
      this.zipBase64.set(null);
      this.errorMessage.set('No se pudo leer el archivo seleccionado. Inténtelo de nuevo.');
    };
    reader.readAsDataURL(file);
  }

  /** Valida la entrada y solicita la creación del análisis. */
  onSubmit(): void {
    this.validationMessage.set(null);
    this.errorMessage.set(null);

    const input = this.buildInput();
    if (input === null) {
      return;
    }

    this.submitting.set(true);
    this.analysis.createAnalysis(input, this.form.controls.useAI.value).subscribe((result) => {
      this.submitting.set(false);
      if (result.ok) {
        this.analysisStarted.emit(result.jobId);
        return;
      }
      // Fallo de ingesta/descarga: se informa y el formulario permanece para
      // permitir reintentar la carga (Requisito 15.7).
      this.errorMessage.set(result.message);
    });
  }

  /** Reintenta el envío con la misma entrada tras un fallo (Requisito 15.7). */
  reintentar(): void {
    this.onSubmit();
  }

  /**
   * Construye la entrada de análisis validando que se aporte EXACTAMENTE una de
   * las dos opciones. Devuelve `null` y fija un mensaje de validación en español
   * si la entrada es incompleta.
   */
  private buildInput(): AnalysisInput | null {
    if (this.method() === 'zip') {
      const zipBase64 = this.zipBase64();
      if (zipBase64 === null || zipBase64.length === 0) {
        this.validationMessage.set('Seleccione un archivo ZIP para analizar.');
        return null;
      }
      return { kind: 'zip', zipBase64, fileName: this.fileName() ?? 'repositorio.zip' };
    }

    const url = this.form.controls.url.value.trim();
    if (url.length === 0) {
      this.validationMessage.set('Introduzca la URL de un repositorio de GitHub.');
      return null;
    }
    return { kind: 'url', url };
  }
}
