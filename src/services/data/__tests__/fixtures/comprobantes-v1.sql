-- comprobantes.db v1, como se aprobó el 26/11 (ARQ-12, docs/backlog/diseno-arq-12-esquema.md, con cotizacion_fecha y
-- lote_id): la referencia contra la que vouchers-schema.test.ts compara la base que crea el adaptador. Cambiarlo es
-- cambiar el esquema y va con una migración.
PRAGMA application_id = 1634886508;  -- 'arcl'
PRAGMA user_version = 1000;          -- 1000*mayor + menor
CREATE TABLE metadatos (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) STRICT;  -- base, emisor_cuit, entorno, creada_el, creada_por_version
CREATE TABLE migraciones (esquema INTEGER PRIMARY KEY, aplicada_el TEXT NOT NULL, version_arcli TEXT NOT NULL, copia TEXT) STRICT;
CREATE TABLE comprobantes (
  cae TEXT PRIMARY KEY CHECK (cae <> '' AND cae NOT GLOB '*[^0-9]*'),
  servicio TEXT NOT NULL,                                   -- 'wsfe' | 'wsfex' (abierto)
  tipo_arca INTEGER NOT NULL CHECK (tipo_arca BETWEEN 1 AND 999),
  punto_venta INTEGER NOT NULL CHECK (punto_venta BETWEEN 1 AND 99999),
  numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 99999999),
  numero_hasta INTEGER CHECK (numero_hasta IS NULL OR numero_hasta BETWEEN numero AND 99999999),
  fecha TEXT NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  cae_vencimiento TEXT, fecha_proceso TEXT, resultado TEXT,
  observaciones_arca TEXT CHECK (observaciones_arca IS NULL OR json_valid(observaciones_arca)),
  concepto INTEGER, servicio_desde TEXT, servicio_hasta TEXT, vencimiento_pago TEXT,
  periodo_asociado_desde TEXT, periodo_asociado_hasta TEXT,
  receptor_tipo_documento INTEGER,
  receptor_numero_documento TEXT CHECK (receptor_numero_documento IS NULL OR receptor_numero_documento NOT GLOB '*[^0-9]*'),
  receptor_condicion_iva INTEGER, receptor_nombre TEXT, receptor_domicilio TEXT,
  receptor_pais INTEGER, receptor_cuit_pais TEXT, receptor_id_impositivo TEXT,
  cliente_id TEXT,
  moneda TEXT,
  cotizacion TEXT CHECK (cotizacion IS NULL OR (cotizacion NOT GLOB '*[^0-9.]*' AND cotizacion GLOB '*[0-9].[0-9][0-9][0-9][0-9][0-9][0-9]')),
  cotizacion_fecha TEXT,                                    -- FchCotiz (WSFE) / Fecha_ctz (WSFEX)
  misma_moneda INTEGER CHECK (misma_moneda IN (0, 1)),
  total_centavos INTEGER NOT NULL,
  neto_centavos INTEGER, no_gravado_centavos INTEGER, exento_centavos INTEGER, iva_centavos INTEGER, tributos_centavos INTEGER,
  descripcion TEXT, condicion_venta TEXT,
  actividades TEXT CHECK (actividades IS NULL OR json_valid(actividades)),
  compradores TEXT CHECK (compradores IS NULL OR json_valid(compradores)),
  fuente TEXT NOT NULL,
  lote_id TEXT,                                             -- los emitidos juntos (--cargar); API-2, hooks
  detalle_completo INTEGER NOT NULL DEFAULT 0 CHECK (detalle_completo IN (0, 1)),
  reemplazado_por TEXT, reemplazado_el TEXT,
  extras TEXT CHECK (extras IS NULL OR (json_valid(extras) AND json_type(extras) = 'object')),
  guardado_el TEXT NOT NULL, actualizado_el TEXT NOT NULL,
  version_arcli_guardado TEXT NOT NULL, version_arcli_actualizado TEXT NOT NULL,
  esquema_guardado INTEGER NOT NULL, esquema_actualizado INTEGER NOT NULL,
  CHECK ((reemplazado_por IS NULL) = (reemplazado_el IS NULL))
) STRICT;
CREATE UNIQUE INDEX comprobantes_por_numero ON comprobantes (tipo_arca, punto_venta, numero) WHERE reemplazado_por IS NULL;
CREATE INDEX comprobantes_por_fecha ON comprobantes (fecha, tipo_arca, punto_venta);
CREATE INDEX comprobantes_por_receptor ON comprobantes (receptor_tipo_documento, receptor_numero_documento, fecha) WHERE receptor_numero_documento IS NOT NULL;
CREATE INDEX comprobantes_por_lote ON comprobantes (lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX comprobantes_por_cliente ON comprobantes (cliente_id, fecha) WHERE cliente_id IS NOT NULL;
CREATE TABLE alicuotas_iva (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  alicuota_id INTEGER NOT NULL, base_centavos INTEGER NOT NULL, importe_centavos INTEGER NOT NULL, PRIMARY KEY (cae, orden)) STRICT;
CREATE TABLE tributos (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  tributo_id INTEGER NOT NULL, descripcion TEXT, base_centavos INTEGER, alicuota TEXT, importe_centavos INTEGER NOT NULL, PRIMARY KEY (cae, orden)) STRICT;
CREATE TABLE opcionales (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  opcional_id TEXT NOT NULL, valor TEXT, PRIMARY KEY (cae, orden)) STRICT;
CREATE TABLE asociados (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  tipo_arca INTEGER NOT NULL, punto_venta INTEGER NOT NULL, numero INTEGER NOT NULL, cuit TEXT, fecha TEXT, PRIMARY KEY (cae, orden)) STRICT;
CREATE INDEX asociados_por_asociado ON asociados (tipo_arca, punto_venta, numero);
CREATE TABLE items (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  codigo TEXT, descripcion TEXT, cantidad TEXT, unidad INTEGER, precio_unitario TEXT, bonificacion TEXT, total TEXT,
  alicuota_iva_id INTEGER, enviado_a_arca INTEGER NOT NULL CHECK (enviado_a_arca IN (0, 1)), PRIMARY KEY (cae, orden)) STRICT;
CREATE TABLE exportacion (cae TEXT PRIMARY KEY REFERENCES comprobantes (cae), tipo_expo INTEGER, incoterm TEXT, incoterm_descripcion TEXT,
  idioma INTEGER, forma_pago TEXT, observaciones TEXT, observaciones_comerciales TEXT, permiso_existente TEXT, id_solicitud INTEGER) STRICT;
CREATE TABLE permisos (cae TEXT NOT NULL REFERENCES comprobantes (cae), orden INTEGER NOT NULL CHECK (orden >= 1),
  permiso TEXT NOT NULL, destino INTEGER, PRIMARY KEY (cae, orden)) STRICT;
CREATE TABLE documentos (id INTEGER PRIMARY KEY, cae TEXT NOT NULL REFERENCES comprobantes (cae),
  clase TEXT NOT NULL,      -- entrada | solicitud | respuesta | consulta | pdf-entrada | importacion (abierto)
  operacion TEXT, contenido TEXT NOT NULL CHECK (json_valid(contenido)), huella TEXT NOT NULL,
  guardado_el TEXT NOT NULL, version_arcli TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX documentos_sin_repetir ON documentos (cae, clase, huella);
CREATE TABLE eventos (id INTEGER PRIMARY KEY, cae TEXT REFERENCES comprobantes (cae),
  tipo TEXT NOT NULL,       -- guardado | completado | diferencia | reemplazo | conflicto-numero | pdf | email | fce-estado | base-repuesta (abierto)
  ocurrido_el TEXT NOT NULL, version_arcli TEXT NOT NULL,
  datos TEXT CHECK (datos IS NULL OR (json_valid(datos) AND json_type(datos) = 'object'))) STRICT;
CREATE INDEX eventos_por_comprobante ON eventos (cae, tipo, ocurrido_el);
CREATE INDEX eventos_por_tipo ON eventos (tipo, ocurrido_el);
CREATE TABLE ultimos_numeros (tipo_arca INTEGER NOT NULL, punto_venta INTEGER NOT NULL, numero INTEGER NOT NULL CHECK (numero >= 0),
  consultado_el TEXT NOT NULL, PRIMARY KEY (tipo_arca, punto_venta)) STRICT;
