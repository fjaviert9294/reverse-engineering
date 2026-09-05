/**
 * Validación y resolución de `URL_GitHub` para la descarga de repositorios
 * públicos (Task 6.2).
 *
 * El Módulo de Ingesta acepta como segundo método de entrada la URL de un
 * repositorio de GitHub público. Antes de intentar cualquier descarga se valida
 * que la URL esté bien formada y corresponda a GitHub (Requisito 15.5): una URL
 * mal formada o ajena a GitHub se rechaza y NO inicia el análisis.
 *
 * Este módulo NO decide el mecanismo concreto de transporte (eso vive tras la
 * abstracción `ZipDownloader`); su única responsabilidad es interpretar la
 * `URL_GitHub` y derivar las URL candidatas del archivo comprimido (ZIP) del
 * repositorio vía la URL/API pública de GitHub, **sin clonación Git**.
 */

/** Hosts que se consideran GitHub para efectos de validación de `URL_GitHub`. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'www.github.com']);

/** Host de descarga de archivos comprimidos de GitHub (codeload). */
const CODELOAD_HOST = 'codeload.github.com';

/**
 * Referencia resuelta de un repositorio de GitHub público, con las URL candidatas
 * para descargar su ZIP. El código transitorio se obtiene desde estas URL sin
 * clonación Git ni credenciales (Requisitos 15.1, 15.2).
 */
export interface GitHubRepoRef {
  /** Propietario del repositorio (usuario u organización). */
  owner: string;
  /** Nombre del repositorio, sin sufijo `.git`. */
  repo: string;
  /**
   * Rama/etiqueta/commit indicado explícitamente en la URL, si lo hubiera. Cuando
   * es `null`, se descarga la rama por defecto del repositorio.
   */
  ref: string | null;
  /**
   * URL candidatas del archivo comprimido (ZIP), en orden de preferencia. Se
   * ofrecen varias porque la rama por defecto puede ser `main` o `master` (u otra)
   * y no se conoce sin consultar; el descargador intenta en orden hasta obtener
   * un ZIP válido. Todas apuntan a endpoints públicos de GitHub y no llevan
   * credenciales.
   */
  zipUrls: string[];
}

/**
 * Error de validación de la `URL_GitHub`: la URL está mal formada o no
 * corresponde a un repositorio de GitHub (Requisito 15.5). Se separa de los
 * errores de descarga (red/repo inaccesible) porque su tratamiento es distinto:
 * aquí ni siquiera se intenta la descarga.
 */
export class GitHubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubUrlError';
  }
}

/**
 * Construye las URL candidatas de descarga del ZIP para un `owner/repo` dado.
 * Cuando se conoce la `ref` se usa esa; en caso contrario se prueban las ramas
 * por defecto habituales. Se usa el host `codeload.github.com`, que sirve el
 * archivo comprimido del repositorio sin clonación Git.
 */
function buildZipUrls(owner: string, repo: string, ref: string | null): string[] {
  const refs = ref !== null ? [ref] : ['main', 'master'];
  return refs.map((r) => `https://${CODELOAD_HOST}/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(r)}`);
}

/**
 * Valida y resuelve una `URL_GitHub`. Devuelve la referencia del repositorio con
 * las URL de descarga del ZIP, o lanza `GitHubUrlError` si la URL está mal
 * formada o no corresponde a un repositorio de GitHub (Requisito 15.5).
 *
 * Reglas de aceptación:
 * - Debe ser una URL absoluta `http`/`https` bien formada.
 * - El host debe ser `github.com` (o `www.github.com`).
 * - La ruta debe identificar un repositorio: `/{owner}/{repo}` como mínimo. Se
 *   admite el sufijo `.git` y una `ref` explícita en la forma
 *   `/{owner}/{repo}/tree/{ref}`.
 */
export function resolveGitHubUrl(rawUrl: string): GitHubRepoRef {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new GitHubUrlError('La URL de GitHub está vacía.');
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new GitHubUrlError(`La URL de GitHub está mal formada: "${rawUrl}".`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GitHubUrlError(`La URL de GitHub debe usar http o https, no "${url.protocol}".`);
  }

  const host = url.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(host)) {
    throw new GitHubUrlError(`La URL no corresponde a un repositorio de GitHub (host "${url.hostname}").`);
  }

  const segments = url.pathname.split('/').filter((seg) => seg.length > 0);
  if (segments.length < 2) {
    throw new GitHubUrlError('La URL de GitHub no identifica un repositorio (se espera "/{owner}/{repo}").');
  }

  const owner = segments[0]!;
  let repo = segments[1]!;
  if (repo.toLowerCase().endsWith('.git')) {
    repo = repo.slice(0, -'.git'.length);
  }
  if (owner.length === 0 || repo.length === 0) {
    throw new GitHubUrlError('La URL de GitHub no identifica un repositorio válido.');
  }

  // Ref explícita en la forma `/{owner}/{repo}/tree/{ref}` (o `/blob/{ref}`).
  let ref: string | null = null;
  if (segments.length >= 4 && (segments[2] === 'tree' || segments[2] === 'blob')) {
    // La ref puede contener `/` (p. ej. "feature/foo"): se reconstruye completa.
    ref = segments.slice(3).join('/');
  }

  return {
    owner,
    repo,
    ref,
    zipUrls: buildZipUrls(owner, repo, ref),
  };
}

/**
 * Indica si una cadena es una `URL_GitHub` aceptable sin lanzar. Útil para
 * validaciones tempranas (p. ej. en la capa API) que solo necesitan un booleano.
 */
export function isValidGitHubUrl(rawUrl: string): boolean {
  try {
    resolveGitHubUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
