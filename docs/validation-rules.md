[← Volver al README](../README.md)

# Reglas de validación

Resumen rápido:

- primero ARCLI valida flags, tipos y combinaciones
- después aplica reglas de negocio del comprobante
- por último pueden aparecer restricciones o errores propios de ARCA

La idea de esta guía es separar esas tres capas para que sea más fácil entender dónde se rompió el flujo.

## 1. Validaciones del CLI

### Flags mutuamente excluyentes

- `--testing` y `--produccion`
- `--emitir` y `--previsualizar`
- `--concepto` y cualquiera de `--cs`, `--cp`, `--csp`
- `--iva-receptor`, `--ir` y cualquier `--ir-*`
- `--ac` y `--at`
- combinaciones múltiples de identidad del receptor:
  - `--cuit`
  - `--cuil`
  - `--dni`
  - `--consumidor-final`
  - `--cfinal`

### Tipos y formatos

- `--monto` debe ser un número positivo
- `--dia` debe ser un entero entre `1` y `31`
- `--punto-venta`, `--pv`, `--at`, `--apv`, `--ar` deben ser enteros positivos
- `--cotizacion-moneda` y `--cm` deben ser números positivos
- `--cuit` y `--cuil` deben tener 11 dígitos
- `--dni` debe tener 7 u 8 dígitos

### Fechas aceptadas

ARCLI interpreta las fechas en formato argentino (día primero), con mes y año opcionales:

- `D` o `DD`
- `D-MM` o `D/MM`
- `D-MM-YY` o `D/MM/YY`
- `D-MM-YYYY` o `D/MM/YYYY`

Reglas de interpretación:

- si omitís el año, ARCLI usa el año actual
- si omitís mes y año, ARCLI usa el mes y año actuales
- un año de 2 dígitos se interpreta como `20YY`
- no se pueden mezclar separadores dentro de la misma fecha (por ejemplo, `5-3/26` no es válido)

Formatos como `YYYY-MM-DD` no son válidos.

Si el formato no coincide, ARCLI corta antes de armar el payload.

### Emisión en producción

Para emitir realmente en `produccion`, ARCLI exige:

- `--produccion`
- `--emitir`
- `--confirmar-produccion`

## 2. Reglas de negocio

### Punto de venta

- Puede venir por flags o por config.
- Si falta en ambos lugares, el flujo falla antes de emitir.

### Concepto y fechas de servicio

#### `productos`

- no usa `--servicio-desde`
- no usa `--servicio-hasta`
- no usa `--dia`

#### `servicios` y `productos-servicios`

- si informás una fecha de servicio, tenés que informar ambas
- la fecha de inicio no puede ser posterior a la de fin

### Identidad del receptor

#### Consumidor final

Si usás consumidor final:

- el documento debe ser `0`
- el IVA receptor debe ser `consumidor-final`

#### CUIT, CUIL y DNI

- si el tipo de documento no es `consumidor-final`, ARCLI exige `numeroDocumento`

### IVA receptor

ARCLI exige una única fuente de IVA receptor:

- `--iva-receptor <tipo>`
- `--ir <tipo>`
- un solo `--ir-*`
- o un default configurado

### Comprobantes asociados

Aplica a:

- `nota-credito`
- `nota-debito`
- `nota-credito-electronica`
- `nota-debito-electronica`

No aplica a:

- `factura`
- `factura-credito-electronica`

Para notas, el asociado necesita:

- `--ac` o `--at`
- `--apv` o `--asociado-punto-venta`
- `--ar`
- `--acuit`

Además:

- el asociado debe ser una factura, no otra nota
- la letra debe coincidir
- la categoría electrónica debe coincidir

### IVA automático

ARCLI hoy calcula IVA automáticamente en estos casos:

- comprobantes letra `B`
- comprobantes letra `A` cuando `ivaReceptor` es `responsable-inscripto`

Usa:

- alícuota fija `21%`
- `Id` de IVA fijo `5`

## 3. Restricciones y errores de ARCA

Estas no son validaciones propias del CLI, pero aparecen en la práctica y conviene documentarlas por separado.

### Errores transitorios

#### `coe.alreadyAuthenticated`

- viene de WSAA
- suele indicar que ya existe un TA válido
- normalmente conviene esperar unos segundos y reintentar

#### `Transacción Activa`

- viene de ARCA
- suele aparecer como error transitorio
- conviene reintentar antes de cambiar el comprobante

### Restricciones reales observadas

#### Emisor igual a receptor

ARCA rechaza `Factura A` si el `DocNro` coincide con el CUIT del emisor.

Error real observado:

```text
Campo DocNro no puede ser igual al del emisor.
```

#### Observaciones de padrón

Algunos CUITes de testing aprueban pero devuelven observaciones, por ejemplo:

- `10217`
- `10017`

Eso no implica necesariamente un problema del CLI. Puede depender del receptor o del entorno de testing.
