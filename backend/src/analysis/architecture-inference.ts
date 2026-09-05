/**
 * Inferencia de arquitectura del Módulo de Análisis Estático (Task 8.13).
 *
 * A partir únicamente de los metadatos del repositorio extraído (rutas de
 * archivo) y de los componentes clave ya identificados (Task 8.11), clasifica el
 * tipo de arquitectura del repositorio en exactamente una de
 * {monolito | microservicios | mvc | hexagonal | por_capas | otro}, o lo deja sin
 * determinar (`type=null`) cuando no hay evidencia estructural suficiente. La
 * clasificación es heurística y por reglas (sin IA) y nunca lee el contenido del
 * código fuente.
 *
 * Trazabilidad de requisitos:
 * - 8.1: clasifica el tipo en exactamente una de las categorías nombradas u
 *   `otro`, con base en la evidencia estructural detectada.
 * - 8.2: asigna un `Nivel_Confianza` porcentual (`confidencePct`) en [0, 100].
 * - 8.4: cuando la evidencia no encaja en las categorías nombradas, clasifica
 *   como `otro` y describe la evidencia estructural (`evidence` no vacía).
 * - 8.5: cuando no hay evidencia estructural suficiente, indica que la
 *   arquitectura no pudo determinarse (`determined=false`, `type=null`, mensaje en
 *   `evidence`) sin interrumpir el resto del análisis.
 *
 * IMPORTANTE (Requisito 2.2): la heurística solo consulta metadatos del
 * repositorio (rutas de archivo) y las categorías de los componentes clave; no
 * lee ni transporta contenido del código fuente. El `ArchitectureInference`
 * resultante es un resultado/metadato persistible.
 *
 * NATURALEZA HEURÍSTICA (Requisito 8.2): al inferirse por reglas estructurales, la
 * confianza nunca alcanza el 100%; se acota a un máximo por debajo de 100 para
 * reflejar que la clasificación es una inferencia y no una certeza.
 */

import type {
  ArchitectureInference,
  ArchitectureType,
  KeyComponent,
} from '../domain/index.js';
import type { ExtractedRepo } from '../ingestion/index.js';

/**
 * Confianza máxima que puede asignar la heurística. Se mantiene por debajo de 100
 * porque la clasificación es una inferencia estructural, no una certeza
 * (Requisito 8.2).
 */
const HEURISTIC_MAX_CONFIDENCE = 90;

/**
 * Umbral por debajo del cual la inferencia se considera incierta (Requisito 8.3).
 * Se expone para que las capas superiores/pruebas puedan razonar sobre el umbral
 * sin duplicar la constante.
 */
export const ARCHITECTURE_UNCERTAIN_THRESHOLD = 70;

/**
 * Mensaje que indica que la arquitectura no pudo determinarse por falta de
 * evidencia estructural (Requisito 8.5). Se expone como constante para
 * reutilizarlo en mensajes y pruebas sin duplicar texto. Acompaña a
 * `type=null` y `determined=false` sin interrumpir el resto del análisis.
 */
export const ARCHITECTURE_UNDETERMINED_NOTICE =
  'No se pudo determinar la arquitectura del repositorio a partir del análisis estático: no se encontró evidencia estructural suficiente para inferir su tipo.';

/**
 * Señales estructurales detectadas en el repositorio, usadas para clasificar el
 * tipo de arquitectura y para redactar la evidencia. Todas derivan de rutas y de
 * las categorías de los componentes clave (nunca del contenido del código).
 */
interface StructuralSignals {
  /** Indicios de múltiples servicios desplegables de forma independiente. */
  microserviceHints: string[];
  /** Indicios de una organización MVC (controladores + modelos + vistas). */
  hasControllers: boolean;
  hasModels: boolean;
  hasViews: boolean;
  /** Indicios de puertos/adaptadores propios de la arquitectura hexagonal. */
  hexagonalHints: string[];
  /** Nombres de capas detectadas por directorios (controladores, servicios, ...). */
  layers: string[];
  /** Indicios de contenedorización/orquestación (Docker, compose, k8s). */
  hasContainerization: boolean;
  hasOrchestration: boolean;
  /** Número de archivos considerados (para distinguir el caso sin evidencia). */
  fileCount: number;
}

