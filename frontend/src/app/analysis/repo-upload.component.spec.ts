import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RepoUploadComponent } from './repo-upload.component';
import { AnalysisService, CreateAnalysisResult } from './analysis.service';

describe('RepoUploadComponent', () => {
  let createSpy: jasmine.Spy;

  function setup(): {
    component: RepoUploadComponent;
    element: HTMLElement;
    detect: () => void;
  } {
    createSpy = jasmine.createSpy('createAnalysis');
    const analysisStub: Partial<AnalysisService> = { createAnalysis: createSpy };
    TestBed.configureTestingModule({
      imports: [RepoUploadComponent],
      providers: [{ provide: AnalysisService, useValue: analysisStub }],
    });
    const fixture = TestBed.createComponent(RepoUploadComponent);
    fixture.detectChanges();
    return {
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  it('debería crearse y mostrar texto en español (Req 10.5)', () => {
    const { component, element } = setup();
    expect(component).toBeTruthy();
    expect(element.querySelector('h2')?.textContent).toContain('Analizar un repositorio');
    expect(element.querySelector('button[type="submit"]')?.textContent).toContain(
      'Iniciar análisis',
    );
  });

  it('no envía si el modo ZIP no tiene archivo seleccionado', () => {
    const { component } = setup();
    expect(component.method()).toBe('zip');
    component.onSubmit();
    expect(createSpy).not.toHaveBeenCalled();
    expect(component.validationMessage()).toContain('archivo ZIP');
  });

  it('no envía si el modo URL no tiene URL (exactamente una entrada)', () => {
    const { component } = setup();
    component.seleccionarMetodo('url');
    component.onSubmit();
    expect(createSpy).not.toHaveBeenCalled();
    expect(component.validationMessage()).toContain('URL de un repositorio');
  });

  it('cambiar de método limpia la entrada del método anterior', () => {
    const { component } = setup();
    component.form.controls.url.setValue('https://github.com/a/b');
    component.seleccionarMetodo('zip');
    expect(component.form.controls.url.value).toBe('');
  });

  it('envía la URL y la opción de IA, y emite el jobId al aceptarse', () => {
    const { component } = setup();
    const emitSpy = spyOn(component.analysisStarted, 'emit');
    const okResult: CreateAnalysisResult = { ok: true, jobId: 'job-9' };
    createSpy.and.returnValue(of(okResult));

    component.seleccionarMetodo('url');
    component.form.controls.url.setValue('https://github.com/a/b');
    component.form.controls.useAI.setValue(true);
    component.onSubmit();

    expect(createSpy).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://github.com/a/b' },
      true,
    );
    expect(emitSpy).toHaveBeenCalledWith('job-9');
    expect(component.errorMessage()).toBeNull();
  });

  it('muestra el error de ingesta y permite reintentar ante fallo (Req 15.7)', () => {
    const { component, element, detect } = setup();
    const failResult: CreateAnalysisResult = {
      ok: false,
      message: 'No se pudo conectar con el servidor. Inténtelo de nuevo.',
    };
    createSpy.and.returnValue(of(failResult));

    component.seleccionarMetodo('url');
    component.form.controls.url.setValue('https://github.com/a/b');
    component.onSubmit();
    detect();

    expect(component.errorMessage()).toContain('No se pudo conectar');
    const retryBtn = element.querySelector('.reintentar') as HTMLButtonElement | null;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.textContent).toContain('Reintentar');

    // Reintentar vuelve a invocar el envío con la misma entrada.
    createSpy.calls.reset();
    createSpy.and.returnValue(of({ ok: true, jobId: 'job-x' } as CreateAnalysisResult));
    component.reintentar();
    expect(createSpy).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://github.com/a/b' },
      false,
    );
  });
});
