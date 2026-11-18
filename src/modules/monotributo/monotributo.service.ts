import { formatArcaDateAsArgentineDate, formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { ISSUES_URL } from '../../lib/links';
import type { ArcliEnvironment } from '../config/config.schemas';

import {
  type MonotributoCategoryLetter,
  type MonotributoTable,
  type MonotributoTableSource,
  staleTableNotice,
} from './monotributo';
import { BUNDLED_MONOTRIBUTO_TABLE } from './monotributo.bundled';
import { parseMonotributoPage } from './monotributo.parser';
import type { FetchMonotributoPage, MonotributoPageFetch } from './monotributo.source';
import type { MonotributoStore } from './monotributo.store';

/** La tabla que se muestra, de donde salio y los avisos para mostrar arriba (o en `avisos` del JSON). */
export interface LoadedMonotributoTable {
  /** Fecha (yyyymmdd) en que se consulto ARCA; null para la incluida. */
  readonly consultedOn: string | null;
  readonly notices: readonly string[];
  readonly source: MonotributoTableSource;
  readonly table: MonotributoTable;
}

export interface LoadMonotributoTableOptions {
  /** Por defecto, la que viene con ARCLI. */
  readonly bundled?: MonotributoTable;
  readonly fetchPage: FetchMonotributoPage;
  readonly now: Date;
  /** `--actualizar` o "Actualizar desde ARCA": consulta aunque haya una tabla guardada. */
  readonly refresh: boolean;
  readonly store: MonotributoStore;
  /** Version de ARCLI, para nombrar la tabla incluida. */
  readonly version: string;
}

type Candidate = Omit<LoadedMonotributoTable, 'notices'>;

/** Entre la guardada y la incluida, la de vigencia mas nueva; si es la misma, la guardada, que dice cuando se leyo. */
function bestKnownTable(store: MonotributoStore, bundled: MonotributoTable): Candidate {
  const saved = store.readTable();

  if (saved && saved.table.validFrom >= bundled.validFrom) {
    return { consultedOn: saved.consultedOn, source: 'guardada', table: saved.table };
  }

  return { consultedOn: null, source: 'incluida', table: bundled };
}

function describeCandidate(candidate: Candidate, version: string): string {
  return candidate.source === 'guardada' && candidate.consultedOn
    ? `la guardada el ${formatArcaDateAsArgentineDate(candidate.consultedOn)}`
    : `la incluida en ARCLI ${version}`;
}

function describeFetchFailure(result: Exclude<MonotributoPageFetch, { ok: true }>): string {
  switch (result.reason) {
    case 'sin-conexion':
      return 'sin conexión';
    case 'sin-respuesta':
      return 'no respondió a tiempo';
    case 'error-http':
      return `respondió con el error ${result.status}`;
  }
}

/**
 * La tabla de categorias para mostrar. Se consulta ARCA solo con `refresh` o la primera vez que se usa (sin tabla
 * guardada y sin un intento anterior): asi la primera vista ya trae lo que publica ARCA, pero sin conexion no se
 * reintenta en cada ejecucion. Si la consulta falla o la pagina no pasa el control, se usa la guardada o la incluida,
 * con un aviso. La tabla leida se guarda con la fecha de hoy.
 */
export async function loadMonotributoTable(options: LoadMonotributoTableOptions): Promise<LoadedMonotributoTable> {
  const { store, version } = options;
  const bundled = options.bundled ?? BUNDLED_MONOTRIBUTO_TABLE;
  const today = formatDateAsArcaDate(options.now);
  const known = bestKnownTable(store, bundled);
  const firstUse = !store.readTable() && !store.readFirstAttempt();
  const withStaleNotice = (candidate: Candidate, notices: string[] = []): LoadedMonotributoTable => {
    const stale = staleTableNotice({ source: candidate.source, today, validFrom: candidate.table.validFrom });

    return { ...candidate, notices: stale ? [...notices, stale] : notices };
  };

  if (!options.refresh && !firstUse) {
    return withStaleNotice(known);
  }

  if (firstUse) {
    store.saveFirstAttempt(today);
  }

  const page = await options.fetchPage();

  if (!page.ok) {
    return withStaleNotice(known, [
      `No se pudo consultar la tabla en ARCA (${describeFetchFailure(page)}). Se muestra ${describeCandidate(known, version)}, vigente desde el ${formatArcaDateAsArgentineDate(known.table.validFrom)}.`,
    ]);
  }

  const parsed = parseMonotributoPage(page.html);

  if (!parsed.ok) {
    return withStaleNotice(known, [
      `La página de ARCA cambió y ARCLI no pudo leer la tabla. Se usa ${describeCandidate(known, version)}. Si sigue, avisanos en GitHub: ${ISSUES_URL}`,
    ]);
  }

  store.saveTable({ consultedOn: today, table: parsed.table });

  return withStaleNotice({ consultedOn: today, source: 'arca', table: parsed.table });
}

export interface ResolveOwnCategoryOptions {
  readonly cuit: string | undefined;
  readonly environment: ArcliEnvironment;
  /** Consulta el padron; lanza si no se puede (sin certificado, sin conexion, servicio sin autorizar). */
  readonly lookup: () => Promise<MonotributoCategoryLetter | null>;
  readonly now: Date;
  readonly refresh: boolean;
  readonly store: MonotributoStore;
}

/**
 * La categoria del CUIT de la config, para marcar su fila. Se consulta el padron una vez por CUIT y entorno y se
 * guarda; con `refresh`, de nuevo. Si no hay CUIT o el padron falla, null y no se guarda nada: no marcar la fila no
 * es un error, y la proxima vez se vuelve a intentar.
 */
export async function resolveOwnCategory(
  options: ResolveOwnCategoryOptions,
): Promise<MonotributoCategoryLetter | null> {
  const { cuit, environment, store } = options;

  if (!cuit) return null;

  const saved = store.readOwnCategory();

  if (!options.refresh && saved && saved.cuit === cuit && saved.environment === environment) {
    return saved.letter;
  }

  try {
    const letter = await options.lookup();

    store.saveOwnCategory({ consultedOn: formatDateAsArcaDate(options.now), cuit, environment, letter });

    return letter;
  } catch {
    return null;
  }
}
