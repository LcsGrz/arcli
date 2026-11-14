[← Documentación](README.md)

# Lotes, JSON y automatización

Para emitir desde un script, una planilla o un sistema propio: datos en JSON con `--cargar`, varios comprobantes en un lote y salida `--json` estable. El formato completo está en [entrada y salida](input-output.md). Si lo usás con un asistente de IA, ver [automatizar con IA](automatizar-con-ia.md).

## Carga desde JSON

### Cuándo usarlo

Cuando ya tenés los datos preparados en un archivo o querés reutilizar payloads de prueba.

### Requisitos

- archivo JSON válido
- estructura compatible con el comando elegido

### Comando

```bash
arcli fc --cargar ./voucher.json
```

### Resultado esperado

- arcli mezcla flags, JSON y config usando esta prioridad:
  - flags
  - JSON
  - config
  - defaults internos

### Errores comunes

- nombres de campos incompatibles con el contrato JSON
- tipos inválidos
- lote con un ítem inválido que corta toda la ejecución

## Batch con JSON

### Cuándo usarlo

Cuando querés procesar varios comprobantes del mismo comando en una sola corrida.

### Requisitos

- archivo con un array JSON (un array de un solo elemento también es un lote)
- cada ítem debe ser válido

### Comando

```bash
arcli fc --cargar ./voucher-batch.json --json --bruto
```

### Resultado esperado

- en texto: un bloque por ítem
- en JSON: un array de resultados con `indice`, `comprobante` y `atajo` (también con un solo elemento); con `--bruto`, cada uno suma `respuesta`

### Errores comunes

- un ítem inválido hace fallar el lote completo
- asumir que hay resultados parciales cuando la validación corta antes

## Caso de automatización

### Cuándo usarlo

Cuando querés consumir arcli desde un script o pipeline.

### Requisitos

- salida estructurada
- un formato fácil de parsear

### Comando

```bash
arcli fb -m 1 --cs --consumidor-final --emitir --json --bruto
```

### Ejemplo con `jq`

Cuando querés encadenar la salida con otros scripts, lo más práctico es combinar `--json` con `jq`:

```bash
arcli fb -m 1 --cs --consumidor-final --emitir --json \
  | jq '{estado, cae, comprobante, atajo, solicitud}'
```

### Resultado esperado

- JSON estable para scripts
- acceso directo a campos como `estado`, `cae`, `atajo` o `solicitud`

### Errores comunes

- intentar parsear la salida humana
- asumir que `--json` devuelve exactamente lo mismo que el modo texto
