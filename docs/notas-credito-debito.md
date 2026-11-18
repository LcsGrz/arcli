[← Documentación](README.md)

# Notas de crédito y débito

Una nota de crédito resta y una de débito suma sobre un comprobante ya emitido (el **asociado**), o sobre un período. Vale para las letras A, B y C con los atajos `nca`, `ncb`, `ncc`, `nda`, `ndb` y `ndc`, y para FCE (`ncea`…`ndec`). Las notas de la factura de exportación están en [exportación](exportacion.md).

En el [modo interactivo](modo-interactivo.md) elegís la factura de una lista y la nota toma de ahí el receptor, la moneda y la alícuota.

## Nota de crédito con comprobante asociado

### Cuándo usarlo

Cuando necesitás anular o ajustar una factura previa, o una nota ya emitida (por ejemplo, una nota de crédito que corrige una de débito).

### Requisitos

- datos completos del asociado
- misma letra que el comprobante referenciado
- asociado del tipo factura, recibo (`--ac ra`, `--ac rb`, `--ac rc`) u otra nota (`--ac nda`, `--ac ncc`…)
- en FCE, una nota sobre otra nota FCE va con `--anulacion`: la NC ajusta la factura o una ND FCE, y la ND solo una NC FCE ([reglas](validation-rules.md#comprobantes-asociados))

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
- referenciar un comprobante de otra letra
- en FCE, asociar una nota FCE sin `--anulacion`, o una ND FCE con `--anulacion` sobre la factura
