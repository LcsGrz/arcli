[← Documentación](README.md)

# Entrada y salida

Contrato formal de entrada y salida de ARCLI.

Este documento asume el flujo descrito en [mental-model.md](mental-model.md) (`Input -> Validación -> Solicitud -> ARCA -> Output`, con prioridad `flags > JSON > config > defaults`) y se enfoca en el contrato concreto de cada formato.

## Formato de input: objeto

Cuando usás `--cargar`, ARCLI espera un objeto JSON o un array de objetos.

```bash
arcli fc --cargar ./voucher.json
```

### Campos soportados

| Campo                 | Tipo           | Requerido                              | Descripción                                                                                                                                     |
| --------------------- | -------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `alicuotaIva`         | string         | no                                     | Alícuota de IVA: alias (`general`, `reducida`, `incrementada`, `cero`) o número (`0`, `2.5`, `5`, `10.5`, `21`, `27`); acepta `"10.5"` o `10.5` |
| `alicuotas`           | array          | no                                     | Varias alícuotas: `[{ "tasa": "general", "monto": 1210 }]`, monto con IVA incluido; con esto `montoTotal` es opcional                           |
| `aliasCbu`            | string         | no                                     | Alias del CBU (facturas FCE)                                                                                                                    |
| `anulacion`           | boolean        | no                                     | NC/ND FCE de anulación                                                                                                                          |
| `cbu`                 | string         | en facturas FCE, salvo `config.cbu`    | CBU del emisor (facturas FCE)                                                                                                                   |
| `comprobanteAsociado` | object         | no                                     | Comprobante asociado                                                                                                                            |
| `concepto`            | string         | sí, salvo default por flags/config     | Concepto                                                                                                                                        |
| `codigoMoneda`        | string         | no                                     | Moneda: código ISO (`ARS`, `USD`, `UYU`…) o de ARCA (`PES`, `DOL`, `011`…)                                                                      |
| `cotizacionMoneda`    | number         | en moneda extranjera sin `mismaMoneda` | Cotización de la moneda                                                                                                                         |
| `mismaMoneda`         | boolean        | no                                     | El pago se cancela en la moneda extranjera                                                                                                      |
| `dia`                 | number         | no                                     | Deprecado: usá `vencimientoPago`. Vence el próximo día con ese número                                                                           |
| `emitir`              | boolean        | no                                     | Emisión real                                                                                                                                    |
| `fechaComprobante`    | string         | no                                     | Fecha del comprobante                                                                                                                           |
| `importeExento`       | number         | no                                     | Parte exenta del total (A y B)                                                                                                                  |
| `importeNoGravado`    | number         | no                                     | Parte no gravada del total (A y B)                                                                                                              |
| `ivaReceptor`         | string         | sí, salvo default por config           | Condición IVA del receptor                                                                                                                      |
| `montoTotal`          | number         | sí                                     | Importe total                                                                                                                                   |
| `periodoAsociado`     | object         | no                                     | `{ "desde": "01-09-2026", "hasta": "30-09-2026" }`; alternativa a `comprobanteAsociado` en notas comunes                                        |
| `numeroDocumento`     | number         | depende del tipo de documento          | Número de documento                                                                                                                             |
| `pdf`                 | boolean        | no                                     | `true` genera el PDF y `false` no, como `--exportar-pdf` y `--sin-pdf`. Ver [PDF](pdf.md)                                                       |
| `descripcion`         | string         | no                                     | Detalle del comprobante en el PDF; ARCA no lo recibe                                                                                            |
| `condicionVenta`      | string \| null | no                                     | Condición de venta en el PDF (`contado`, `cuenta-corriente`… o un texto); `null` omite el valor de la config; ARCA no la recibe                 |
| `receptorNombre`      | string         | no                                     | Nombre o razón social del receptor en el PDF; ARCA no lo recibe                                                                                 |
| `receptorDomicilio`   | string         | no                                     | Domicilio del receptor en el PDF; ARCA no lo recibe                                                                                             |
| `previsualizar`       | boolean        | no                                     | Preview sin emitir                                                                                                                              |
| `puntoVenta`          | number         | no                                     | Punto de venta                                                                                                                                  |
| `servicioDesde`       | string         | no                                     | Fecha inicio de servicio                                                                                                                        |
| `servicioHasta`       | string         | no                                     | Fecha fin de servicio                                                                                                                           |
| `vencimientoPago`     | string         | no                                     | Fecha de vencimiento del pago                                                                                                                   |
| `tipoDocumento`       | string         | no                                     | `consumidor-final`, `cuit`, `cuil` o `dni`                                                                                                      |
| `transferencia`       | string         | no                                     | `sca` o `adc` (facturas FCE)                                                                                                                    |

### Claves desconocidas y tipos

Cada objeto se valida contra esta lista antes de mezclarlo con los flags y la config:

