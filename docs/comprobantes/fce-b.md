<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Comprobantes](README.md)

# FCE B

<!-- arcli: familia="Responsable inscripto · B" icono="banco" orden="17" -->

Factura de Crédito Electrónica B, a una empresa obligada a recibirla.

`arcli fceb` | `arcli factura-credito-electronica b`

## Ejemplo

```bash
arcli fceb -m 1210000 --cs --cuit 30546689979 --cbu 0110599520000012345678
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

### Receptor

Su condición IVA sale del padrón de ARCA.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--cuit <número>` | El CUIT del receptor |

Ej.: `--cuit 20168598204`

### CBU

Donde te pagan. Una vez guardado en la config, no hace falta.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--cbu <22 dígitos>` | Tu CBU |

Ej.: `--cbu 0110599520000012345678`

## Opcional

Más datos del comprobante, o cambiar lo que viene de la config.

<!-- arcli: opciones=opt -->

### Cobro

Datos extra del cobro de la FCE.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--alias <alias>` | Alias del CBU |
|  | `--transferencia <sca\|adc>` | Modalidad de transferencia; por defecto sca |

Ej.: `--transferencia adc`

### IVA

El monto es el total con IVA: ARCLI calcula el neto y el IVA.

| Corto | Largo | Qué es |
| --- | --- | --- |
|  | `--alicuota <tasa>` | general (21, por defecto), reducida (10.5), incrementada (27), cero (0), 5 o 2.5. Varias: TASA:MONTO |
|  | `--exento <número>` | La parte exenta del total |
|  | `--nogravado <número>` | La parte no gravada del total |

Ej.: `--alicuota 10.5`

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

## No aplica

Estos flags no van en este comprobante: `--pd`, `--ph`, `--ac`.

Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).
