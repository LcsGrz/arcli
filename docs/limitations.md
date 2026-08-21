[← Volver al README](../README.md)

# Limitaciones actuales

Limitaciones y decisiones de diseño que hoy forman parte del comportamiento real del proyecto.

## Limitaciones funcionales

### Batch fail-fast

Ver [input-output.md](input-output.md#batch-fail-fast).

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

### IVA automático simplificado

Hoy el CLI aplica una lógica simplificada de IVA:

- letra `B`: IVA automático
- letra `A` con `responsable-inscripto`: IVA automático
- alícuota fija `21%`
- `Id` fijo `5`

Eso funciona para los casos hoy soportados, pero sigue siendo una simplificación.

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
