import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Componente raíz de la Interfaz Web. Aloja el `router-outlet` donde se renderiza
 * la pantalla de login o el área protegida según la ruta activa (Task 17.1). Todo
 * el texto visible de la aplicación está en español (Requisito 10.5).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet></router-outlet>`,
})
export class AppComponent {
  /** Título de la aplicación, en español (Requisito 10.5). */
  readonly title = 'Repo-Analyzer';
}