- **Una clave que no está en las tablas es un error** (`INPUT_VALIDATION_ERROR`) que la nombra y, si se parece a una válida o a un flag, sugiere la correcta: `"montototal"` → `montoTotal`, `"vencimiento"` → `vencimientoPago`, `"moneda"` → `codigoMoneda`. Vale también dentro de `comprobanteAsociado`, `periodoAsociado` y cada ítem de `alicuotas`.
- **Un tipo incorrecto es un error**, no se descarta: `"puntoVenta": "3"` falla con "tiene que ser un número". Los números van sin comillas y los booleanos son `true` o `false`, no `"true"`. `null` tampoco vale (salvo en `condicionVenta`, donde omite el valor de la config): para no informar un campo, omití la clave. La única clave que acepta texto o número es la tasa de IVA (`alicuotaIva` y `tasa` en `alicuotas`).
- En un lote, cada ítem se valida por separado y el error sale en `BATCH_VALIDATION_ERROR` con su índice (ver [abajo](#validación-y-errores-del-lote)). Un array vacío también es error.

Con un solo comprobante, `detalles.campos` lista cada problema con su ruta en el JSON:

```json
{
  "codigo": "INPUT_VALIDATION_ERROR",
  "detalles": {
    "campos": [
      {
        "mensaje": "\"puntoVenta\" tiene que ser un número y llegó el texto \"3\". Escribilo sin comillas.",
        "ruta": ["puntoVenta"]
      },
      { "mensaje": "La clave \"vencimiento\" no existe: ¿quisiste decir \"vencimientoPago\"?", "ruta": ["vencimiento"] }
    ]
  },
  "error": "En el JSON de `--cargar`: ...",
  "sugerencia": null
}
```

### Flags y claves del JSON

Los nombres de las claves no siempre coinciden con los flags. Si pasás las dos cosas, gana el flag.

| Flag                                                          | Clave del JSON                      |
| ------------------------------------------------------------- | ----------------------------------- |
| `--monto`, `-m`                                               | `montoTotal`                        |
| `--alicuota TASA`                                             | `alicuotaIva`                       |
| `--alicuota TASA:MONTO` (repetido)                            | `alicuotas: [{ "tasa", "monto" }]`  |
| `--exento`                                                    | `importeExento`                     |
| `--nogravado`                                                 | `importeNoGravado`                  |
| `--dia`                                                       | `dia`                               |
| `--punto-venta`, `--pv`                                       | `puntoVenta`                        |
| `--fecha`                                                     | `fechaComprobante`                  |
| `--concepto`, `--cs`, `--cp`, `--csp`                         | `concepto`                          |
| `--moneda`, `--mda`                                           | `codigoMoneda`                      |
| `--cotizacion-moneda`, `--cm`                                 | `cotizacionMoneda`                  |
| `--misma-moneda`                                              | `mismaMoneda`                       |
| `--cuit`, `--cuil`, `--dni`, `--consumidor-final`, `--cfinal` | `tipoDocumento` y `numeroDocumento` |
| `--iva-receptor`, `--ir`, `--ir-*`                            | `ivaReceptor`                       |
| `--servicio-desde`, `--sd`                                    | `servicioDesde`                     |
| `--servicio-hasta`, `--sh`                                    | `servicioHasta`                     |
| `--vencimiento`, `--vto`                                      | `vencimientoPago`                   |
| `--ac`                                                        | `comprobanteAsociado.atajo`         |
| `--at`                                                        | `comprobanteAsociado.tipo`          |
| `--apv`, `--asociado-punto-venta`                             | `comprobanteAsociado.puntoVenta`    |
| `--ar`                                                        | `comprobanteAsociado.numero`        |
| `--acuit`                                                     | `comprobanteAsociado.cuit`          |
| `--afecha`                                                    | `comprobanteAsociado.fecha`         |
| `--periodo-desde`, `--pd`                                     | `periodoAsociado.desde`             |
| `--periodo-hasta`, `--ph`                                     | `periodoAsociado.hasta`             |
| `--cbu`                                                       | `cbu`                               |
| `--alias`                                                     | `aliasCbu`                          |
| `--transferencia`                                             | `transferencia`                     |
| `--anulacion`                                                 | `anulacion`                         |
| `--exportar-pdf`, `--pdf` / `--sin-pdf`                       | `pdf: true` / `pdf: false`          |
| `--descripcion`                                               | `descripcion`                       |
| `--condicion-venta`, `--cv`                                   | `condicionVenta`                    |
| `--sin-condicion-venta`                                       | `condicionVenta: null`              |
| `--receptor-nombre`                                           | `receptorNombre`                    |
| `--receptor-domicilio`                                        | `receptorDomicilio`                 |
| `--emitir`                                                    | `emitir`                            |
| `--previsualizar`                                             | `previsualizar`                     |

### Objeto `comprobanteAsociado`

| Campo        | Tipo   | Requerido       | Descripción                                                         |
| ------------ | ------ | --------------- | ------------------------------------------------------------------- |
| `atajo`      | string | sí\*            | Atajo del comprobante asociado                                      |
| `cuit`       | string | sí para notas   | CUIT del comprobante asociado (en NC/ND FCE, por defecto el emisor) |
| `fecha`      | string | sí en NC/ND FCE | Fecha del comprobante asociado                                      |
| `numero`     | number | sí para notas   | Número del comprobante asociado                                     |
| `puntoVenta` | number | sí para notas   | Punto de venta del comprobante asociado                             |
| `tipo`       | number | sí\*            | Tipo ARCA del comprobante asociado                                  |

\* Hay que informar `atajo` o `tipo`, pero no hace falta enviar ambos.

### Ejemplo de input simple

```json
{
  "concepto": "servicios",
  "codigoMoneda": "ARS",
  "cotizacionMoneda": 1,
  "emitir": false,
  "ivaReceptor": "responsable-inscripto",
  "montoTotal": 15000,
  "numeroDocumento": 20168598204,
  "puntoVenta": 3,
  "tipoDocumento": "cuit"
}
```

### Ejemplo con asociado

```json
{
  "comprobanteAsociado": {
    "atajo": "fa",
    "cuit": "20333333334",
    "numero": 120,
    "puntoVenta": 3
  },
  "concepto": "servicios",
  "ivaReceptor": "responsable-inscripto",
  "montoTotal": 5000,
  "numeroDocumento": 20168598204,
  "tipoDocumento": "cuit"
}
```

## Factura de exportación (E)

La factura `E` (`arcli fe` o `arcli factura e`) no comparte el JSON de facturación: no tiene concepto, IVA ni receptor con documento, y `--cargar` acepta **un objeto, nunca un array** (el lote de exportación no está soportado y responde `INPUT_VALIDATION_ERROR`). El archivo es `.strict()`: una clave desconocida también es error.

### Input de `--cargar`

| Campo                                       | Tipo              | Requerido | Descripción                                                                                                                                                        |
| ------------------------------------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cliente`                                   | string            | sí        | Nombre del cliente del exterior                                                                                                                                    |
| `domicilioCliente`                          | string            | sí        | Domicilio del cliente                                                                                                                                              |
| `paisDestino`                               | string \| number  | sí        | Código de ARCA o nombre del país (`203`, `"Brasil"`)                                                                                                               |
| `montoTotal`                                | number            | sí        | Total del comprobante, igual que en A, B y C. `monto` sigue andando, con un aviso, hasta la 3.0.0; las dos juntas son un error. Tiene que dar la suma de los ítems |
| `numero`                                    | number            | sí        | El siguiente al último `E` de ese punto de venta: ARCLI todavía no lo puede consultar en WSFEX                                                                     |
| `actividad`                                 | number            | sí\*      | Código de la tabla de actividades de WSFEX. \*Si falta, sale de `exportacion.actividad`                                                                            |
| `items`                                     | array             | no        | Renglones (ver abajo). Sin ítems va uno solo con `descripcion` por el total                                                                                        |
| `idImpositivo`                              | string            | no        | ID impositivo del cliente en su país                                                                                                                               |
| `cuitPais`                                  | number            | no        | CUIT del país del cliente; si falta sale de la tabla de ARCA                                                                                                       |
| `tipoExpo`                                  | `1` \| `2` \| `4` | no        | `2` servicios (por defecto), `1` bienes, `4` otros                                                                                                                 |
| `incoterm`, `descripcionIncoterm`           | string            | no        | Código y descripción del incoterm (`FOB`, `CIF`…)                                                                                                                  |
| `idioma`                                    | number            | no        | `1` español (por defecto), `2` inglés, `3` portugués                                                                                                               |
| `formaPago`                                 | string            | no        | Por defecto `Transferencia Internacional`                                                                                                                          |
| `permisos`, `permisoExistente`              | string[], boolean | no        | IDs de permiso de embarque y si ya están informados en ARCA; solo con `tipoExpo: 1`                                                                                |
| `idSolicitud`                               | number            | no        | ID de la solicitud; si falta se pide a WSFEX                                                                                                                       |
| `puntoVenta`                                | number            | no        | Por defecto, el de la config                                                                                                                                       |
| `fechaComprobante`, `fechaPago`             | string            | no        | Formato argentino: `27/10/2026`, `27-10-26` o solo día y mes                                                                                                       |
| `codigoMoneda`, `cotizacionMoneda`          | string, number    | no        | `USD` viaja como `DOL` (por defecto); sin cotización se usa la de aduana que publica ARCA                                                                          |
| `mismaMoneda`                               | boolean           | no        | Pago en la misma moneda extranjera (`CanMisMonExt` en `S`): ARCLI consulta la cotización oficial                                                                   |
| `observaciones`, `observacionesComerciales` | string            | no        | Van a `Obs` y `Obs_comerciales`                                                                                                                                    |
| `descripcion`                               | string            | no        | Descripción del renglón único cuando no hay `items`; por defecto `Según detalle`                                                                                   |
| `pdf`, `emitir`, `previsualizar`            | boolean           | no        | Igual que en el resto de los comprobantes                                                                                                                          |

Cada ítem:

| Campo            | Tipo             | Requerido | Descripción                                               |
| ---------------- | ---------------- | --------- | --------------------------------------------------------- |
| `cantidad`       | number           | sí        | `Pro_qty`                                                 |
| `descripcion`    | string           | sí        | `Pro_ds`                                                  |
| `precioUnitario` | number           | sí        | `Pro_precio_uni`; el total del renglón lo calcula ARCLI   |
| `codigo`         | string           | no        | `Pro_codigo`                                              |
| `unidad`         | string \| number | no        | Código de ARCA o nombre de la tabla (`7`, `"kilogramos"`) |

```json
{
  "cliente": "ACME LLC",
  "domicilioCliente": "123 Main St",
  "paisDestino": 203,
  "montoTotal": 1500,
  "numero": 1,
  "actividad": 620100,
  "tipoExpo": 2,
  "incoterm": "FOB",
  "items": [
    {
      "codigo": "001",
      "descripcion": "Servicios de consultoría",
      "cantidad": 1,
      "precioUnitario": 1000,
      "unidad": "unidades"
    },
    { "codigo": "002", "descripcion": "Soporte", "cantidad": 2, "precioUnitario": 250, "unidad": "unidades" }
  ],
  "previsualizar": false,
  "pdf": true
}
```

### Output JSON

Es el mismo resumen que A, B y C (`atajo`, `cae`, `estado`, `errores`, `observaciones`, `pdf`…) con `atajo: "fe"` y `tipoArca: 19`, y `numero`, también en la vista previa, porque lo informás vos. Suma un bloque `exportacion` con lo que WSFEX tiene y `wsfe` no. `solicitud` es el `Cmp` de WSFEX, con los nombres de ARCA.

```json
{
  "atajo": "fe",
  "cae": "86120020284412",
  "comprobante": "Factura de exportación E",
  "estado": "aprobado",
  "exportacion": {
    "actividad": [620100],
    "cliente": "ACME LLC",
    "cuitPaisCliente": 55000002126,
    "destino": { "codigo": 212, "nombre": "ESTADOS UNIDOS" },
    "domicilioCliente": "123 Main St",
    "formaPago": "Transferencia Internacional",
    "idImpositivo": null,
    "idioma": 1,
    "incoterm": null,
    "incotermDescripcion": null,
    "items": [
      {
        "cantidad": 1,
        "codigo": "001",
        "descripcion": "Servicios de consultoría",
        "precioUnitario": 1000,
        "total": 1000,
        "unidad": "unidades",
        "unidadCodigo": 7
      }
    ],
    "mismaMoneda": false,
    "permisos": [],
    "tipoExpo": 2
  },
  "solicitud": { "Cbte_Tipo": 19, "Imp_total": 1500 },
  "tipoArca": 19
}
```

`exportacion.destino.nombre`, `exportacion.incotermDescripcion` y `exportacion.items[].unidad` salen de las tablas de WSFEX; si la tabla no trae el nombre, quedan en `null` y el código numérico sigue disponible. `exportacion.actividad` lista los códigos de actividad informados en `solicitud.Actividades` (de `--actividad` o de `exportacion.actividad`) y `exportacion.mismaMoneda` indica si el pago se cancela en la misma moneda extranjera (`solicitud.CanMisMonExt` en `S`).

Una actividad que no está en la tabla de actividades de WSFEX es `INPUT_VALIDATION_ERROR` antes de ir a ARCA, porque ARCA la rechaza (error 2105). En `arcli factura e`, los flags de A, B y C que se saltean salen en `avisos`. `solicitud` no trae `Cmps_asoc` ni `Opcionales` mientras el comprobante no los informe: ARCA rechaza esos bloques vacíos (error 1820 el primero).

`solicitud` no incluye `Permisos` cuando el comprobante no informa permisos de embarque: ARCA rechaza ese campo (error 1720) si `Permiso_existente` es `N`. En las exportaciones de servicios (`tipoExpo: 2`) y otros (`tipoExpo: 4`) ARCA exige ese campo **vacío** (error 1550), así que `solicitud.Permiso_existente` sale `""` y los permisos de embarque no se admiten.

## Formato de input: batch

Si el archivo contiene un array, ARCLI procesa un lote del mismo comando. **Un array es siempre un lote, aunque tenga un solo elemento**: la salida `--json` es un array y los errores son `BATCH_VALIDATION_ERROR` / `BATCH_EMISSION_ERROR` con el índice. Un objeto suelto es un solo comprobante: sale un objeto y los errores son los de siempre (`INPUT_VALIDATION_ERROR`, etc.).

```json
[
  {
    "concepto": "servicios",
    "ivaReceptor": "consumidor-final",
    "montoTotal": 1000,
    "numeroDocumento": 0,
    "tipoDocumento": "consumidor-final"
  },
  {
    "concepto": "servicios",
    "ivaReceptor": "responsable-inscripto",
    "montoTotal": 2000,
    "numeroDocumento": 20168598204,
    "tipoDocumento": "cuit"
  }
]
```

### Validación y errores del lote

**Antes de emitir el primer comprobante, ARCLI valida todos los del lote**: la forma del JSON, las consultas a ARCA que se hacen antes de emitir (IVA receptor desde el padrón, cotización oficial) y las reglas de negocio (IVA receptor por letra, fechas, FCE, montos…).

- Si alguno es inválido o falla su consulta, **no se emite ninguno** y el error `BATCH_VALIDATION_ERROR` lista **todos** los ítems con problemas, con su índice (desde 1) y el motivo.
- Si la emisión se corta a mitad del lote (red, ARCA), ARCLI **muestra primero los comprobantes ya procesados**, con su PDF si corresponde (según `pdf` o `--exportar-pdf`, igual que en un lote completo; en `--json`, cada uno con su campo `pdf`), y después el error `BATCH_EMISSION_ERROR`, que indica en qué ítem falló y cuáles quedaron sin procesar. **No vuelvas a cargar los ya emitidos**. Si viene `detalles.sinConfirmar`, el que falló puede haberse emitido igual: verificalo con `arcli ultimos` antes de reintentarlo. Si no viene, falló antes de emitir (login, último número) y ya está en `detalles.sinProcesar`. Después reintentá los de `sinProcesar`.

```json
{
  "codigo": "BATCH_VALIDATION_ERROR",
  "detalles": {
    "comprobantes": [
      { "error": "Falta el dato: monto.", "indice": 2 },
      {
        "error": "La factura B de $ 10.000.000 o más requiere identificar al consumidor final. Usá `--dni`, `--cuit` o `--cuil`.",
        "indice": 3
      }
    ]
  },
  "error": "2 de 4 comprobantes del lote tienen errores. No se emitió ninguno.\n\n#2: ...",
  "sugerencia": null
}
```

```json
{
  "codigo": "BATCH_EMISSION_ERROR",
  "detalles": { "fallo": 3, "procesados": 2, "sinConfirmar": 3, "sinProcesar": [4], "total": 4 },
  "error": "El lote se interrumpió en el comprobante #3: ...\nProcesados: 2 de 4. Sin procesar: #4.\nEl #3 puede haberse emitido: verificalo con `arcli ultimos` antes de reintentarlo.",
  "sugerencia": null
}
```

Con un solo comprobante (sin lote) los errores son los de siempre.

## Output humano

La salida humana está pensada para terminal y prioriza legibilidad.

Incluye, según el caso:

- banner de entorno
- solicitud amigable
- estado visual del resultado
- paneles secundarios para `Observaciones`, `Eventos`, `Errores` y `Sugerencias`
- panel `Respuesta bruta` al final, además de todo lo anterior, cuando se usa `--bruto` y hubo emisión real (en una previsualización no hay respuesta de ARCA y no se muestra)

### Estabilidad del contrato

La salida humana no debe tratarse como contrato estable para automatización. Para eso existe `--json`.

Una clave del JSON no cambia sin aviso. Antes de sacarla o de cambiarle el tipo, sigue funcionando y la respuesta suma `deprecado`: una lista de frases con qué pasa y qué usar. Solo aparece si esa respuesta trae algo deprecado, nunca es un error y no se muestra en la terminal.

| Clave deprecada                            | Dónde                    | Qué usar                                                   |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------- |
| `Code`, `Msg` en `errores` y `eventos`     | emisión de A, B y C      | `codigo`, `mensaje`                                        |
| `code`, `message` en `errores` y `eventos` | emisión de la factura E  | `codigo`, `mensaje`                                        |
| `puntoVenta` como objeto                   | `estado`                 | `puntoVentaDetalle`; en la 3.0.0 `puntoVenta` es un número |
| `cuit` como número                         | `padron`, `fce-obligado` | Leelo como texto: en la 3.0.0 es un string                 |
| `detalles.errors`                          | errores de ARCA          | `detalles.errores`, con `codigo` y `mensaje`               |
| `monto` en `--cargar`                      | factura E                | `montoTotal`; este aviso sale en `avisos` y en la terminal |

Todas se sacan en la 3.0.0.

## Output JSON

### Caso simple

ARCLI serializa un resumen del resultado. Con `--bruto` se agrega además el campo `respuesta` (ver [abajo](#output-con---bruto)); el resto no cambia.

| Campo              | Tipo                                       | Descripción                                                                                                            |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `atajo`            | `string`                                   | Atajo del comprobante                                                                                                  |
| `avisos`           | `string[]`                                 | Avisos de ARCLI: régimen FCE, padrón o certificado por vencer (ver [abajo](#aviso-del-certificado))                    |
| `cae`              | `string \| null`                           | CAE informado por ARCA                                                                                                 |
| `caeVencimiento`   | `string \| null`                           | Vencimiento del CAE                                                                                                    |
| `comprobante`      | `string`                                   | Nombre visible del comprobante                                                                                         |
| `deprecado`        | `string[]`, opcional                       | Claves de esta respuesta que se sacan en la 3.0.0 (ver [Estabilidad del contrato](#estabilidad-del-contrato))          |
| `entorno`          | `"testing" \| "produccion"`                | Entorno en que se emitió o previsualizó                                                                                |
| `errores`          | `object[]`                                 | Errores de ARCA, con `codigo` y `mensaje`                                                                              |
| `estado`           | `"aprobado" \| "observado" \| "rechazado"` | Estado normalizado que arma ARCLI                                                                                      |
| `eventos`          | `object[]`                                 | Eventos de ARCA, con `codigo` y `mensaje`                                                                              |
| `numero`           | `number \| null`                           | Número del comprobante emitido; `null` en una previsualización                                                         |
| `observaciones`    | `string[]`                                 | Observaciones amigables                                                                                                |
| `observacion`      | `string \| null`                           | Observaciones unidas en una sola cadena                                                                                |
| `pdf`              | `object`, opcional                         | Solo si se intentó generar el PDF: `{ ruta }` o `{ error: { codigo, mensaje, sugerencia } }`. Ver [PDF](pdf.md#salida) |
| `previsualizacion` | `boolean`                                  | `true` si no hubo emisión real                                                                                         |
| `puntoVenta`       | `number`                                   | Punto de venta del comprobante                                                                                         |
| `resultado`        | `string \| null`                           | Resultado original de ARCA, por ejemplo `A` o `R`                                                                      |
| `solicitud`        | `object`                                   | Solicitud enviada o previsualizada; si se emitió, con el número en `CbteDesde` y `CbteHasta`                           |
| `sugerencias`      | `string[]`                                 | Sugerencias generadas por ARCLI                                                                                        |
| `tipoArca`         | `number`                                   | Tipo ARCA del comprobante                                                                                              |

### Aviso del certificado

Si a alguno de los certificados configurados (de testing o de producción, sin importar con cuál se trabaja) le quedan menos de 30 días, el aviso sale al principio del comando en **stderr** (stdout queda solo para el JSON) y, en los comandos de facturación, también como un texto más en `avisos`:

```json
{
  "avisos": [
    "El certificado de producción vence el 20/11/2026 (en 10 días). Renovalo: https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md"
  ],
  "...": "..."
}
```

En texto sale solo el banner del principio, no se repite en el panel de avisos. Si ya venció el del entorno que se usa, no hay resultado: sale el error [`CERTIFICATE_EXPIRED`](#certificado-vencido). Uno vencido de otro entorno solo se avisa.

### `estado` vs `resultado`

No significan lo mismo:

- `resultado` es el valor original que llega de ARCA
- `estado` es una normalización que hace ARCLI

Ejemplo:

- ARCA puede devolver `resultado: "A"`
- ARCLI puede devolver:
  - `estado: "aprobado"` si no hay observaciones
  - `estado: "observado"` si hubo observaciones

```json
{
  "atajo": "fb",
  "cae": "86120020284412",
  "caeVencimiento": "20260329",
  "comprobante": "Factura B",
  "entorno": "testing",
  "errores": [],
  "estado": "aprobado",
  "eventos": [],
  "numero": 125,
  "puntoVenta": 3,
  "observaciones": [],
  "observacion": null,
  "previsualizacion": false,
  "resultado": "A",
  "solicitud": {
    "...": "..."
  },
  "sugerencias": [],
  "tipoArca": 6
}
```

## Output batch en JSON

Cuando `--cargar` trae un array, ARCLI devuelve un array, aunque tenga un solo elemento. Con flags o un objeto devuelve un objeto.

Cada ítem agrega:

| Campo         | Tipo     | Descripción                         |
| ------------- | -------- | ----------------------------------- |
| `atajo`       | `string` | Atajo del comprobante               |
| `comprobante` | `string` | Nombre visible del comprobante      |
| `indice`      | `number` | Posición en el lote, empezando en 1 |

Y después incluye el resto del resultado serializado.

## Output con `--bruto`

`--bruto` (o `bruto=true` en la config) **agrega** el campo `respuesta` al JSON de siempre: `cae`, `estado`, `errores` y los demás campos del [caso simple](#caso-simple) siguen igual. En un lote, cada ítem trae su `respuesta`.

| Campo       | Tipo     | Descripción                                   |
| ----------- | -------- | --------------------------------------------- |
| `respuesta` | `object` | Respuesta cruda del SDK o un mensaje amigable |

```json
{
  "atajo": "fb",
  "cae": "86120020284412",
  "estado": "aprobado",
  "errores": [],
  "...": "el resto del resumen",
  "respuesta": {
    "cae": "86120020284412",
    "caeFchVto": "20260329",
    "response": { "FeCabResp": { "...": "..." }, "FeDetResp": { "...": "..." } }
  }
}
```

### Sin emisión real

Si no hubo emisión real, `respuesta` no se serializa como `null`. En su lugar:

```json
{
  "mensaje": "Sin emisión real. Usá `--emitir` para obtener una respuesta de ARCA."
}
```

## Comprobantes emitidos (`ultimos` y `consultar`)

`arcli ultimos <tipo> --json` devuelve el tipo de comprobante y la lista, del más nuevo al más viejo:

```json
{
  "atajo": "fb",
  "comprobante": "Factura B",
  "tipoArca": 6,
  "comprobantes": [
    {
      "cae": "86400940834444",
      "caeVencimiento": "20261011",
      "concepto": 2,
      "cotizacion": 1,
      "fecha": "20261001",
      "importes": { "exento": 50, "iva": 105.05, "neto": 1000.45, "noGravado": 25, "total": 1180.5, "tributos": 0 },
      "moneda": "PES",
      "numero": 12,
      "numeroDocumento": 0,
      "resultado": "A",
      "tipoDocumento": 99
    }
  ],
  "entorno": "testing",
  "puntoVenta": 3
}
```

`arcli consultar <tipo> <numero> --json` devuelve un solo comprobante, con los mismos campos al primer nivel (sin el array `comprobantes`).

| Campo                     | Tipo             | Descripción                                                           |
| ------------------------- | ---------------- | --------------------------------------------------------------------- |
| `fecha`, `caeVencimiento` | `string`         | Formato ARCA `yyyymmdd`                                               |
| `concepto`                | `number`         | `1` productos, `2` servicios, `3` productos y servicios               |
| `tipoDocumento`           | `number`         | Código de ARCA: `80` CUIT, `86` CUIL, `96` DNI, `99` consumidor final |
| `moneda`                  | `string`         | Código de ARCA (`PES`, `DOL`…)                                        |
| `importes`                | `object`         | `total`, `neto`, `iva`, `exento`, `noGravado` y `tributos`            |
| `resultado`               | `string \| null` | `A` aprobado, `R` rechazado                                           |

## Padrón (`padron`)

`arcli padron <cuit> --json` devuelve los datos de la constancia de inscripción. Los campos que ARCA no informa salen en `null` (o `[]` en las listas):

```json
{
  "actividades": [{ "descripcion": "SERVICIOS DE CONSULTORES EN INFORMATICA", "id": 620100 }],
  "avisos": [],
  "categoriaMonotributo": null,
  "condicionIva": "responsable-inscripto",
  "cuit": 20201797064,
  "deprecado": ["`cuit` pasa a ser texto en la 3.0.0: leelo como texto para que no te afecte."],
  "domicilio": "AV SIEMPRE VIVA 742, CABA, CP 1000, CIUDAD AUTONOMA BUENOS AIRES",
  "entorno": "testing",
  "estadoClave": "ACTIVO",
  "impuestos": [{ "activo": true, "descripcion": "IVA", "id": 30 }],
  "nombre": "PEREZ JUAN",
  "tipoPersona": "fisica"
}
```

| Campo                  | Tipo                             | Descripción                                                                                                          |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `actividades`          | `{ descripcion, id }[]`          | Actividades; la primera es la principal                                                                              |
| `avisos`               | `string[]`                       | Observaciones de ARCA sobre la constancia                                                                            |
| `categoriaMonotributo` | `string \| null`                 | Categoría, si es monotributista                                                                                      |
| `condicionIva`         | `string \| null`                 | `responsable-inscripto`, `responsable-monotributo` o `sujeto-exento`; `null` si no se puede deducir de los impuestos |
| `cuit`                 | `number`                         | CUIT consultado                                                                                                      |
| `domicilio`            | `string \| null`                 | Domicilio fiscal en una línea                                                                                        |
| `entorno`              | `"testing" \| "produccion"`      | Entorno consultado                                                                                                   |
| `estadoClave`          | `string \| null`                 | Estado de la clave fiscal según ARCA, por ejemplo `ACTIVO`                                                           |
| `impuestos`            | `{ activo, descripcion, id }[]`  | Impuestos inscriptos                                                                                                 |
| `nombre`               | `string \| null`                 | Razón social, o apellido y nombre                                                                                    |
| `tipoPersona`          | `"fisica" \| "juridica" \| null` | Tipo de persona                                                                                                      |

Si el CUIT no figura, es el error `TAXPAYER_NOT_FOUND` (ver [códigos](#códigos-de-error)).

## Régimen FCE (`fce-obligado`)

`arcli fce-obligado <cuit> --json`:

```json
{
  "cuit": 30546689979,
  "deprecado": ["`cuit` pasa a ser texto en la 3.0.0: leelo como texto para que no te afecte."],
  "entorno": "testing",
  "fecha": "20261019",
  "montoDesde": 3958316,
  "obligado": true
}
```

| Campo        | Tipo      | Descripción                                                    |
| ------------ | --------- | -------------------------------------------------------------- |
| `cuit`       | `number`  | CUIT consultado                                                |
| `fecha`      | `string`  | Fecha consultada, formato ARCA `yyyymmdd` (`--fecha` o hoy)    |
| `montoDesde` | `number`  | Monto en pesos desde el que corresponde FCE                    |
| `obligado`   | `boolean` | `true` si el receptor está obligado a recibir FCE en esa fecha |
| `entorno`    | `string`  | `testing` o `produccion`                                       |

## Estado de ARCA (`estado`)

`arcli estado --json`:

```json
{
  "deprecado": ["`puntoVenta` pasa a ser un número en la 3.0.0: para el detalle usá `puntoVentaDetalle`."],
  "entorno": "produccion",
  "latenciaMs": 412,
  "listo": true,
  "puntoVenta": { "estado": "habilitado", "numero": 3, "tipoEmision": "CAE" },
  "puntoVentaDetalle": { "estado": "habilitado", "numero": 3, "tipoEmision": "CAE" },
  "servidores": { "aplicacion": "OK", "autenticacion": "OK", "baseDeDatos": "OK" }
}
```

| Campo                    | Tipo             | Descripción                                                                                     |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| `listo`                  | `boolean`        | Se puede emitir: los tres servidores en `OK` y el punto de venta `habilitado` o `sin-datos`     |
| `latenciaMs`             | `number`         | Lo que tardó ARCA en responder el estado de los servidores                                      |
| `servidores`             | `object`         | `aplicacion`, `baseDeDatos` y `autenticacion`, tal como los informa ARCA (`OK` si andan)        |
| `puntoVentaDetalle`      | `object`         | Lo mismo que `puntoVenta`, que en la 3.0.0 pasa a ser un número. Se detalla abajo               |
| `puntoVenta.estado`      | `string`         | `habilitado`, `bloqueado`, `de-baja`, `no-encontrado`, `sin-datos` (testing) o `sin-configurar` |
| `puntoVenta.numero`      | `number \| null` | Punto de venta de la config; `null` si no hay                                                   |
| `puntoVenta.tipoEmision` | `string \| null` | Tipo de emisión que informa ARCA, si encontró el punto de venta                                 |
| `entorno`                | `string`         | `testing` o `produccion`                                                                        |

`listo: false` **no es un error**: el comando sale con exit code `0`. Revisá `listo` en el JSON. Si ARCA no responde, sí es error: `ARCA_UNAVAILABLE`, con exit code `1`.

## Tablas de ARCA (`parametros`)

`arcli parametros --json` lista las tablas (no consulta ARCA ni necesita config):

```json
{
  "tablas": [
    { "descripcion": "Alícuotas de IVA", "tabla": "alicuotas" },
    { "descripcion": "Cotización oficial de ARCA", "tabla": "cotizacion" }
  ]
}
```

`arcli parametros <tabla> --json` devuelve los valores vigentes:

```json
{
  "entorno": "testing",
  "tabla": "alicuotas",
  "valores": [{ "descripcion": "21%", "detalle": null, "id": "5", "vigenteHasta": null }]
}
```

| Campo                    | Tipo             | Descripción                                                                               |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `valores[].id`           | `string`         | Código de ARCA                                                                            |
| `valores[].descripcion`  | `string`         | Descripción de ARCA                                                                       |
| `valores[].detalle`      | `string \| null` | Dato propio de la tabla: clase de comprobante en `iva-receptor`, estado en `puntos-venta` |
| `valores[].vigenteHasta` | `string \| null` | Fin de vigencia, `yyyymmdd`; `null` si no vence                                           |

En testing, `puntos-venta` sale con `valores: []`: ARCA no informa puntos de venta en ese entorno.

`arcli parametros cotizacion <moneda> --json`:

```json
{ "cotizacion": 1452.5, "entorno": "produccion", "fecha": "20261017", "moneda": "DOL" }
```

`moneda` es el código de ARCA (`USD` sale como `DOL`) y `fecha` (`yyyymmdd`) puede ser `null`.

## Configuración (`config` y `config revisar`)

`arcli config --json` (y `config establecer` o `config eliminar` con `--json`, que devuelven la config resultante) muestra la config con las rutas enmascaradas. Las claves sin valor no aparecen:

```json
{
  "alicuota": "21",
  "cert": { "testing": ".../certs/testing.crt" },
  "concepto": "servicios",
  "consultarPadron": true,
  "cotizacion": 1,
  "cuit": "20333333334",
  "emisor": { "razonSocial": "Ana Gomez", "domicilio": "Calle 1, CABA" },
  "emitir": false,
  "entorno": "testing",
  "exportacion": { "cert": {}, "key": {} },
  "json": false,
  "key": { "testing": ".../certs/testing.key" },
  "moneda": "PES",
  "pdf": "preguntar",
  "pdfCarpeta": ".../arcli/comprobantes",
  "puntoVenta": 3,
  "bruto": false,
  "ticketPath": ".../arcli/tickets"
}
```

Las claves son las de [configuración](configuration.md), salvo que `cert.*`, `key.*`, `emisor.*` y `exportacion.*` van anidadas en los objetos `cert`, `key`, `emisor` y `exportacion` (vacíos si no hay nada; `exportacion` trae a su vez `cert`, `key` y, si está, `actividad`). `emitir`, `entorno`, `exportacion`, `json`, `bruto`, `pdf`, `pdfCarpeta`, `moneda`, `cotizacion`, `consultarPadron` y `ticketPath` siempre aparecen, con su valor por defecto si no se configuraron; el resto, solo si tiene valor.

`arcli config revisar --json`:

```json
{
  "chequeos": [
    { "categoria": "ok", "detalle": "Entorno por defecto: testing.", "etiqueta": "Entorno" },
    {
      "categoria": "warning",
      "detalle": "Configurá un punto de venta por defecto con `arcli config establecer puntoVenta <valor>`.",
      "etiqueta": "Punto de venta"
    },
    {
      "categoria": "error",
      "detalle": "Falta el CUIT. Configuralo con `arcli config establecer cuit <valor>`.",
      "etiqueta": "Validación testing"
    }
  ],
  "ok": false
}
```

`categoria` es `ok`, `warning` o `error`, y `ok` es `true` solo si todos los chequeos son `ok`. `ok: false` **no es un error**: el comando sale con exit code `0`. Revisá `ok` y las `categoria` en el JSON.

## Plugin de PDF (`pdf estado`)

`arcli pdf --json`, `arcli pdf estado --json` y `arcli pdf instalar --json` (al terminar) devuelven:

```json
{
  "instalado": true,
  "navegador": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "origenNavegador": "sistema",
  "ruta": "/Users/ana/Library/Preferences/arcli/plugins/pdf",
  "version": "0.2.1",
  "versionInstalada": "0.2.1"
}
```

| Campo              | Tipo             | Descripción                                                                                  |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------- |
| `instalado`        | `boolean`        | El plugin está instalado                                                                     |
| `navegador`        | `string \| null` | Navegador que usa para el PDF; `null` si no encontró ninguno                                 |
| `origenNavegador`  | `string \| null` | `config` (`pdfNavegador`), `entorno` (`PUPPETEER_EXECUTABLE_PATH`), `sistema` o `descargado` |
| `ruta`             | `string`         | Carpeta del plugin                                                                           |
| `version`          | `string`         | Versión del plugin que usa esta versión de arcli                                             |
| `versionInstalada` | `string \| null` | Versión instalada; `null` si no está instalado                                               |

`arcli pdf desinstalar --json` devuelve `{ "desinstalado": true, "ruta": "..." }`.

## Certificados (`certificado`)

`arcli certificado generar --json` devuelve el pedido y los pasos para ARCA:

```json
{
  "alias": "arcli",
  "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "cuit": "20123456786",
  "entorno": "produccion",
  "guia": "https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md",
  "pasos": ["1. Entrá a ARCA con tu clave fiscal y abrí \"Administración de Certificados Digitales\".", "..."],
  "rutaClave": "/Users/ana/Library/Preferences/arcli/certificados/20123456786/produccion.nueva.key",
  "rutaCsr": "/Users/ana/Library/Preferences/arcli/certificados/20123456786/produccion.nueva.csr"
}
```

`arcli certificado importar <archivo> --json` devuelve lo que cargó:

```json
{
  "alias": "arcli",
  "cuit": "20123456786",
  "entorno": "produccion",
  "reemplazado": false,
  "rutaCertificado": "/Users/ana/Library/Preferences/arcli/certificados/20123456786/produccion.crt",
  "rutaClave": "/Users/ana/Library/Preferences/arcli/certificados/20123456786/produccion.key",
  "vence": "2028-11-04T12:00:00.000Z"
}
```

| Campo         | Tipo             | Descripción                                                       |
| ------------- | ---------------- | ----------------------------------------------------------------- |
| `alias`       | `string \| null` | Nombre del certificado en ARCA (`CN` del certificado)             |
| `entorno`     | `string`         | `testing` o `produccion`, según quién firmó el certificado        |
| `reemplazado` | `boolean`        | Había otro certificado configurado para el entorno y se reemplazó |
| `vence`       | `string`         | Vencimiento, en ISO 8601                                          |

Los errores de los dos comandos son los `CERTIFICATE_*` de la [tabla de códigos](#códigos-de-error); ninguno toca la config ni los archivos.

## Acceso directo y autocompletado

`arcli acceso-directo --json` devuelve dónde quedó el acceso directo:

```json
{
  "reemplazado": false,
  "ruta": "/Users/ana/Desktop/ARCLI.app",
  "usaArcliInstalado": false
}
```

| Campo               | Tipo      | Descripción                                                                                     |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `reemplazado`       | `boolean` | Ya había un acceso directo de ARCLI en esa carpeta y se actualizó                               |
| `ruta`              | `string`  | Ruta del acceso directo                                                                         |
| `usaArcliInstalado` | `boolean` | Se creó desde el código fuente (`yarn dev`): abre el `arcli` instalado en lugar del que lo creó |

`arcli completado --json`, `arcli completado instalar --json` y `arcli completado desinstalar --json` devuelven el estado del autocompletado:

```json
{
  "cambio": true,
  "instalado": true,
  "ruta": "/Users/ana/.zshrc",
  "shell": "zsh"
}
```

| Campo       | Tipo      | Descripción                                                                       |
| ----------- | --------- | --------------------------------------------------------------------------------- |
| `cambio`    | `boolean` | Solo en `instalar` y `desinstalar`: si se modificó el archivo de inicio del shell |
| `instalado` | `boolean` | El autocompletado queda instalado                                                 |
| `ruta`      | `string`  | Archivo de inicio del shell (`~/.zshrc`, `~/.bashrc`…)                            |
| `shell`     | `string`  | `bash`, `zsh` o `fish`                                                            |

## Formato de errores

Los errores salen en JSON con `--json` o, sin el flag, si la config tiene `json=true`. Van a stderr y el proceso termina con exit code `1`.

Todos tienen las mismas cuatro claves:

| Campo        | Tipo                      | Descripción                                                                              |
| ------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| `codigo`     | `string`                  | Código estable del error (ver [códigos](#códigos-de-error))                              |
| `detalles`   | `object \| array \| null` | Datos del error: un objeto, la lista de campos en errores de validación de Zod, o `null` |
| `error`      | `string`                  | Mensaje para mostrar                                                                     |
| `sugerencia` | `string \| null`          | Qué hacer; `null` cuando no hay nada que sugerir                                         |

En los errores de ARCA, `detalles.errores` trae cada error con `codigo` y `mensaje`. Si `detalles.errors` también está, `detalles.deprecado` avisa que se saca en la 3.0.0.

Un comprobante **rechazado por ARCA no es un error del comando**: sale como resultado normal (stdout, `estado: "rechazado"`, con `errores` y `observaciones`), pero el exit code es `2`.

| Exit code | Cuándo                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| `0`       | Todo bien: comprobantes aprobados (también `observado`, que tiene CAE) o vista previa |
| `1`       | Error: entrada inválida, configuración, red o ARCA sin respuesta                      |
| `2`       | ARCA rechazó al menos un comprobante. En un lote, revisá `estado` de cada uno         |

Dos comandos de diagnóstico informan un problema sin que sea un error: `arcli config revisar` con `ok: false` y `arcli estado` con `listo: false` salen por stdout con exit code `0`. Para saber si está todo listo, leé `ok` o `listo` en el JSON, no el exit code.

### Códigos de error

| Código                             | Comando                                                                    | Qué pasó                                                                                                        | Qué hacer                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `INPUT_VALIDATION_ERROR`           | todos                                                                      | Flags, argumentos o JSON de `--cargar` inválidos o incompletos                                                  | Corregí lo que indican `error` y `detalles`; no se emitió nada                                                                           |
| `CONFIGURATION_ERROR`              | todos los que usan ARCA, `config`                                          | Falta o es inválido un dato de la config: CUIT, certificado, clave, `config.json` corrupto                      | `arcli config revisar` y `arcli config establecer`                                                                                       |
| `BATCH_VALIDATION_ERROR`           | facturación con lote                                                       | Algún comprobante del lote es inválido; no se emitió ninguno                                                    | Corregí los índices de `detalles.comprobantes` y corré el lote completo ([detalle](#validación-y-errores-del-lote))                      |
| `BATCH_EMISSION_ERROR`             | facturación con lote                                                       | El lote se cortó a mitad; los procesados salen antes por stdout                                                 | No reemitas los procesados; verificá `detalles.sinConfirmar` con `arcli ultimos` y reintentá `detalles.sinProcesar`                      |
| `EMISSION_UNCERTAIN`               | facturación                                                                | Falló la llamada que emite: puede haberse emitido igual                                                         | Seguí la `sugerencia` antes de reintentar ([detalle](#emisión-sin-confirmar))                                                            |
| `TRANSIENT_ERROR`                  | todos los que usan ARCA                                                    | WSAA o ARCA informan un estado pasajero (ticket vigente, transacción activa)                                    | Esperá unos segundos y reintentá sin cambiar nada                                                                                        |
| `UNEXPECTED_ERROR`                 | todos                                                                      | Error sin código propio: red, login en WSAA (certificado vencido o no autorizado), respuesta inesperada de ARCA | Leé `error`; si es de red o de ARCA, reintentá más tarde                                                                                 |
| `ARCA_UNAVAILABLE`                 | `estado`                                                                   | ARCA no respondió a la consulta de estado                                                                       | Reintentá en unos minutos; si persiste, ARCA está caído                                                                                  |
| `ARCA_PARAMETERS_ERROR`            | `parametros <tabla>`                                                       | ARCA devolvió un error al consultar una tabla o los puntos de venta (`detalles.errores`)                        | Revisá el mensaje de ARCA; suele ser pasajero o de permisos del certificado                                                              |
| `ARCA_QUOTATION_ERROR`             | `parametros cotizacion`, facturación en moneda extranjera sin `--cm`, `fe` | ARCA no devolvió una cotización válida para la moneda                                                           | Revisá el código de moneda (`arcli parametros monedas`) o pasá la cotización con `--cm` (sin `--misma-moneda`)                           |
| `ARCA_LAST_VOUCHER_ERROR`          | facturación, `ultimos`                                                     | ARCA devolvió un error al pedir el último número (`detalles.errores`); no se emitió nada                        | Si es del punto de venta (11002), revisá `arcli parametros puntos-venta`; si no, el mensaje de ARCA y reintentá                          |
| `VOUCHER_NOT_FOUND`                | `consultar`                                                                | El comprobante no existe en ese punto de venta y entorno                                                        | Revisá tipo, número, `--pv` y entorno; `arcli ultimos` lista los emitidos                                                                |
| `TAXPAYER_NOT_FOUND`               | `padron`                                                                   | El CUIT no figura en el padrón de ese entorno                                                                   | Revisá el número; en testing el padrón tiene datos ficticios (`sugerencia` trae un CUIT de prueba)                                       |
| `PADRON_SERVICE_NOT_AUTHORIZED`    | `padron`                                                                   | El certificado no está autorizado para `ws_sr_constancia_inscripcion`                                           | Autorizalo como `wsfe` ([certificados](obtencion-certificados.md)). Al facturar no corta: se usa `ivaReceptor` de la config con un aviso |
| `FCE_SERVICE_NOT_AUTHORIZED`       | `fce-obligado`                                                             | El certificado no está autorizado para `wsfecred`                                                               | Autorizalo como `wsfe` ([certificados](obtencion-certificados.md)). Con `verificarFce` al facturar no corta: sale como aviso             |
| `WSFEX_SERVICE_NOT_AUTHORIZED`     | `fe`, `factura e`                                                          | El certificado no está autorizado para `wsfex`                                                                  | Autorizalo como `wsfe` ([certificados](obtencion-certificados.md)) o configurá `exportacion.cert.*`/`exportacion.key.*`                  |
| `ARCA_EXPORT_ERROR`                | `fe`, `factura e`                                                          | WSFEX devolvió un error al consultar una tabla, el ID de solicitud o la cotización (`detalles.errores`)         | Revisá el mensaje de ARCA; no se emitió nada                                                                                             |
| `FCE_OBLIGATION_ERROR`             | `fce-obligado`                                                             | ARCA no pudo informar si el receptor está obligado a FCE (`detalles.errores`)                                   | Revisá el CUIT y la fecha; los códigos de ARCA vienen en el mensaje. Al facturar sale como aviso                                         |
| `CERTIFICATE_REQUEST_PENDING`      | `certificado generar`                                                      | Ya hay un pedido del entorno sin importar                                                                       | Importá el certificado de ese pedido, o sumá `--reemplazar` para descartarlo y armar otro                                                |
| `CERTIFICATE_INVALID`              | `certificado importar`                                                     | El archivo no tiene un certificado X.509                                                                        | Usá el `.crt` que bajaste de ARCA, sin abrirlo ni guardarlo con otro programa                                                            |
| `CERTIFICATE_CUIT_MISMATCH`        | `certificado importar`                                                     | El certificado es de otro CUIT que el de la config                                                              | Bajalo con la clave fiscal del CUIT configurado, o cambiá `cuit`                                                                         |
| `CERTIFICATE_EXPIRED`              | todos los que usan ARCA, `certificado importar`                            | El certificado del entorno ya venció ([detalle](#certificado-vencido)); en `importar`, el que se quiso cargar   | Renovalo con `arcli certificado generar`                                                                                                 |
| `CERTIFICATE_ENVIRONMENT_UNKNOWN`  | `certificado importar`                                                     | El emisor no es una autoridad de ARCA conocida                                                                  | Si es de ARCA, indicá el entorno con `--testing` o `--produccion`                                                                        |
| `CERTIFICATE_KEY_MISMATCH`         | `certificado importar`                                                     | El certificado no corresponde a la clave del pedido ni a la configurada                                         | Bajá el certificado que creaste con el último CSR de `arcli certificado generar`                                                         |
| `CERTIFICATE_REPLACE_CONFIRMATION` | `certificado importar`                                                     | Ya hay otro certificado configurado para ese entorno                                                            | Sumá `--reemplazar` (en una terminal, se pregunta)                                                                                       |
| `DESKTOP_SHORTCUT_ERROR`           | `acceso-directo`                                                           | Windows no pudo crear el `.lnk`                                                                                 | Revisá los permisos de la carpeta y que PowerShell esté disponible                                                                       |
| `PDF_PLUGIN_INSTALL_ERROR`         | `pdf instalar`                                                             | No se pudo descargar el plugin o el navegador                                                                   | Revisá la conexión o el proxy de npm y reintentá                                                                                         |
| `PDF_*` en `pdf.error`             | facturación con PDF                                                        | No es un error del comando: el comprobante se emitió y falló solo el PDF                                        | Ver [errores del PDF](#errores-del-pdf); no reemitas                                                                                     |

### Errores JSON de validación

Cuando el error viene de Zod o de validación de entrada:

```json
{
  "codigo": "INPUT_VALIDATION_ERROR",
  "detalles": [
    {
      "mensaje": "Falta el dato: monto.",
      "ruta": ["montoTotal"]
    }
  ],
  "error": "Hay parámetros inválidos o incompletos en la entrada.",
  "sugerencia": null
}
```

### Errores JSON de uso

Una opción desconocida, un valor faltante o un comando que no existe también sale en JSON cuando corresponde (`--json` o `json=true` en la config), con exit code `1`. El mensaje es el de commander traducido al español, en una sola línea. `--ayuda` y `--version` no son errores.

```json
{
  "codigo": "INPUT_VALIDATION_ERROR",
  "detalles": null,
  "error": "opción desconocida `--montoo` (¿quisiste decir `--monto`?)",
  "sugerencia": "Usá `arcli ayuda` o `arcli <comando> --ayuda` para ver comandos y opciones."
}
```

### Errores JSON de configuración

```json
{
  "codigo": "CONFIGURATION_ERROR",
  "detalles": null,
  "error": "Falta la ruta del certificado para testing. Configurá \"cert.testing\".",
  "sugerencia": null
}
```

Si el `config.json` tiene JSON inválido, sale con el mismo código, la ruta del archivo y qué hacer:

```json
{
  "codigo": "CONFIGURATION_ERROR",
  "detalles": { "ruta": "/Users/ana/Library/Preferences/arcli/config.json" },
  "error": "El archivo de configuración tiene JSON inválido y no se puede leer.",
  "sugerencia": "Corregilo a mano, o renombralo (por ejemplo, a config.json.bak) y volvé a cargar los datos con `arcli config establecer` o desde \"Configuración\" en `arcli`. ARCLI no lo borra ni lo pisa."
}
```

### Certificado vencido

Con el certificado del entorno vencido, los comandos que van a ARCA cortan antes de autenticar en WSAA: no se envió nada y no hay que verificar. Con `--json` no sale el banner, solo este error en stderr:

```json
{
  "codigo": "CERTIFICATE_EXPIRED",
  "detalles": { "entorno": "produccion", "vencimiento": "20/11/2026" },
  "error": "El certificado de producción venció el 20/11/2026: ARCA no lo acepta.",
  "sugerencia": "Renovalo con `arcli certificado generar --produccion` y cargá el .crt de ARCA con `arcli certificado importar <archivo>`. Guía: https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md"
}
```

### Emisión sin confirmar

Si falla la llamada que emite en ARCA (red, timeout, transacción activa), no se sabe si el comprobante quedó autorizado: pudo emitirse y perderse la respuesta. **No reintentes sin verificar**, porque se duplicaría.

Los pasos previos no cuentan: si falla el login en WSAA (por ejemplo, un certificado no autorizado; uno vencido corta antes, con [`CERTIFICATE_EXPIRED`](#certificado-vencido)) o el pedido del último número, no se envió nada: sale como `ARCA_LAST_VOUCHER_ERROR` si ARCA devolvió errores, o como `UNEXPECTED_ERROR` o `TRANSIENT_ERROR` si falló la red o WSAA.

```json
{
  "codigo": "EMISSION_UNCERTAIN",
  "detalles": { "causa": "socket hang up" },
  "error": "No se pudo confirmar la emisión: socket hang up",
  "sugerencia": "Puede haberse emitido igual. Antes de reintentar, verificá con `arcli ultimos fc --pv 3`: si figura, ya está emitido y no hay que repetirlo."
}
```

En la factura E (`fe`) el número lo pasás vos con `--numero`, y ARCA no autoriza dos comprobantes con el mismo número. Por eso la `sugerencia` no manda a verificar con `arcli ultimos` (que no acepta `fe`) sino a reintentar con los mismos `--numero` e `--id-solicitud`, que también vienen en `detalles`:

```json
{
  "codigo": "EMISSION_UNCERTAIN",
  "detalles": { "causa": "socket hang up", "idSolicitud": 42, "numero": 7 },
  "error": "No se pudo confirmar la emisión: socket hang up",
  "sugerencia": "Puede haberse emitido igual. Si reintentás, usá el mismo número y la misma solicitud (`--numero 7 --id-solicitud 42 --pv 3`): si ya se había emitido, ARCA no lo autoriza dos veces."
}
```

En un lote, el mismo caso sale como `BATCH_EMISSION_ERROR` con `detalles.sinConfirmar` (el índice que hay que verificar).

### Errores transitorios o inesperados

```json
{
  "codigo": "TRANSIENT_ERROR",
  "detalles": null,
  "error": "ns1:coe.alreadyAuthenticated",
  "sugerencia": "WSAA informó que ya existe un TA válido para este servicio. Esperá unos segundos y volvé a intentar sin cambiar el payload."
}
```

### Errores del PDF

Un error del PDF **no** es un error del comando: el comprobante ya se emitió, así que el error va dentro del resultado, en `pdf.error`, y el código de salida no cambia. Los códigos son `PDF_PLUGIN_MISSING`, `PDF_PLUGIN_INSTALL_ERROR`, `PDF_ISSUER_INCOMPLETE` y `PDF_GENERATION_ERROR`. Ver [PDF de comprobantes](pdf.md#salida).

`arcli pdf instalar` sí falla como un comando, con `sugerencia`:

```json
{
  "codigo": "PDF_PLUGIN_INSTALL_ERROR",
  "detalles": { "salida": "npm error code ECONNREFUSED" },
  "error": "npm no pudo instalar @arcasdk/pdf.",
  "sugerencia": "Revisá la conexión a internet o el proxy de npm y volvé a correr `arcli pdf instalar`."
}
```

## Diferencias entre modos

| Modo              | Llama a ARCA   | Devuelve solicitud | Devuelve respuesta real                        | Contrato recomendado               |
| ----------------- | -------------- | ------------------ | ---------------------------------------------- | ---------------------------------- |
| texto             | depende        | sí                 | depende                                        | uso humano                         |
| `--json`          | depende        | sí                 | resumen serializado                            | automatización                     |
| `--json --bruto`  | depende        | sí                 | resumen + cruda (`respuesta`), si hubo emisión | automatización con detalle técnico |
| `--previsualizar` | solo consultas | sí                 | no                                             | revisión previa                    |
| `--emitir`        | sí             | sí                 | sí                                             | operación real                     |
