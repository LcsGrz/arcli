[← Documentación](README.md)

# Automatizar con IA

arcli está pensado para que un asistente con acceso a la terminal (Claude, ChatGPT, Copilot) pueda emitir por vos, con reglas claras y una salida `--json` que no cambia de forma.

## Qué leerle al asistente

- **[`llms.txt`](../llms.txt):** referencia condensada de comandos, flags y reglas, en un solo archivo. Es el punto de partida.
- **`llms-full.txt`:** toda la documentación junta, para el asistente que quiera leer todo. Está en el [sitio de documentación](https://lcsgrz.github.io/arcli/llms-full.txt).

## Las reglas que siguen los agentes

- Siempre `--json` y el entorno explícito: `--testing` o `--produccion`.
- Primero la vista previa; `--emitir` solo cuando la persona confirmó ese comprobante.
- En producción, emitir es irreversible: nunca sin confirmación explícita.
- Se emitió si y solo si `previsualizacion` es `false` y `cae` no es `null`.

## Códigos de salida

| Código | Qué significa                                                                            |
| ------ | ---------------------------------------------------------------------------------------- |
| `0`    | Todo bien: aprobado, observado o vista previa                                            |
| `1`    | Error del comando: mirar `codigo` en el JSON ([tabla](input-output.md#códigos-de-error)) |
| `2`    | ARCA rechazó el comprobante                                                              |

## Un pedido de ejemplo

```text
Usá arcli para emitir una Factura C de $ 15.000 por servicios a consumidor final, en testing. Leé primero https://lcsgrz.github.io/arcli/llms.txt, mostrame la vista previa y esperá que te confirme antes de emitir.
```

Para lotes y scripts sin asistente, ver [lotes, JSON y automatización](lotes-y-json.md).
