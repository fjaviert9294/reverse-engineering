import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  AuthService,
  MENSAJE_CREDENCIALES_INVALIDAS,
  MENSAJE_ERROR_CONEXION,
} from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('debería empezar sin sesión', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
  });

  it('debería establecer la sesión con credenciales válidas', (done) => {
    service.login('ana', 'secreto').subscribe((result) => {
      expect(result.ok).toBe(true);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getToken()).toBe('tok-123');
      expect(service.session()?.username).toBe('ana');
      done();
    });

    const req = httpMock.expectOne('/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'ana', password: 'secreto' });
    req.flush({
      status: 'ok',
      token: 'tok-123',
      userId: 'u1',
      username: 'ana',
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
  });

  it('debería devolver mensaje genérico ante 401 sin establecer sesión', (done) => {
    service.login('ana', 'mala').subscribe((result) => {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);
      }
      expect(service.isAuthenticated()).toBe(false);
      done();
    });

    const req = httpMock.expectOne('/auth/login');
    req.flush(
      { status: 'credenciales_invalidas', message: 'Usuario o contraseña incorrectos.' },
      { status: 401, statusText: 'Unauthorized' },
    );
  });

  it('debería devolver mensaje de conexión ante error de red', (done) => {
    service.login('ana', 'x').subscribe((result) => {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe(MENSAJE_ERROR_CONEXION);
      }
      done();
    });

    const req = httpMock.expectOne('/auth/login');
    req.flush(null, { status: 0, statusText: 'Unknown Error' });
  });

  it('debería limpiar la sesión al cerrar sesión', (done) => {
    service.login('ana', 'secreto').subscribe(() => {
      expect(service.isAuthenticated()).toBe(true);
      service.logout();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.getToken()).toBeNull();
      done();
    });

    const req = httpMock.expectOne('/auth/login');
    req.flush({ status: 'ok', token: 'tok-123', userId: 'u1', username: 'ana', expiresAt: '' });
  });
});
