/**
 * Punto de entrada de la capa de almacenamiento transitorio de Repo-Analyzer.
 *
 * Reexporta el contrato agnóstico a la tecnología (`TransientStorage`), sus tipos
 * y errores, y el adaptador por defecto respaldado por el sistema de archivos
 * temporal, para que el resto de capas los consuman sin acoplarse a las rutas
 * internas ni a la implementación concreta.
 */
export type {
  JobId,
  StorageEntry,
  TransientStorage,
} from './transient-storage.js';
export { TransientStorageError } from './transient-storage.js';
export {
  FsTransientStorage,
  type FsTransientStorageOptions,
} from './fs-transient-storage.js';
