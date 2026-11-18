<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# Recibo B

<!-- arcli: familia="Responsable inscripto · B" icono="recibo" orden="18" -->

Para documentar un cobro a un consumidor final, monotributista o exento. Se arma como una Factura B: el IVA va incluido.

`arcli rb` | `arcli recibo b`

## Ejemplo

```bash
arcli rb -m 12100 --cs --cfinal
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

### Condición IVA del receptor

Cómo está inscripto a quien le facturás. `--ir` es el corto de `--iva-receptor`. Con `--cuit` sale sola del padrón de ARCA; si no, va una de estas o la de la config (`ivaReceptor`).

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--iva-receptor consumidor-final` | `--ir-cf` | Consumidor final |
| `--iva-receptor sujeto-exento` | `--ir-se` | Exento |
| `--iva-receptor sujeto-no-categorizado` | `--ir-snc` | Sujeto no categorizado |
| `--iva-receptor cliente-del-exterior` | `--ir-ce` | Cliente del exterior |
| `--iva-receptor proveedor-del-exterior` | `--ir-pe` | Proveedor del exterior |
| `--iva-receptor iva-liberado` | `--ir-il` | IVA liberado |
| `--iva-receptor iva-no-alcanzado` | `--ir-ina` | IVA no alcanzado |

Ej.: `--ir-cf`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Receptor

A quién le facturás. Sin ninguno, consumidor final. Desde $ 10.000.000 hay que identificarlo.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--consumidor-final` | `--cfinal` | Consumidor final, sin identificar |
| `--cuit <número>` |  | Con CUIT: la condición IVA sale del padrón |
| `--cuil <número>` |  | Con CUIL |
| `--dni <número>` |  | Con DNI |

Ej.: `--cuit 20168598204`

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
| `--fecha <fecha>` | `-f` | D, D/M, D/M/AA o D/M/AAAA |

Ej.: `-f 31/10`

### Período del servicio

Solo con servicios. Sin estos flags, el mes en curso.

| Largo | Corto | Qué es |
| --- | --- | --- |
| `--servicio-desde <fecha>` | `--sd` | Inicio del servicio |
| `--servicio-hasta <fecha>` | `--sh` | Fin del servicio |
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

- El IVA va incluido en el total y no se muestra discriminado en el PDF.
- El PDF sale con el título RECIBO B.

## No aplica

Estos flags no van en este comprobante: `--ac`, `--cbu`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
