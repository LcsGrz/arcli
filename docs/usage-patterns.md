[← Volver al README](../README.md)

# Patrones de uso

Guías prácticas para los flujos más comunes de ARCLI.

## Factura C simple

### Cuándo usarlo

Cuando querés emitir o previsualizar una factura básica para consumidor final.

### Requisitos

- `puntoVenta` resuelto por flag o config
- credenciales del entorno configuradas si vas a emitir

### Comando

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf
```

### Resultado esperado

- payload visible en terminal
- estado `SIN EMITIR` si no confirmás emisión
- prompt interactivo si el flujo entra por defaults y la terminal es interactiva

### Errores comunes

- falta `--monto`
- falta `puntoVenta`
- `--consumidor-final` sin `--ir-cf`

## Factura usando config sin casi flags

### Cuándo usarlo

Cuando ya dejaste defaults guardados y querés un flujo más corto para uso diario.

### Requisitos

Tener configurado al menos:

- `puntoVenta`
- `concepto`
- `ivaReceptor`
- credenciales del entorno

### Comando

```bash
arcli config establecer puntoVenta 3
arcli config establecer concepto servicios
arcli config establecer ivaReceptor consumidor-final
arcli fc -m 15000 --consumidor-final
```

### Resultado esperado

- ARCLI completa el resto desde config
- el payload sale igual de explícito en la preview

### Errores comunes

- asumir que la config cubre todo cuando falta `cuit` o credenciales
- olvidar qué defaults quedaron guardados

## Factura A con CUIT

### Cuándo usarlo

Cuando el receptor está identificado por CUIT y la condición IVA corresponde a responsable inscripto.

### Requisitos

- CUIT receptor válido
- `--ir-ri`
- entorno configurado

### Comando

```bash
arcli fa -m 15000 --cs --cuit 20168598204 --ir-ri
```

### Resultado esperado

- payload con documento `cuit`
- cálculo automático de IVA
- preview o emisión según flags

### Errores comunes

- usar el mismo CUIT que el emisor
- omitir IVA receptor
- CUIT con longitud inválida

## Nota de crédito con comprobante asociado

### Cuándo usarlo

Cuando necesitás anular o ajustar una factura previa.

### Requisitos

- datos completos del asociado
- misma letra que la factura referenciada
- asociado del tipo factura, no otra nota

### Comando

```bash
arcli nca -m 5000 --cs --cuit 20168598204 --ir-ri \
  --ac fa \
  --apv 3 \
  --ar 120 \
  --acuit 20409509763
```

### Resultado esperado

- payload con `CbtesAsoc`
- validación previa del asociado
- emisión normal si agregás `--emitir`

### Errores comunes

- faltan `--apv`, `--ar` o `--acuit`
- usar `--ac` y `--at` juntos
- referenciar otra nota en lugar de una factura

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

- ARCLI mezcla flags, JSON y config usando esta prioridad:
  - flags
  - JSON
  - config
  - defaults internos

### Errores comunes

- nombres de campos incompatibles con el contrato JSON
- tipos inválidos
- lote con un item inválido que corta toda la ejecución

## Batch con JSON

### Cuándo usarlo

Cuando querés procesar varios comprobantes del mismo comando en una sola corrida.

### Requisitos

- archivo con un array JSON
- cada item debe ser válido

### Comando

```bash
arcli fc --cargar ./voucher-batch.json --json --bruto
```

### Resultado esperado

- en texto: un bloque por item
- en JSON: un array de resultados con `indice`, `comprobante` y `atajo`

### Errores comunes

- un item inválido hace fallar el lote completo
- asumir que hay resultados parciales cuando la validación corta antes

## Caso con error real

### Cuándo usarlo

Cuando querés entender un rechazo o una observación real del entorno ARCA.

### Requisitos

- entorno configurado
- caso reproducible

### Comando

```bash
arcli fa -m 15000 --cs --cuit 20409509763 --ir-ri --emitir --bruto
```

### Resultado esperado

- respuesta real de ARCA
- error funcional porque el receptor coincide con el emisor

### Errores comunes

- confundir un error funcional con un fallo del CLI
- mirar solo la salida humana cuando conviene revisar `--bruto`

## Previsualizar

### Cuándo usarlo

Cuando querés revisar el payload sin llamar a ARCA.

### Requisitos

- datos mínimos válidos para construir el payload

### Comando

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf --previsualizar
```

### Resultado esperado

- no hay emisión real
- no aparece respuesta ARCA real
- `--bruto` muestra un mensaje amigable en vez de `null`

### Errores comunes

- combinar `--previsualizar` con `--emitir`

## Emitir

### Cuándo usarlo

Cuando querés crear realmente el comprobante en ARCA.

### Comando

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf --emitir
```

### Resultado esperado

- payload visible
- resultado humano
- respuesta cruda si agregás `--bruto`

### Errores comunes

- asumir que `--json` cambia el comportamiento funcional; solo cambia la salida

## Caso de automatización

### Cuándo usarlo

Cuando querés consumir ARCLI desde un script o pipeline.

### Requisitos

- salida estructurada
- un formato fácil de parsear

### Comando

```bash
arcli fb -m 1 --cs --consumidor-final --ir-cf --emitir --json --bruto
```

### Ejemplo con `jq`

Cuando querés encadenar la salida con otros scripts, lo más práctico es combinar `--json` con `jq`:

```bash
arcli fb -m 1 --cs --consumidor-final --ir-cf --emitir --json \
  | jq '{estado, cae, comprobante, atajo, solicitud}'
```

### Resultado esperado

- JSON estable para scripts
- acceso directo a campos como `estado`, `cae`, `atajo` o `solicitud`

### Errores comunes

- intentar parsear la salida humana
- asumir que `--json` devuelve exactamente lo mismo que el modo texto
