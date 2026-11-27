import { DATABASE_HOUSEKEEPING_DDL, type SqliteMigration } from './migrations';

/**
 * clientes.db v1 (ARQ-12, esquema aprobado el 26/11; la referencia de los tests es __tests__/fixtures/clientes-v1.sql).
 * Una por CUIT, compartida entre entornos. Se borra con `borrado_el`, nunca con DELETE; los valores por defecto van con
 * la forma de `--cargar` por familia. La llena CLIENTES-1.
 */
const CLIENTS_V1_DDL = `
${DATABASE_HOUSEKEEPING_DDL}
CREATE TABLE clientes (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  tipo_documento INTEGER,
  numero_documento TEXT CHECK (numero_documento IS NULL OR (numero_documento <> '' AND numero_documento NOT GLOB '*[^0-9]*')),
  nombre TEXT, nombre_busqueda TEXT, alias TEXT, domicilio TEXT, condicion_iva INTEGER,
  pais INTEGER, cuit_pais TEXT, id_impositivo TEXT,
  valores_por_defecto TEXT CHECK (valores_por_defecto IS NULL OR (json_valid(valores_por_defecto) AND json_type(valores_por_defecto) = 'object')),
  notas TEXT, padron_consultado_el TEXT,
  extras TEXT CHECK (extras IS NULL OR (json_valid(extras) AND json_type(extras) = 'object')),
  creado_el TEXT NOT NULL, actualizado_el TEXT NOT NULL, borrado_el TEXT,
  version_arcli_guardado TEXT NOT NULL, version_arcli_actualizado TEXT NOT NULL,
  esquema_guardado INTEGER NOT NULL, esquema_actualizado INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX clientes_por_documento ON clientes (tipo_documento, numero_documento) WHERE numero_documento IS NOT NULL AND borrado_el IS NULL;
CREATE UNIQUE INDEX clientes_por_alias ON clientes (alias) WHERE alias IS NOT NULL AND borrado_el IS NULL;
CREATE INDEX clientes_por_nombre ON clientes (nombre_busqueda) WHERE borrado_el IS NULL;
CREATE INDEX clientes_del_exterior ON clientes (pais, id_impositivo) WHERE pais IS NOT NULL;
CREATE TABLE contactos (id INTEGER PRIMARY KEY, cliente_id TEXT NOT NULL REFERENCES clientes (id),
  medio TEXT NOT NULL, valor TEXT NOT NULL, valor_normalizado TEXT NOT NULL, orden INTEGER NOT NULL,
  fuente TEXT NOT NULL, ultimo_uso_el TEXT, extras TEXT CHECK (extras IS NULL OR json_valid(extras)),
  creado_el TEXT NOT NULL, actualizado_el TEXT NOT NULL, borrado_el TEXT) STRICT;
CREATE UNIQUE INDEX contactos_sin_repetir ON contactos (cliente_id, medio, valor_normalizado) WHERE borrado_el IS NULL;
`;

/** Los pasos de clientes.db, en orden. */
export const CLIENTS_MIGRATIONS: readonly SqliteMigration[] = [{ version: 1000, up: (exec) => exec(CLIENTS_V1_DDL) }];
