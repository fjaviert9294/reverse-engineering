# Repo-Analyzer

Aplicación web que analiza repositorios de código fuente públicos y genera
documentación automática (explicación funcional, componentes clave, arquitectura
inferida y hallazgos adicionales). Se implementa como un **monolito modular en
Node.js** con procesamiento asíncrono, frontend Angular en español y persistencia
en PostgreSQL (solo resultados; el código fuente es transitorio).

Ver la especificación en `.kiro/specs/repo-analyzer/` (requirements, design, tasks).

## Estructura del monorepo

```
.
├── backend/    # Monolito modular Node.js + TypeScript (API/Auth, módulos de dominio)
├── frontend/   # Interfaz_Web en Angular (dashboard en español, responsive)
├── db/         # Migraciones/esquema PostgreSQL (solo resultados, nunca código)
└── docker-compose.yml  # Composición local: Node.js + PostgreSQL (1 instancia, 1 GB, 1 vCPU)
```

## Requisitos previos

- Node.js >= 20 (se recomienda 20.19+ para el frontend Angular 20). Ver `.nvmrc`.
- Docker y Docker Compose (para la composición local).

## Cómo ejecutar el proyecto

Hay dos formas de levantar el sistema. La primera es la recomendada porque arranca
el backend y la base de datos juntos con un único comando.

### Opción A — Docker Compose (recomendada)

Levanta el backend (unidad ejecutable única, límite de 1 instancia / 1 GB / 1 vCPU
— Requisito 14.3) y PostgreSQL en un único entorno local:

```bash
docker compose up --build
```

Comprueba que responde:

```bash
curl http://localhost:3000/health   # -> 200
```

Para detenerlo pulsa Ctrl+C. Para eliminar contenedores y volúmenes: `docker compose down -v`.

### Opción B — Backend en local (sin Docker)

Útil para desarrollo con recarga en caliente. Requiere Node.js >= 20.

```bash
cd backend
npm install
npm run dev        # desarrollo con recarga en caliente (tsx watch)
# — o build + arranque de producción —
npm run build      # compila TypeScript a dist/
npm start          # arranca el servidor HTTP (GET / y GET /health -> 200)
```

El servidor responde en `http://localhost:3000/` y `http://localhost:3000/health`
(Requisito 14.2). El punto de entrada (`src/index.ts`) usa el composition root
`createApplication`, que cablea todos los componentes —API/Auth, cola/worker,
módulos de dominio, persistencia y almacenamiento transitorio— en este mismo proceso.

> Nota: la Opción B usa por defecto la persistencia en memoria del proceso único
> (los datos no sobreviven a un reinicio). Para persistir en PostgreSQL, usa la
> Opción A o inyecta un cliente de base de datos vía `CompositionOverrides`.

En desarrollo, `npm run dev` establece automáticamente `NODE_ENV=development` y
carga un usuario demo en memoria:

- Usuario: `demo`
- Contraseña: `demo1234`

También puedes usar el build compilado con `NODE_ENV=development npm start`. Este
usuario no se crea cuando `NODE_ENV=production` (valor usado por Docker) ni se
persiste en PostgreSQL.

### Variables de entorno

| Variable                         | Por defecto | Descripción                                                        |
|----------------------------------|-------------|--------------------------------------------------------------------|
| `NODE_ENV`                       | —           | `development` carga el usuario demo; `production` lo deshabilita.  |
| `PORT`                           | `3000`      | Puerto de escucha del servidor HTTP.                               |
| `HOST`                           | `0.0.0.0`   | Interfaz de escucha.                                               |
| `DATABASE_URL`                   | —           | Cadena de conexión a PostgreSQL (usada en la composición Docker).  |
| `AI_PROVIDER`                    | vacío       | Proveedor de IA (Req 4.5). Vacío => la inferencia por IA se omite. |
| `MODULE_INGESTION_ENABLED`       | `true`      | Habilita/deshabilita el módulo de Ingesta.                         |
| `MODULE_STATIC_ANALYSIS_ENABLED` | `true`      | Habilita/deshabilita el módulo de Análisis Estático.               |
| `MODULE_AI_ENABLED`              | `true`      | Habilita/deshabilita la Inferencia IA (Req 14.5).                  |
| `MODULE_EXPORT_ENABLED`          | `true`      | Habilita/deshabilita el módulo de Exportación.                     |

Los conmutadores de módulo (Requisito 14.1) permiten deshabilitar un módulo sin
impedir la ejecución de los demás. Por ejemplo, arrancar con la IA deshabilitada:

```bash
MODULE_AI_ENABLED=false npm start
```

El análisis continúa en modo solo estático (ingesta + análisis estático +
exportación) y el resultado indica que la IA no se aplicó (Requisito 14.5).

## Backend

Runtime: Node.js 20 + TypeScript. Runner de pruebas: **Vitest** (elegido por su
soporte nativo de ESM/TypeScript e integración directa con `fast-check`).
Property-based testing con `fast-check` (mínimo 100 iteraciones por propiedad).

```bash
cd backend
npm install
npm run build      # compila TypeScript a dist/
npm start          # arranca el servidor HTTP (GET / y GET /health -> 200)
npm run dev        # desarrollo con recarga en caliente
npm test           # ejecuta Vitest (incluye smoke del servidor + wiring end-to-end)
npm run lint       # ESLint
npm run typecheck  # verificación de tipos sin emitir
```

## Frontend

Angular 20 (standalone). Runner de pruebas: **Karma + Jasmine** (runner estándar de Angular).

```bash
cd frontend
npm install
npm start          # servidor de desarrollo (ng serve) en http://localhost:4200
npm run build      # build de producción
npm test           # ejecuta Karma + Jasmine
```

El servidor de desarrollo usa `proxy.conf.json` (configurado en `angular.json` vía
`serve.options.proxyConfig`) para redirigir `/auth`, `/analyses`, `/preferences` y
`/health` a `http://localhost:3000`. Así el frontend puede seguir usando rutas
relativas (p. ej. `/auth/login`) y las peticiones llegan al backend real en lugar
de quedarse en el propio servidor de Angular. Para probar el flujo completo,
arranca primero el backend (Opción B más arriba) y luego el frontend.

## Base de datos

`db/migrations/` contiene los scripts SQL aplicados en orden. La composición local
los monta en la inicialización de PostgreSQL. PostgreSQL persiste únicamente
resultados/metadatos; nunca código fuente (Requisito 2.2).

## Decisiones abiertas

El proveedor de IA, la plataforma de nube, el mecanismo de cola/almacenamiento
transitorio y el mecanismo de descarga de GitHub se mantienen tras interfaces y
no se fijan en este andamiaje.
