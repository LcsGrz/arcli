[← Documentación](README.md)

# Limitaciones actuales

Limitaciones y decisiones de diseño que hoy forman parte del comportamiento real del proyecto.

## Limitaciones funcionales

### Lotes sin emisión parcial controlada

Un lote se valida entero antes de emitir, pero si la emisión se corta a mitad (red, ARCA) los comprobantes ya emitidos quedan emitidos: no hay "deshacer". ARCLI los muestra antes del error para que no se carguen dos veces. Ver [input-output.md](input-output.md#validación-y-errores-del-lote).

### Salida humana no estable

La salida humana es para terminal y puede cambiar. Para integraciones usá `--json` (o `--json --bruto`).

### Dependencia de ARCA y WSAA

Hay errores que no dependen de la solicitud sino del entorno remoto, por ejemplo:

- `coe.alreadyAuthenticated`
- `Transacción Activa`

ARCLI los trata mejor en la salida, pero no los elimina.

### Factura de exportación (E)

WSFEX emite solo la factura `E`: las notas de crédito y débito de exportación no están soportadas. Tampoco hay lote: el JSON de `--cargar` tiene que ser un objeto.

- Sin concepto, fechas de servicio, IVA discriminado, comprobante asociado ni datos FCE: esos flags y sus defaults de config no aplican a `E`.
- `--tipo-expo` acepta solo `1` (bienes), `2` (servicios) y `4` (otros), y por defecto la `E` sale de servicios; la moneda por defecto es `DOL` y la forma de pago `Transferencia Internacional`. La clave `moneda` de la config no aplica. La tabla de ARCA se consulta igual para validar países, unidades, incoterms e idiomas.
- Los permisos de embarque se informan como ya existentes (`--permiso-existente`) y solo aplican a exportaciones de bienes (`--tipo-expo 1`): ARCLI no da de alta permisos nuevos en ARCA. Sin permisos el campo `Permisos` no se envía, porque ARCA lo rechaza (error 1720) cuando `Permiso_existente` es `N`; en `--tipo-expo 2` (servicios) y `4` (otros) el campo va vacío, como pide ARCA (error 1550).
- La numeración de WSFEX (`getLastCmp` más `getLastId`) no se discrimina por punto de venta. Con emisiones en paralelo o varios emisores sobre el mismo CUIT, fijá `--numero` y `--id-solicitud`.
- El certificado tiene que estar autorizado a `wsfex`, además de `wsfe`. Se puede usar uno propio con `exportacion.cert.*` / `exportacion.key.*` ([configuración](configuration.md#certificados-de-exportación-wsfex)).
- La cotización oficial de `--misma-moneda` se consulta a WSFEX (`getParamCtz`), no a `wsfe`.

### PDF solo al emitir

El PDF se genera en el momento de emitir. Todavía no se puede regenerar el de un comprobante ya emitido: la consulta de ARCA que usa el SDK (`FECompConsultar`) no devuelve el detalle de IVA, los comprobantes asociados ni las fechas de servicio. Tampoco hay ítems detallados en A, B y C: el PDF lleva un renglón por alícuota con la descripción que pases (la factura de exportación `E` sí imprime los items de WSFEX). Ver [PDF de comprobantes](pdf.md#qué-no-hace-todavía).

## Decisiones de diseño

### `testing` por defecto

Se eligió `testing` como entorno por defecto para reducir errores accidentales.

### IVA automático y tributos

En letras `A` y `B` el CLI calcula el IVA a partir del total, con una o varias alícuotas, y admite importes exentos y no gravados. Ver [IVA automático](validation-rules.md#iva-automático).

Todavía no se soportan los tributos (`Tributos` / `ImpTrib`), como las percepciones de IIBB.

## Inconsistencias o bordes ya detectados

### Observaciones de padrón

Algunos CUITes de testing aprueban y devuelven observaciones como:

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
