[← Volver al README](../README.md)

# Limitaciones actuales

Limitaciones y decisiones de diseño que hoy forman parte del comportamiento real del proyecto.

## Limitaciones funcionales

### Lotes sin emisión parcial controlada

Un lote se valida entero antes de emitir, pero si la emisión se corta a mitad (red, ARCA) los comprobantes ya emitidos quedan emitidos: no hay "deshacer". ARCLI los muestra antes del error para que no se carguen dos veces. Ver [input-output.md](input-output.md#validación-y-errores-del-lote).

### Contrato humano no estable

La salida humana está pensada para terminal, no como contrato de automatización.

Para integraciones:

- `--json`
- `--json --bruto`

### Dependencia de ARCA y WSAA

Hay errores que no dependen de la solicitud sino del entorno remoto, por ejemplo:

- `coe.alreadyAuthenticated`
- `Transacción Activa`

ARCLI los trata mejor en la salida, pero no los elimina.

## Decisiones de diseño

### `testing` por defecto

Se eligió `testing` como entorno por defecto para reducir errores accidentales.

### IVA automático con una alícuota

En letras `A` y `B` el CLI calcula el IVA a partir del total, con una alícuota (`--alicuota`, por defecto `21%`) o varias (`--alicuota TASA:MONTO` repetido). Exento y no gravado se informan con `--exento` y `--nogravado`.

Todavía no se soportan:

- tributos (`Tributos` / `ImpTrib`), como percepciones de IIBB

## Inconsistencias o bordes ya detectados

### Observaciones de padrón

Algunos CUITes de testing aprueban y devuelven observaciones como:

- `10217`
- `10017`

No siempre indican un error del CLI.

### Casos sensibles al paralelismo

En pruebas reales apareció el error `10016` cuando se forzaron varias emisiones `A` en paralelo. Probando de forma serial, el caso volvió a aprobar.

### `respuesta` cambia según el modo

Con `--bruto`:

- si hubo emisión real, `respuesta` contiene la respuesta cruda del SDK
- si no hubo emisión, `respuesta` pasa a ser un objeto con `mensaje`

Eso está documentado, pero conviene tenerlo presente si alguien consume JSON desde scripts.

## Posibles mejoras futuras

- batch con resultados parciales por item
- estrategia de retry para errores transitorios WSAA/ARCA
- soporte de IVA menos simplificado
- más guías de automatización y ejemplos de integración
