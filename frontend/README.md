# Repo-Analyzer — Frontend (Interfaz_Web)

Aplicación Angular 20 (componentes standalone) que presenta el dashboard de
resultados en español y responsive (Requisitos 10.1–10.6).

## Runner de pruebas

**Karma + Jasmine** (runner estándar de Angular), configurado con el builder
`@angular/build:karma`. La ejecución headless usa `ChromeHeadless`.

## Requisito de Node.js

Angular 20 requiere Node.js **>= 20.19**, **>= 22.12** o **>= 24**. En entornos
con Node 20.18 el CLI rechazará build/test; usa una versión compatible.

## Comandos

```bash
npm install
npm start        # ng serve (desarrollo)
npm run build    # build de producción
npm test         # Karma + Jasmine (modo watch)
npm run test:ci  # Karma + Jasmine headless (una sola pasada)
```

Para la ejecución headless puede ser necesario indicar el binario de Chrome:

```bash
export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run test:ci
```
