[← Documentación](README.md)

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

Asume que ya configuraste CUIT, credenciales y punto de venta (`arcli config revisar` lo verifica). Sin `--emitir` (y con `emitir` en `false` en la config, el valor por defecto) solo muestra la vista previa.

¿Preferís que te pregunte paso a paso? Corré `arcli` sin argumentos y se abre el [modo interactivo](modo-interactivo.md). Antes de emitir te muestra el comando equivalente.

Si querés entender más, este orden sirve: [Cómo pensar los comprobantes](#cómo-pensar-los-comprobantes-en-arcli) → [Parámetros por familia](#parámetros-por-familia-de-comprobantes) → [Cómo funcionan los flags](#cómo-funcionan-los-flags) → [Ejemplos útiles](#ejemplos-útiles). Si ya conocés el CLI, las tablas de flags sirven como referencia rápida.

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

| Comando                       | Argumentos  | Descripción                                                          |
| ----------------------------- | ----------- | -------------------------------------------------------------------- |
| `factura`                     | `<a\|b\|c>` | Emite o previsualiza Factura A, B o C                                |
| `nota-credito`                | `<a\|b\|c>` | Emite o previsualiza Nota de crédito A, B o C                        |
| `nota-debito`                 | `<a\|b\|c>` | Emite o previsualiza Nota de débito A, B o C                         |
| `factura-credito-electronica` | `<a\|b\|c>` | Emite o previsualiza Factura de crédito electrónica A, B o C         |
| `nota-credito-electronica`    | `<a\|b\|c>` | Emite o previsualiza Nota de crédito electrónica A, B o C            |
| `nota-debito-electronica`     | `<a\|b\|c>` | Emite o previsualiza Nota de débito electrónica A, B o C             |
| `factura-exportacion`         | ninguna     | Emite o previsualiza la Factura de exportación E (WSFEX); alias `fe` |

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
| `fe`     | `factura-exportacion`           |
| `fcea`   | `factura-credito-electronica a` |
| `fceb`   | `factura-credito-electronica b` |
| `fcec`   | `factura-credito-electronica c` |
| `ncea`   | `nota-credito-electronica a`    |
| `nceb`   | `nota-credito-electronica b`    |
| `ncec`   | `nota-credito-electronica c`    |
| `ndea`   | `nota-debito-electronica a`     |
| `ndeb`   | `nota-debito-electronica b`     |
| `ndec`   | `nota-debito-electronica c`     |

`arcli factura e` y `arcli fe` son la misma Factura de exportación `E`: la letra `E` de la familia `factura` se resuelve por WSFEX, con sus propios flags (ver [Factura de exportación](#factura-de-exportación-e-wsfex)).

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

Usalos cuando necesitás controlar el entorno, la salida o el modo de inspección del resultado. Cada comando acepta solo los que usa:

| Comando                                                                  | Flags globales que acepta                        |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| comprobantes (`fa`, `fc`, `nca`, `factura`, ...)                         | `--testing`, `--produccion`, `--json`, `--bruto` |
| `padron`, `fce-obligado`, `ultimos`, `consultar`, `parametros`, `estado` | `--testing`, `--produccion`, `--json`            |
| `interactivo`                                                            | `--testing`, `--produccion`                      |
| `config` (y sus subcomandos), `pdf` (y sus subcomandos)                  | `--json`                                         |

### Emisión en producción

El entorno y la decisión de emitir son independientes:

- **Entorno:** `--testing` o `--produccion`; sin flag, `config.entorno` (`testing` por defecto).
- **Emitir:** `--emitir` o `--previsualizar`; sin flag, `emitir`/`previsualizar` del JSON de `--cargar`; si tampoco, `config.emitir` (`false` por defecto). Si nada pide emitir, en una terminal se muestra la vista previa y se pregunta (Esc cuenta como no, igual que en el modo interactivo, y también en las preguntas del PDF); con `--json` o sin terminal no se emite.

Así, `--produccion --emitir` emite en producción sin preguntar, y también lo hace un comando sin flags si la config tiene `entorno produccion` y `emitir true`. Es a propósito, para quien no quiere confirmar cada vez. Para no depender de la config (scripts, agentes), pasá siempre el entorno y `--emitir` o `--previsualizar`.

| Flag           | Alias   | Tipo      | Valor por defecto                    | Descripción                                   |
| -------------- | ------- | --------- | ------------------------------------ | --------------------------------------------- |
| `--testing`    | ninguno | `boolean` | `false`                              | Fuerza entorno `testing` en esta ejecución    |
| `--produccion` | ninguno | `boolean` | `false`                              | Fuerza entorno `produccion` en esta ejecución |
| `--json`       | ninguno | `boolean` | `config.json` (`false` por defecto)  | Devuelve salida estructurada                  |
| `--bruto`      | ninguno | `boolean` | `config.bruto` (`false` por defecto) | Agrega respuesta cruda de ARCA cuando exista  |

Si pasás una de estas opciones a un comando que no la usa (por ejemplo `arcli padron 20201797064 --bruto`), el comando corre igual y en stderr aparece un aviso: ``Aviso: --bruto no aplica a `arcli padron`, se ignora.``

Todos los comandos con `--json` lo resuelven igual: el flag o, si no está, la clave de config `json`. También los errores de uso (opción desconocida, valor faltante, comando que no existe): con `--json` o `json=true` salen como `INPUT_VALIDATION_ERROR` en el [formato de error JSON](input-output.md#errores-json-de-uso); sin JSON, en texto como siempre.

## Flags de comprobantes

Esta sección describe qué existe. Más abajo vas a encontrar qué hace falta en cada familia.

### Ejecución

Estos flags controlan si ARCLI previsualiza o emite de verdad.

| Flag              | Alias   | Tipo      | Valor por defecto                                             | Descripción                     |
| ----------------- | ------- | --------- | ------------------------------------------------------------- | ------------------------------- |
| `--previsualizar` | ninguno | `boolean` | lo contrario de `emitir`, resuelto desde flags, JSON o config | Muestra la solicitud sin emitir |
| `--emitir`        | ninguno | `boolean` | `config.emitir` (`false` por defecto)                         | Emite realmente en ARCA         |

### Identidad e IVA receptor

Estos flags definen a quién le emitís y bajo qué condición de IVA.

En la práctica, siempre necesitás:

- una identidad
- una condición de IVA receptor

| Flag                    | Alias         | Tipo                                                                                                                                                                                                                                                                                                     | Valor por defecto    | Descripción                                       |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| `--cuit <numero>`       | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno              | CUIT del receptor: 11 dígitos, con o sin guiones  |
| `--cuil <numero>`       | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno              | CUIL del receptor: 11 dígitos, con o sin guiones  |
| `--dni <numero>`        | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno              | DNI del receptor: 7 u 8 dígitos, con o sin puntos |
| `--consumidor-final`    | `--cfinal`    | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Usa consumidor final con documento `0`            |
| `--iva-receptor <tipo>` | `--ir <tipo>` | `'cliente-del-exterior' \| 'consumidor-final' \| 'iva-liberado' \| 'iva-no-alcanzado' \| 'monotributista-social' \| 'monotributo-trabajador-independiente-promovido' \| 'proveedor-del-exterior' \| 'responsable-inscripto' \| 'responsable-monotributo' \| 'sujeto-exento' \| 'sujeto-no-categorizado'` | `config.ivaReceptor` | Condición IVA del receptor                        |
| `--ir-ce`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Cliente del exterior                              |
| `--ir-cf`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Consumidor final                                  |
| `--ir-il`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | IVA liberado                                      |
| `--ir-ina`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | IVA no alcanzado                                  |
| `--ir-ms`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Monotributista social                             |
| `--ir-mtip`             | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Monotributo trabajador independiente promovido    |
| `--ir-pe`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Proveedor del exterior                            |
| `--ir-ri`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Responsable inscripto                             |
| `--ir-rm`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Responsable monotributo                           |
| `--ir-se`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Sujeto exento                                     |
| `--ir-snc`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`              | Sujeto no categorizado                            |

El IVA receptor tiene que ser válido para la letra del comprobante. Por ejemplo, `fa` no admite `--ir-cf` y `fb` no admite `--ir-ri`. Ver [IVA receptor](validation-rules.md#iva-receptor).

### Contenido

Estos flags arman el contenido del comprobante.

En casi todos los casos te va a interesar mirar primero:

- `--monto`
- `--concepto`
- `--fecha`
- `--punto-venta`

| Flag                           | Alias           | Tipo                                                  | Valor por defecto                        | Descripción                                      |
| ------------------------------ | --------------- | ----------------------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `--cargar <ruta>`              | ninguno         | `string`                                              | ninguno                                  | Carga datos base desde un archivo JSON           |
| `--monto <numero>`             | `-m`            | `number`                                              | requerido                                | Importe total del comprobante                    |
| `--alicuota <tasa>`            | ninguno         | `'0' \| '2.5' \| '5' \| '10.5' \| '21' \| '27'`       | `config.alicuota` o `21`                 | Alícuota de IVA (solo `A` y `B`)                 |
| `--alicuota <tasa>:<monto>`    | ninguno         | repetible                                             | ninguno                                  | Varias alícuotas: monto con IVA de cada una      |
| `--exento <numero>`            | ninguno         | `number`                                              | `0`                                      | Parte exenta del monto (solo `A` y `B`)          |
| `--nogravado <numero>`         | ninguno         | `number`                                              | `0`                                      | Parte no gravada del monto (solo `A` y `B`)      |
| `--fecha <fecha>`              | `-f`            | `string`                                              | hoy                                      | Fecha del comprobante                            |
| `--dia <numero>`               | `-d`            | `integer`                                             | ninguno                                  | Día de vencimiento o referencia del servicio     |
| `--punto-venta <numero>`       | `--pv`          | `integer`                                             | `config.puntoVenta`                      | Punto de venta                                   |
| `--concepto <tipo>`            | `-c`            | `'productos' \| 'servicios' \| 'productos-servicios'` | `config.concepto`                        | `productos`, `servicios` o `productos-servicios` |
| `--cs`                         | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto servicios`                |
| `--cp`                         | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto productos`                |
| `--csp`                        | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto productos-servicios`      |
| `--moneda <codigo>`            | `--mda`         | `'ARS' \| 'USD' \| string(3)`                         | `config.moneda` o `ARS`                  | Moneda del comprobante                           |
| `--cotizacion-moneda <numero>` | `--cm`          | `number`                                              | `config.cotizacion` o `1`                | Cotización de la moneda                          |
| `--misma-moneda`               | ninguno         | `boolean`                                             | `false`                                  | El pago se cancela en la moneda extranjera       |
| `--servicio-desde <fecha>`     | `--sd <fecha>`  | `string`                                              | ninguno                                  | Fecha de inicio del servicio                     |
| `--servicio-hasta <fecha>`     | `--sh <fecha>`  | `string`                                              | ninguno                                  | Fecha de fin del servicio                        |
| `--vencimiento <fecha>`        | `--vto <fecha>` | `string`                                              | fin del servicio o fecha del comprobante | Vencimiento del pago (`FchVtoPago`)              |

En moneda extranjera (`--moneda USD`) hay dos formas de informar la cotización:

- **Te pagan en pesos** (default): pasá `--cotizacion-moneda` con la cotización acordada. Es obligatoria y no puede ser `1`.
- **Te pagan en la moneda extranjera**: pasá `--misma-moneda`. ARCLI consulta la cotización oficial a ARCA y la muestra en la vista previa. No se combina con `--cotizacion-moneda`.

En pesos la cotización siempre es `1` y `--misma-moneda` no aplica. Detalle en [Moneda y cotización](validation-rules.md#moneda-y-cotización).

`--alicuota` acepta alias: `general` (21), `reducida` (10.5), `incrementada` (27) y `cero` (0). Para una factura con ítems a distintas alícuotas, repetí `--alicuota TASA:MONTO` (por ejemplo `--alicuota general:1210 --alicuota reducida:552,50`); el total se calcula solo. Ver [Varias alícuotas](validation-rules.md#varias-alícuotas-en-un-comprobante).

`--monto` siempre es el total del comprobante. Si informás `--exento` o `--nogravado`, ARCLI los descuenta del total y calcula neto e IVA sobre el resto. Ejemplo: `fb -m 1196 --exento 50 --nogravado 25` da neto 926,45 e IVA 194,55. El flag es `--nogravado`, sin guion, porque el CLI interpreta cualquier `--no-*` como la negación de otro flag.

Los montos usan formato argentino: el punto separa miles y la coma separa decimales. `15000`, `15.000`, `1500,50` y `1.500,50` son válidos; `1500.50` da error, igual que el texto sobrante (`12abc`) y más de 2 decimales. La cotización acepta hasta 6. Vale para `--monto`, `--exento`, `--nogravado`, `--cotizacion-moneda` y el monto de `--alicuota TASA:MONTO`. En el JSON de `--cargar` los montos son números, también con 2 decimales como máximo (la cotización, 6).

Las fechas usan formato argentino (día primero), con mes y año opcionales. Detalle completo en [Fechas aceptadas](validation-rules.md#fechas-aceptadas).

### Asociados

Estos flags importan solo para notas. Si estás emitiendo una factura, podés ignorarlos.

Dicho más directo: **no aplican a `factura`, `factura-credito-electronica`, `fa`, `fb`, `fc`, `fcea`, `fceb` ni `fcec`**.

| Flag                              | Alias            | Tipo         | Valor por defecto | Descripción                        |
| --------------------------------- | ---------------- | ------------ | ----------------- | ---------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | ninguno           | Atajo del comprobante asociado     |
| `--at <numero>`                   | ninguno          | `integer`    | ninguno           | Tipo ARCA del comprobante asociado |
| `--asociado-punto-venta <numero>` | `--apv <numero>` | `integer`    | ninguno           | Punto de venta del asociado        |
| `--ar <numero>`                   | ninguno          | `integer`    | ninguno           | Número del comprobante asociado    |
| `--acuit <numero>`                | ninguno          | `string(11)` | ninguno           | CUIT del comprobante asociado      |
| `--afecha <fecha>`                | ninguno          | `string`     | ninguno           | Fecha del comprobante asociado     |
| `--periodo-desde <fecha>`         | `--pd <fecha>`   | `string`     | ninguno           | Inicio del período asociado        |
| `--periodo-hasta <fecha>`         | `--ph <fecha>`   | `string`     | ninguno           | Fin del período asociado           |

### Crédito electrónico (FCE)

Estos flags solo aplican a comprobantes de crédito electrónica. En cualquier otro comprobante dan error, porque ARCA los rechaza (10169).

| Flag                          | Alias   | Tipo             | Valor por defecto | Aplica a    | Descripción                         |
| ----------------------------- | ------- | ---------------- | ----------------- | ----------- | ----------------------------------- |
| `--cbu <cbu>`                 | ninguno | `string(22)`     | `config.cbu`      | Factura FCE | CBU del emisor (obligatorio)        |
| `--alias <alias>`             | ninguno | `string(6..20)`  | `config.aliasCbu` | Factura FCE | Alias del CBU (opcional)            |
| `--transferencia <modalidad>` | ninguno | `'sca' \| 'adc'` | `sca`             | Factura FCE | Modalidad de transferencia          |
| `--anulacion`                 | ninguno | `boolean`        | `false`           | NC/ND FCE   | La nota anula una factura rechazada |

### PDF

Estos flags controlan el PDF del comprobante emitido. Los datos que se pasan acá **solo van en el PDF**: ARCA no los recibe. Detalle en [PDF de comprobantes](pdf.md).

| Flag                           | Alias   | Tipo      | Valor por defecto  | Descripción                                  |
| ------------------------------ | ------- | --------- | ------------------ | -------------------------------------------- |
| `--exportar-pdf`               | `--pdf` | `boolean` | según `config.pdf` | Genera el PDF después de emitir              |
| `--sin-pdf`                    | ninguno | `boolean` | según `config.pdf` | No genera el PDF                             |
| `--descripcion <texto>`        | ninguno | `string`  | `Segun detalle`    | Detalle del comprobante en el PDF            |
| `--receptor-nombre <texto>`    | ninguno | `string`  | ninguno            | Nombre o razón social del receptor en el PDF |
| `--receptor-domicilio <texto>` | ninguno | `string`  | ninguno            | Domicilio del receptor en el PDF             |

`--exportar-pdf` y `--sin-pdf` no se combinan. Sin ninguno de los dos, decide `config.pdf` (`preguntar` por defecto: en una terminal pregunta, con `--json` o sin terminal no genera).

### Comando `arcli pdf`

Instala o revisa el plugin que genera los PDFs. No viene con ARCLI porque pesa unos 160 MB.

| Comando                 | Descripción                                            |
| ----------------------- | ------------------------------------------------------ |
| `arcli pdf`             | Estado del plugin: instalado o no, versión y navegador |
| `arcli pdf estado`      | Igual que `arcli pdf`                                  |
| `arcli pdf instalar`    | Descarga el plugin (y un navegador si no hay Chrome)   |
| `arcli pdf desinstalar` | Borra el plugin y el navegador que haya descargado     |

Todos aceptan `--json`. El formato está en [Entrada y salida](input-output.md#plugin-de-pdf-pdf-estado).

### Comandos `arcli estado` y `arcli parametros`

Consultan a ARCA sin emitir nada. Usan el entorno y el punto de venta de la config (o `--testing` / `--produccion`) y aceptan `--json`.

| Comando                                | Descripción                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `arcli estado`                         | Si los servidores de ARCA responden, cuánto tardan y si el punto de venta está habilitado                                    |
| `arcli parametros`                     | Lista las tablas disponibles (no consulta ARCA)                                                                              |
| `arcli parametros <tabla>`             | `puntos-venta`, `comprobantes`, `documentos`, `alicuotas`, `iva-receptor`, `monedas`, `conceptos`, `opcionales` o `tributos` |
| `arcli parametros cotizacion <moneda>` | Cotización oficial de ARCA, por ejemplo `USD`                                                                                |

- Las tablas muestran solo los valores vigentes hoy.
- **Puntos de venta en testing:** ARCA no los informa, así que `parametros puntos-venta` sale vacío y `estado` no puede verificar el punto de venta. En testing cualquier número sirve.
- En producción, `estado` avisa si el punto de venta configurado no existe para tu CUIT, está bloqueado o dado de baja.
- `estado` con `listo: false` sale con exit code `0`: es un diagnóstico, no un error. Si ARCA no responde, el error es `ARCA_UNAVAILABLE`.
- El JSON de cada uno está en [Entrada y salida](input-output.md#estado-de-arca-estado) y [tablas de ARCA](input-output.md#tablas-de-arca-parametros).

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
- moneda y cotización: `--moneda`, `--mda`, `--cotizacion-moneda`, `--cm`, `--misma-moneda`
- carga JSON: `--cargar`
- fechas de servicio: `--dia`, `--servicio-desde`, `--servicio-hasta`, `--vencimiento`
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
| `--monto <numero>`                                                              | `-m`            | `number`                                              | Sí          | Siempre                                       |
| `--concepto <tipo>`                                                             | `-c`            | `'productos' \| 'servicios' \| 'productos-servicios'` | Sí          | Siempre                                       |
| `--cs`, `--cp`, `--csp`                                                         | ninguno         | `boolean`                                             | Condicional | Si preferís el atajo en lugar de `--concepto` |
| `--cuit <numero>` / `--cuil <numero>` / `--dni <numero>` / `--consumidor-final` | `--cfinal`      | `string` / `boolean`                                  | Sí          | Siempre, una sola identidad                   |
| `--iva-receptor <tipo>` / `--ir <tipo>` / `--ir-*`                              | ninguno         | unión de IVA receptor o `boolean`                     | Sí          | Siempre, una sola forma de IVA receptor       |
| `--punto-venta <numero>`                                                        | `--pv <numero>` | `integer`                                             | Condicional | Si no está en config                          |
| `--fecha <fecha>`                                                               | `-f`            | `string`                                              | No          | Si querés fijar una fecha específica          |
| `--dia <numero>`                                                                | `-d`            | `integer`                                             | Condicional | Si el concepto usa servicio                   |
| `--servicio-desde <fecha>`                                                      | `--sd <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                   |
| `--servicio-hasta <fecha>`                                                      | `--sh <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                   |
| `--vencimiento <fecha>`                                                         | `--vto <fecha>` | `string`                                              | No          | Servicios y facturas FCE                      |

#### Qué no aplica

Las facturas no usan comprobante asociado, así que no aplican:

- `--ac`
- `--at`
- `--apv`
- `--asociado-punto-venta`
- `--ar`
- `--acuit`

### Notas de crédito y débito `A`, `B` y `C`

Las notas heredan todo lo de una factura, pero suman una regla importante: **siempre requieren un comprobante asociado o un período asociado**.

#### Diferencias clave con facturas

- siempre requieren asociado: una factura puntual (`--ac`…) o un período (`--periodo-desde` y `--periodo-hasta`)
- el asociado debe ser una factura compatible
- la letra del asociado debe coincidir con la de la nota
- `--ac` y `--at` son excluyentes

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- todo lo base de una factura
- además:
  - un comprobante asociado: `--ac` o `--at`, con `--asociado-punto-venta` (o `--apv`), `--ar` y `--acuit`
  - o un período asociado: `--periodo-desde` y `--periodo-hasta` (entonces no van `--ac`, `--apv`, `--ar` ni `--acuit`)

**Opcional**

- el resto de flags base de facturas

#### Ejemplo mínimo funcional

```bash
arcli nca -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20333333334
```

#### Nota por período

Si la nota ajusta un período entero y no una factura puntual (por ejemplo, un descuento sobre todo lo facturado en el mes), usá el período en lugar del bloque `--ac`:

```bash
arcli ncb -m 5000 --cs --cfinal --ir-cf --periodo-desde 01-09-2026 --periodo-hasta 30-09-2026
```

El período no puede terminar después de la fecha de la nota. Las notas FCE no lo aceptan.

#### Resumen rápido de parámetros asociados

| Parámetro                         | Alias            | Tipo         | Requerido   | Cuándo usarlo                                                       |
| --------------------------------- | ---------------- | ------------ | ----------- | ------------------------------------------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | Condicional | Si querés identificar el asociado por shortcut                      |
| `--at <numero>`                   | ninguno          | `integer`    | Condicional | Si querés identificar el asociado por tipo ARCA                     |
| `--asociado-punto-venta <numero>` | `--apv <numero>` | `integer`    | Condicional | Con `--ac`/`--at`                                                   |
| `--ar <numero>`                   | ninguno          | `integer`    | Condicional | Con `--ac`/`--at`                                                   |
| `--acuit <numero>`                | ninguno          | `string(11)` | Condicional | Con `--ac`/`--at`; no con período; en NC/ND FCE toma el CUIT emisor |

### Factura de crédito electrónica `A`, `B` y `C`

La base es la de una factura común, más los datos de cobro que exige el régimen MiPyMEs.

#### Qué cambia respecto a una factura común

- cambia el tipo ARCA
- no usa comprobante asociado
- lleva el CBU del emisor y la modalidad de transferencia
- siempre lleva vencimiento de pago, incluso con concepto productos
- la fecha del comprobante puede ir de 5 días antes a 1 día después de hoy

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- lo mismo que en una factura común
- CBU: `--cbu`, o configurado una vez con `arcli config establecer cbu <22 dígitos>`

**Opcional**

- `--alias`, `--transferencia` (por defecto `sca`) y `--vencimiento`

#### Ejemplo mínimo funcional

```bash
arcli fcea -m 1 --cs --cuit 20168598204 --ir-ri --cbu 0110599520000012345678
```

### Nota de crédito electrónica y nota de débito electrónica `A`, `B` y `C`

Acá se combinan las dos reglas anteriores:

- base de factura
- tipo ARCA electrónico
- comprobante asociado obligatorio, con su fecha

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- todo lo base de una factura
- bloque de asociado completo, incluida `--afecha`
- el asociado tiene que ser del propio emisor: `--acuit` se puede omitir y toma el CUIT configurado

**Opcional**

- `--anulacion` si la nota anula una factura que el comprador rechazó

No llevan CBU, alias, transferencia ni vencimiento de pago.

#### Ejemplo mínimo funcional

```bash
arcli ncea -m 1 --cs --cuit 20168598204 --ir-ri --ac fcea --apv 3 --ar 6 --afecha 01-03-2026
```

### Factura de exportación `E` (WSFEX)

`arcli fe`, `arcli factura-exportacion` y `arcli factura e` hacen lo mismo: emiten o previsualizan una Factura de exportación `E` con el servicio `wsfex`, que tiene sus propios datos y su propio certificado autorizado. No es una letra más de la familia de facturas: no lleva concepto, IVA ni receptor con CUIT/CUIL/DNI, y en cambio lleva país de destino, incoterm, permisos de embarque e ítems reales.

Las notas de crédito y débito `E` todavía no están soportadas.

#### Credenciales

WSFEX pide un certificado autorizado al servicio `wsfex`. ARCLI usa `exportacion.cert.<entorno>` y `exportacion.key.<entorno>` si están configurados; si no, cae en `cert.<entorno>` y `key.<entorno>`. El par se resuelve junto: si configurás solo una de las dos claves de exportación, el comando corta antes de ir a ARCA. Ver [Configuración](configuration.md#certificados-de-exportación-wsfex).

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- importe total: `--monto`
- cliente y domicilio en el exterior: `--cliente`, `--domicilio-cliente`
- país de destino: `--pais-destino`, por código (`203`) o por nombre (`Brasil`)

**Opcional**

- `--id-impositivo` y `--cuit-pais` (sin `--cuit-pais` se resuelve desde el país de destino; si ARCA no
  publica un CUIT para ese país, el flag es obligatorio)
- `--tipo-expo` (`1` bienes, `2` servicios, `4` otros; por defecto `2`)
- `--actividad` con el código de la tabla de actividades de WSFEX (por defecto `620900`, servicios de informática N.C.P.): la `E` siempre informa una actividad, porque ARCA rechaza `Actividades` vacío (error 2100). Esa tabla no es la del padrón y es más chica, así que si el código no está la vista previa lo avisa con las actividades que empiezan igual —ARCA lo rechaza al emitir con el error 2105— y se cambia con `--actividad`
- `--item` para el detalle real; sin items va un renglón con `--descripcion`
- `--incoterm` y `--incoterms-desc`, `--idioma`, `--forma-pago` (por defecto `Transferencia Internacional`)
- `--permiso` y `--permiso-existente` para permisos de embarque (solo con `--tipo-expo 1`; en `2` y `4` ARCA exige `Permiso_existente` vacío)
- `--numero` y `--id-solicitud` si los querés fijar a mano
- punto de venta si no está en config: `--punto-venta` o `--pv`
- moneda y cotización: `--moneda` (por defecto `DOL`), `--mda`, `--cotizacion-moneda`, `--cm`, `--misma-moneda`
- PDF: `--exportar-pdf`, `--pdf` o `--sin-pdf`
- modo y salida: `--previsualizar`, `--emitir`, `--json`, `--bruto`

Sin `--tipo-expo`, `--moneda` ni `--forma-pago`, la `E` sale de servicios (`Tipo_expo` `2`), en dólares (`DOL`), con la actividad `620900` y con forma de pago `Transferencia Internacional`. La clave `moneda` de la config es la de los comprobantes locales y no aplica a exportación.

El pago de una exportación se hace en la moneda extranjera del comprobante (`Moneda_Id`/`Moneda_ctz`). Si además se cobra en esa misma moneda, `--misma-moneda` manda `CanMisMonExt` en `S`, que es el campo de WSFEX que lo declara; sin el flag va en `N`.

La `E` no lleva comprobantes asociados ni datos opcionales todavía, así que `solicitud` no incluye `Cmps_asoc` ni `Opcionales`: ARCA rechaza esos bloques vacíos (error 1820 el primero).

#### Ejemplo mínimo funcional

```bash
arcli fe --monto 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203
```

Con los datos del receptor del exterior (CUIT del país, ID impositivo, razón social y domicilio), items, incoterm y
salida JSON:

```bash
arcli fe -m 1500 --cliente "ACME LLC" --id-impositivo "12-3456789" --domicilio-cliente "123 Main St" \
  --pais-destino Brasil --cuit-pais 55000002126 --tipo-expo 1 --incoterm FOB \
  --item "001|Bienes varios|1|1500|unidad" --emitir --json
```

Cobrando en dólares, con la cotización de aduana de ARCA (`--misma-moneda`):

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --actividad 620900 --misma-moneda --previsualizar
```

#### Resumen rápido de parámetros

| Parámetro                         | Alias           | Tipo                                 | Requerido   | Cuándo usarlo                                                                      |
| --------------------------------- | --------------- | ------------------------------------ | ----------- | ---------------------------------------------------------------------------------- |
| `--monto <number>`                | `-m`            | `number`                             | Sí          | Siempre                                                                            |
| `--cliente <texto>`               | ninguno         | `string`                             | Sí          | Siempre: nombre o razón social del cliente del exterior                            |
| `--domicilio-cliente <texto>`     | ninguno         | `string`                             | Sí          | Siempre                                                                            |
| `--pais-destino <codigo\|nombre>` | ninguno         | `string`                             | Sí          | Siempre: código de ARCA o nombre tal como lo informa ARCA                          |
| `--id-impositivo <texto>`         | ninguno         | `string`                             | No          | ID fiscal del cliente en su país                                                   |
| `--cuit-pais <number>`            | ninguno         | `integer`                            | No          | CUIT del país del cliente; sin el flag sale de la tabla de ARCA                    |
| `--tipo-expo <1\|2\|4>`           | ninguno         | `1` bienes, `2` servicios, `4` otros | No          | Por defecto `2` (servicios)                                                        |
| `--actividad <codigo>`            | ninguno         | `integer`                            | No          | Código de la tabla de ARCA; por defecto `620900` (servicios de informática N.C.P.) |
| `--item <partes>`                 | ninguno         | `string` repetible                   | No          | `codigo\|descripcion\|cantidad\|precio\|unidad`; la suma debe dar `--monto`        |
| `--incoterm <codigo>`             | ninguno         | `string`                             | No          | Por ejemplo `FOB`; se valida contra la tabla de ARCA                               |
| `--incoterms-desc <texto>`        | ninguno         | `string`                             | No          | Por defecto, la descripción de la tabla de ARCA                                    |
| `--idioma <codigo>`               | ninguno         | `integer`                            | No          | `1` español (por defecto), `2` inglés, `3` portugués                               |
| `--forma-pago <texto>`            | ninguno         | `string`                             | No          | Por defecto `Transferencia Internacional`                                          |
| `--permiso <id>`                  | ninguno         | `string` repetible                   | No          | Permiso de embarque ya existente; requiere `--permiso-existente` y `--tipo-expo 1` |
| `--permiso-existente`             | ninguno         | `boolean`                            | No          | Marca que los permisos informados ya están en ARCA                                 |
| `--numero <number>`               | ninguno         | `integer`                            | No          | Por defecto, el siguiente de WSFEX                                                 |
| `--id-solicitud <number>`         | ninguno         | `integer`                            | No          | Por defecto, el siguiente de WSFEX                                                 |
| `--punto-venta <number>`          | `--pv <number>` | `integer`                            | Condicional | Si no está en config                                                               |
| `--fecha <fecha>`                 | `-f`            | `string`                             | No          | No admite fechas futuras                                                           |
| `--fecha-pago <fecha>`            | ninguno         | `string`                             | No          | Por defecto, la fecha del comprobante                                              |
| `--moneda <codigo>`               | `--mda`         | `string`                             | No          | Código de ARCA, por ejemplo `USD` o `DOL`; por defecto `DOL`                       |
| `--cotizacion-moneda <number>`    | `--cm`          | `number`                             | No          | Sin flag se usa la última cotización de aduana publicada por ARCA                  |
| `--misma-moneda`                  | ninguno         | `boolean`                            | No          | El pago se cancela en la misma moneda extranjera: manda `CanMisMonExt` en `S`      |
| `--observaciones <texto>`         | ninguno         | `string`                             | No          | Observaciones del comprobante                                                      |
| `--obs-comerciales <texto>`       | ninguno         | `string`                             | No          | Observaciones comerciales                                                          |
| `--descripcion <texto>`           | ninguno         | `string`                             | No          | Solo sin `--item`; también va al PDF                                               |
| `--cargar <path>`                 | ninguno         | `string`                             | No          | Un objeto con un comprobante, no un lote                                           |

Los flags globales (`--testing`, `--produccion`, `--json`, `--bruto`) y los de modo (`--previsualizar`, `--emitir`) funcionan igual que en el resto de los comprobantes.

#### Items

Cada `--item` se separa con `|` para no pelear con las comas de los importes. La forma completa es `codigo|descripcion|cantidad|precio|unidad`; con cuatro partes se omite el código y con tres la unidad, que queda en `unidad` (código `7` de ARCA). La unidad puede ser el código numérico o el nombre de la tabla de unidades, que se compara sin mayúsculas y acepta singular o plural (`unidad` o `unidades`).

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203 \
  --item "001|Servicio de consultoria|1|1000|unidad" \
  --item "002|Soporte|2|250|unidades" --previsualizar
```

WSFEX no valida que `Imp_total` coincida con la suma de los items, así que ARCLI lo valida antes de ir a ARCA: si la suma no da `--monto`, el comando corta con un error de validación.

#### Qué no aplica

Estos flags de facturación no existen en `fe` (y `arcli factura e` los ignora):

- concepto (`--concepto`, `--cs`, `--cp`, `--csp`) y fechas de servicio (`--dia`, `--servicio-desde`, `--servicio-hasta`, `--vencimiento`)
- identidad del receptor (`--cuit`, `--cuil`, `--dni`, `--consumidor-final`) e `--iva-receptor`
- IVA y alícuotas (`--alicuota`, `--exento`, `--nogravado`, `--alicuotas`)
- comprobante asociado (`--ac`, `--at`, `--apv`, `--ar`, `--acuit`, `--afecha`, `--anulacion`, `--periodo-desde`, `--periodo-hasta`)
- datos de cobro FCE (`--cbu`, `--alias`, `--transferencia`); el régimen FCE (`verificarFce` en la config) tampoco se consulta

Los defaults de config de esos campos (concepto, IVA receptor, alícuota, CBU) no se usan al emitir una `E`.

#### Vista previa, numeración y PDF

- La vista previa consulta las tablas de WSFEX (países, unidades, incoterms, idiomas), la cotización y la numeración, pero no emite.
- La numeración sale de WSFEX (`getLastCmp` más `getLastId`) y **no se discrimina por punto de venta**. Si compartís el punto de venta entre varios emisores o procesos, fijá `--numero` y `--id-solicitud`.
- El PDF se genera después de emitir, como en el resto de los comprobantes. Se guarda como `factura-exportacion-e_<pv>-<numero>.pdf` e imprime los items reales, el país de destino, el incoterm, el CUIT del país y el ID impositivo del cliente.
- Un comprobante rechazado por WSFEX sale como respuesta válida con exit code `2`, igual que en las letras A, B y C.

El JSON de salida y el de `--cargar` están en [Entrada y salida](input-output.md#factura-de-exportación-factura-exportacion).

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
arcli config establecer concepto servicios
arcli config establecer ivaReceptor consumidor-final
arcli fc -m 300000
```

### Debug

```bash
arcli fa -m 1 --cs --cuit 20168598204 --ir-ri --emitir --json --bruto
```

## Consultar comprobantes emitidos

Dos comandos de solo lectura para ver lo que ya está emitido en ARCA, sin abrir el modo interactivo:

```bash
arcli ultimos fb                  # últimas 15 facturas B del punto de venta configurado
arcli ultimos nca --cantidad 25   # últimas 25 notas de crédito A
arcli consultar fb 14             # detalle de la factura B número 14
arcli consultar fb 14 --json      # lo mismo, en JSON
```

| Comando                           | Argumentos                                                 | Flags                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `arcli ultimos <tipo>`            | `tipo`: atajo del comprobante (`fa`, `fb`, `nca`, `fcea`…) | `--cantidad <n>` (1 a 50; por defecto `config.comprobantesPorLista` o 15), `--pv` / `--punto-venta`, `--json`, `--testing`, `--produccion` |
| `arcli consultar <tipo> <numero>` | `tipo` y número del comprobante                            | `--pv` / `--punto-venta`, `--json`, `--testing`, `--produccion`                                                                            |

Sin `--pv` usan el punto de venta de la config. Si el comprobante no existe, `consultar` termina con el error `VOUCHER_NOT_FOUND`. El formato del JSON está en [Entrada y salida](input-output.md#comprobantes-emitidos-ultimos-y-consultar).

## Consultar el régimen FCE

`arcli fce-obligado <cuit>` le pregunta a ARCA si un receptor está obligado a recibir Factura de Crédito Electrónica y desde qué monto. Con eso sabés si corresponde `fa/fb/fc` o `fcea/fceb/fcec`.

```bash
arcli fce-obligado 30546689979
arcli fce-obligado 30546689979 --fecha 15/10 --json
```

| Flag                                  | Alias   | Descripción                                   |
| ------------------------------------- | ------- | --------------------------------------------- |
| `--fecha <fecha>`                     | `-f`    | Fecha de emisión a consultar; por defecto hoy |
| `--json`, `--testing`, `--produccion` | ninguno | Flags globales                                |

Usa el servicio `wsfecred`, que hay que autorizar aparte de `wsfe`. Ver [Autorizar el servicio web](obtencion-certificados.md#3-autorizar-el-servicio-web).

Si activás `arcli config establecer verificarFce true`, la misma consulta corre en cada factura con CUIT del receptor y deja un aviso si el comprobante no coincide con el régimen. Por ejemplo, una `fa` a un receptor obligado por encima del mínimo. El aviso no frena la emisión. Ver [Régimen FCE del receptor](validation-rules.md#régimen-fce-del-receptor).

El JSON está en [Entrada y salida](input-output.md#régimen-fce-fce-obligado).

## Consultar el padrón

`arcli padron <cuit>` muestra lo que ARCA tiene de un CUIT: nombre o razón social, domicilio fiscal, condición frente al IVA, impuestos, categoría de monotributo y actividad principal.

```bash
arcli padron 20201797064
arcli padron 20201797064 --json
```

| Flag                                  | Alias   | Descripción    |
| ------------------------------------- | ------- | -------------- |
| `--json`, `--testing`, `--produccion` | ninguno | Flags globales |

La condición IVA sale de los impuestos activos: monotributo es `responsable-monotributo`, IVA es `responsable-inscripto` e IVA exento es `sujeto-exento`. Con otros datos queda sin informar (`condicionIva: null`). Si el CUIT no está en el padrón, termina con el error `TAXPAYER_NOT_FOUND`. En testing el padrón tiene datos ficticios: `20201797064` devuelve datos completos. El JSON está en [Entrada y salida](input-output.md#padrón-padron).

Usa el servicio `ws_sr_constancia_inscripcion`, que hay que autorizar aparte de `wsfe`. Ver [Autorizar el servicio web](obtencion-certificados.md#3-autorizar-el-servicio-web).

### IVA receptor desde el padrón

Al facturar con `--cuit` sin `--ir` (ni `ivaReceptor` en el JSON), ARCLI consulta el padrón y usa esa condición IVA, aunque la config tenga un `ivaReceptor` por defecto. También completa el nombre y el domicilio del receptor para el PDF, si no los pasaste. La vista previa lo marca: `IVA receptor   Responsable inscripto (padron)`.

| Caso                                            | Resultado                                                   |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `--ir`, `--ir-*` o `ivaReceptor` en el JSON     | Se usa ese valor; no se consulta el padrón                  |
| El padrón informa la condición                  | Se usa la del padrón                                        |
| El padrón no responde o no informa la condición | Se usa `ivaReceptor` de la config, con un aviso en `avisos` |
| Lo mismo, sin `ivaReceptor` en la config        | Error `INPUT_VALIDATION_ERROR`: indicala con `--ir`         |

Para no consultarlo: `arcli config establecer consultarPadron false`. El modo interactivo hace la misma consulta al cargar un CUIT y propone esa condición, marcada "(según el padrón)".

## Autocompletado

Completa con Tab comandos, flags y valores en bash, zsh y fish: atajos (`arcli ultimos nc<Tab>`), flags (`arcli fc --ir-<Tab>`), valores de `--iva-receptor`, `--concepto`, `--alicuota`, `--moneda`, `--transferencia` y `--ac`, claves de config y sus valores (`arcli config establecer entorno <Tab>`), tablas de `parametros` y letras de las familias. Donde va una ruta (`--cargar`), completa archivos.

```bash
arcli completado instalar        # con el shell de $SHELL; o: arcli completado instalar zsh
arcli completado                 # ¿está instalado?
arcli completado desinstalar
```

`arcli completado instalar` agrega al archivo de inicio del shell una línea marcada con un comentario `# arcli` y `desinstalar` saca solo eso:

| Shell | Archivo                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------- |
| zsh   | `~/.zshrc` (o `$ZDOTDIR/.zshrc`)                                                                  |
| bash  | `~/.bashrc`; en macOS, el primero que exista de `~/.bash_profile`, `~/.bash_login` y `~/.profile` |
| fish  | `~/.config/fish/completions/arcli.fish` (archivo propio; `desinstalar` lo borra)                  |

Pedir el comando ya es la confirmación: no vuelve a preguntar, como `arcli pdf instalar`. Con `--json` devuelve `{ "cambio", "instalado", "ruta", "shell" }`. Si no se puede saber el shell, da `INPUT_VALIDATION_ERROR` y hay que indicarlo. Un programa no puede cambiar la terminal que ya está abierta: después de instalar, abrí una nueva.

`arcli completado <bash|zsh|fish>` solo imprime el script, para instalarlo a mano. Cada Tab le pregunta a la versión instalada qué sigue, así que después de actualizar arcli no hay que reinstalar nada. En el modo interactivo está en Configuración → Autocompletado.

## Configuración

Comandos `config` y claves disponibles: [Configuración](configuration.md).

## Estabilidad

Todos los comandos de esta referencia son estables, salvo `storybook`, una herramienta interna de desarrollo que no aparece en la ayuda ni en `llms.txt`.

## Ver también

- [Patrones de uso](usage-patterns.md): casos completos paso a paso.
- [Reglas de validación](validation-rules.md) y [Troubleshooting](troubleshooting.md): qué rechaza el CLI y cómo resolverlo.
