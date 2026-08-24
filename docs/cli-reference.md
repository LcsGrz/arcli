[← Volver al README](../README.md)

# Referencia del CLI

## TL;DR

Si solo querés un ejemplo mínimo funcional para arrancar:

```bash
arcli fc -m 300000 --cs --consumidor-final --ir-cf
```

Eso crea una `Factura C` con:

- monto
- concepto `servicios`
- receptor consumidor final
- IVA receptor consumidor final

Con eso ya podés emitir una factura básica sin configuración previa.

Si querés entender más, este orden sirve: [Cómo pensar los comprobantes](#cómo-pensar-los-comprobantes-en-arcli) → [Parámetros por familia](#parámetros-por-familia-de-comprobantes) → [Cómo funcionan los flags](#cómo-funcionan-los-flags) → [Ejemplos útiles](#ejemplos-útiles). Si ya conocés el CLI, las tablas y el [Estado de comandos](#estado-de-comandos) al final sirven como referencia rápida.

## Cómo pensar rápido un comando

Si querés armar un comando sin perderte, este orden suele funcionar bien:

1. elegí el comprobante: `fc`, `fa`, `nca`, `ndb`, `fcec`, etc
2. definí el monto: `--monto`
3. elegí el concepto: `--cs`, `--cp`, `--csp` o `--concepto`
4. definí la identidad del receptor: `--cuit`, `--cuil`, `--dni`, `--consumidor-final`
5. definí el IVA receptor: `--ir-*`, `--ir` o `--iva-receptor`

Con eso ya tenés la base. Después sumás fechas de servicio, JSON, salida estructurada o asociado solo si ese caso lo necesita.

## Cómo pensar los comprobantes en ARCLI

ARCLI trabaja con dos ideas al mismo tiempo:

- **familias**, como `factura` o `nota-credito`
- **letras**, como `a`, `b` o `c`

Entonces:

- `arcli factura c` y `arcli fc` representan el mismo comprobante
- `arcli nota-credito a` y `arcli nca` también

Los shortcuts existen para escribir menos. Las familias existen para que el comando sea más explícito o más fácil de descubrir.

En todos los casos, la estructura base se parece bastante:

- importe
- concepto
- identidad del receptor
- IVA del receptor
- punto de venta
- modo de ejecución

Después cambian algunas cosas según la familia:

- las **facturas** no usan comprobante asociado
- las **notas** sí lo usan
- las **electrónicas** mantienen la misma forma general, pero cambian el tipo ARCA

### Familias

| Comando                       | Argumentos  | Descripción                                                  |
| ----------------------------- | ----------- | ------------------------------------------------------------ |
| `factura`                     | `<a\|b\|c>` | Emite o previsualiza Factura A, B o C                        |
| `nota-credito`                | `<a\|b\|c>` | Emite o previsualiza Nota de crédito A, B o C                |
| `nota-debito`                 | `<a\|b\|c>` | Emite o previsualiza Nota de débito A, B o C                 |
| `factura-credito-electronica` | `<a\|b\|c>` | Emite o previsualiza Factura de crédito electrónica A, B o C |
| `nota-credito-electronica`    | `<a\|b\|c>` | Emite o previsualiza Nota de crédito electrónica A, B o C    |
| `nota-debito-electronica`     | `<a\|b\|c>` | Emite o previsualiza Nota de débito electrónica A, B o C     |

### Shortcuts

| Shortcut | Comando largo                   |
| -------- | ------------------------------- |
| `fa`     | `factura a`                     |
| `fb`     | `factura b`                     |
| `fc`     | `factura c`                     |
| `nca`    | `nota-credito a`                |
| `ncb`    | `nota-credito b`                |
| `ncc`    | `nota-credito c`                |
| `nda`    | `nota-debito a`                 |
| `ndb`    | `nota-debito b`                 |
| `ndc`    | `nota-debito c`                 |
| `fcea`   | `factura-credito-electronica a` |
| `fceb`   | `factura-credito-electronica b` |
| `fcec`   | `factura-credito-electronica c` |
| `ncea`   | `nota-credito-electronica a`    |
| `nceb`   | `nota-credito-electronica b`    |
| `ncec`   | `nota-credito-electronica c`    |
| `ndea`   | `nota-debito-electronica a`     |
| `ndeb`   | `nota-debito-electronica b`     |
| `ndec`   | `nota-debito-electronica c`     |

## Cómo funcionan los flags

Antes de ver parámetro por parámetro, hay cuatro reglas que te conviene tener presentes:

- **prioridad:** `flags > JSON > config > defaults`
- **los flags pisan todo**: si algo viene por CLI, manda eso
- **hay flags excluyentes**: no todo se puede combinar
- **`--json` y `--bruto` cambian la salida, no el sentido del comprobante**

Ejemplo simple de prioridad:

- si en config guardaste `puntoVenta = 3`
- en `voucher.json` mandás `puntoVenta = 5`
- y en CLI ejecutás `--pv 7`

ARCLI usa `7`, porque el flag explícito siempre pisa JSON y config.

### Exclusividades importantes

Hay varias combinaciones de flags que no podés usar juntas (entorno, modo de ejecución, concepto, IVA receptor, identidad del receptor, tipo de asociado). El detalle completo vive en [Flags mutuamente excluyentes](validation-rules.md#flags-mutuamente-excluyentes).

## Flags globales

Estos flags aplican a cualquier comando de comprobantes.

Usalos cuando necesitás controlar el entorno, la salida o el modo de inspección del resultado.

### ⚠️ Emisión en producción

Para emitir en producción, ARCLI exige este bloque completo:

```bash
--produccion --emitir
```

| Flag           | Alias   | Tipo      | Valor por defecto                                     | Descripción                                   |
| -------------- | ------- | --------- | ----------------------------------------------------- | --------------------------------------------- |
| `--testing`    | ninguno | `boolean` | `false`                                               | Fuerza entorno `testing` en esta ejecución    |
| `--produccion` | ninguno | `boolean` | `false`                                               | Fuerza entorno `produccion` en esta ejecución |
| `--json`       | ninguno | `boolean` | `config.output.jsonPorDefecto` (`false` por defecto)  | Devuelve salida estructurada                  |
| `--bruto`      | ninguno | `boolean` | `config.output.brutoPorDefecto` (`false` por defecto) | Agrega respuesta cruda de ARCA cuando exista  |

## Flags de comprobantes

Esta sección describe qué existe. Más abajo vas a encontrar qué hace falta en cada familia.

### Ejecución

Estos flags controlan si ARCLI previsualiza o emite de verdad.

| Flag              | Alias   | Tipo      | Valor por defecto                                      | Descripción                     |
| ----------------- | ------- | --------- | ------------------------------------------------------ | ------------------------------- |
| `--previsualizar` | ninguno | `boolean` | `!emitir` resuelto desde flags, JSON o config          | Muestra la solicitud sin emitir |
| `--emitir`        | ninguno | `boolean` | `config.output.emitirPorDefecto` (`false` por defecto) | Emite realmente en ARCA         |

### Identidad e IVA receptor

Estos flags definen a quién le emitís y bajo qué condición de IVA.

En la práctica, siempre necesitás:

- una identidad
- una condición de IVA receptor

| Flag                    | Alias         | Tipo                                                                                                                                                                                                                                                                                                     | Valor por defecto              | Descripción                                    |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `--cuit <number>`       | ninguno       | `integer`                                                                                                                                                                                                                                                                                                | ninguno                        | Usa CUIT del receptor                          |
| `--cuil <number>`       | ninguno       | `integer`                                                                                                                                                                                                                                                                                                | ninguno                        | Usa CUIL del receptor                          |
| `--dni <number>`        | ninguno       | `integer`                                                                                                                                                                                                                                                                                                | ninguno                        | Usa DNI del receptor                           |
| `--consumidor-final`    | `--cfinal`    | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Usa consumidor final con documento `0`         |
| `--iva-receptor <tipo>` | `--ir <tipo>` | `'cliente-del-exterior' \| 'consumidor-final' \| 'iva-liberado' \| 'iva-no-alcanzado' \| 'monotributista-social' \| 'monotributo-trabajador-independiente-promovido' \| 'proveedor-del-exterior' \| 'responsable-inscripto' \| 'responsable-monotributo' \| 'sujeto-exento' \| 'sujeto-no-categorizado'` | `config.ivaReceptorPorDefecto` | Condición IVA del receptor                     |
| `--ir-ce`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Cliente del exterior                           |
| `--ir-cf`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Consumidor final                               |
| `--ir-il`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | IVA liberado                                   |
| `--ir-ina`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | IVA no alcanzado                               |
| `--ir-ms`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Monotributista social                          |
| `--ir-mtip`             | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Monotributo trabajador independiente promovido |
| `--ir-pe`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Proveedor del exterior                         |
| `--ir-ri`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Responsable inscripto                          |
| `--ir-rm`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Responsable monotributo                        |
| `--ir-se`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Sujeto exento                                  |
| `--ir-snc`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                        | Sujeto no categorizado                         |

### Contenido

Estos flags arman el contenido del comprobante.

En casi todos los casos te va a interesar mirar primero:

- `--monto`
- `--concepto`
- `--fecha`
- `--punto-venta`

| Flag                           | Alias          | Tipo                                                  | Valor por defecto                   | Descripción                                      |
| ------------------------------ | -------------- | ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `--cargar <path>`              | ninguno        | `string`                                              | ninguno                             | Carga datos base desde un archivo JSON           |
| `--monto <number>`             | `-m`           | `number`                                              | requerido                           | Importe total del comprobante                    |
| `--fecha <fecha>`              | `-f`           | `string`                                              | hoy                                 | Fecha del comprobante                            |
| `--dia <number>`               | `-d`           | `integer`                                             | ninguno                             | Día de vencimiento o referencia del servicio     |
| `--punto-venta <number>`       | `--pv`         | `integer`                                             | `config.puntoVentaPorDefecto`       | Punto de venta                                   |
| `--concepto <tipo>`            | `-c`           | `'productos' \| 'servicios' \| 'productos-servicios'` | `config.conceptoPorDefecto`         | `productos`, `servicios` o `productos-servicios` |
| `--cs`                         | ninguno        | `boolean`                                             | `false`                             | Equivale a `--concepto servicios`                |
| `--cp`                         | ninguno        | `boolean`                                             | `false`                             | Equivale a `--concepto productos`                |
| `--csp`                        | ninguno        | `boolean`                                             | `false`                             | Equivale a `--concepto productos-servicios`      |
| `--moneda <codigo>`            | `--mda`        | `'ARS' \| 'USD' \| string(3)`                         | `config.monedaPorDefecto` o `ARS`   | Moneda del comprobante                           |
| `--cotizacion-moneda <number>` | `--cm`         | `number`                                              | `config.cotizacionPorDefecto` o `1` | Cotización de la moneda                          |
| `--servicio-desde <fecha>`     | `--sd <fecha>` | `string`                                              | ninguno                             | Fecha de inicio del servicio                     |
| `--servicio-hasta <fecha>`     | `--sh <fecha>` | `string`                                              | ninguno                             | Fecha de fin del servicio                        |

Las fechas usan formato argentino (día primero), con mes y año opcionales. Detalle completo en [Fechas aceptadas](validation-rules.md#fechas-aceptadas).

### Asociados

Estos flags importan solo para notas. Si estás emitiendo una factura, podés ignorarlos.

Dicho más directo: **no aplican a `factura`, `factura-credito-electronica`, `fa`, `fb`, `fc`, `fcea`, `fceb` ni `fcec`**.

| Flag                              | Alias            | Tipo         | Valor por defecto | Descripción                        |
| --------------------------------- | ---------------- | ------------ | ----------------- | ---------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | ninguno           | Atajo del comprobante asociado     |
| `--at <number>`                   | ninguno          | `integer`    | ninguno           | Tipo ARCA del comprobante asociado |
| `--asociado-punto-venta <number>` | `--apv <number>` | `integer`    | ninguno           | Punto de venta del asociado        |
| `--ar <number>`                   | ninguno          | `integer`    | ninguno           | Número del comprobante asociado    |
| `--acuit <number>`                | ninguno          | `string(11)` | ninguno           | CUIT del comprobante asociado      |

## Parámetros por familia de comprobantes

Acá está la parte más práctica del documento: qué necesitás para emitir cada familia y qué cambia entre una y otra.

### Facturas `A`, `B` y `C`

Las facturas comparten la misma base.

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- monto: `--monto`
- concepto: `--concepto`, `--cs`, `--cp` o `--csp`
- identidad del receptor: `--cuit`, `--cuil`, `--dni`, `--consumidor-final` o `--cfinal`
- IVA del receptor: `--iva-receptor`, `--ir` o un solo `--ir-*`

**Opcional**

- punto de venta si no está en config: `--punto-venta` o `--pv`
- fecha del comprobante: `--fecha`
- moneda y cotización: `--moneda`, `--mda`, `--cotizacion-moneda`, `--cm`
- carga JSON: `--cargar`
- fechas de servicio: `--dia`, `--servicio-desde`, `--servicio-hasta`
- modo de ejecución: `--previsualizar`, `--emitir`
- salida: `--json`, `--bruto`

#### Ejemplo mínimo funcional

Factura C simple:

```bash
arcli fc -m 300000 --cs --consumidor-final --ir-cf
```

Factura A con CUIT:

```bash
arcli fa -m 1 --cs --cuit 20168598204 --ir-ri
```

#### Resumen rápido de parámetros

| Parámetro                                                                       | Alias           | Tipo                                                  | Requerido   | Cuándo usarlo                                 |
| ------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------- | ----------- | --------------------------------------------- |
| `--monto <number>`                                                              | `-m`            | `number`                                              | Sí          | Siempre                                       |
| `--concepto <tipo>`                                                             | `-c`            | `'productos' \| 'servicios' \| 'productos-servicios'` | Sí          | Siempre                                       |
| `--cs`, `--cp`, `--csp`                                                         | ninguno         | `boolean`                                             | Condicional | Si preferís el atajo en lugar de `--concepto` |
| `--cuit <number>` / `--cuil <number>` / `--dni <number>` / `--consumidor-final` | `--cfinal`      | `integer` / `boolean`                                 | Sí          | Siempre, una sola identidad                   |
| `--iva-receptor <tipo>` / `--ir <tipo>` / `--ir-*`                              | ninguno         | unión de IVA receptor o `boolean`                     | Sí          | Siempre, una sola forma de IVA receptor       |
| `--punto-venta <number>`                                                        | `--pv <number>` | `integer`                                             | Condicional | Si no está en config                          |
| `--fecha <fecha>`                                                               | `-f`            | `string`                                              | No          | Si querés fijar una fecha específica          |
| `--dia <number>`                                                                | `-d`            | `integer`                                             | Condicional | Si el concepto usa servicio                   |
| `--servicio-desde <fecha>`                                                      | `--sd <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                   |
| `--servicio-hasta <fecha>`                                                      | `--sh <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                   |

#### Qué no aplica

Las facturas no usan comprobante asociado, así que no aplican:

- `--ac`
- `--at`
- `--apv`
- `--asociado-punto-venta`
- `--ar`
- `--acuit`

### Notas de crédito y débito `A`, `B` y `C`

Las notas heredan todo lo de una factura, pero suman una regla importante: **siempre requieren comprobante asociado**.

#### Diferencias clave con facturas

- siempre requieren asociado
- el asociado debe ser una factura compatible
- la letra del asociado debe coincidir con la de la nota
- `--ac` y `--at` son excluyentes

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- todo lo base de una factura
- además:
  - `--asociado-punto-venta` o `--apv`
  - `--ar`
  - `--acuit`
  - `--ac` o `--at`

**Opcional**

- el resto de flags base de facturas

#### Ejemplo mínimo funcional

```bash
arcli nca -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20409509763
```

#### Resumen rápido de parámetros asociados

| Parámetro                         | Alias            | Tipo         | Requerido   | Cuándo usarlo                                   |
| --------------------------------- | ---------------- | ------------ | ----------- | ----------------------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | Condicional | Si querés identificar el asociado por shortcut  |
| `--at <number>`                   | ninguno          | `integer`    | Condicional | Si querés identificar el asociado por tipo ARCA |
| `--asociado-punto-venta <number>` | `--apv <number>` | `integer`    | Sí          | Siempre en notas                                |
| `--ar <number>`                   | ninguno          | `integer`    | Sí          | Siempre en notas                                |
| `--acuit <number>`                | ninguno          | `string(11)` | Sí          | Siempre en notas                                |

### Factura de crédito electrónica `A`, `B` y `C`

La lógica de uso es casi la misma que en una factura común.

#### Qué cambia respecto a una factura común

- cambia el tipo ARCA
- se mantiene la misma estructura base
- no usa comprobante asociado

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- lo mismo que en una factura común

#### Ejemplo mínimo funcional

```bash
arcli fcec -m 1 --cs --consumidor-final --ir-cf
```

### Nota de crédito electrónica y nota de débito electrónica `A`, `B` y `C`

Acá se combinan las dos reglas anteriores:

- base de factura
- tipo ARCA electrónico
- comprobante asociado obligatorio

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- todo lo base de una factura
- bloque de asociado completo

#### Ejemplo mínimo funcional

```bash
arcli ncec -m 1 --cs --consumidor-final --ir-cf --ac fcec --apv 3 --ar 6 --acuit 20409509763
```

## Ejemplos útiles

### `arcli ejemplos`

Muestra ejemplos seguros y listos para copiar de todos los comprobantes soportados.

```bash
arcli ejemplos
```

La salida incluye versión mínima, versión full, forma larga y forma corta para cada comprobante. Todos usan `--previsualizar` para evitar emisiones reales por error.

### Básico (manual)

```bash
arcli fc -m 300000 --cs --consumidor-final --ir-cf
```

### Desde JSON

```bash
arcli fc --cargar ./voucher.json --json
```

### Usando config

Si ya guardaste `cuit`, `puntoVenta`, `concepto` e `ivaReceptor` en config:

```bash
arcli fc -m 300000
```

### Debug

```bash
arcli fa -m 1 --cs --cuit 20168598204 --ir-ri --emitir --json --bruto
```

## Errores comunes

Tropiezos habituales cuando el comando parece bien armado pero igual falla:

- falta un dato base: `--monto`, identidad del receptor, IVA receptor o concepto
- se mezclan flags excluyentes (ver [exclusividades importantes](#cómo-funcionan-los-flags))
- faltan datos del asociado en una nota: `--ac`/`--at`, `--apv`, `--ar`, `--acuit`
- el JSON de `--cargar` no representa el mismo comprobante que estás invocando (por ejemplo, cargar una nota en `arcli fc`)

Para el diagnóstico paso a paso de cada caso, ver [Troubleshooting](troubleshooting.md).

## Configuración

Para referencia de comandos `config` y claves disponibles, ver [configuration.md](configuration.md).

## Estado de comandos

| Comando                                                                                                                            | Estado  | Notas                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| `fa`, `fb`, `fc`, `nca`, `ncb`, `ncc`, `nda`, `ndb`, `ndc`, `fcea`, `fceb`, `fcec`, `ncea`, `nceb`, `ncec`, `ndea`, `ndeb`, `ndec` | estable | Shortcuts públicos de comprobantes                     |
| `factura`, `nota-credito`, `nota-debito`, `factura-credito-electronica`, `nota-credito-electronica`, `nota-debito-electronica`     | estable | Familias públicas de comprobantes                      |
| `config`                                                                                                                           | estable | Gestión de configuración persistente                   |
| `config revisar`                                                                                                                   | estable | Revisión de defaults, credenciales y validación activa |
| `config ruta`                                                                                                                      | estable | Muestra la ruta del archivo de config                  |
| `config establecer`                                                                                                                | estable | Guarda una clave pública                               |
| `config eliminar`                                                                                                                  | estable | Elimina una clave pública                              |
| `ejemplos`                                                                                                                         | estable | Muestra ejemplos listos para copiar                    |
| `storybook`                                                                                                                        | interno | Herramienta de desarrollo para probar la UI            |
