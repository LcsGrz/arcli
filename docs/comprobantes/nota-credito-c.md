<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# Nota de crédito C

<!-- arcli: familia="Monotributo · C" icono="menos" orden="2" -->

Resta sobre una Factura C o un Recibo C: un descuento, una devolución o una anulación.

`arcli ncc` | `arcli nota-credito c`

## Ejemplo

```bash
arcli ncc -m 5000 --cs --cfinal --ac fc --apv 3 --ar 142 --acuit 20333333334
```

Sin `--emitir` muestra la vista previa y pregunta antes de emitir. También se emite desde el [asistente](../modo-interactivo.md), sin recordar flags.

## Obligatorio

Sin esto no se puede emitir. Lo que guardaste en la config no hace falta repetirlo.

<!-- arcli: opciones=req -->

### Importe

El total del comprobante, en formato argentino: punto para miles y coma para decimales.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `-m` | `--monto <número>` | 15000, 15.000 o 1.500,50 |

Ej.: `-m 15000`

### Concepto

Qué facturás. `-c` es el corto de `--concepto`. Si lo guardás en la config (`concepto`), no hace falta.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--cs` | `--concepto servicios` | Servicios |
| `--cp` | `--concepto productos` | Productos |
| `--csp` | `--concepto productos-servicios` | Productos y servicios |

Ej.: `--cs`

### Condición IVA del receptor

Cómo está inscripto a quien le facturás. `--ir` es el corto de `--iva-receptor`. Con `--cuit` sale sola del padrón de ARCA; si no, va una de estas o la de la config (`ivaReceptor`).

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--ir-cf` | `--iva-receptor consumidor-final` | Consumidor final |
| `--ir-ri` | `--iva-receptor responsable-inscripto` | Responsable inscripto |
| `--ir-rm` | `--iva-receptor responsable-monotributo` | Monotributo |
| `--ir-se` | `--iva-receptor sujeto-exento` | Exento |
| `--ir-snc` | `--iva-receptor sujeto-no-categorizado` | Sujeto no categorizado |
| `--ir-ms` | `--iva-receptor monotributista-social` | Monotributista social |
| `--ir-mtip` | `--iva-receptor monotributo-trabajador-independiente-promovido` | Monotributo trabajador independiente promovido |
| `--ir-ce` | `--iva-receptor cliente-del-exterior` | Cliente del exterior |
| `--ir-pe` | `--iva-receptor proveedor-del-exterior` | Proveedor del exterior |
| `--ir-il` | `--iva-receptor iva-liberado` | IVA liberado |
| `--ir-ina` | `--iva-receptor iva-no-alcanzado` | IVA no alcanzado |

Ej.: `--ir-cf`

### Comprobante que ajusta

Atajo, punto de venta y número del comprobante. O un período entero, con `--pd` y `--ph`.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--ac <atajo>` | Atajo del comprobante: fc, rc, fa… |
| `--apv` | `--asociado-punto-venta <número>` | Su punto de venta |
|  | `--ar <número>` | Su número |
|  | `--acuit <cuit>` | El CUIT del emisor: el tuyo |
|  | `--at <número>` | Tipo ARCA, en vez de --ac |

Ej.: `--ac fc --apv 3 --ar 142 --acuit 20333333334`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Período, en vez de un comprobante

Para ajustar un período entero, por ejemplo un descuento sobre el mes. No va con `--ac`.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--pd` | `--periodo-desde <fecha>` | Inicio del período |
| `--ph` | `--periodo-hasta <fecha>` | Fin del período |

Ej.: `--pd 1/9 --ph 30/9`

### Receptor

A quién le facturás. Sin ninguno, consumidor final. Desde $ 10.000.000 hay que identificarlo.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--cfinal` | `--consumidor-final` | Consumidor final, sin identificar |
|  | `--cuit <número>` | Con CUIT: la condición IVA sale del padrón |
|  | `--cuil <número>` | Con CUIL |
|  | `--dni <número>` | Con DNI |

Ej.: `--cuit 20168598204`

### Punto de venta

Si no es el de la config.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--pv` | `--punto-venta <número>` | Un punto de venta para web service |

Ej.: `--pv 3`

### Fecha

Si no es hoy.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `-f` | `--fecha <fecha>` | D, D/M, D/M/AA o D/M/AAAA |

Ej.: `-f 31/10`

### Período del servicio

Solo con servicios. Sin estos flags, el mes en curso.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--sd` | `--servicio-desde <fecha>` | Inicio del servicio |
| `--sh` | `--servicio-hasta <fecha>` | Fin del servicio |
| `--vto` | `--vencimiento <fecha>` | Vencimiento del pago; por defecto, el fin del servicio |

Ej.: `--sd 1/10 --sh 31/10`

### Moneda extranjera

Sin `--cm`, la cotización oficial de ARCA.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--mda` | `--moneda <código>` | ISO (USD, EUR) o de ARCA (DOL, 060) |
| `--cm` | `--cotizacion-moneda <número>` | Cotización, por ejemplo 1.452,50 |
|  | `--misma-moneda` | Te pagan en esa misma moneda |

Ej.: `--moneda USD`

### Datos del PDF

Solo cambian el PDF, no lo que se informa a ARCA.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--descripcion <texto>` | Detalle; por defecto, "Según detalle" |
| `--cv` | `--condicion-venta <tipo>` | contado, transferencia, tarjeta-debito, tarjeta-credito, cuenta-corriente, cheque, otros-medios-electronicos, otra o un texto |
|  | `--sin-condicion-venta` | Sin condición de venta, aunque esté en la config |
|  | `--receptor-nombre <texto>` | Nombre o razón social del receptor |
|  | `--receptor-domicilio <texto>` | Domicilio del receptor |

Ej.: `--cv transferencia`

## Al ejecutar

No cambian el comprobante: cómo corre ARCLI esta vez. Son los mismos en todos los comprobantes.

<!-- arcli: opciones=run -->

### Vista previa o emisión

Sin ninguno, muestra la vista previa y pregunta antes de emitir.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--previsualizar` | Solo la vista previa: no emite |
|  | `--emitir` | Emite sin preguntar |

Ej.: `--emitir`

### Entorno

Si no es el de la config.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--testing` | Homologación: no vale fiscalmente |
|  | `--produccion` | Comprobantes reales |

Ej.: `--produccion`

### PDF

Aunque la config diga otra cosa.

| Corto | Largo | Qué es |
| --- | --- | --- |
| `--pdf` | `--exportar-pdf` | Genera el PDF |
|  | `--sin-pdf` | No lo genera |

Ej.: `--pdf`

### Salida

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--json` | JSON, para scripts e IAs |
|  | `--bruto` | Suma la respuesta cruda de ARCA |

Ej.: `--json`

### Desde un archivo

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--cargar <archivo>` | Los datos desde un JSON, también varios comprobantes |

Ej.: `--cargar facturas.json`

## Para tener en cuenta

- La nota de crédito no puede superar el total del comprobante que ajusta, si van en la misma moneda: ARCLI lo revisa antes de emitir.
- El comprobante que ajusta también puede ser un Recibo C: `--ac rc`.
- Con un período (`--pd` y `--ph`) en vez de un comprobante, el período no puede terminar después de la fecha de la nota.

## No aplica

Estos flags no van en este comprobante: `--cbu`, `--alicuota`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
