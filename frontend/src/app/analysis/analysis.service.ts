import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  map,
  catchError,
  of,
  switchMap,
  timer,
  takeWhile,
  distinctUntilChanged,
} from 'rxjs';
import { AnalysisResult } from './analysis-result.model';

/**
 * Servicio de análisis de la Interfaz Web (Task 17.2).
 *
 * Consume los endpoints del backend relacionados con el inicio de un análisis:
 *
 * - `POST /analyses` — crea un análisis a partir de EXACTAMENTE una entrada: un
 *   archivo ZIP (enviado en base64) o una `URL_GitHub`, junto con la opción
 *   `useAI`. Responde `202` con `{ jobId }` sin bloquear al usuario
 *   (Requisitos 1.1, 15.1). Los errores de ingesta (ZIP inválido, URL mal
 *   formada/no-GitHub, repo inaccesible, fallo de red) se traducen a mensajes en
 *   español para mostrarlos al usuario y permitir reintentar (Requisito 15.7).
 * - `PUT /preferences/ai` — activa/desactiva y conserva la preferencia de uso de
 *   IA del usuario autenticado (Requisito 3.3).
 *
 * El servicio nunca transporta código fuente persistente: el ZIP es un contenido
 * transitorio que el backend deposita en almacenamiento efímero, y la
 * `URL_GitHub` es solo metadato de origen.
 */

/** Entrada de análisis: exactamente una de las dos formas admitidas. */
export type AnalysisInput =
  | { kind: 'zip'; zipBase64: string; fileName: string }
  | { kind: 'url'; url: string };

/** Resultado de solicitar la creación de un análisis. */
export type CreateAnalysisResult =
  | { ok: true; jobId: string }
  | { ok: false; message: string };

/** Resultado de conservar la preferencia de uso de IA. */
export type SavePreferenceResult =
  | { ok: true; useAI: boolean }
  | { ok: false; message: string };

/**
 * Estado de ejecución de un job de análisis (Requisito 12.x).
 * Coincide con el enum `JobStatus` del backend.
 */
export type JobStatus = 'EN_COLA' | 'EN_PROGRESO' | 'COMPLETADO' | 'FALLIDO';

/**
 * Etapa actual del pipeline de análisis. Coincide con el enum `AnalysisStage`
 * del backend.
 */
export type AnalysisStage =
  | 'INGESTA'
  | 'ANALISIS_ESTATICO'
  | 'INFERENCIA_IA'
  | 'PERSISTENCIA'
  | 'FINALIZADO';

/**
 * Instantánea del progreso de un análisis, tal como la percibe la vista.
 *
 * - `estado='consultando'`: aún no hay una respuesta útil del servidor pero el
 *   seguimiento sigue activo (p. ej. tras un fallo transitorio de red durante el
 *   polling); se conserva el estado previo (Requisito 12.5).
 * - `estado='en_curso'`: el análisis está en cola o en ejecución; se muestra el
 *   porcentaje 0-100 y la etapa actual (Requisito 12.1).
 * - `estado='completado'`: el análisis finalizó correctamente; progreso 100
 *   (Requisito 12.4).
 * - `estado='fallido'`: el análisis no pudo completarse; se detiene el polling y
 *   se informa con un mensaje (Requisito 12.5).
 */
export type ProgressSnapshot =
  | { estado: 'consultando' }
  | {
      estado: 'en_curso';
      jobStatus: 'EN_COLA' | 'EN_PROGRESO';
      progress: number;
      stage: AnalysisStage;
    }
  | { estado: 'completado'; progress: 100 }
  | { estado: 'fallido'; message: string; errorModule: string | null };

/** Intervalo de sondeo del estado del job, en milisegundos (Requisito 12.1). */
export const INTERVALO_POLLING_MS = 2000;

/** Mensaje mostrado cuando un análisis falla (Requisito 12.5). */
export const MENSAJE_ANALISIS_FALLIDO =
  'El análisis no pudo completarse.';

