<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Volver a la documentación](../README.md)

# ¿Qué comprobante me toca?

Depende de tu condición frente al IVA y de a quién le facturás. Cada comprobante tiene su página con un ejemplo y todos sus flags.

| Sos | Le facturás a | Comprobante |
| --- | --- | --- |
| Monotributo | Cualquiera | [Factura C](factura-c.md) \| [Recibo C](recibo-c.md) |
| Monotributo | Una empresa obligada a FCE | [FCE C](fce-c.md) |
| Responsable inscripto | Otro responsable inscripto | [Factura A](factura-a.md) \| [Recibo A](recibo-a.md) |
| Responsable inscripto | Consumidor final, monotributo o exento | [Factura B](factura-b.md) \| [Recibo B](recibo-b.md) |
| Responsable inscripto | Una empresa obligada a FCE | [FCE A](fce-a.md) \| [FCE B](fce-b.md) |
| Cualquiera | Un cliente del exterior | [Factura E](factura-e.md) |

## ¿Y para corregir una factura?

Una **nota de crédito** resta (un descuento, una devolución, una factura mal hecha) y una **nota de débito** suma. Van con la misma letra que la factura: sobre una Factura C, una [nota de crédito C](nota-credito-c.md) o una [nota de débito C](nota-debito-c.md). Cómo funcionan, en [notas de crédito y débito](../notas-credito-debito.md).

> [!TIP]
> **¿No sabés tu condición?** Con tu CUIT: `arcli padron <CUIT>`. O en la constancia de inscripción de ARCA.

## Todos los comprobantes

Un atajo por comprobante, cada uno con su página: la fila es el tipo y la columna, la letra.

<!-- arcli: atajos -->

| Comprobante | A | B | C | E |
| --- | --- | --- | --- | --- |
| Factura | [`fa`](factura-a.md) | [`fb`](factura-b.md) | [`fc`](factura-c.md) | [`fe`](factura-e.md) |
| Nota de crédito | [`nca`](nota-credito-a.md) | [`ncb`](nota-credito-b.md) | [`ncc`](nota-credito-c.md) | [`nce`](nota-credito-e.md) |
| Nota de débito | [`nda`](nota-debito-a.md) | [`ndb`](nota-debito-b.md) | [`ndc`](nota-debito-c.md) | [`nde`](nota-debito-e.md) |
| Recibo | [`ra`](recibo-a.md) | [`rb`](recibo-b.md) | [`rc`](recibo-c.md) | – |
| FCE | [`fcea`](fce-a.md) | [`fceb`](fce-b.md) | [`fcec`](fce-c.md) | – |
| Nota de crédito FCE | [`ncea`](nota-credito-fce-a.md) | [`nceb`](nota-credito-fce-b.md) | [`ncec`](nota-credito-fce-c.md) | – |
| Nota de débito FCE | [`ndea`](nota-debito-fce-a.md) | [`ndeb`](nota-debito-fce-b.md) | [`ndec`](nota-debito-fce-c.md) | – |

Para entender cada uno: [notas de crédito y débito](../notas-credito-debito.md), [Factura de Crédito Electrónica](../fce.md) y [exportación paso a paso](../exportacion.md).
