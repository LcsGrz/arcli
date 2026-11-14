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
- la actividad de la tabla de WSFEX, por flag o en `exportacion.actividad`

### Comando

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203 \
  --actividad 620100 --item "001|Servicios de consultoría|1|1500|unidad"
```

### Resultado esperado

- va en dólares (`DOL`) con la cotización de aduana que publica ARCA, salvo `--moneda` o `--cotizacion-moneda`
- la vista previa muestra cliente, destino, ítems y la solicitud de WSFEX

### Errores comunes

- la suma de los `--item` no da `--monto`
- la actividad no está en la tabla de WSFEX (no es la del padrón)

Detalle de flags: [Factura de exportación `E`](cli-reference.md#factura-de-exportación-e-wsfex).

## Nota de crédito o débito E

### Cuándo usarlo

Para ajustar una factura de exportación ya emitida: un descuento o una devolución (`nce`) o un cargo adicional (`nde`).

### Requisitos

- el número de la factura E (y su punto de venta, si es otro que el de la nota)

### Comando

```bash
arcli nce -m 500 --ar 1 --apv 4
```

### Resultado esperado

- cliente, destino, moneda, cotización y actividad salen de la factura, que arcli consulta en ARCA
- la vista previa muestra la factura asociada con su fecha y su total

### Errores comunes

- ARCA no tiene la factura: revisá `--ar` y `--apv`
- la nota de crédito supera el total de la factura
- en servicios, otra cotización, moneda o destino que la factura: ARCA los rechaza

Detalle: [Notas de crédito y débito de exportación](cli-reference.md#notas-de-crédito-y-débito-de-exportación-e).