/** Mensaje genérico ante errores de red o del servidor, en español. */
export const MENSAJE_ERROR_CONEXION =
  'No se pudo conectar con el servidor. Inténtelo de nuevo.';

/** Mensaje genérico ante una respuesta inesperada del servidor, en español. */
export const MENSAJE_ERROR_INESPERADO =
  'Ocurrió un error inesperado al iniciar el análisis. Inténtelo de nuevo.';

/** Mensaje cuando el resultado solicitado no existe (404) (Requisitos 2.5, 10.4). */
export const MENSAJE_RESULTADO_NO_ENCONTRADO =
  'No se encontró el resultado del análisis solicitado.';

/** Mensaje cuando la respuesta del servidor no contiene un resultado válido. */
export const MENSAJE_RESULTADO_NO_DISPONIBLE =
  'No hay un resultado de análisis disponible en este momento.';

/** Resultado de recuperar el `Resultado_Analisis` persistido. */
export type GetResultOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; message: string };

/** Resultado de solicitar la exportación a Markdown. */
export type ExportOutcome =
  | { ok: true; filename: string; mediaType: string; content: string }
  | { ok: false; message: string };

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly http = inject(HttpClient);

  /**
   * Solicita la creación de un análisis. Antes de enviar, si el usuario indicó
   * el uso de IA, conserva la preferencia mediante `PUT /preferences/ai`
   * (Requisito 3.3) y a continuación crea el análisis con esa opción.
   *
   * Ante cualquier fallo (validación de entrada rechazada por el backend, repo
   * inaccesible, fallo de red) devuelve `{ ok: false, message }` con un texto en
   * español, de modo que la vista pueda mostrarlo y permitir reintentar
   * (Requisito 15.7).
   */
  createAnalysis(input: AnalysisInput, useAI: boolean): Observable<CreateAnalysisResult> {
    // Se conserva la preferencia de IA antes de crear el análisis (Req 3.3). Si
    // el guardado de la preferencia falla, no se aborta el análisis: la opción
    // viaja igualmente en el cuerpo de `POST /analyses`, que es lo que determina
    // el modo del job. El error de preferencia se ignora silenciosamente para no
    // bloquear el flujo principal.
    return this.savePreference(useAI).pipe(
      switchMap(() => this.postAnalysis(input, useAI)),
    );
  }

  /**
   * Conserva la preferencia de uso de IA del usuario autenticado mediante
   * `PUT /preferences/ai` (Requisito 3.3).
   */
  savePreference(useAI: boolean): Observable<SavePreferenceResult> {
    return this.http.put<PreferenceBackendResponse>('/preferences/ai', { useAI }).pipe(
      map((response): SavePreferenceResult => {
        if (response.status === 'ok') {
          return { ok: true, useAI: response.useAI ?? useAI };
        }
        return { ok: false, message: this.messageFromResponse(response) };
      }),
      catchError((error: unknown) =>
        of<SavePreferenceResult>({ ok: false, message: this.messageFromError(error) }),
      ),
    );
  }

  /**
   * Realiza el seguimiento del progreso de un análisis mediante consulta
   * periódica (polling) de `GET /analyses/{id}/status`, con una actualización al
   * menos cada 2 segundos (Requisitos 12.1, 12.4, 12.5).
   *
   * El flujo emite una `ProgressSnapshot` por cada consulta y se completa
   * automáticamente cuando el análisis termina, ya sea con éxito
   * (`estado='completado'`, progreso 100 — Requisito 12.4) o con fallo
   * (`estado='fallido'` con un mensaje — Requisito 12.5). Mientras el análisis
   * sigue en cola o en ejecución, emite `estado='en_curso'` con el porcentaje y
   * la etapa (Requisito 12.1).
   *
   * Ante un fallo transitorio durante el sondeo (p. ej. red), no se detiene el
   * seguimiento: se emite `estado='consultando'` para conservar el estado previo
   * mostrado y el polling continúa en el siguiente ciclo (Requisito 12.5). Solo
   * un estado `FALLIDO` reportado por el backend detiene el seguimiento.
   *
   * `distinctUntilChanged` evita re-emitir instantáneas idénticas consecutivas,
   * de modo que la vista solo reacciona ante cambios reales de progreso/estado.
   */
  pollStatus(jobId: string): Observable<ProgressSnapshot> {
    return timer(0, INTERVALO_POLLING_MS).pipe(
      switchMap(() => this.fetchStatusOnce(jobId)),
      // Se sigue emitiendo hasta (e incluyendo) el estado terminal.
      takeWhile((snapshot) => !this.esEstadoTerminal(snapshot), true),
      distinctUntilChanged(
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
      ),
    );
  }

  /**
   * Consulta una vez `GET /analyses/{id}/status` y traduce la respuesta del
   * backend a una `ProgressSnapshot`. Un fallo de la consulta no propaga error:
   * devuelve `estado='consultando'` para que el polling continúe conservando el
   * estado previo (Requisito 12.5).
   */
  private fetchStatusOnce(jobId: string): Observable<ProgressSnapshot> {
    const encodedId = encodeURIComponent(jobId);
    return this.http.get<StatusBackendResponse>(`/analyses/${encodedId}/status`).pipe(
      map((response) => this.snapshotFromResponse(response)),
      catchError(() => of<ProgressSnapshot>({ estado: 'consultando' })),
    );
  }

  /** Traduce la respuesta de estado del backend a una `ProgressSnapshot`. */
  private snapshotFromResponse(response: StatusBackendResponse): ProgressSnapshot {
    if (response.jobStatus === 'COMPLETADO') {
      return { estado: 'completado', progress: 100 };
    }
    if (response.jobStatus === 'FALLIDO') {
      return {
        estado: 'fallido',
        message: MENSAJE_ANALISIS_FALLIDO,
        errorModule: response.errorModule ?? null,
      };
    }
    return {
      estado: 'en_curso',
      jobStatus: response.jobStatus,
      progress: this.clampProgress(response.progress),
      stage: response.stage,
    };
  }

  /** Restringe el progreso al rango 0-100 (Requisito 12.1, Property 24). */
  private clampProgress(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  /** Indica si una instantánea representa un estado terminal (fin del polling). */
  private esEstadoTerminal(snapshot: ProgressSnapshot): boolean {
    return snapshot.estado === 'completado' || snapshot.estado === 'fallido';
  }

  /** Envía `POST /analyses` con la entrada seleccionada y la opción de IA. */
  private postAnalysis(input: AnalysisInput, useAI: boolean): Observable<CreateAnalysisResult> {
    const body =
      input.kind === 'zip'
        ? { zip: input.zipBase64, useAI }
        : { url: input.url, useAI };

    return this.http.post<CreateAnalysisBackendResponse>('/analyses', body).pipe(
      map((response): CreateAnalysisResult => {
        if (typeof response.jobId === 'string' && response.jobId.length > 0) {
          return { ok: true, jobId: response.jobId };
        }
        return { ok: false, message: MENSAJE_ERROR_INESPERADO };
      }),
      catchError((error: unknown) =>
        of<CreateAnalysisResult>({ ok: false, message: this.messageFromError(error) }),
      ),
    );
  }

  /**
   * Traduce un error HTTP a un mensaje en español para el usuario. Si el backend
   * envió un mensaje (`{ status, message }`), se prioriza porque ya describe la
   * causa de la ingesta (ZIP inválido, URL mal formada, etc.) en español. Un
   * error sin respuesta del servidor (status 0) se interpreta como fallo de red
   * y muestra el mensaje de conexión, tras el cual el usuario puede reintentar
   * (Requisito 15.7).
   */
  private messageFromError(error: unknown): string {
    const err = error as { status?: number; error?: unknown };
    const backendMessage = this.extractBackendMessage(err.error);
    if (backendMessage !== null) {
      return backendMessage;
    }
    // Sin cuerpo útil: distinguir fallo de red (status 0) del resto.
    if (err.status === 0 || err.status === undefined) {
      return MENSAJE_ERROR_CONEXION;
    }
    return MENSAJE_ERROR_INESPERADO;
  }

  /** Extrae `message` del cuerpo de error del backend, si existe y es texto. */
  private extractBackendMessage(errorBody: unknown): string | null {
    if (errorBody !== null && typeof errorBody === 'object' && 'message' in errorBody) {
      const message = (errorBody as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }
    return null;
  }

  /** Extrae un mensaje de una respuesta 2xx con estado distinto de `ok`. */
  private messageFromResponse(response: { message?: unknown }): string {
    if (typeof response.message === 'string' && response.message.trim().length > 0) {
      return response.message;
    }
    return MENSAJE_ERROR_INESPERADO;
  }

  /**
   * Recupera el `Resultado_Analisis` persistido mediante `GET /analyses/{id}`
   * (Requisitos 2.3, 2.5). Devuelve `{ ok: true, result }` con el resultado, o
   * `{ ok: false, message }` con un texto en español cuando no existe (404) o
   * ante un fallo de red/servidor, de modo que el dashboard pueda mostrar el
   * mensaje de ausencia de resultados manteniendo visibles las secciones
   * (Requisito 10.4).
   */
  getResult(id: string): Observable<GetResultOutcome> {
    const encodedId = encodeURIComponent(id);
    return this.http.get<GetResultBackendResponse>(`/analyses/${encodedId}`).pipe(
      map((response): GetResultOutcome => {
        if (response.status === 'ok' && response.result) {
          return { ok: true, result: response.result };
        }
        return { ok: false, message: MENSAJE_RESULTADO_NO_DISPONIBLE };
      }),
      catchError((error: unknown) => {
        const err = error as { status?: number };
        const message =
          err.status === 404 ? MENSAJE_RESULTADO_NO_ENCONTRADO : this.messageFromError(error);
        return of<GetResultOutcome>({ ok: false, message });
      }),
    );
  }

  /**
   * Solicita la exportación a Markdown del resultado mediante
   * `POST /analyses/{id}/export` (Requisitos 11.1, 11.2). Ante éxito devuelve el
   * nombre de archivo y el contenido Markdown para que la vista lo ofrezca como
   * descarga; ante fallo (resultado vacío o error de generación) devuelve un
   * mensaje en español (Requisitos 11.3, 11.4).
   */
  exportMarkdown(id: string): Observable<ExportOutcome> {
    const encodedId = encodeURIComponent(id);
    return this.http
      .post<ExportBackendResponse>(`/analyses/${encodedId}/export`, {})
      .pipe(
        map((response): ExportOutcome => {
          if (response.status === 'ok' && typeof response.content === 'string') {
            return {
              ok: true,
              filename: response.filename ?? 'analisis.md',
              mediaType: response.mediaType ?? 'text/markdown',
              content: response.content,
            };
          }
          return { ok: false, message: this.messageFromResponse(response) };
        }),
        catchError((error: unknown) =>
          of<ExportOutcome>({ ok: false, message: this.messageFromError(error) }),
        ),
      );
  }
}

/** Forma de la respuesta de `POST /analyses` del backend (Task 15.2). */
interface CreateAnalysisBackendResponse {
  status: string;
  jobId?: string;
  message?: string;
}

/** Forma de la respuesta de `PUT /preferences/ai` del backend (Task 15.1). */
interface PreferenceBackendResponse {
  status: string;
  useAI?: boolean;
  message?: string;
}

/** Forma de la respuesta de `GET /analyses/{id}/status` del backend (Task 15.2). */
interface StatusBackendResponse {
  status: string;
  jobId: string;
  jobStatus: JobStatus;
  progress: number;
  stage: AnalysisStage;
  errorModule?: string | null;
}

/** Forma de la respuesta de `GET /analyses/{id}` del backend (Task 15.2). */
interface GetResultBackendResponse {
  status: string;
  result?: AnalysisResult;
  message?: string;
}

/** Forma de la respuesta de `POST /analyses/{id}/export` del backend (Task 15.2). */
interface ExportBackendResponse {
  status: string;
  filename?: string;
  mediaType?: string;
  content?: string;
  message?: string;
}