/** Devuelve el último segmento (nombre de archivo) de una ruta con separador `/`. */
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Extrae señales estructurales de las rutas del repositorio y de las categorías
 * de los componentes clave (sin leer contenido). Es la única fuente de evidencia
 * de la clasificación posterior.
 */
function collectSignals(repo: ExtractedRepo, components: readonly KeyComponent[]): StructuralSignals {
  const microserviceHints = new Set<string>();
  const hexagonalHints = new Set<string>();
  const layers = new Set<string>();
  let hasControllers = false;
  let hasModels = false;
  let hasViews = false;
  let hasContainerization = false;
  let hasOrchestration = false;
  let dockerfileCount = 0;

  for (const file of repo.files) {
    const lowerPath = file.path.toLowerCase();
    const lowerName = basename(lowerPath);

    // Microservicios: múltiples servicios en carpetas hermanas bajo una raíz
    // explícita de servicios/microservicios. Se evitan raíces genéricas como
    // `app/` o `packages/`, comunes en aplicaciones monolíticas, para no producir
    // falsos positivos; el segundo segmento identifica el servicio concreto.
    const serviceDirMatch = lowerPath.match(
      /(^|\/)(services|servicios|microservices|micro-services|microservicios|apps)\/([^/]+)\//,
    );
    if (serviceDirMatch) {
      microserviceHints.add(`${serviceDirMatch[2]}/${serviceDirMatch[3]}`);
    }

    // MVC: controladores, modelos y vistas.
    if (/(^|\/)(controllers?|controladores?)(\/|$)/.test(lowerPath)) {
      hasControllers = true;
      layers.add('controladores');
    }
    if (/(^|\/)(models?|modelos?|entities?|entity)(\/|$)/.test(lowerPath)) {
      hasModels = true;
      layers.add('modelos');
    }
    if (/(^|\/)(views?|vistas?|templates?|pages?)(\/|$)/.test(lowerPath)) {
      hasViews = true;
      layers.add('vistas');
    }

    // Hexagonal / puertos y adaptadores.
    if (/(^|\/)(ports?|puertos?)(\/|$)/.test(lowerPath)) {
      hexagonalHints.add('puertos');
    }
    if (/(^|\/)(adapters?|adaptadores?)(\/|$)/.test(lowerPath)) {
      hexagonalHints.add('adaptadores');
    }
    if (/(^|\/)(hexagonal)(\/|$)/.test(lowerPath)) {
      hexagonalHints.add('hexagonal');
    }
    if (/(^|\/)(domain|dominio)(\/|$)/.test(lowerPath)) {
      hexagonalHints.add('dominio');
    }
    if (/(^|\/)(infrastructure|infraestructura|infra)(\/|$)/.test(lowerPath)) {
      hexagonalHints.add('infraestructura');
      layers.add('infraestructura');
    }

    // Capas adicionales (por_capas).
    if (/(^|\/)(services?|servicios?|application|aplicacion)(\/|$)/.test(lowerPath)) {
      layers.add('servicios');
    }
    if (
      /(^|\/)(repositories?|repository|repositorios?|dao|persistence|persistencia)(\/|$)/.test(
        lowerPath,
      )
    ) {
      layers.add('persistencia');
    }
    if (/(^|\/)(presentation|presentacion|ui)(\/|$)/.test(lowerPath)) {
      layers.add('presentación');
    }

    // Contenedorización / orquestación.
    if (
      lowerName === 'dockerfile' ||
      lowerName.endsWith('.dockerfile') ||
      lowerName.startsWith('dockerfile.')
    ) {
      hasContainerization = true;
      dockerfileCount += 1;
    }
    if (
      lowerName === 'docker-compose.yml' ||
      lowerName === 'docker-compose.yaml' ||
      /(^|\/)(k8s|kubernetes|helm|charts?)(\/|$)/.test(lowerPath)
    ) {
      hasOrchestration = true;
    }
  }

  // Un componente de categoría controlador/modelo también cuenta como señal MVC,
  // aunque su ruta no coincidiera con los patrones de directorio anteriores.
  for (const component of components) {
    if (component.category === 'controlador') {
      hasControllers = true;
      layers.add('controladores');
    }
    if (component.category === 'modelo') {
      hasModels = true;
      layers.add('modelos');
    }
    if (component.category === 'servicio') {
      layers.add('servicios');
    }
  }

  // Varios Dockerfile en distintas rutas es un indicio adicional de múltiples
  // servicios desplegables por separado (microservicios).
  if (dockerfileCount > 1) {
    microserviceHints.add(`${dockerfileCount} imágenes`);
  }

  return {
    microserviceHints: [...microserviceHints],
    hasControllers,
    hasModels,
    hasViews,
    hexagonalHints: [...hexagonalHints],
    layers: [...layers],
    hasContainerization,
    hasOrchestration,
    fileCount: repo.files.length,
  };
}

