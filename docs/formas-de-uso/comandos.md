[← Volver a la documentación](../README.md)

# Comandos

Lo mismo que el asistente, en una línea. Conviene si facturás seguido, si querés repetir siempre lo mismo o para automatizar.

![Una Factura C emitida con un comando: vista previa, confirmación y CAE](../assets/demo/comandos.gif)

## Cómo se arma

`arcli fc -m 15000 --cs --cfinal`, por partes:

| Parte      | Qué es         |
| ---------- | -------------- |
| `arcli fc` | El comprobante |
| `-m 15000` | El monto       |
| `--cs`     | Servicios      |
| `--cfinal` | A quién        |

Cada comprobante tiene su atajo (`fc`, `fa`, `ncc`…) y su página con todos los flags: empezá por [¿qué comprobante me toca?](../comprobantes/README.md).

## Vista previa y emisión

| Con               | Qué pasa                                     |
| ----------------- | -------------------------------------------- |
| Nada              | Muestra la vista previa y pregunta si emitir |
| `--previsualizar` | Solo la vista previa, sin preguntar          |
| `--emitir`        | Emite sin preguntar                          |

## Los más usados

```bash
arcli fc -m 15000 --cs --cfinal
arcli ultimos fc
arcli consultar fc 142
arcli padron 20201797064
arcli estado
```

## Ayuda en la terminal

`arcli --ayuda` lista todos los comandos, y `arcli fc --ayuda` los flags de uno. Con el [autocompletado](../cli-reference.md#autocompletado), Tab completa atajos, flags y valores.

Todo junto, en la [referencia del CLI](../cli-reference.md). Para scripts, [lotes y JSON](../lotes-y-json.md).
