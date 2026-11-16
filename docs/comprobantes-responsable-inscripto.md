[← Documentación](README.md)

# Responsable inscripto: Facturas A y B

Si sos responsable inscripto, emitís comprobantes **A** y **B**, con el IVA discriminado:

- **A** a otro responsable inscripto (siempre con CUIT).
- **B** a consumidores finales, monotributistas y exentos.

| Comprobante                    | A      | B      |
| ------------------------------ | ------ | ------ |
| Factura                        | `fa`   | `fb`   |
| Nota de crédito                | `nca`  | `ncb`  |
| Nota de débito                 | `nda`  | `ndb`  |
| Factura de Crédito Electrónica | `fcea` | `fceb` |

Con `--cuit` y sin `--ir`, ARCLI toma la condición frente al IVA del receptor del padrón de ARCA. Las alícuotas, varias por comprobante y el IVA automático están en las [reglas de validación](validation-rules.md#iva-automático). Las notas se explican en [notas de crédito y débito](notas-credito-debito.md) y la FCE en [su página](fce.md).

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
- el padrón no informa la condición IVA del CUIT: pasala con `--ir`
- CUIT con longitud inválida
