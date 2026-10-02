[← Volver al README](../README.md)

# Entrada y salida

Contrato formal de entrada y salida de ARCLI.

Este documento asume el flujo descrito en [mental-model.md](mental-model.md) (`Input -> Validación -> Solicitud -> ARCA -> Output`, con prioridad `flags > JSON > config > defaults`) y se enfoca en el contrato concreto de cada formato.

## Formato de input: objeto

Cuando usás `--cargar`, ARCLI espera un objeto JSON o un array de objetos.

```bash
arcli fc --cargar ./voucher.json
```

### Campos soportados

| Campo                 | Tipo    | Requerido                              | Descripción                                                                                              |
| --------------------- | ------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `alicuotaIva`         | string  | no                                     | Alícuota de IVA: `0`, `2.5`, `5`, `10.5`, `21` o `27`                                                    |
| `aliasCbu`            | string  | no                                     | Alias del CBU (facturas FCE)                                                                             |
| `anulacion`           | boolean | no                                     | NC/ND FCE de anulación                                                                                   |
| `cbu`                 | string  | en facturas FCE, salvo `config.cbu`    | CBU del emisor (facturas FCE)                                                                            |
| `comprobanteAsociado` | object  | no                                     | Comprobante asociado                                                                                     |
| `concepto`            | string  | sí, salvo default por flags/config     | Concepto                                                                                                 |
| `codigoMoneda`        | string  | no                                     | Moneda                                                                                                   |
| `cotizacionMoneda`    | number  | en moneda extranjera sin `mismaMoneda` | Cotización de la moneda                                                                                  |
| `mismaMoneda`         | boolean | no                                     | El pago se cancela en la moneda extranjera                                                               |
| `dia`                 | number  | no                                     | Día de vencimiento o referencia                                                                          |
| `emitir`              | boolean | no                                     | Emisión real                                                                                             |
| `fechaComprobante`    | string  | no                                     | Fecha del comprobante                                                                                    |
| `importeExento`       | number  | no                                     | Parte exenta del total (A y B)                                                                           |
| `importeNoGravado`    | number  | no                                     | Parte no gravada del total (A y B)                                                                       |
| `ivaReceptor`         | string  | sí, salvo default por config           | Condición IVA del receptor                                                                               |
| `montoTotal`          | number  | sí                                     | Importe total                                                                                            |
| `periodoAsociado`     | object  | no                                     | `{ "desde": "01-09-2026", "hasta": "30-09-2026" }`; alternativa a `comprobanteAsociado` en notas comunes |
| `numeroDocumento`     | number  | depende del tipo de documento          | Número de documento                                                                                      |
| `previsualizar`       | boolean | no                                     | Preview sin emitir                                                                                       |
| `puntoVenta`          | number  | no                                     | Punto de venta                                                                                           |
| `servicioDesde`       | string  | no                                     | Fecha inicio de servicio                                                                                 |
| `servicioHasta`       | string  | no                                     | Fecha fin de servicio                                                                                    |
| `vencimientoPago`     | string  | no                                     | Fecha de vencimiento del pago                                                                            |
| `tipoDocumento`       | string  | no                                     | `consumidor-final`, `cuit`, `cuil` o `dni`                                                               |
| `transferencia`       | string  | no                                     | `sca` o `adc` (facturas FCE)                                                                             |

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
  "fechaComprobante": "27-03-2026",
  "ivaReceptor": "responsable-inscripto",
  "montoTotal": 15000,
  "numeroDocumento": 20168598204,
  "puntoVenta": 3,
  "servicioDesde": "27-03-2026",
  "servicioHasta": "27-03-2026",
  "tipoDocumento": "cuit"
}
```

### Ejemplo con asociado

```json
{
  "comprobanteAsociado": {
    "atajo": "fa",
    "cuit": "20409509763",
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

## Formato de input: batch

Si el archivo contiene un array, ARCLI procesa un lote del mismo comando.

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

### ⚠️ Batch fail-fast

Hoy el batch es fail-fast:

- si un item es inválido, el lote completo falla
- no hay resultados parciales por item
- el error típico es `INPUT_VALIDATION_ERROR`

## Output humano

La salida humana está pensada para terminal y prioriza legibilidad.

Incluye, según el caso:

- banner de entorno
- solicitud amigable
- estado visual del resultado
- paneles secundarios para `Observaciones`, `Eventos`, `Errores` y `Sugerencias`
- panel `Respuesta bruta` cuando se usa `--bruto`

### Estabilidad del contrato

La salida humana no debe tratarse como contrato estable para automatización. Para eso existe `--json`.

## Output JSON

### Caso simple

Sin `--bruto`, ARCLI serializa un resumen del resultado.

| Campo              | Tipo                                       | Descripción                                       |
| ------------------ | ------------------------------------------ | ------------------------------------------------- |
| `atajo`            | `string`                                   | Atajo del comprobante                             |
| `avisos`           | `string[]`                                 | Avisos de ARCLI, por ejemplo del régimen FCE      |
| `cae`              | `string \| null`                           | CAE informado por ARCA                            |
| `caeVencimiento`   | `string \| null`                           | Vencimiento del CAE                               |
| `comprobante`      | `string`                                   | Nombre visible del comprobante                    |
| `errores`          | `unknown[]`                                | Array de errores crudos                           |
| `estado`           | `"aprobado" \| "observado" \| "rechazado"` | Estado normalizado que arma ARCLI                 |
| `eventos`          | `unknown[]`                                | Array de eventos crudos                           |
| `observaciones`    | `string[]`                                 | Observaciones amigables                           |
| `observacion`      | `string \| null`                           | Observaciones unidas en una sola cadena           |
| `previsualizacion` | `boolean`                                  | `true` si no hubo emisión real                    |
| `resultado`        | `string \| null`                           | Resultado original de ARCA, por ejemplo `A` o `R` |
| `solicitud`        | `object`                                   | Solicitud enviada o previsualizada                |
| `sugerencias`      | `string[]`                                 | Sugerencias generadas por ARCLI                   |
| `tipoArca`         | `number`                                   | Tipo ARCA del comprobante                         |

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
  "errores": [],
  "estado": "aprobado",
  "eventos": [],
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

Cuando hay varios resultados, ARCLI devuelve un array.

Cada item agrega:

| Campo         | Tipo     | Descripción                         |
| ------------- | -------- | ----------------------------------- |
| `atajo`       | `string` | Atajo del comprobante               |
| `comprobante` | `string` | Nombre visible del comprobante      |
| `indice`      | `number` | Posición en el lote, empezando en 1 |

Y después incluye el resto del resultado serializado.

## Output con `--bruto`

Cuando se usa `--bruto`, el contrato cambia para priorizar inspección técnica.

| Campo              | Tipo       | Descripción                                   |
| ------------------ | ---------- | --------------------------------------------- |
| `atajo`            | `string`   | Atajo del comprobante                         |
| `avisos`           | `string[]` | Avisos de ARCLI, por ejemplo del régimen FCE  |
| `comprobante`      | `string`   | Nombre visible del comprobante                |
| `previsualizacion` | `boolean`  | `true` si no hubo emisión real                |
| `respuesta`        | `object`   | Respuesta cruda del SDK o un mensaje amigable |
| `solicitud`        | `object`   | Solicitud enviada o previsualizada            |
| `sugerencias`      | `string[]` | Sugerencias generadas por ARCLI               |

### Sin emisión real

Si no hubo emisión real, `respuesta` no se serializa como `null`. En su lugar:

```json
{
  "mensaje": "Sin emision real. Use --emitir para obtener una respuesta de ARCA."
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

## Formato de errores

### Errores JSON de validación

Cuando el error viene de Zod o de validación de entrada:

```json
{
  "codigo": "INPUT_VALIDATION_ERROR",
  "detalles": [
    {
      "mensaje": "Falta monto.",
      "ruta": ["montoTotal"]
    }
  ],
  "error": "Hay parametros invalidos o incompletos en la entrada."
}
```

### Errores JSON de configuración

```json
{
  "codigo": "CONFIGURATION_ERROR",
  "detalles": null,
  "error": "Falta la ruta del certificado para testing."
}
```

### Errores transitorios o inesperados

```json
{
  "codigo": "TRANSIENT_ERROR",
  "detalles": null,
  "error": "ns1:coe.alreadyAuthenticated",
  "sugerencia": "WSAA informo que ya existe un TA valido para este servicio. Espere unos segundos y vuelva a intentar sin cambiar la solicitud."
}
```

## Diferencias entre modos

| Modo              | Llama a ARCA | Devuelve solicitud | Devuelve respuesta real | Contrato recomendado |
| ----------------- | ------------ | ------------------ | ----------------------- | -------------------- |
| texto             | depende      | sí                 | depende                 | uso humano           |
| `--json`          | depende      | sí                 | resumen serializado     | automatización       |
| `--json --bruto`  | depende      | sí                 | sí, si hubo emisión     | depuración técnica   |
| `--previsualizar` | no           | sí                 | no                      | revisión previa      |
| `--emitir`        | sí           | sí                 | sí                      | operación real       |
