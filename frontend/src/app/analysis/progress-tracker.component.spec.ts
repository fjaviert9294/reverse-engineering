import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ProgressTrackerComponent } from './progress-tracker.component';
import { AnalysisService, ProgressSnapshot } from './analysis.service';

describe('ProgressTrackerComponent', () => {
  let pollSpy: jasmine.Spy;
  let stream: Subject<ProgressSnapshot>;

  function setup(jobId = 'job-1'): {
    fixture: ComponentFixture<ProgressTrackerComponent>;
    component: ProgressTrackerComponent;
    element: HTMLElement;
  } {
    stream = new Subject<ProgressSnapshot>();
    pollSpy = jasmine.createSpy('pollStatus').and.returnValue(stream.asObservable());
    const analysisStub: Partial<AnalysisService> = { pollStatus: pollSpy };

    TestBed.configureTestingModule({
      imports: [ProgressTrackerComponent],
      providers: [{ provide: AnalysisService, useValue: analysisStub }],
    });
    const fixture = TestBed.createComponent(ProgressTrackerComponent);
    fixture.componentRef.setInput('jobId', jobId);
    fixture.detectChanges();
    return {
      fixture,
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('sondea el estado del job indicado (Req 12.1)', () => {
    const { component } = setup('job-77');
    expect(pollSpy).toHaveBeenCalledWith('job-77');
    expect(component.snapshot().estado).toBe('consultando');
  });

  it('muestra el porcentaje y la etapa mientras el análisis avanza (Req 12.1)', () => {
    const { fixture, element } = setup();
    stream.next({
      estado: 'en_curso',
      jobStatus: 'EN_PROGRESO',
      progress: 45,
      stage: 'ANALISIS_ESTATICO',
    });
    fixture.detectChanges();

    expect(element.querySelector('.porcentaje')?.textContent).toContain('45%');
    expect(element.querySelector('.etapa')?.textContent).toContain('análisis estático');
    const bar = element.querySelector('.barra') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
  });

  it('indica cuando el análisis está en cola (Req 12.1)', () => {
    const { fixture, element } = setup();
    stream.next({ estado: 'en_curso', jobStatus: 'EN_COLA', progress: 0, stage: 'INGESTA' });
    fixture.detectChanges();
    expect(element.querySelector('.etapa')?.textContent).toContain('en cola');
  });

  it('notifica 100% y emite completed al completarse (Req 12.4)', () => {
    const { fixture, component, element } = setup('job-9');
    const emitSpy = spyOn(component.completed, 'emit');

    stream.next({ estado: 'completado', progress: 100 });
    fixture.detectChanges();

    expect(element.querySelector('.completado')?.textContent).toContain('se completó');
    expect(element.querySelector('.porcentaje')?.textContent).toContain('100%');
    expect(emitSpy).toHaveBeenCalledWith('job-9');
  });

  it('informa el fallo y deja de mostrar progreso (Req 12.5)', () => {
    const { fixture, element } = setup();
    stream.next({ estado: 'fallido', message: 'El análisis no pudo completarse.', errorModule: 'INGESTA' });
    fixture.detectChanges();

    const fallo = element.querySelector('.fallido');
    expect(fallo?.textContent).toContain('no pudo completarse');
    expect(fallo?.textContent).toContain('INGESTA');
    // Ya no se muestra la barra de progreso en curso.
    expect(element.querySelector('.etapa')).toBeNull();
  });

  it('no emite completed cuando el análisis falla', () => {
    const { fixture, component } = setup();
    const emitSpy = spyOn(component.completed, 'emit');
    stream.next({ estado: 'fallido', message: 'El análisis no pudo completarse.', errorModule: null });
    fixture.detectChanges();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
