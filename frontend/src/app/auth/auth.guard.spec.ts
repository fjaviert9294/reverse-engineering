import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, RouterStateSnapshot, ActivatedRouteSnapshot } from '@angular/router';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard', () => {
  function runGuard(authenticated: boolean, url = '/'): boolean | UrlTree {
    const authStub: Partial<AuthService> = {
      isAuthenticated: signal(authenticated),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authStub }],
    });
    const state = { url } as RouterStateSnapshot;
    const route = {} as ActivatedRouteSnapshot;
    // authGuard es síncrono: devuelve boolean | UrlTree.
    return TestBed.runInInjectionContext(() => authGuard(route, state)) as boolean | UrlTree;
  }

  it('debería permitir el acceso con sesión válida', () => {
    expect(runGuard(true)).toBe(true);
  });

  it('debería redirigir a /login sin sesión', () => {
    const result = runGuard(false, '/panel');
    expect(result instanceof UrlTree).toBe(true);
    const router = TestBed.inject(Router);
    const tree = result as UrlTree;
    expect(router.serializeUrl(tree)).toContain('/login');
    expect(router.serializeUrl(tree)).toContain('returnUrl');
  });
});
