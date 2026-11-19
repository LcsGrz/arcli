<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# Factura E

<!-- arcli: familia="Exportación · E" icono="mundo" orden="22" -->

Bienes o servicios a un cliente del exterior. Usa el servicio wsfex, con su propio certificado y punto de venta.

`arcli fe` | `arcli factura e`

## Ejemplo

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212
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

### Cliente del exterior

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--cliente <texto>` |  | Nombre o razón social |
| `--domicilio-cliente <texto>` |  | Domicilio en el exterior |

Ej.: `--cliente "ACME LLC"`

### País de destino

El CUIT del país sale solo de la tabla de ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--pais-destino <código\|nombre>` |  | Por código (203) o nombre (Brasil) |

Ej.: `--pais-destino Brasil`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Tipo de exportación

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--tipo-expo 1` |  | Bienes |
| `--tipo-expo 2` |  | Servicios (por defecto) |
| `--tipo-expo 4` |  | Otros |

Ej.: `--tipo-expo 1`

### Actividad

Sin actividad, la E va sin ella. Si la usás, mejor guardarla en la config (`exportacion.actividad`).

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--actividad <código>` |  | Código de la tabla de actividades de WSFEX |

Ej.: `--actividad 620100`

### Ítems

Repetible. La suma tiene que dar el monto. Sin ítems, va un renglón con `--descripcion`.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--item <partes>` |  | "código\|descripción\|cantidad\|precio\|unidad" |
| `--descripcion <texto>` |  | Detalle cuando no hay ítems |

Ej.: `--item "001|Servicio|1|1500|7"`

### Más datos del cliente

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--id-impositivo <texto>` |  | Su ID impositivo en su país |
| `--cuit-pais <número>` |  | CUIT del país, si no querés el de la tabla |

Ej.: `--id-impositivo 12-3456789`

### Datos del comprobante

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--incoterm <código>` |  | Obligatorio en bienes, por ejemplo FOB |
| `--incoterms-desc <texto>` |  | Descripción del incoterm, hasta 20 caracteres |
| `--idioma <1\|2\|3>` |  | Español (por defecto), inglés o portugués |
| `--forma-pago <texto>` |  | Por defecto, "Transferencia Internacional" |
| `--observaciones <texto>` |  | Observaciones |
| `--obs-comerciales <texto>` |  | Observaciones comerciales |

Ej.: `--idioma 2`

### Permisos de embarque

Solo en bienes (`--tipo-expo 1`). Repetible. ARCLI consulta cada uno en ARCA antes de emitir: si ARCA dice que no es válido para el país de destino, frena con un error.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--permiso <id>` |  | Un permiso de embarque |
| `--permiso-existente` |  | El permiso ya existe en ARCA |

Ej.: `--permiso 26001EC01000123A`

### Moneda

Por defecto, dólares. Sin `--cm`, la cotización de aduana que publica ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--moneda <código>` | `--mda` | ISO (USD, EUR) o de ARCA (DOL, 060) |
| `--cotizacion-moneda <número>` | `--cm` | Cotización |
| `--misma-moneda` |  | Te pagan en esa misma moneda |
| `--fecha-pago <fecha>` |  | Fecha de pago, solo en servicios y otros; por defecto, la del comprobante |

Ej.: `--moneda EUR`

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
| `--fecha <fecha>` | `-f` | D, D/M, D/M/AA o D/M/AAAA, o hoy, ayer, +N o -N (días desde hoy) |

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

- El CUIT del país de destino sale solo de la tabla de ARCA.
- Sin `--numero`, ARCLI toma el que sigue en ARCA para ese punto de venta.

## No aplica

Estos flags no van en este comprobante: `--cuit`, `--ir`, `--concepto`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
