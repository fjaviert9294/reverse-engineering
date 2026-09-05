import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import {
  AnalysisService,
  MENSAJE_ERROR_CONEXION,
  MENSAJE_ERROR_INESPERADO,
  MENSAJE_ANALISIS_FALLIDO,
  ProgressSnapshot,
} from './analysis.service';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalysisService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('conserva la preferencia de IA y crea el análisis con URL (Req 3.3, 15.1)', () => {
    let result: { ok: boolean; jobId?: string } | undefined;
    service
      .createAnalysis({ kind: 'url', url: 'https://github.com/a/b' }, true)
      .subscribe((r) => (result = r as typeof result));

    const prefReq = httpMock.expectOne('/preferences/ai');
    expect(prefReq.request.method).toBe('PUT');
    expect(prefReq.request.body).toEqual({ useAI: true });
    prefReq.flush({ status: 'ok', useAI: true });

    const analysisReq = httpMock.expectOne('/analyses');
    expect(analysisReq.request.method).toBe('POST');
    expect(analysisReq.request.body).toEqual({ url: 'https://github.com/a/b', useAI: true });
    analysisReq.flush({ status: 'aceptado', jobId: 'job-1' }, { status: 202, statusText: 'Accepted' });

    expect(result).toEqual({ ok: true, jobId: 'job-1' });
  });

  it('envía el ZIP en base64 al crear el análisis (Req 1.1)', () => {
    let result: { ok: boolean } | undefined;
    service
      .createAnalysis({ kind: 'zip', zipBase64: 'UEsDBA==', fileName: 'r.zip' }, false)
      .subscribe((r) => (result = r as typeof result));

    httpMock.expectOne('/preferences/ai').flush({ status: 'ok', useAI: false });

    const analysisReq = httpMock.expectOne('/analyses');
    expect(analysisReq.request.body).toEqual({ zip: 'UEsDBA==', useAI: false });
    analysisReq.flush({ status: 'aceptado', jobId: 'job-2' }, { status: 202, statusText: 'Accepted' });

    expect(result?.ok).toBeTrue();
  });

  it('muestra el mensaje del backend ante URL de GitHub inválida (Req 15.5)', () => {
    let result: { ok: boolean; message?: string } | undefined;
    service
      .createAnalysis({ kind: 'url', url: 'ftp://no-github' }, false)
      .subscribe((r) => (result = r as typeof result));

    httpMock.expectOne('/preferences/ai').flush({ status: 'ok', useAI: false });

    httpMock.expectOne('/analyses').flush(
      { status: 'url_github_invalida', message: 'La URL de GitHub está mal formada.' },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(result?.ok).toBeFalse();
    expect(result?.message).toBe('La URL de GitHub está mal formada.');
  });

  it('muestra mensaje de conexión ante fallo de red (Req 15.7)', () => {
    let result: { ok: boolean; message?: string } | undefined;
    service
      .createAnalysis({ kind: 'url', url: 'https://github.com/a/b' }, false)
      .subscribe((r) => (result = r as typeof result));

    httpMock.expectOne('/preferences/ai').flush({ status: 'ok', useAI: false });

    httpMock.expectOne('/analyses').error(new ProgressEvent('network error'), { status: 0 });

    expect(result?.ok).toBeFalse();
    expect(result?.message).toBe(MENSAJE_ERROR_CONEXION);
  });

  it('devuelve error inesperado si la respuesta no trae jobId', () => {
    let result: { ok: boolean; message?: string } | undefined;
    service
      .createAnalysis({ kind: 'url', url: 'https://github.com/a/b' }, false)
      .subscribe((r) => (result = r as typeof result));

    httpMock.expectOne('/preferences/ai').flush({ status: 'ok', useAI: false });
    httpMock.expectOne('/analyses').flush({ status: 'aceptado' }, { status: 202, statusText: 'Accepted' });

    expect(result?.ok).toBeFalse();
    expect(result?.message).toBe(MENSAJE_ERROR_INESPERADO);
  });

  it('crea el análisis aunque falle el guardado de la preferencia', () => {
    let result: { ok: boolean } | undefined;
    service
      .createAnalysis({ kind: 'url', url: 'https://github.com/a/b' }, true)
      .subscribe((r) => (result = r as typeof result));

    // La preferencia falla, pero el flujo continúa (no bloquea el análisis).
    httpMock.expectOne('/preferences/ai').error(new ProgressEvent('error'), { status: 500 });

    const analysisReq = httpMock.expectOne('/analyses');
    analysisReq.flush({ status: 'aceptado', jobId: 'job-3' }, { status: 202, statusText: 'Accepted' });

    expect(result?.ok).toBeTrue();
  });

  describe('pollStatus (Req 12.1, 12.4, 12.5)', () => {
    const STATUS_URL = '/analyses/job-1/status';

    function flushStatus(body: Partial<{
      jobStatus: string;
      progress: number;
      stage: string;
      errorModule: string | null;
    }>): void {
      httpMock.expectOne(STATUS_URL).flush({
        status: 'ok',
        jobId: 'job-1',
        jobStatus: 'EN_PROGRESO',
        progress: 0,
        stage: 'INGESTA',
        errorModule: null,
        ...body,
      });
    }

    it('consulta el estado al menos cada 2 segundos (Req 12.1)', fakeAsync(() => {
      const snapshots: ProgressSnapshot[] = [];
      const sub = service.pollStatus('job-1').subscribe((s) => snapshots.push(s));

      // Primera consulta inmediata (timer arranca en 0, se libera con tick).
      tick(0);
      flushStatus({ jobStatus: 'EN_PROGRESO', progress: 20, stage: 'INGESTA' });
      // Tras 2 s, se dispara la segunda consulta.
      tick(2000);
      flushStatus({ jobStatus: 'EN_PROGRESO', progress: 60, stage: 'ANALISIS_ESTATICO' });

      expect(snapshots.length).toBe(2);
      expect(snapshots[0]).toEqual({
        estado: 'en_curso',
        jobStatus: 'EN_PROGRESO',
        progress: 20,
        stage: 'INGESTA',
      });
      expect(snapshots[1]).toEqual({
        estado: 'en_curso',
        jobStatus: 'EN_PROGRESO',
        progress: 60,
        stage: 'ANALISIS_ESTATICO',
      });

      // Al desuscribirse se cancela el timer y cualquier consulta en curso.
      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('notifica 100% y completa al finalizar correctamente (Req 12.4)', fakeAsync(() => {
      const snapshots: ProgressSnapshot[] = [];
      let completed = false;
      service.pollStatus('job-1').subscribe({
        next: (s) => snapshots.push(s),
        complete: () => (completed = true),
      });

      tick(0);
      flushStatus({ jobStatus: 'EN_PROGRESO', progress: 80, stage: 'PERSISTENCIA' });
      tick(2000);
      flushStatus({ jobStatus: 'COMPLETADO', progress: 100, stage: 'FINALIZADO' });

      const last = snapshots[snapshots.length - 1];
      expect(last).toEqual({ estado: 'completado', progress: 100 });
      expect(completed).toBeTrue();

      // El polling se detuvo: no debe haber más peticiones tras completarse.
      tick(2000);
      httpMock.expectNone(STATUS_URL);
    }));

    it('detiene el polling e informa el fallo, conservando estado (Req 12.5)', fakeAsync(() => {
      const snapshots: ProgressSnapshot[] = [];
      let completed = false;
      service.pollStatus('job-1').subscribe({
        next: (s) => snapshots.push(s),
        complete: () => (completed = true),
      });

      tick(0);
      flushStatus({ jobStatus: 'FALLIDO', progress: 30, stage: 'ANALISIS_ESTATICO', errorModule: 'ANALISIS_ESTATICO' });

      const last = snapshots[snapshots.length - 1];
      expect(last).toEqual({
        estado: 'fallido',
        message: MENSAJE_ANALISIS_FALLIDO,
        errorModule: 'ANALISIS_ESTATICO',
      });
      expect(completed).toBeTrue();

      tick(2000);
      httpMock.expectNone(STATUS_URL);
    }));

    it('ante fallo transitorio de red emite "consultando" y sigue sondeando (Req 12.5)', fakeAsync(() => {
      const snapshots: ProgressSnapshot[] = [];
      const sub = service.pollStatus('job-1').subscribe((s) => snapshots.push(s));

      // Fallo de red en la primera consulta: no debe abortar el flujo.
      tick(0);
      httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'), { status: 0 });
      expect(snapshots[0]).toEqual({ estado: 'consultando' });

      // El siguiente ciclo sí obtiene una respuesta útil.
      tick(2000);
      flushStatus({ jobStatus: 'EN_PROGRESO', progress: 50, stage: 'ANALISIS_ESTATICO' });
      expect(snapshots[snapshots.length - 1]).toEqual({
        estado: 'en_curso',
        jobStatus: 'EN_PROGRESO',
        progress: 50,
        stage: 'ANALISIS_ESTATICO',
      });

      sub.unsubscribe();
      discardPeriodicTasks();
    }));

    it('restringe el progreso al rango 0-100 (Req 12.1, Property 24)', fakeAsync(() => {
      const snapshots: ProgressSnapshot[] = [];
      const sub = service.pollStatus('job-1').subscribe((s) => snapshots.push(s));

      tick(0);
      flushStatus({ jobStatus: 'EN_PROGRESO', progress: 150, stage: 'INGESTA' });
      const snap = snapshots[0];
      expect(snap.estado).toBe('en_curso');
      if (snap.estado === 'en_curso') {
        expect(snap.progress).toBe(100);
      }

      sub.unsubscribe();
      discardPeriodicTasks();
    }));
  });
});
