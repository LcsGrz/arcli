[← Volver al README](../README.md)

# UI Smoke Checklist

Checklist manual para probar todas las salidas que hoy hacen una diferencia real en la UI.

## Cómo usar este checklist

No está pensado para leerse de punta a punta en cada cambio.

La idea es usarlo por bloques, según lo que estés tocando:

- help y descubrimiento si cambiaste comandos o textos
- configuración si cambiaste defaults o validaciones
- facturación si tocaste payload, estados o respuesta
- JSON si cambiaste contratos de automatización
- storybook si tocaste componentes visuales

## Preparacion

Usar siempre `testing` y montos chicos:

```bash
yarn dev config revisar --testing
```

Si queres un baseline consistente:

```bash
yarn dev config establecer emitir false
yarn dev config establecer bruto false
```

## Showcase rapido

### UI gallery

```bash
yarn dev storybook
```

Verifica:

- portada minimalista con `Galeria visual del CLI`
- escena de colores antes de componentes
- escenas de componentes, config, billing y errores
- escena JSON para contrato estructurado
- datos hardcodeados consistentes
- utilidad real para iterar diseño sin depender de ARCA

## Help y descubrimiento

### Help general

```bash
yarn dev --ayuda
```

Verifica:

- banner ASCII
- familias soportadas
- uso rapido
- opciones globales

### Help de shortcut

```bash
yarn dev fc ayuda
```

Verifica:

- resumen del comprobante
- ejemplos
- parametros comunes
- reglas clave

### Help de familia

```bash
yarn dev factura ayuda
```

Verifica:

- relacion A/B/C
- ejemplos por familia
- parametros compartidos

### Help de config

```bash
yarn dev config ayuda
```

Verifica:

- subcomandos
- nombres claros
- ayuda entendible

## Configuracion

### Config show

```bash
yarn dev config
```

Verifica:

- panel con titulo
- alineacion de columnas
- padding parejo

### Config validate en testing

```bash
yarn dev config revisar --testing
```

Verifica:

- panel de validacion
- footer de exito
- rutas saneadas

### Config doctor

```bash
yarn dev config revisar
```

Verifica:

- recomendaciones claras
- checks separados entre `ok` y `warning`
- orientacion util para completar defaults

### Config path

```bash
yarn dev config ruta
```

Verifica:

- salida simple
- sin ruido visual extra

## Facturacion: preview, emision y bruto

### Preview simple

```bash
yarn dev factura c -m 1
```

Verifica:

- banner de testing
- payload visible
- footer `SIN EMITIR`
- prompt interactivo al final

### Dry run explicito

```bash
yarn dev factura c -m 1 --previsualizar
```

Verifica:

- no aparece prompt
- se muestra solo payload
- footer `SIN EMITIR`

### Emision directa

```bash
yarn dev factura c -m 1 --emitir
```

Verifica:

- se muestra payload
- luego respuesta final
- estado `APROBADO/OBSERVADO/RECHAZADO`
- sin duplicar preview

### Emision directa con bruto

```bash
yarn dev factura c -m 1 --emitir --bruto
```

Verifica:

- se muestra payload
- luego panel `Respuesta bruta`
- sin headers viejos tipo `=====`

### Emision real aprobada con bruto

```bash
yarn dev factura b -m 1 --cs --dni 12345678 --ir-cf --emitir --bruto
```

Verifica:

- payload visible
- panel `Respuesta bruta`
- `CAE` y `CbteTipo` consistentes

### Emision real JSON con bruto

```bash
yarn dev factura c -m 1 --cs --consumidor-final --ir-cf --emitir --json --bruto
```

Verifica:

- la salida empieza y termina con aire visual consistente
- `solicitud` y `respuesta` aparecen completos
- no hay paneles de texto mezclados con JSON
- el JSON sigue siendo legible si se ve en terminal
- si aparece `coe.alreadyAuthenticated`, tratarlo como un fallo transitorio del entorno WSAA y no como una rotura del contrato JSON

### Emision real aprobada con asociado

