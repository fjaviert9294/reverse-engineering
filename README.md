# Repo-Analyzer

Aplicación web que analiza repositorios de código fuente públicos y genera
documentación automática (explicación funcional, componentes clave, arquitectura
inferida y hallazgos adicionales). Se implementa como un app con arquitectura **monolito modular en
Node.js** con procesamiento asíncrono, frontend Angular y persistencia
en PostgreSQL (solo resultados; el código fuente es transitorio).

## Estructura del monorepo

```
.
├── backend/    # Monolito modular Node.js + TypeScript (API/Auth, módulos de dominio)
├── frontend/   # Interfaz_Web en Angular (dashboard responsive)
├── db/         # Migraciones/esquema PostgreSQL (solo se mapean resultados del análisis)
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
| `DATABASE_URL`                   | —           | Conexión a PostgreSQL. Definida => persiste en BD; vacía => memoria.|
| `AI_PROVIDER`                    | vacío       | Proveedor de IA (Req 4.5). `groq` activa Groq; vacío lo omite.     |
| `GROQ_API_KEY`                   | —           | Clave de API de Groq (requerida si `AI_PROVIDER=groq`).            |
| `GROQ_MODEL`                     | `llama-3.3-70b-versatile` | Modelo de Groq a usar (opcional).                    |
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

### Documentación de la API (OpenAPI / Swagger)

El contrato de la API está en `backend/openapi.yaml` (OpenAPI 3.0). Para
explorarlo de forma interactiva:

```bash
cd backend
npm run docs:api        # abre una vista interactiva de la API en el navegador
npm run docs:api:lint   # valida el spec OpenAPI
```

También puedes pegar el contenido de `openapi.yaml` en https://editor.swagger.io
para verlo con Swagger UI.

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

## Inferencia por IA (opcional, Groq)

La inferencia por IA está deshabilitada por defecto (privacidad por defecto,
Requisitos 4.1, 4.2). El proveedor concreto se resuelve por variable de entorno
(Requisito 4.5) detrás de la abstracción `AIProvider`, sin acoplar el resto del
sistema. Actualmente se incluye un proveedor para los modelos de **Groq** (API
de Chat Completions compatible con OpenAI).

Para activarla necesitas una clave de API de Groq (obtenla en GroqCloud).

**Opción recomendada: archivo `.env` (para `docker compose up`).** Docker
Compose carga automáticamente un archivo `.env` en la raíz del proyecto, así que
basta con crearlo una vez a partir de la plantilla y levantar los servicios:

```bash
# edita .env y pon tu GROQ_API_KEY
docker compose up --build
```

**Backend local (sin Docker).** Exporta las variables en tu shell y arranca:

```bash
export AI_PROVIDER=groq
export GROQ_API_KEY=tu_clave
# opcional: export GROQ_MODEL=llama-3.3-70b-versatile
cd backend && npm run dev
```

También puedes pasar las variables en línea a Compose sin usar `.env`:

```bash
AI_PROVIDER=groq GROQ_API_KEY=tu_clave docker compose up --build
```

Requisitos de comportamiento respetados:

- El código fuente solo se envía al proveedor cuando el análisis solicita IA
  (`useAI: true`) y la privacidad lo permite (Requisitos 4.3, 4.4). Es transitorio
  y nunca se persiste (Requisito 2.2).
- Si `AI_PROVIDER` está vacío o falta `GROQ_API_KEY`, la inferencia se omite y
  el resultado indica que la IA no se aplicó (Requisitos 4.5, 4.6).
- Si Groq falla, el análisis degrada a solo estático con aviso (Requisitos 3.6,
  14.5); el fallo del módulo de IA no interrumpe el resto del pipeline.

## Base de datos

`db/migrations/` contiene los scripts SQL aplicados en orden. La composición local
los monta en la inicialización de PostgreSQL. PostgreSQL persiste únicamente
resultados/metadatos;

### Persistencia: PostgreSQL o en memoria

El backend elige el respaldo de persistencia según la variable de entorno
`DATABASE_URL`:

- **Con `DATABASE_URL` definida** (caso de Docker Compose): usa PostgreSQL. Los
  usuarios, jobs, resultados y preferencias se guardan en la BD y sobreviven a
  reinicios. En desarrollo, el usuario demo se siembra en la tabla `usuario`.
- **Sin `DATABASE_URL`** (p. ej. backend local con `npm run dev`): usa
  repositorios en memoria; los datos no sobreviven a un reinicio.

Para consultar la BD del contenedor:

```bash
docker compose exec db psql -U repo_analyzer -d repo_analyzer -c "SELECT id, status, stage, progress FROM analysis_job ORDER BY created_at DESC LIMIT 10;"
```

Las credenciales de la BD se parametrizan por `.env` (`POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`); ver `.env.example`. Por
defecto son `repo_analyzer` / `repo_analyzer` / `repo_analyzer` y el puerto
`5432`.

El puerto de PostgreSQL se publica al host, así que puedes conectarte con un
cliente gráfico (DBeaver, TablePlus, pgAdmin) usando:

- Host: `localhost`
- Puerto: `5432` (o el valor de `POSTGRES_PORT`)
- Base de datos / usuario / contraseña: los de tu `.env`


