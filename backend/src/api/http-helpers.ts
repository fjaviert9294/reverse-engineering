/**
 * Utilidades HTTP compartidas por la capa API/Auth (Task 15.1).
 *
 * Ofrecen lectura del cuerpo de la petición como JSON y escritura de respuestas
 * JSON con codificación UTF-8, siguiendo la convención del andamiaje del
 * servidor (`server.ts`): respuestas `application/json; charset=utf-8` y cuerpos
 * con al menos `{ status, message }`. No fijan ninguna decisión abierta: solo
 * encapsulan el manejo del `http.IncomingMessage`/`http.ServerResponse` nativo
 * de Node para evitar dependencias externas de framework.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Tamaño máximo aceptado para el cuerpo JSON de una petición (1 MiB). */
export const MAX_BODY_BYTES = 1_048_576;

/** Escribe una respuesta JSON con el código de estado indicado. */
export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * Escribe una respuesta de error con la forma estándar `{ status, message }`
 * usada por el resto del servidor. `status` es una etiqueta legible del error.
 */
export function sendError(
  res: ServerResponse,
  statusCode: number,
  status: string,
  message: string,
): void {
  sendJson(res, statusCode, { status, message });
}

/** Error lanzado cuando el cuerpo de la petición no es JSON válido o es demasiado grande. */
export class BodyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyParseError';
  }
}

/**
 * Lee por completo el cuerpo de la petición y lo interpreta como JSON. Aborta si
 * el cuerpo supera `MAX_BODY_BYTES` para no consumir memoria sin límite. Un
 * cuerpo vacío se interpreta como `{}` (objeto sin campos). Ante JSON inválido o
 * cuerpo excesivo, lanza `BodyParseError`.
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new BodyParseError('El cuerpo de la petición es demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new BodyParseError('El cuerpo de la petición no es JSON válido.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}