```bash
yarn dev nota-credito c -m 1 --cs --consumidor-final --ir-cf \
  --ac fc \
  --apv 3 \
  --ar 47 \
  --acuit 20409509763 \
  --emitir
```

Verifica:

- payload con bloque de asociado
- respuesta final aprobada
- paneles secundarios vacios o ausentes

### Emision real aprobada de nota de credito B

```bash
yarn dev nota-credito b -m 1 --cs --dni 12345678 --ir-cf \
  --ac fb \
  --apv 3 \
  --ar 4 \
  --acuit 20409509763 \
  --emitir
```

Verifica:

- payload con asociado
- estado `APROBADO`
- layout consistente con la nota de credito C

### Emision real aprobada de nota de debito

```bash
yarn dev nota-debito c -m 1 --cs --consumidor-final --ir-cf \
  --ac fc \
  --apv 3 \
  --ar 47 \
  --acuit 20409509763 \
  --emitir
```

Verifica:

- payload con asociado
- respuesta aprobada
- layout igual al de nota de credito

### Emision real aprobada de nota de debito B

```bash
yarn dev nota-debito b -m 1 --cs --dni 12345678 --ir-cf \
  --ac fb \
  --apv 3 \
  --ar 4 \
  --acuit 20409509763 \
  --emitir
```

Verifica:

- payload con asociado
- estado `APROBADO`
- layout consistente con la nota de debito C

### Emision real aprobada de nota de debito C con bruto

```bash
yarn dev nota-debito c -m 1 --cs --consumidor-final --ir-cf \
  --ac fc \
  --apv 3 \
  --ar 47 \
  --acuit 20409509763 \
  --emitir --bruto
```

Verifica:

- payload con asociado visible
- panel `Respuesta bruta`
- `CAE` real en la respuesta
- el asociado se entiende bien en el payload sin duplicarse raro en la respuesta

### Emision real observada

```bash
yarn dev factura a -m 1 --cs --cuit 20168598204 --ir-ri --emitir
```

Verifica:

- payload con IVA calculado
- estado `OBSERVADO`
- panel de observaciones visible

### Emision real de Factura A con bruto

```bash
yarn dev factura a -m 1 --cs --cuit 20168598204 --ir-ri --emitir --bruto
```

Verifica:

- payload con IVA calculado
- `Respuesta bruta` sin saltos de linea sobrantes al inicio
- `CAE` presente
- observacion de padron visible en la respuesta de ARCA
- observacion `10217` visible en `Respuesta bruta`

### Emision real rechazada de Factura A usando la CUIT del emisor

```bash
yarn dev factura a -m 1 --cs --cuit 20409509763 --ir-ri --emitir --bruto
```

Verifica:

- estado `RECHAZADO`
- `Respuesta bruta` con error ARCA `10069`
- mensaje claro de que `DocNro` no puede ser igual al del emisor

### Emision real aprobada de Factura A con CUIT juridica

```bash
yarn dev factura a -m 1 --cs --cuit 30202020204 --ir-ri --emitir --json --bruto
```

Verifica:

- `CAE` real presente
- salida JSON estructurada correcta
- observacion `10017` visible sobre padrones AFIP

### Factura A con CUIT juridica alternativa

```bash
yarn dev factura a -m 1 --cs --cuit 30558515305 --ir-ri --emitir --json --bruto
```

Verifica:

- `CAE` real presente cuando se corre de forma serial
- observacion `10217`
- si aparece error `10016`, probablemente sea por emisiones paralelas previas; correrlo de forma serial para confirmarlo

### Emision real aprobada de Nota de credito A

```bash
yarn dev nota-credito a -m 1 --cs --cuit 20168598204 --ir-ri \
  --ac fa \
  --apv 3 \
  --ar 6 \
  --acuit 20409509763 \
  --emitir --bruto
```

Verifica:

- `CAE` real presente
- comprobante asociado visible en el payload
- observacion `10217` visible en `Respuesta bruta`

### Emision real aprobada de Nota de debito A

