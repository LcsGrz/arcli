[← Volver al README](../README.md)

# Troubleshooting

Problemas comunes agrupados por categoría.

## Debug rápido

Si algo no cierra, estas son las tres corridas que más ayudan:

```bash
arcli config revisar
arcli fc ayuda
arcli fc -m 1000 --cs --consumidor-final --ir-cf --emitir --json --bruto --testing
```

Con eso normalmente ves:

- si falta configuración
- si el comando está mal armado
- si el problema viene de la solicitud o de ARCA

### Inspeccionar con JSON o bruto

Si la salida humana no alcanza para entender qué pasó:

```bash
arcli fc -m 1000 --cs --consumidor-final --ir-cf --emitir --json
arcli fc -m 1000 --cs --consumidor-final --ir-cf --emitir --bruto
arcli fc -m 1000 --cs --consumidor-final --ir-cf --emitir --json --bruto
```

- **Documentación relacionada:** [Entrada y salida](input-output.md)

## Config

### Falta CUIT del emisor

- **Severidad:** común
- **Síntoma:** error de configuración indicando que falta el CUIT.
- **Causa:** no existe `cuit` en la config persistente.
- **Solución:**

```bash
arcli config establecer cuit 20168598204
arcli config revisar
```

- **Documentación relacionada:** [Configuración](configuration.md)

### Falta punto de venta

- **Severidad:** común
- **Síntoma:** el flujo corta antes de emitir con un mensaje sobre punto de venta.
- **Causa:** no llegó `puntoVenta` por flags ni por config.
- **Solución:**

```bash
arcli config establecer puntoVenta 3
```

o bien:

```bash
arcli fc -m 1000 --pv 3 --cs --consumidor-final --ir-cf
```

- **Documentación relacionada:** [Configuración](configuration.md), [Referencia del CLI](cli-reference.md)

### Certificado o clave PEM inválidos

- **Severidad:** crítico
- **Síntoma:** error indicando que la ruta apunta a un archivo con formato PEM inválido.
- **Causa:** el archivo existe, pero el contenido no parece un PEM válido.
- **Solución:** volver a guardar la ruta correcta.

```bash
arcli config establecer cert.testing /ruta/al/certificado.crt
arcli config establecer key.testing /ruta/a/la/clave.key
```

- **Documentación relacionada:** [Configuración](configuration.md), [Cómo obtener los certificados de ARCA](obtencion-certificados.md)

## Validación

### Falta un dato obligatorio

- **Severidad:** común
- **Síntoma:** `INPUT_VALIDATION_ERROR` o mensaje como `Falta monto.`
- **Causa:** falta un dato obligatorio en flags o JSON.
- **Solución:** revisar `ayuda` del comando puntual y completar los campos faltantes.

```bash
arcli fc ayuda
```

- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### Se mezclan identidades del receptor

- **Severidad:** frecuente
- **Síntoma:** error pidiendo usar una sola identidad de receptor.
- **Causa:** se combinaron `--cuit`, `--cuil`, `--dni` o `--consumidor-final`.
- **Solución:** dejar una sola forma de identificar al receptor.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### Se mezclan formas de indicar IVA receptor

- **Severidad:** frecuente
- **Síntoma:** error pidiendo usar `--iva-receptor`, `--ir` o un solo `--ir-*`.
- **Causa:** se combinaron varias formas de indicar IVA receptor.
- **Solución:** dejar una sola fuente.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

## ARCA

### `coe.alreadyAuthenticated`

- **Severidad:** frecuente
- **Síntoma:** error WSAA con `coe.alreadyAuthenticated`.
- **Causa:** ya existe un ticket válido para ese servicio.
- **Solución:** esperar unos segundos y reintentar sin cambiar la solicitud.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Limitaciones actuales](limitations.md)

### `Transacción Activa`

- **Severidad:** frecuente
- **Síntoma:** error ARCA con referencia a transacción activa.
- **Causa:** ARCA informa una operación transitoria en curso.
- **Solución:** esperar unos segundos y reintentar antes de modificar el comprobante.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Limitaciones actuales](limitations.md)

### El receptor coincide con el emisor

- **Severidad:** crítico
- **Síntoma:** error ARCA `Campo DocNro no puede ser igual al del emisor.`
- **Causa:** se está usando el mismo CUIT como emisor y receptor.
- **Solución:** usar otro CUIT válido de testing como receptor.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### Observaciones de padrón

- **Severidad:** frecuente
- **Síntoma:** el comprobante aprueba, pero devuelve observaciones como `10217` o `10017`.
- **Causa:** condición del receptor o del entorno de testing.
- **Solución:** revisar si el caso es aceptable para tu flujo y distinguirlo de un rechazo real.
- **Documentación relacionada:** [Limitaciones actuales](limitations.md)

## Batch

### Un item inválido hace caer todo el lote

- **Severidad:** crítico
- **Síntoma:** el batch devuelve `INPUT_VALIDATION_ERROR` y no hay resultados parciales.
- **Causa:** hoy la validación del lote es fail-fast.
- **Solución:** validar o dividir el lote antes de ejecutarlo.
- **Documentación relacionada:** [Entrada y salida](input-output.md), [Limitaciones actuales](limitations.md)
