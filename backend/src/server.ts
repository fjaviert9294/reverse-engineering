import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * Manejador de rutas de la capa API/Auth. Devuelve `true` si atendió la petición
 * (una ruta reconocida de la API) y `false` si no la reconoce, para que el
 * servidor aplique su comportamiento por defecto (salud / 404).
 */
export type ApiRouter = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * Crea el servidor HTTP del monolito modular Repo-Analyzer.
 *
 * El servidor expone un punto de entrada de salud (`GET /` y `GET /health`),
 * satisfaciendo el Requisito 14.2 ("una solicitud al punto de entrada del
 * servicio reciba una respuesta satisfactoria").
 *
 * Cuando se inyecta un `router` (capa API/Auth, Task 15.x), el servidor le da
 * prioridad: si el router atiende la petición, el servidor no hace nada más; si
 * el router no reconoce la ruta, el servidor aplica su comportamiento por defecto
 * (salud / 404). El router se inyecta como dependencia para no acoplar el
 * andamiaje del servidor a los endpoints concretos.
 */
export function createServer(router?: ApiRouter): Server {
  return createHttpServer((req, res) => {
    void handleRequest(req, res, router);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  router?: ApiRouter,
): Promise<void> {
  const url = req.url ?? '/';

  if (router !== undefined) {
    try {
      const handled = await router(req, res);
      if (handled) {
        return;
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({ status: 'error', message: 'Error interno del servidor.' }),
        );
      }
      return;
    }
  }

  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        service: 'repo-analyzer',
        status: 'ok',
        message: 'Repo-Analyzer backend operativo.',
      }),
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ status: 'not_found', message: 'Recurso no encontrado.' }));
}
