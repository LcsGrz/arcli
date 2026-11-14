[← Documentación](README.md)

# Limitaciones actuales

Limitaciones y decisiones de diseño que hoy forman parte del comportamiento real del proyecto.

## Limitaciones funcionales

### Lotes sin emisión parcial controlada

Un lote se valida entero antes de emitir, pero si la emisión se corta a mitad (red, ARCA) los comprobantes ya emitidos quedan emitidos: no hay "deshacer". arcli los muestra antes del error para que no se carguen dos veces. Ver [input-output.md](input-output.md#validación-y-errores-del-lote).

### Salida humana no estable

La salida humana es para terminal y puede cambiar. Para integraciones usá `--json` (o `--json --bruto`).

### Dependencia de ARCA y WSAA

Hay errores que no dependen de la solicitud sino del entorno remoto, por ejemplo:

- `coe.alreadyAuthenticated`
- `Transacción Activa`

arcli los trata mejor en la salida, pero no los elimina.

### Factura de exportación (E)

arcli emite la factura `E` y sus notas de crédito y débito (`nce`, `nde`). No hay lote: el JSON de `--cargar` tiene que ser un objeto.

- Sin concepto, fechas de servicio, IVA discriminado, comprobante asociado ni datos FCE: esos flags y sus defaults de config no aplican a `E`.
- `--tipo-expo` acepta solo `1` (bienes), `2` (servicios) y `4` (otros), y por defecto la `E` sale de servicios; la moneda por defecto es `DOL` y la forma de pago `Transferencia Internacional`. Las claves `moneda` y `cotizacion` de la config no aplican. La tabla de ARCA se consulta igual para validar países, unidades, incoterms e idiomas.
- Los permisos de embarque se informan como ya existentes (`--permiso-existente` en la factura; en las notas, `--permiso` solo) y solo aplican a exportaciones de bienes (`--tipo-expo 1`): arcli no da de alta permisos nuevos en ARCA. Sin permisos el campo `Permisos` no se envía, porque ARCA lo rechaza (error 1720) cuando `Permiso_existente` es `N`; en `--tipo-expo 2` (servicios) y `4` (otros) el campo va vacío, como pide ARCA (error 1550).
- La actividad no tiene default: se informa con `--actividad` o `exportacion.actividad`.
- El certificado tiene que estar autorizado a `wsfex`, además de `wsfe`. Se puede usar uno propio con `exportacion.cert.*` / `exportacion.key.*` ([configuración](configuration.md#certificados-de-exportación-wsfex)).
- La cotización es la de aduana que publica WSFEX (`FEXGetPARAM_MON_CON_COTIZACION`), no la de `wsfe`, y no se toma de la clave `cotizacion` de la config.
- En homologación, ARCA rechazó una nota de crédito de servicios asociada a una nota de débito (error 2055) aunque la nota de débito tenía su factura asociada. arcli no la bloquea: si ARCA la rechaza, no se emite nada.

### Recibo C con la plantilla de factura

El PDF del Recibo C (`rc`) usa la plantilla de factura con el título `RECIBO C`, no el formato de recibo del portal de ARCA (sin "Recibí(mos) la suma de").

### PDF solo al emitir

El PDF se genera en el momento de emitir. Todavía no se puede regenerar el de un comprobante ya emitido: la consulta de ARCA que usa el SDK (`FECompConsultar`) no devuelve el detalle de IVA, los comprobantes asociados ni las fechas de servicio. Tampoco hay ítems detallados en A, B y C: el PDF lleva un renglón por alícuota con la descripción que pases (la factura de exportación `E` sí imprime los ítems de WSFEX). Ver [PDF de comprobantes](pdf.md#qué-no-hace-todavía).

## Decisiones de diseño

### `testing` por defecto

Se eligió `testing` como entorno por defecto para reducir errores accidentales.

### IVA automático y tributos

En letras `A` y `B` el CLI calcula el IVA a partir del total, con una o varias alícuotas, y admite importes exentos y no gravados. Ver [IVA automático](validation-rules.md#iva-automático).

Todavía no se soportan los tributos (`Tributos` / `ImpTrib`), como las percepciones de IIBB.

## Inconsistencias o bordes ya detectados

### Observaciones de padrón

Algunos CUIT de testing aprueban y devuelven observaciones como:

- `10217`
- `10017`

No siempre indican un error del CLI.

### Casos sensibles al paralelismo

En pruebas reales apareció el error `10016` cuando se forzaron varias emisiones `A` en paralelo. Probando de forma serial, el caso volvió a aprobar.

### `respuesta` cambia según el modo

Con `--bruto` se agrega `respuesta` al resumen de siempre (no reemplaza ningún campo):

- si hubo emisión real, `respuesta` contiene la respuesta cruda del SDK
- si no hubo emisión, `respuesta` pasa a ser un objeto con `mensaje`

Eso está documentado, pero conviene tenerlo presente si alguien consume JSON desde scripts.
