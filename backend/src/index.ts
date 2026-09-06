import { createApplication } from './composition.js';

/**
 * Punto de entrada del monolito modular Repo-Analyzer.
 *
 * Despliega el sistema como una única unidad ejecutable accesible por su punto
 * de entrada (Requisito 14.2). El composition root (`createApplication`) cablea
 * todos los componentes —API/Auth, cola/worker, módulos de dominio (Ingesta,
 * Análisis Estático, Inferencia IA opcional, Exportación), persistencia y
 * almacenamiento transitorio— en este mismo proceso, respetando los conmutadores
 * de módulo (Requisito 14.1) y la degradación elegante de la IA (Requisito 14.5).
 */
function main(): void {
  const { server, config, pgClient } = createApplication();

  server.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`Repo-Analyzer backend escuchando en http://${config.host}:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(
      `Módulos: ingesta=${config.modules.ingestion}, análisisEstático=${config.modules.staticAnalysis}, ` +
        `IA=${config.modules.aiInference}, exportación=${config.modules.export}`,
    );
    // eslint-disable-next-line no-console
    console.log(`Persistencia: ${pgClient ? 'PostgreSQL (DATABASE_URL)' : 'en memoria'}`);
  });

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`Recibida señal ${signal}, cerrando el servidor...`);
    server.close(() => {
      // Cierre ordenado del pool de PostgreSQL si la persistencia SQL está activa.
      const closable = pgClient as { close?: () => Promise<void> } | null;
      void Promise.resolve(closable?.close?.()).finally(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