```bash
yarn dev nota-debito a -m 1 --cs --cuit 20168598204 --ir-ri \
  --ac fa \
  --apv 3 \
  --ar 6 \
  --acuit 20409509763 \
  --emitir --bruto
```

Verifica:

- `CAE` real presente
- comprobante asociado visible en el payload
- observacion `10217` visible en `Respuesta bruta`

### Emision real rechazada

```bash
yarn dev factura b -m 1 --cs --dni 12345678 --ir-cf --emitir
```

Verifica:

- payload visible
- estado `RECHAZADO`
- panel de observaciones o errores visible

### Emision real aprobada de Factura B con consumidor final

```bash
yarn dev factura b -m 1 --cs --consumidor-final --ir-cf --emitir --json --bruto
```

Verifica:

- `CAE` real presente
- `DocTipo` 99 y `DocNro` 0 en el payload
- salida JSON estructurada correcta

### Preview con bruto

```bash
yarn dev factura c -m 1 --bruto
```

Verifica:

- preview amigable
- sin `null`
- sin respuesta ARCA si no hubo emision

### JSON simple

```bash
yarn dev factura c -m 1 --json
```

Verifica:

- salida JSON limpia
- sin paneles ASCII

### JSON con bruto

```bash
yarn dev factura c -m 1 --emitir --json --bruto
```

Verifica:

- JSON con `solicitud`
- JSON con `respuesta`
- sin decoracion visual

### JSON aprobado real de Factura B

```bash
yarn dev factura b -m 1 --cs --dni 12345678 --ir-cf --emitir --json --bruto
```

Verifica:

- contrato JSON completo
- `solicitud` con IVA automatico
- `respuesta` con `CAE` real
- salida estructurada sin mezclar paneles de texto

## Variantes de receptor

### Consumidor final

```bash
yarn dev factura c -m 1 --cs --consumidor-final --ir-cf --previsualizar
```

Verifica:

- `Tipo de documento`
- `Numero de documento`
- `IVA receptor`

### CUIT

```bash
yarn dev factura a -m 1 --cs --cuit 20168598204 --ir-ri --previsualizar
```

Verifica:

- cambio visual de receptor
- labels amigables

### DNI

```bash
yarn dev factura c -m 1 --cs --dni 12345678 --ir-cf --previsualizar
```

Verifica:

- documento distinto
- formato claro

## Notas con asociado

### Nota de credito con asociado

```bash
yarn dev nota-credito a -m 1 --cs --cuit 20168598204 --ir-ri \
  --ac fa \
  --apv 3 \
  --ar 1 \
  --acuit 20409509763 \
  --previsualizar
```

Verifica:

- bloque de asociado visible
- nombres amigables
- orden claro

## Input por JSON

### Un comprobante desde JSON

```bash
yarn dev factura c --cargar ./voucher.json --previsualizar
```

Verifica:

- preview igual de prolijo que por flags

### Lote JSON

```bash
yarn dev factura c --cargar ./voucher-batch.json --previsualizar
```

Verifica:

- separacion entre lotes
- numeracion de lote
- consistencia visual entre items

### Lote JSON en modo JSON

```bash
yarn dev factura c --cargar ./voucher-batch.json --json --bruto --previsualizar
```

Verifica:

- cada item incluye `indice`
- cada item incluye `comprobante`
- cada item incluye `atajo`
- el array sigue siendo facil de leer

### Lote JSON realista en previsualizacion

```bash
yarn dev factura c --cargar /tmp/arcli-batch.json --previsualizar
yarn dev factura c --cargar /tmp/arcli-batch.json --json --bruto --previsualizar
```

Verifica:

- el modo texto separa claramente `Lote 1/2` y `Lote 2/2`
- el modo JSON conserva `indice`, `comprobante`, `atajo`, `solicitud` y `respuesta.mensaje`
- el segundo item respeta `DNI` y `DocNro`

### Lote JSON con item invalido

```bash
yarn dev factura c --cargar /tmp/arcli-batch-mixed.json --previsualizar
yarn dev factura c --cargar /tmp/arcli-batch-mixed.json --json --bruto --previsualizar
```

Verifica:

