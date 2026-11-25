[← Documentación](README.md)

# Exportación: Factura E y sus notas

La factura de exportación **E** usa otro servicio de ARCA (`wsfex`), con su propio certificado autorizado y su propio punto de venta. Lleva cliente y país de destino en vez de receptor con CUIT, y no discrimina IVA.

| Comprobante       | Atajo | Familia                |
| ----------------- | ----- | ---------------------- |
| Factura E         | `fe`  | `arcli factura e`      |
| Nota de crédito E | `nce` | `arcli nota-credito e` |
| Nota de débito E  | `nde` | `arcli nota-debito e`  |

Todos los flags están en la [referencia del CLI](cli-reference.md#factura-de-exportación-e-wsfex) y las reglas en [validaciones](validation-rules.md#factura-de-exportación-e).

## Factura de exportación E

### Cuándo usarlo

Cuando le vendés servicios o bienes a un cliente del exterior. Va por el servicio `wsfex`, que hay que autorizar en ARCA aparte de `wsfe`.

### Requisitos

- certificado autorizado a `wsfex` (ver [certificados](obtencion-certificados.md))
- opcional: la actividad de la tabla de WSFEX, por flag o en `exportacion.actividad`

### Comando

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203 \
  --actividad 620100 --item "001|Servicios de consultoría|1|1500|unidad"
```

### Resultado esperado

- va en dólares (`DOL`) con la cotización de aduana que publica ARCA, salvo `--moneda` o `--cotizacion-moneda`
- la vista previa muestra cliente, destino, ítems y la solicitud de WSFEX: primero los datos hasta las fechas, después los ítems con su importe a la derecha y al pie el importe total (en una terminal angosta, cada ítem va con la descripción arriba y el importe debajo)

### El detalle de la E: rápido o por ítems

ARCA pide al menos un renglón (ítem) en cada comprobante `E`. El CLI lo carga de dos formas:

| Forma     | Flags                                                             | Qué le manda a ARCA                                                                                                                            |
| --------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Rápida    | `-m` y, si querés, `--descripcion`                                | Un solo renglón: la descripción (por defecto "Según detalle"), cantidad 1, unidad "unidades" (código 7) y el monto como precio                 |
| Detallada | `-m` y uno o más `--item "descripcion\|cantidad\|precio\|unidad"` | Un renglón por `--item`. La suma de los renglones (cada uno redondeado a dos decimales) tiene que dar `-m`: si no, es error antes de ir a ARCA |

Rápida, para un servicio:

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --descripcion "Consultoría de software" --previsualizar
```

Detallada, con bienes en litros: 1.000 litros de jugo de naranja a 1,50 USD.

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --tipo-expo 1 --incoterm FOB --item "Jugo de naranja|1000|1,50|litros" --previsualizar
```

Detallada, con varios renglones que suman `-m` (1.500 + 500 + 100 = 2.100):

```bash
arcli fe -m 2100 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --tipo-expo 1 --incoterm FOB --item "Jugo de naranja|1000|1,50|litros" \
  --item "Flete|1|500" --item "Seguro|1|100" --previsualizar
```

Con `--item`, `--descripcion` no se usa (avisa). El formato completo de `--item`, con código, y las unidades que se aceptan están en la [referencia](cli-reference.md#ítems).

En el [modo interactivo](modo-interactivo.md#ítems-de-la-e) no se pregunta el monto: el asistente arranca con un ítem con esos mismos valores por defecto ("Según detalle", cantidad 1, unidades) y el total es la suma de los que cargues. Su comando equivalente usa la forma rápida si queda un solo renglón así (cantidad 1, unidades y sin código), y la detallada en cualquier otro caso.

### Errores comunes

- la suma de los `--item` no da `--monto`
- la actividad no está en la tabla de WSFEX (no es la del padrón)

Detalle de flags: [Factura de exportación `E`](cli-reference.md#factura-de-exportación-e-wsfex).

## Nota de crédito o débito E

### Cuándo usarlo

Para ajustar una factura de exportación ya emitida: un descuento o una devolución (`nce`) o un cargo adicional (`nde`).

### Requisitos

- el número de la factura E (y su punto de venta, si es otro que el de la nota). En bienes y otros (`--tipo-expo 1` o `4`) es opcional: sin `--ar`, cliente, domicilio y destino van por flag, y va solo por comando (el asistente siempre pide el asociado)

### Comando

```bash
arcli nce -m 500 --ar 1 --apv 4
```

### Resultado esperado

- cliente, destino, moneda, cotización y actividad salen de la factura, que ARCLI consulta en ARCA
- la vista previa muestra la factura asociada con su fecha y su total

### Errores comunes

- ARCA no tiene la factura: revisá `--ar` y `--apv`
- la nota de crédito supera el total de la factura
- en servicios, otra cotización, moneda o destino que la factura: ARCA los rechaza

Detalle: [Notas de crédito y débito de exportación](cli-reference.md#notas-de-crédito-y-débito-de-exportación-e).
