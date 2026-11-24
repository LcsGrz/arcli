[← Documentación](README.md)

# Factura de Crédito Electrónica (FCE)

La Factura de Crédito Electrónica MiPyMEs corresponde cuando le facturás a una empresa obligada a recibirla y el monto supera el mínimo que fija ARCA. `arcli fce-obligado <cuit>` te dice si el receptor está obligado y desde qué monto; con `verificarFce` en la config, ARCLI lo revisa solo al facturar. Atajos: `fcea`, `fceb`, `fcec` y sus notas `ncea`…`ndec`.

## Factura de crédito electrónica (FCE)

### Cuándo usarlo

Cuando vendés a una empresa grande dentro del régimen FCE MiPyMEs y el comprobante tiene que ser de crédito electrónica.

### Requisitos

- CBU del emisor, por flag o configurado una vez, con su alias si lo tiene
- receptor identificado con CUIT y IVA receptor válido para la letra

### Comando

```bash
arcli config establecer cuenta 0110599520000012345678 mi.alias.cbu

arcli fcea -m 1500000 --cs --cuit 30546689979 --ir-ri \
  --vto 25 \
  --transferencia sca
```

Si después el comprador rechaza la factura en el Registro de FCE, la nota de crédito de anulación es:

```bash
arcli ncea -m 1500000 --cs --cuit 30546689979 --ir-ri \
  --ac fcea --apv 3 --ar 15 --afecha 01-10-2026 \
  --anulacion
```

### Resultado esperado

- la factura lleva `Opcionales` con CBU (`2101`) y transferencia (`27`), además de `FchVtoPago`
- la nota lleva `Opcionales` con anulación (`22`) y `CbtesAsoc` con la fecha del asociado: sin `--afecha`, ARCLI la toma de ARCA y la vista previa ya la muestra
- el CUIT del asociado se toma del emisor configurado
- con `--anulacion`, ARCLI consulta el asociado en el Registro de FCE (`wsfecred`) y, si el comprador no lo rechazó, la vista previa lo avisa en `avisos`

### Anulación: el comprador tiene que rechazar antes

Una nota con `--anulacion` solo vale si el comprador ya **rechazó** el comprobante asociado en el Registro de Facturas de Crédito Electrónica. Si lo recibió y no lo rechazó, o lo aceptó, ARCA rechaza la nota con el error `10154` ("Comprobante electronico autorizado, NO rechazado por el Comprador") y no se emite nada. Lo mismo vale para una nota sobre otra nota FCE, que siempre es de anulación: la nota asociada tiene que estar rechazada.

Antes de emitir, la vista previa consulta el estado del asociado en el Registro y avisa si no está rechazado. Es un aviso y no frena: el comprador puede rechazarlo en el medio. Esa consulta usa `wsfecred`, así que el certificado tiene que tenerlo autorizado; si no, el aviso dice que no se pudo consultar. Si la nota no es una anulación (por ejemplo, un ajuste sobre una factura aceptada), emitila sin `--anulacion`. Ver [ARCA rechaza la nota FCE de anulación](troubleshooting.md#arca-rechaza-la-nota-fce-de-anulación).

### Errores comunes

- falta el CBU en la factura
- la nota de crédito supera el total de la factura: ARCLI lo frena desde la vista previa
- pasar `--cbu` o `--transferencia` en una nota FCE: solo van en la factura
- emitir la nota de anulación antes de que el comprador rechace el asociado: ARCA la rechaza con `10154`
