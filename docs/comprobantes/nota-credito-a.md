<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# Nota de crédito A

<!-- arcli: familia="Responsable inscripto · A" icono="menos" orden="9" -->

Resta sobre una Factura A, un Recibo A u otra nota A: un descuento, una devolución o una anulación.

`arcli nca` | `arcli nota-credito a`

## Ejemplo

```bash
arcli nca -m 1210 --cs --cuit 20168598204 --ac fa --apv 3 --ar 6
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

### Concepto

Qué facturás. `-c` es el corto de `--concepto`. Si lo guardás en la config (`concepto`), no hace falta.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--concepto servicios` | `--cs` | Servicios |
| `--concepto productos` | `--cp` | Productos |
| `--concepto productos-servicios` | `--csp` | Productos y servicios |

Ej.: `--cs`

### Receptor

Su condición IVA sale del padrón de ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--cuit <número>` |  | El CUIT del receptor |

Ej.: `--cuit 20168598204`

### Comprobante que ajusta

Atajo, punto de venta y número del comprobante: una factura u otra nota de la misma letra. O un período entero, con `--pd` y `--ph`.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--ac <atajo>` |  | Atajo del comprobante: fc, rc, ndc… |
| `--asociado-punto-venta <número>` | `--apv` | Su punto de venta |
| `--ar <número>` |  | Su número |
| `--acuit <cuit>` |  | El CUIT de quien lo emitió; sin él, el tuyo |
| `--at <número>` |  | Tipo ARCA, en vez de --ac |

Ej.: `--ac fc --apv 3 --ar 142`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Período, en vez de un comprobante

Para ajustar un período entero, por ejemplo un descuento sobre el mes. No va con `--ac`.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--periodo-desde <fecha>` | `--pd` | Inicio del período; mes-actual o mes-pasado dan el día 1 |
| `--periodo-hasta <fecha>` | `--ph` | Fin del período; mes-actual o mes-pasado dan el último día |

Ej.: `--pd 1/9 --ph 30/9`

### Condición IVA del receptor

Sale sola del padrón de ARCA con el CUIT. Usala solo si querés indicarla vos.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--iva-receptor responsable-inscripto` | `--ir-ri` | Responsable inscripto |
| `--iva-receptor responsable-monotributo` | `--ir-rm` | Monotributo |
| `--iva-receptor monotributista-social` | `--ir-ms` | Monotributista social |
| `--iva-receptor monotributo-trabajador-independiente-promovido` | `--ir-mtip` | Monotributo trabajador independiente promovido |

Ej.: `--ir-ri`

### IVA

El monto es el total con IVA: ARCLI calcula el neto y el IVA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--alicuota <tasa>` |  | general (21, por defecto), reducida (10.5), incrementada (27), cero (0), 5 o 2.5. Varias: TASA:MONTO |
| `--exento <número>` |  | La parte exenta del total |
| `--nogravado <número>` |  | La parte no gravada del total |

Ej.: `--alicuota 10.5`

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

### Período del servicio

Solo con servicios. Sin estos flags, el mes en curso.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--servicio-desde <fecha>` | `--sd` | Inicio del servicio; mes-actual o mes-pasado dan el día 1 |
| `--servicio-hasta <fecha>` | `--sh` | Fin del servicio; mes-actual o mes-pasado dan el último día |
| `--vencimiento <fecha>` | `--vto` | Vencimiento del pago; por defecto, el fin del servicio |

Ej.: `--sd 1/10 --sh 31/10`

### Moneda extranjera

Sin `--cm`, la cotización oficial de ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--moneda <código>` | `--mda` | ISO (USD, EUR) o de ARCA (DOL, 060) |
| `--cotizacion-moneda <número>` | `--cm` | Cotización, por ejemplo 1.452,50 |
| `--misma-moneda` |  | Te pagan en esa misma moneda |

Ej.: `--moneda USD`

### Datos del PDF

Solo cambian el PDF, no lo que se informa a ARCA.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--descripcion <texto>` |  | Detalle; por defecto, "Según detalle" |
| `--condicion-venta <tipo>` | `--cv` | contado, transferencia, tarjeta-debito, tarjeta-credito, cuenta-corriente, cheque, otros-medios-electronicos, otra o un texto |
| `--sin-condicion-venta` |  | Sin condición de venta, aunque esté en la config |
| `--receptor-nombre <texto>` |  | Nombre o razón social del receptor |
| `--receptor-domicilio <texto>` |  | Domicilio del receptor |

Ej.: `--cv transferencia`

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
- El comprobante que ajusta también puede ser un Recibo A: `--ac ra`.
- Con un período (`--pd` y `--ph`) en vez de un comprobante, el período no puede terminar después de la fecha de la nota.

## No aplica

Estos flags no van en este comprobante: `--cbu`, `--cfinal`, `--dni`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
