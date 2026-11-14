[← Documentación](README.md)

# Monotributo: Factura C, notas y Recibo C

Si sos monotributista, emitís comprobantes **C**: no discriminan IVA. Todos se pueden emitir con flags o desde el [modo interactivo](modo-interactivo.md).

| Comprobante                      | Atajo  | Familia                |
| -------------------------------- | ------ | ---------------------- |
| Factura C                        | `fc`   | `arcli factura c`      |
| Nota de crédito C                | `ncc`  | `arcli nota-credito c` |
| Nota de débito C                 | `ndc`  | `arcli nota-debito c`  |
| Recibo C                         | `rc`   | `arcli recibo c`       |
| Factura de Crédito Electrónica C | `fcec` | ver [FCE](fce.md)      |

Las notas se explican en [notas de crédito y débito](notas-credito-debito.md). Sin `--emitir`, los comandos muestran la vista previa y, en una terminal, preguntan antes de emitir.

## Factura C simple

### Cuándo usarlo

Cuando querés emitir o previsualizar una factura básica para consumidor final.

### Requisitos

- `puntoVenta` resuelto por flag o config
- credenciales del entorno configuradas si vas a emitir

### Comando

```bash
arcli fc -m 15000 --cs --consumidor-final
```

### Resultado esperado

- vista previa de la solicitud, con estado `SIN EMITIR`
- agregá `--emitir` para emitir de verdad

### Errores comunes

- falta `--monto`
- falta `puntoVenta`

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

- arcli completa el resto desde config
- el payload sale igual de explícito en la preview

### Errores comunes

- asumir que la config cubre todo cuando falta `cuit` o credenciales
- olvidar qué defaults quedaron guardados

## Recibo C

### Cuándo usarlo

Cuando sos monotributista o exento y tenés que documentar un cobro con recibo en lugar de factura.

### Comando

```bash
arcli rc -m 15000 --cs --cfinal
```

### Resultado esperado

- vista previa con tipo ARCA `15` y sin IVA discriminado, igual que una Factura C
- si después hay que anularlo o ajustarlo, la nota C lo asocia con `--ac rc`

### Errores comunes

- pasar `--alicuota`, `--exento` o `--nogravado`: en letra C dan error
- pasar un comprobante asociado: el recibo no lleva
