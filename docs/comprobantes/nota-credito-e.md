<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# Nota de crédito E

<!-- arcli: familia="Exportación · E" icono="menos" orden="21" -->

Resta sobre una Factura E: un descuento, una devolución o una anulación. Cliente, destino, moneda y actividad salen de la factura, que ARCLI consulta en ARCA.

`arcli nce` | `arcli nota-credito e`

## Ejemplo

```bash
arcli nce -m 500 --ar 1 --apv 4
```

Sin `--emitir` muestra la vista previa y pregunta antes de emitir. También se emite desde el [asistente](../modo-interactivo.md), sin recordar flags.

## Obligatorio

Sin esto no se puede emitir. Lo que guardaste en la config no hace falta repetirlo.

<!-- arcli: opciones=req -->

### Importe

El total del comprobante, en formato argentino: punto para miles y coma para decimales.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--monto <número>` | `-m` | 15000, 15.000 o 1.500,50 |

Ej.: `-m 15000`

### Factura que ajusta

Cliente, destino, moneda y actividad salen de ella.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--ar <número>` |  | Su número |
| `--asociado-punto-venta <número>` | `--apv` | Su punto de venta; por defecto, el de la nota |
| `--ac <atajo>` |  | fe (por defecto), nde o nce |
| `--at <número>` |  | Tipo ARCA: 19, 20 o 21 |

Ej.: `--ar 1 --apv 4`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Permisos de embarque

Solo si la factura es de bienes. Repetible.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--permiso <id>` |  | Un permiso de embarque |

Ej.: `--permiso 26001EC01000123A`

### Ítems

Repetible. La suma tiene que dar el monto. Sin ítems, va un renglón con `--descripcion`.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--item <partes>` |  | "código\|descripción\|cantidad\|precio\|unidad" |
| `--descripcion <texto>` |  | Detalle cuando no hay ítems |

Ej.: `--item "001|Servicio|1|1500|7"`

### Datos del comprobante

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--incoterm <código>` |  | En bienes, por ejemplo FOB |
| `--incoterms-desc <texto>` |  | Descripción del incoterm |
| `--idioma <1\|2\|3>` |  | Español (por defecto), inglés o portugués |
| `--forma-pago <texto>` |  | Por defecto, "Transferencia Internacional" |
| `--observaciones <texto>` |  | Observaciones |
| `--obs-comerciales <texto>` |  | Observaciones comerciales |

Ej.: `--idioma 2`

### Punto de venta

Si no es el de la config.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--punto-venta <número>` | `--pv` | Un punto de venta para web service |

Ej.: `--pv 3`

### Fecha

Si no es hoy.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--fecha <fecha>` | `-f` | D, D/M, D/M/AA o D/M/AAAA |

Ej.: `-f 31/10`

### Numeración

Por defecto, la que sigue en ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--numero <número>` |  | Número del comprobante |
| `--id-solicitud <número>` |  | ID de la solicitud |

Ej.: `--numero 12`

## Al ejecutar

No cambian el comprobante: cómo corre ARCLI esta vez. Son los mismos en todos los comprobantes.

<!-- arcli: opciones=run -->

### Vista previa o emisión

Sin ninguno, muestra la vista previa y pregunta antes de emitir.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--previsualizar` |  | Solo la vista previa: no emite |
| `--emitir` |  | Emite sin preguntar |

Ej.: `--emitir`

### Entorno

Si no es el de la config.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--testing` |  | Homologación: no vale fiscalmente |
| `--produccion` |  | Comprobantes reales |

Ej.: `--produccion`

### PDF

Aunque la config diga otra cosa.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--exportar-pdf` | `--pdf` | Genera el PDF |
| `--sin-pdf` |  | No lo genera |

Ej.: `--pdf`

### Salida

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--json` |  | JSON, para scripts e IAs |
| `--bruto` |  | Suma la respuesta cruda de ARCA |

Ej.: `--json`

### Desde un archivo

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--cargar <archivo>` |  | Los datos desde un JSON, también varios comprobantes |

Ej.: `--cargar facturas.json`

## Para tener en cuenta

- La nota de crédito no puede superar el total del comprobante que ajusta, si van en la misma moneda: ARCLI lo revisa antes de emitir.
- Los permisos de embarque van solo si la factura es de bienes (`--tipo-expo 1`).

## No aplica

Estos flags no van en este comprobante: `--fecha-pago`, `--misma-moneda`, `--permiso-existente`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