/** Une una lista en español con comas y una conjunción final ("a, b y c"). */
function joinSpanish(items: readonly string[]): string {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0];
  }
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Resultado interno de una regla de clasificación antes de acotar la confianza. */
interface Classification {
  type: ArchitectureType;
  confidencePct: number;
  evidence: string;
}

/**
 * Clasifica la arquitectura a partir de las señales, evaluando las reglas en
 * orden de especificidad. Devuelve `null` cuando ninguna regla nombrada aplica
 * (el caso `otro`/no determinado se resuelve fuera).
 */
function classifyNamed(signals: StructuralSignals): Classification | null {
  // Microservicios: múltiples servicios/apps hermanos u orquestación de servicios.
  if (signals.microserviceHints.length >= 2 || (signals.microserviceHints.length >= 1 && signals.hasOrchestration)) {
    return {
      type: 'microservicios',
      confidencePct: 78,
      evidence: `Se detectan múltiples servicios desplegables (${joinSpanish(signals.microserviceHints)})${
        signals.hasOrchestration ? ' junto con archivos de orquestación de contenedores' : ''
      }, lo que sugiere una arquitectura de microservicios.`,
    };
  }

  // Hexagonal: puertos/adaptadores (opcionalmente con dominio/infraestructura).
  const hasPorts = signals.hexagonalHints.includes('puertos');
  const hasAdapters = signals.hexagonalHints.includes('adaptadores');
  const explicitHexagonal = signals.hexagonalHints.includes('hexagonal');
  if (explicitHexagonal || (hasPorts && hasAdapters)) {
    return {
      type: 'hexagonal',
      confidencePct: 80,
      evidence: `La estructura expone ${joinSpanish(signals.hexagonalHints)}, característico de una arquitectura hexagonal (puertos y adaptadores).`,
    };
  }

  // MVC: controladores + modelos + vistas.
  if (signals.hasControllers && signals.hasModels && signals.hasViews) {
    return {
      type: 'mvc',
      confidencePct: 76,
      evidence:
        'Se identifican controladores, modelos y vistas como directorios diferenciados, patrón propio de una arquitectura MVC.',
    };
  }

  // Por capas: al menos tres capas diferenciadas (sin vistas suficientes para MVC).
  if (signals.layers.length >= 3) {
    return {
      type: 'por_capas',
      confidencePct: 72,
      evidence: `Se observa una separación en capas diferenciadas (${joinSpanish(signals.layers)}), propia de una arquitectura por capas.`,
    };
  }

  // Monolito: un único despliegue (sin múltiples servicios) con evidencia de
  // aplicación unificada (contenedor único y/o algunas capas internas).
  if (signals.microserviceHints.length === 0 && signals.fileCount > 0 && (signals.hasContainerization || signals.layers.length >= 1)) {
    const details: string[] = [];
    if (signals.hasContainerization) details.push('un único artefacto de contenedor');
    if (signals.layers.length >= 1) details.push(`organización interna por ${joinSpanish(signals.layers)}`);
    return {
      type: 'monolito',
      confidencePct: 62,
      evidence: `El repositorio se organiza como una única unidad desplegable${
        details.length > 0 ? ` (${joinSpanish(details)})` : ''
      }, sin evidencia de múltiples servicios independientes, lo que sugiere un monolito.`,
    };
  }

  return null;
}

