[← Documentación](README.md)

# Cambiar de entorno

arcli trabaja con dos entornos de ARCA. **Testing** es para probar sin validez fiscal; **producción** emite comprobantes reales. Cada uno tiene su propio certificado.

|                    | Testing                                                | Producción                                                                                     |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **Para qué**       | Probar todo lo que quieras                             | Facturar de verdad                                                                             |
| **Validez fiscal** | No                                                     | Sí: no se borra, se compensa con una nota de crédito                                           |
| **Certificado**    | El de testing ([cómo sacarlo](certificado-testing.md)) | Otro, el de producción ([cómo sacarlo](certificado-produccion.md))                             |
| **Punto de venta** | Cualquier número                                       | Uno dado de alta [para web service](certificado-produccion.md#punto-de-venta-para-web-service) |
| **Cómo se elige**  | `--testing` (por defecto)                              | `--produccion`                                                                                 |

## Elegir el entorno en cada comando

Sin flag, arcli usa el entorno de la config, que arranca en testing. Un flag lo cambia solo para ese comando:

```bash
arcli fc -m 1000 --cs --consumidor-final --testing      # sin validez fiscal
arcli fc -m 1000 --cs --consumidor-final --produccion   # real
```

Sin `--emitir`, los dos muestran la vista previa y, en una terminal, preguntan antes de emitir: en producción, `¿Emitimos la factura C en PRODUCCIÓN?`. En el [modo interactivo](modo-interactivo.md) el entorno se cambia en Configuración, la barra de estado muestra en cuál estás y en producción pide una segunda confirmación.

## Cambiar el entorno por defecto

Si ya facturás de verdad todos los días, dejá producción como entorno de la config. Para volver, lo mismo con `testing`:

```bash
arcli config establecer entorno produccion
```

> [!CAUTION]
> Con `entorno produccion` y `emitir true` en la config, los comandos emiten en producción sin preguntar. Sirve para automatizar, pero pensalo dos veces si lo usás a mano.

## Antes de la primera factura real

> [!WARNING]
> Un comprobante emitido en producción no se borra: si te equivocás, se compensa con una nota de crédito.

1. **Certificado de producción.** Es otro, distinto del de testing: `arcli certificado generar --produccion` y después `importar` ([guía](certificado-produccion.md)).
2. **Autorizado a facturar.** En ARCA, el certificado de producción tiene que estar autorizado a `wsfe`.
3. **Punto de venta para web service.** Uno de Factura en línea no sirve. Revisalo con `arcli parametros puntos-venta --produccion`.
4. **La conexión responde.** `arcli estado --produccion` dice que ARCA responde y que el punto de venta está habilitado.
5. **Primera factura, con vista previa.** Emití una de monto chico y revisá el PDF antes de mandarla.
