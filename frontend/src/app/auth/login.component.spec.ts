import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService, LoginResult } from './auth.service';

describe('LoginComponent', () => {
  let loginSpy: jasmine.Spy;

  function setup(): { component: LoginComponent; element: HTMLElement } {
    loginSpy = jasmine.createSpy('login');
    const authStub: Partial<AuthService> = { login: loginSpy };
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authStub }],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  }

  it('debería crearse y mostrar texto en español', () => {
    const { component, element } = setup();
    expect(component).toBeTruthy();
    expect(element.querySelector('h1')?.textContent).toContain('Iniciar sesión');
    expect(element.querySelector('button')?.textContent).toContain('Acceder');
  });

  it('no debería llamar al backend con formulario inválido', () => {
    const { component } = setup();
    component.onSubmit();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('usuario y contraseña');
  });

  it('debería navegar al área protegida con credenciales válidas', () => {
    const { component } = setup();
    const okResult: LoginResult = {
      ok: true,
      session: { token: 't', userId: 'u', username: 'ana', expiresAt: '' },
    };
    loginSpy.and.returnValue(of(okResult));
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl');

    component.form.setValue({ username: 'ana', password: 'secreto' });
    component.onSubmit();

    expect(loginSpy).toHaveBeenCalledWith('ana', 'secreto');
    expect(navSpy).toHaveBeenCalledWith('/');
    expect(component.errorMessage()).toBeNull();
  });

  it('debería mostrar mensaje genérico con credenciales inválidas', () => {
    const { component } = setup();
    const failResult: LoginResult = { ok: false, message: 'Usuario o contraseña incorrectos.' };
    loginSpy.and.returnValue(of(failResult));

    component.form.setValue({ username: 'ana', password: 'mala' });
    component.onSubmit();

    expect(component.errorMessage()).toBe('Usuario o contraseña incorrectos.');
  });
});