/** Acota un valor de confianza al rango [0, 100] exigido por 8.2. */
function clampConfidence(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), HEURISTIC_MAX_CONFIDENCE);
}

/**
 * Infiere la arquitectura del repositorio a partir de sus metadatos y de los
 * componentes clave identificados (Requisitos 8.1, 8.2, 8.4, 8.5).
 *
 * - Clasifica el tipo en exactamente una de las categorías nombradas cuando hay
 *   evidencia que encaje; si hay evidencia estructural pero no encaja en ninguna
 *   categoría nombrada, clasifica como `otro` con una descripción no vacía de la
 *   evidencia (Requisitos 8.1, 8.4).
 * - Asigna un `confidencePct` en [0, 100], siempre inferior al 100% por tratarse
 *   de una inferencia heurística (Requisito 8.2).
 * - Cuando no hay evidencia estructural suficiente, devuelve `type=null`,
 *   `determined=false`, `confidencePct=0` y un mensaje de "no determinada" en
 *   `evidence`, sin interrumpir el resto del análisis (Requisito 8.5).
 *
 * La función es determinista y no lanza; opera solo sobre metadatos del
 * repositorio (rutas) y las categorías de los componentes, sin leer el código
 * fuente (Requisito 2.2).
 */
export function inferArchitecture(
  repo: ExtractedRepo,
  components: readonly KeyComponent[] = [],
): ArchitectureInference {
  const signals = collectSignals(repo, components);

  const hasAnyEvidence =
    signals.microserviceHints.length > 0 ||
    signals.hasControllers ||
    signals.hasModels ||
    signals.hasViews ||
    signals.hexagonalHints.length > 0 ||
    signals.layers.length > 0 ||
    signals.hasContainerization ||
    signals.hasOrchestration;

  // Requisito 8.5: sin evidencia estructural, no se determina la arquitectura.
  if (!hasAnyEvidence) {
    return {
      type: null,
      confidencePct: 0,
      determined: false,
      evidence: ARCHITECTURE_UNDETERMINED_NOTICE,
    };
  }

  const named = classifyNamed(signals);
  if (named !== null) {
    return {
      type: named.type,
      confidencePct: clampConfidence(named.confidencePct),
      determined: true,
      evidence: named.evidence,
    };
  }

  // Requisito 8.4: hay evidencia estructural, pero no encaja en ninguna categoría
  // nombrada -> `otro` con descripción no vacía de la evidencia detectada.
  const structuralHints: string[] = [];
  if (signals.layers.length > 0) structuralHints.push(`capas parciales (${joinSpanish(signals.layers)})`);
  if (signals.hexagonalHints.length > 0) {
    structuralHints.push(`elementos de puertos/adaptadores (${joinSpanish(signals.hexagonalHints)})`);
  }
  if (signals.microserviceHints.length > 0) {
    structuralHints.push(`indicios de servicios (${joinSpanish(signals.microserviceHints)})`);
  }
  if (signals.hasContainerization) structuralHints.push('contenedorización');
  if (signals.hasOrchestration) structuralHints.push('orquestación');
  if (structuralHints.length === 0) {
    // Existe evidencia (p. ej. una única señal de capa) que no alcanzó ninguna
    // regla; se describe de forma genérica pero no vacía.
    structuralHints.push('señales estructurales aisladas que no configuran un patrón conocido');
  }

  return {
    type: 'otro',
    confidencePct: clampConfidence(45),
    determined: true,
    evidence: `La evidencia estructural detectada (${joinSpanish(
      structuralHints,
    )}) no coincide con las categorías monolito, microservicios, MVC, hexagonal o por capas; se clasifica como "otro".`,
  };
}
