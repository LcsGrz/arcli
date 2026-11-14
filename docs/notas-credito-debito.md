[← Documentación](README.md)

# Notas de crédito y débito

Una nota de crédito resta y una de débito suma sobre un comprobante ya emitido (el **asociado**), o sobre un período. Vale para las letras A, B y C con los atajos `nca`, `ncb`, `ncc`, `nda`, `ndb` y `ndc`, y para FCE (`ncea`…`ndec`). Las notas de la factura de exportación están en [exportación](exportacion.md).

En el [modo interactivo](modo-interactivo.md) elegís la factura de una lista y la nota toma de ahí el receptor, la moneda y la alícuota.

## Nota de crédito con comprobante asociado

### Cuándo usarlo

Cuando necesitás anular o ajustar una factura previa.

### Requisitos

- datos completos del asociado
- misma letra que la factura referenciada
- asociado del tipo factura o Recibo C, no otra nota

### Comando

```bash
arcli nca -m 5000 --cs --cuit 20168598204 --ir-ri \
  --ac fa \
  --apv 3 \
  --ar 120 \
  --acuit 20333333334
```

### Resultado esperado

- payload con `CbtesAsoc`
- validación previa del asociado
- emisión normal si agregás `--emitir`

### Errores comunes

- faltan `--apv`, `--ar` o `--acuit`
- usar `--ac` y `--at` juntos
- referenciar otra nota en lugar de una factura