- hoy el lote corta completo con `INPUT_VALIDATION_ERROR`
- en texto se muestra `Error de entrada`
- en JSON se devuelve `codigo`, `error` y `detalles`
- no hay resultados parciales por item cuando uno falla

## Errores y validaciones

### Error de entrada por monto faltante

```bash
yarn dev factura c
```

Verifica:

- panel de error
- titulo claro
- detalle entendible
- sugerencia visible

### Error por flags incompatibles

```bash
yarn dev factura c -m 1 --emitir --previsualizar
```

Verifica:

- error de entrada
- mensaje claro

### Error por concepto duplicado

```bash
yarn dev factura c -m 1 --cs --concepto servicios
```

Verifica:

- error claro
- no demasiada jerga tecnica

### Error por identidad duplicada

```bash
yarn dev factura c -m 1 --cuit 20168598204 --dni 12345678 --ir-ri
```

Verifica:

- error claro
- detalle util

### Error por PEM invalido

```bash
yarn dev config establecer key.testing /ruta/invalida.key
```

Verifica:

- panel de error de configuracion
- detalle de ruta
- explicacion de formato esperado

### Error real de ARCA

```bash
yarn dev factura b -m 1 --cs --consumidor-final --ir-cf --emitir
```

Verifica:

- estado `RECHAZADO`
- panel `Errores` visible
- mensaje tecnico real de ARCA bien encapsulado

### Error transitorio WSAA

```bash
yarn dev factura c -m 1 --cs --consumidor-final --ir-cf --emitir --json --bruto
```

Verifica:

- si aparece `coe.alreadyAuthenticated`, la salida JSON sigue siendo clara
- no se rompe el formato estructurado
- el error se interpreta como transitorio del entorno WSAA

## Testing y produccion

### Banner de testing

```bash
yarn dev factura c -m 1 --previsualizar
```

Verifica:

- aviso visible de `TESTING`

### Produccion sin confirmacion

```bash
yarn dev factura c -m 1 --produccion --emitir
```

Verifica:

- error de configuracion
- mensaje de `--confirmar-produccion`

## Orden recomendado de prueba

1. `yarn dev --ayuda`
2. `yarn dev config`
3. `yarn dev config revisar --testing`
4. `yarn dev factura c -m 1`
5. `yarn dev factura c -m 1 --emitir`
6. `yarn dev factura c -m 1 --emitir --bruto`
7. `yarn dev nota-credito c -m 1 --cs --consumidor-final --ir-cf --ac fc --apv 3 --ar 47 --acuit 20409509763 --emitir`
8. `yarn dev nota-credito b -m 1 --cs --dni 12345678 --ir-cf --ac fb --apv 3 --ar 4 --acuit 20409509763 --emitir`
9. `yarn dev nota-debito c -m 1 --cs --consumidor-final --ir-cf --ac fc --apv 3 --ar 47 --acuit 20409509763 --emitir`
10. `yarn dev nota-debito b -m 1 --cs --dni 12345678 --ir-cf --ac fb --apv 3 --ar 4 --acuit 20409509763 --emitir`
11. `yarn dev factura a -m 1 --cs --cuit 20168598204 --ir-ri --emitir`
12. `yarn dev factura b -m 1 --cs --dni 12345678 --ir-cf --emitir`
13. `yarn dev factura b -m 1 --cs --dni 12345678 --ir-cf --emitir --bruto`
14. `yarn dev factura b -m 1 --cs --consumidor-final --ir-cf --emitir`
15. `yarn dev factura c -m 1 --json`
16. `yarn dev nota-credito a ... --previsualizar`
17. `yarn dev factura c`
18. `yarn dev factura c -m 1 --produccion --emitir`

## Casos pendientes

- probar `Factura A`, `Nota de credito A` y `Nota de debito A` con otra CUIT de testing valida para ver si existe un caso sin observaciones
- probar `Nota de credito A` con un comprobante `A` previo real
- probar `Nota de debito A` con un comprobante `A` previo real
- probar lote JSON en `previsualizacion` con multiples items
