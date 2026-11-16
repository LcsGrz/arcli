<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->

[← Volver a la documentación](../README.md)

# ¿Qué comprobante me toca?

Depende de tu condición frente al IVA y de a quién le facturás. Cada comprobante tiene su página con un ejemplo y todos sus flags.

| Sos | Le facturás a | Comprobante |
| --- | --- | --- |
| Monotributo | Cualquiera | [Factura C](factura-c.md) \| [Recibo C](recibo-c.md) |
| Monotributo | Una empresa obligada a FCE | [FCE C](fce-c.md) |
| Responsable inscripto | Otro responsable inscripto | [Factura A](factura-a.md) |
| Responsable inscripto | Consumidor final, monotributo o exento | [Factura B](factura-b.md) |
| Responsable inscripto | Una empresa obligada a FCE | [FCE A](fce-a.md) \| [FCE B](fce-b.md) |
| Cualquiera | Un cliente del exterior | [Factura E](factura-e.md) |

## ¿Y para corregir una factura?

Una **nota de crédito** resta (un descuento, una devolución, una factura mal hecha) y una **nota de débito** suma. Van con la misma letra que la factura: sobre una Factura C, una [nota de crédito C](nota-credito-c.md) o una [nota de débito C](nota-debito-c.md). Cómo funcionan, en [notas de crédito y débito](../notas-credito-debito.md).

> [!TIP]
> **¿No sabés tu condición?** Con tu CUIT: `arcli padron <CUIT>`. O en la constancia de inscripción de ARCA.

## Todos los comprobantes

- **Monotributo C:** [Factura C](factura-c.md) (`fc`), [Nota de crédito C](nota-credito-c.md) (`ncc`), [Nota de débito C](nota-debito-c.md) (`ndc`), [Recibo C](recibo-c.md) (`rc`), [FCE C](fce-c.md) (`fcec`), [Nota de crédito FCE C](nota-credito-fce-c.md) (`ncec`), [Nota de débito FCE C](nota-debito-fce-c.md) (`ndec`)
- **Responsable inscripto A:** [Factura A](factura-a.md) (`fa`), [Nota de crédito A](nota-credito-a.md) (`nca`), [Nota de débito A](nota-debito-a.md) (`nda`), [FCE A](fce-a.md) (`fcea`), [Nota de crédito FCE A](nota-credito-fce-a.md) (`ncea`), [Nota de débito FCE A](nota-debito-fce-a.md) (`ndea`)
- **Responsable inscripto B:** [Factura B](factura-b.md) (`fb`), [Nota de crédito B](nota-credito-b.md) (`ncb`), [Nota de débito B](nota-debito-b.md) (`ndb`), [FCE B](fce-b.md) (`fceb`), [Nota de crédito FCE B](nota-credito-fce-b.md) (`nceb`), [Nota de débito FCE B](nota-debito-fce-b.md) (`ndeb`)
- **Exportación E:** [Factura E](factura-e.md) (`fe`), [Nota de crédito E](nota-credito-e.md) (`nce`), [Nota de débito E](nota-debito-e.md) (`nde`)

Para entender cada uno: [notas de crédito y débito](../notas-credito-debito.md), [Factura de Crédito Electrónica](../fce.md) y [exportación paso a paso](../exportacion.md).
