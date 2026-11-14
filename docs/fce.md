[← Documentación](README.md)

# Factura de Crédito Electrónica (FCE)

La Factura de Crédito Electrónica MiPyMEs corresponde cuando le facturás a una empresa obligada a recibirla y el monto supera el mínimo que fija ARCA. `arcli fce-obligado <cuit>` te dice si el receptor está obligado y desde qué monto; con `verificarFce` en la config, arcli lo revisa solo al facturar. Atajos: `fcea`, `fceb`, `fcec` y sus notas `ncea`…`ndec`.

## Factura de crédito electrónica (FCE)

### Cuándo usarlo

Cuando vendés a una empresa grande dentro del régimen FCE MiPyMEs y el comprobante tiene que ser de crédito electrónica.

### Requisitos

- CBU del emisor, por flag o configurado una vez
- receptor identificado con CUIT y IVA receptor válido para la letra

### Comando

```bash
arcli config establecer cbu 0110599520000012345678

arcli fcea -m 1500000 --cs --cuit 30546689979 --ir-ri \
  --vto 25 \
  --transferencia sca
```

Si después el comprador rechaza la factura, la nota de crédito de anulación es:

```bash
arcli ncea -m 1500000 --cs --cuit 30546689979 --ir-ri \
  --ac fcea --apv 3 --ar 15 --afecha 01-10-2026 \
  --anulacion
```

### Resultado esperado

- la factura lleva `Opcionales` con CBU (`2101`) y transferencia (`27`), además de `FchVtoPago`
- la nota lleva `Opcionales` con anulación (`22`) y `CbtesAsoc` con la fecha del asociado
- el CUIT del asociado se toma del emisor configurado

### Errores comunes

- falta el CBU en la factura
- falta `--afecha` en la nota
- pasar `--cbu` o `--transferencia` en una nota FCE: solo van en la factura
