[← Documentación](README.md)

# Referencia del CLI

## TL;DR

Si solo querés un ejemplo mínimo funcional para arrancar:

```bash
arcli fc -m 300000 --cs --consumidor-final
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

| Comando                       | Argumentos     | Descripción                                                        |
| ----------------------------- | -------------- | ------------------------------------------------------------------ |
| `factura`                     | `<a\|b\|c\|e>` | Emite o previsualiza Factura A, B, C o la de exportación E (WSFEX) |
| `nota-credito`                | `<a\|b\|c\|e>` | Emite o previsualiza Nota de crédito A, B, C o la de exportación E |
| `nota-debito`                 | `<a\|b\|c\|e>` | Emite o previsualiza Nota de débito A, B, C o la de exportación E  |
| `factura-credito-electronica` | `<a\|b\|c>`    | Emite o previsualiza Factura de crédito electrónica A, B o C       |
| `nota-credito-electronica`    | `<a\|b\|c>`    | Emite o previsualiza Nota de crédito electrónica A, B o C          |
| `nota-debito-electronica`     | `<a\|b\|c>`    | Emite o previsualiza Nota de débito electrónica A, B o C           |
| `recibo`                      | `<a\|b\|c>`    | Emite o previsualiza Recibo A, B o C                               |

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
| `fe`     | `factura e`                     |
| `nce`    | `nota-credito e`                |
| `nde`    | `nota-debito e`                 |
| `fcea`   | `factura-credito-electronica a` |
| `fceb`   | `factura-credito-electronica b` |
| `fcec`   | `factura-credito-electronica c` |
| `ncea`   | `nota-credito-electronica a`    |
| `nceb`   | `nota-credito-electronica b`    |
| `ncec`   | `nota-credito-electronica c`    |
| `ndea`   | `nota-debito-electronica a`     |
| `ndeb`   | `nota-debito-electronica b`     |
| `ndec`   | `nota-debito-electronica c`     |
| `ra`     | `recibo a`                      |
| `rb`     | `recibo b`                      |
| `rc`     | `recibo c`                      |

`arcli factura e` y `arcli fe` son la misma Factura de exportación `E`: la letra `E` de la familia `factura` se resuelve por WSFEX, con sus propios flags (ver [Factura de exportación](#factura-de-exportación-e-wsfex)). Lo mismo pasa con `nota-credito e` (`nce`) y `nota-debito e` (`nde`): ver [Notas de crédito y débito de exportación](#notas-de-crédito-y-débito-de-exportación-e).

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

Si el flag cambia a quién, qué comprobante o qué moneda, además descarta del JSON los datos que dependían del valor anterior: con `--cuit` de otro cliente no van el nombre, el domicilio ni el IVA del que trae el archivo. La lista está en [Datos del JSON que un flag descarta](validation-rules.md#datos-del-json-que-un-flag-descarta).

### Exclusividades importantes

Hay varias combinaciones de flags que no podés usar juntas (entorno, modo de ejecución, concepto, IVA receptor, identidad del receptor, tipo de asociado). El detalle completo vive en [Flags mutuamente excluyentes](validation-rules.md#flags-mutuamente-excluyentes).

## Flags globales

Usalos cuando necesitás controlar el entorno, la salida o el modo de inspección del resultado. Cada comando acepta solo los que usa:

| Comando                                                                                 | Flags globales que acepta                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| comprobantes (`fa`, `fc`, `nca`, `factura`, ...)                                        | `--testing`, `--produccion`, `--json`, `--bruto` |
| `padron`, `fce-obligado`, `ultimos`, `consultar`, `parametros`, `estado`, `monotributo` | `--testing`, `--produccion`, `--json`            |
| `certificado generar`, `certificado importar`                                           | `--testing`, `--produccion`, `--json`            |
| `interactivo`                                                                           | `--testing`, `--produccion`                      |
| `config` (y sus subcomandos), `pdf` (y sus subcomandos), `completado`, `acceso-directo` | `--json`                                         |

### Emisión en producción

El entorno y la decisión de emitir son independientes:

- **Entorno:** `--testing` o `--produccion`; sin flag, `config.entorno` (`testing` por defecto).
- **Emitir:** `--emitir` o `--previsualizar`; sin flag, `emitir`/`previsualizar` del JSON de `--cargar`; si tampoco, `config.emitir` (`false` por defecto). Si nada pide emitir, en una terminal se muestra la vista previa y se pregunta, nombrando el entorno: `¿Emitimos la factura B en PRODUCCIÓN?`, con las opciones **Sí, emitir ahora**, **Sí, emitir y generar el PDF** y **No, dejar sin emitir** (la del PDF no aparece con `--exportar-pdf` o `--sin-pdf`; ver [PDF](pdf.md#cuándo-se-genera)). Al confirmar sale lo que mostró la vista previa, con las mismas fechas aunque ya sea otro día. Esc cuenta como no, igual que en el modo interactivo, y también en las preguntas del PDF. Ctrl+C en esa pregunta cancela sin emitir y sale con código `1`; en las del PDF, con el comprobante ya emitido, cuenta como no. Con `--json` o sin terminal no se emite.

Así, `--produccion --emitir` emite en producción sin preguntar, y también lo hace un comando sin flags si la config tiene `entorno produccion` y `emitir true`. Es a propósito, para quien no quiere confirmar cada vez. Para no depender de la config (scripts, agentes), pasá siempre el entorno y `--emitir` o `--previsualizar`.

| Flag           | Alias   | Tipo      | Valor por defecto                    | Descripción                                   |
| -------------- | ------- | --------- | ------------------------------------ | --------------------------------------------- |
| `--testing`    | ninguno | `boolean` | `false`                              | Fuerza entorno `testing` en esta ejecución    |
| `--produccion` | ninguno | `boolean` | `false`                              | Fuerza entorno `produccion` en esta ejecución |
| `--json`       | ninguno | `boolean` | `config.json` (`false` por defecto)  | Devuelve salida estructurada                  |
| `--bruto`      | ninguno | `boolean` | `config.bruto` (`false` por defecto) | Agrega respuesta cruda de ARCA cuando exista  |

Si pasás una de estas opciones a un comando que no la usa (por ejemplo `arcli padron 20201797064 --bruto`), el comando corre igual y en stderr aparece un aviso: ``Aviso: `--bruto` no aplica a `arcli padron`, se ignora.``

Todos los comandos con `--json` lo resuelven igual: el flag o, si no está, la clave de config `json`. También los errores de uso (opción desconocida, valor faltante, comando que no existe): con `--json` o `json=true` salen como `INPUT_VALIDATION_ERROR` en el [formato de error JSON](input-output.md#errores-json-de-uso); sin JSON, en el mismo panel que el resto de los errores, con la sugerencia de ayuda.

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

| Flag                    | Alias         | Tipo                                                                                                                                                                                                                                                                                                     | Valor por defecto                                        | Descripción                                                         |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `--cuit <numero>`       | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno                                                  | CUIT del receptor: 11 dígitos, con o sin guiones, puntos o espacios |
| `--cuil <numero>`       | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno                                                  | CUIL del receptor: 11 dígitos, con o sin guiones, puntos o espacios |
| `--dni <numero>`        | ninguno       | `string`                                                                                                                                                                                                                                                                                                 | ninguno                                                  | DNI del receptor: de 6 a 8 dígitos, con o sin puntos o espacios     |
| `--consumidor-final`    | `--cfinal`    | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Documento `0` e IVA receptor `consumidor-final`                     |
| `--iva-receptor <tipo>` | `--ir <tipo>` | `'cliente-del-exterior' \| 'consumidor-final' \| 'iva-liberado' \| 'iva-no-alcanzado' \| 'monotributista-social' \| 'monotributo-trabajador-independiente-promovido' \| 'proveedor-del-exterior' \| 'responsable-inscripto' \| 'responsable-monotributo' \| 'sujeto-exento' \| 'sujeto-no-categorizado'` | Con `--cuit`, la del padrón; si no, `config.ivaReceptor` | Condición IVA del receptor                                          |
| `--ir-ce`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Cliente del exterior                                                |
| `--ir-cf`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Consumidor final                                                    |
| `--ir-il`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | IVA liberado                                                        |
| `--ir-ina`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | IVA no alcanzado                                                    |
| `--ir-ms`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Monotributista social                                               |
| `--ir-mtip`             | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Monotributo trabajador independiente promovido                      |
| `--ir-pe`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Proveedor del exterior                                              |
| `--ir-ri`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Responsable inscripto                                               |
| `--ir-rm`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Responsable monotributo                                             |
| `--ir-se`               | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Sujeto exento                                                       |
| `--ir-snc`              | ninguno       | `boolean`                                                                                                                                                                                                                                                                                                | `false`                                                  | Sujeto no categorizado                                              |

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
| `--monto <numero>`             | `-m`            | `number`                                              | requerido                                | Importe total del comprobante, hasta 13 enteros  |
| `--alicuota <tasa>`            | ninguno         | `'0' \| '2.5' \| '5' \| '10.5' \| '21' \| '27'`       | `config.alicuota` o `21`                 | Alícuota de IVA (solo `A` y `B`)                 |
| `--alicuota <tasa>:<monto>`    | ninguno         | repetible                                             | ninguno                                  | Varias alícuotas: monto con IVA de cada una      |
| `--exento <numero>`            | ninguno         | `number`                                              | `0`                                      | Parte exenta del monto (solo `A` y `B`)          |
| `--nogravado <numero>`         | ninguno         | `number`                                              | `0`                                      | Parte no gravada del monto (solo `A` y `B`)      |
| `--fecha <fecha>`              | `-f`            | `string`                                              | hoy                                      | Fecha del comprobante                            |
| `--dia <numero>`               | `-d`            | `integer`                                             | ninguno                                  | Deprecado: usá `--vencimiento` o `--vto`         |
| `--punto-venta <numero>`       | `--pv`          | `integer`                                             | `config.puntoVenta`                      | Punto de venta, de 1 a 99.998 (error 10004)      |
| `--concepto <tipo>`            | `-c`            | `'productos' \| 'servicios' \| 'productos-servicios'` | `config.concepto`                        | `productos`, `servicios` o `productos-servicios` |
| `--cs`                         | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto servicios`                |
| `--cp`                         | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto productos`                |
| `--csp`                        | ninguno         | `boolean`                                             | `false`                                  | Equivale a `--concepto productos-servicios`      |
| `--moneda <codigo>`            | `--mda`         | `string(3)`                                           | `config.moneda` o `ARS`                  | Moneda del comprobante: ISO o código de ARCA     |
| `--cotizacion-moneda <numero>` | `--cm`          | `number`                                              | oficial de ARCA                          | Cotización de la moneda                          |
| `--misma-moneda`               | ninguno         | `boolean`                                             | `false`                                  | El pago se cancela en la moneda extranjera       |
| `--servicio-desde <fecha>`     | `--sd <fecha>`  | `string`                                              | ninguno                                  | Fecha de inicio del servicio                     |
| `--servicio-hasta <fecha>`     | `--sh <fecha>`  | `string`                                              | ninguno                                  | Fecha de fin del servicio                        |
| `--vencimiento <fecha>`        | `--vto <fecha>` | `string`                                              | fin del servicio o fecha del comprobante | Vencimiento del pago (`FchVtoPago`)              |

En moneda extranjera (`--moneda USD`) hay dos formas de informar la cotización:

- **Te pagan en pesos** (default): pasá `--cotizacion-moneda` con la cotización acordada. Sin ella, ARCLI usa la oficial de ARCA y lo avisa en "Avisos". No puede ser `1`, y tiene que estar entre el 2 % y el 500 % de la oficial: la vista previa la compara (error 10119 de ARCA).
- **Te pagan en la moneda extranjera**: pasá `--misma-moneda`. ARCLI consulta la cotización oficial a ARCA y la muestra en la vista previa: con una `--fecha` pasada, la del día hábil anterior a esa fecha, como pide ARCA. No se combina con `--cotizacion-moneda`.

En pesos la cotización siempre es `1` y `--misma-moneda` no aplica. Detalle en [Moneda y cotización](validation-rules.md#moneda-y-cotización).

`--moneda` acepta el código ISO o el de ARCA, en mayúsculas o minúsculas: `ARS` y `PES` son lo mismo, como `USD` y `DOL`, `EUR` y `060` o `UYU` y `011`. ARCLI traduce el ISO al código de ARCA antes de enviar y la vista previa muestra el nombre con el ISO (`Pesos uruguayos (UYU)`). Están todas las monedas de la tabla de ARCA (`arcli parametros monedas`) que tienen código ISO; un código que no está en esa tabla se busca en la de ARCA antes de la vista previa (en la `E`, en la de WSFEX): si ARCA no la tiene, es `INPUT_VALIDATION_ERROR` (ARCA la rechazaría con 10037, en la `E` con 1590), con o sin `--cm`. Si la tabla no se puede consultar, sigue y decide ARCA. Lo mismo vale para `codigoMoneda` en el JSON y la clave `moneda` de la config.

`--alicuota` acepta alias: `general` (21), `reducida` (10.5), `incrementada` (27) y `cero` (0). Para una factura con ítems a distintas alícuotas, repetí `--alicuota TASA:MONTO` (por ejemplo `--alicuota general:1210 --alicuota reducida:552,50`); el total se calcula solo. Ver [Varias alícuotas](validation-rules.md#varias-alícuotas-en-un-comprobante).

`--monto` siempre es el total del comprobante. Si informás `--exento` o `--nogravado`, ARCLI los descuenta del total y calcula neto e IVA sobre el resto. Ejemplo: `fb -m 1196 --exento 50 --nogravado 25` da neto 926,45 e IVA 194,55. El flag es `--nogravado`, sin guion, porque el CLI interpreta cualquier `--no-*` como la negación de otro flag.

Los montos usan formato argentino: el punto separa miles y la coma separa decimales. `15000`, `15.000`, `1500,50` y `1.500,50` son válidos; `1500.50` da error, igual que el texto sobrante (`12abc`) y más de 2 decimales. La cotización acepta hasta 6. Vale para `--monto`, `--exento`, `--nogravado`, `--cotizacion-moneda` y el monto de `--alicuota TASA:MONTO`. En el JSON de `--cargar` los montos son números, también con 2 decimales como máximo (la cotización, 6).

#### Las fechas de un comprobante

Un comprobante puede llevar hasta cuatro fechas, y cada una responde a una pregunta distinta:

| Fecha                    | Flag                                                 | Responde                       | Sin el flag                                     |
| ------------------------ | ---------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| Del comprobante          | `-f`, `--fecha`                                      | ¿Qué día se emite?             | hoy                                             |
| Período del servicio     | `--sd`/`--servicio-desde`, `--sh`/`--servicio-hasta` | ¿Qué período cubre la factura? | la fecha del comprobante                        |
| Vencimiento              | `--vto`, `--vencimiento`                             | ¿Cuándo vence el pago?         | el fin del servicio, o la fecha del comprobante |
| Período asociado (notas) | `--pd`/`--periodo-desde`, `--ph`/`--periodo-hasta`   | ¿Qué facturas ajusta la nota?  | no va: se usa el comprobante asociado (`--ac`…) |

- `--servicio-*` y `--vencimiento` son de facturas (y notas) de servicios. `--periodo-*` es solo de notas: en lugar de ajustar una factura puntual, ajustan todo lo facturado en ese período.
- `--dia` está deprecado: usá `--vencimiento` o `--vto`.

Ejemplos:

```bash
# Servicio de octubre, facturado hoy, que vence el 10/11
arcli fc -m 1000 --cs --cfinal --sd 1/10 --sh 31/10 --vto 10/11

# Nota de crédito por un descuento sobre todo lo facturado en octubre de 2026
arcli ncc -m 500 --cs --cfinal --pd 1/10/2026 --ph 31/10/2026
```

Para facturar con otra fecha, sumá `-f`: por ejemplo, `-f 31/10` el 3/11 (en servicios, hasta 10 días antes o después de hoy).

Las cuatro se escriben igual: formato argentino (día primero), con mes y año opcionales; sin año se toma la fecha más cercana a hoy. Detalle completo en [Fechas aceptadas](validation-rules.md#fechas-aceptadas).

También aceptan fechas relativas: `hoy`, `ayer`, `+N` y `-N` (N días desde hoy) en todas, y `mes-actual` y `mes-pasado` solo en desde y hasta (`--sd`/`--sh`, `--pd`/`--ph`): en desde dan el día 1 del mes y en hasta, el último día. La vista previa y el `--json` muestran la fecha resuelta. Las preguntas de fecha del modo interactivo aceptan las de un día. La excepción es la fecha de inicio de actividades (`emisor.inicioActividades`), que se escribe completa (D/MM/YYYY) y no acepta relativas: es una fecha vieja y fija. Detalle en [Fechas relativas](validation-rules.md#fechas-relativas).

```bash
# Vence en 10 días; se emitió ayer
arcli fc -m 1000 --cs --cfinal -f ayer --vto +10
```

#### Abono mensual por cron

Con las palabras de mes, el mismo comando sirve todos los meses. Por ejemplo, para facturar el 1 de cada mes el servicio del mes anterior, con vencimiento a 10 días:

```bash
arcli fc -m 50.000 --cs --cfinal --sd mes-pasado --sh mes-pasado --vto +10 --emitir
```

En `crontab -e`, a las 9 del día 1 (sin terminal no pregunta: `--emitir` es lo que hace que emita; sumá `--json` para guardar la respuesta):

```bash
0 9 1 * * arcli fc -m 50.000 --cs --cfinal --sd mes-pasado --sh mes-pasado --vto +10 --emitir --json >> ~/abono.log 2>&1
```

"Hoy" es la fecha argentina aunque el servidor esté en otra zona horaria, pero cron dispara en la hora del equipo: en un servidor en UTC, `0 12 1 * *` son las 9 en Argentina.

### Asociados

Estos flags importan solo para notas. Si estás emitiendo una factura, podés ignorarlos.

Dicho más directo: **no aplican a `factura`, `factura-credito-electronica`, `recibo`, `fa`, `fb`, `fc`, `fcea`, `fceb`, `fcec`, `ra`, `rb` ni `rc`**.

| Flag                              | Alias            | Tipo         | Valor por defecto | Descripción                                                     |
| --------------------------------- | ---------------- | ------------ | ----------------- | --------------------------------------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | ninguno           | Atajo del comprobante asociado                                  |
| `--at <numero>`                   | ninguno          | `integer`    | ninguno           | Tipo ARCA del comprobante asociado                              |
| `--asociado-punto-venta <numero>` | `--apv <numero>` | `integer`    | ninguno           | Punto de venta del asociado, hasta 99.998 (error 10058)         |
| `--ar <numero>`                   | ninguno          | `integer`    | ninguno           | Número del comprobante asociado, hasta 99.999.999 (error 10059) |
| `--acuit <numero>`                | ninguno          | `string(11)` | el CUIT emisor    | CUIT del comprobante asociado                                   |
| `--afecha <fecha>`                | ninguno          | `string`     | ninguno           | Fecha del comprobante asociado                                  |
| `--periodo-desde <fecha>`         | `--pd <fecha>`   | `string`     | ninguno           | Inicio del período asociado                                     |
| `--periodo-hasta <fecha>`         | `--ph <fecha>`   | `string`     | ninguno           | Fin del período asociado                                        |

### Crédito electrónico (FCE)

Estos flags solo aplican a comprobantes de crédito electrónica. En cualquier otro comprobante dan error, porque ARCA los rechaza (10169).

| Flag                          | Alias   | Tipo             | Valor por defecto | Aplica a    | Descripción                                                                 |
| ----------------------------- | ------- | ---------------- | ----------------- | ----------- | --------------------------------------------------------------------------- |
| `--cbu <cbu>`                 | ninguno | `string(22)`     | `config.cbu`      | Factura FCE | CBU del emisor (obligatorio)                                                |
| `--alias <alias>`             | ninguno | `string(6..20)`  | `config.aliasCbu` | Factura FCE | Alias del CBU (opcional). El de la config va solo si el CBU es `config.cbu` |
| `--transferencia <modalidad>` | ninguno | `'sca' \| 'adc'` | `sca`             | Factura FCE | Modalidad de transferencia                                                  |
| `--anulacion`                 | ninguno | `boolean`        | `false`           | NC/ND FCE   | La nota anula una factura rechazada                                         |

### PDF

Estos flags controlan el PDF del comprobante emitido. Los datos que se pasan acá **solo van en el PDF**: ARCA no los recibe. Detalle en [PDF de comprobantes](pdf.md).

| Flag                           | Alias   | Tipo      | Valor por defecto       | Descripción                                  |
| ------------------------------ | ------- | --------- | ----------------------- | -------------------------------------------- |
| `--exportar-pdf`               | `--pdf` | `boolean` | según `config.pdf`      | Genera el PDF después de emitir              |
| `--sin-pdf`                    | ninguno | `boolean` | según `config.pdf`      | No genera el PDF                             |
| `--descripcion <texto>`        | ninguno | `string`  | `Según detalle`         | Detalle del comprobante en el PDF            |
| `--condicion-venta <tipo>`     | `--cv`  | `string`  | `config.condicionVenta` | Condición de venta en el PDF                 |
| `--sin-condicion-venta`        | ninguno | `boolean` | ninguno                 | Omite la condición aunque esté configurada   |
| `--receptor-nombre <texto>`    | ninguno | `string`  | ninguno                 | Nombre o razón social del receptor en el PDF |
| `--receptor-domicilio <texto>` | ninguno | `string`  | ninguno                 | Domicilio del receptor en el PDF             |

`--condicion-venta` acepta `contado`, `tarjeta-debito`, `tarjeta-credito`, `cuenta-corriente`, `cheque`, `transferencia`, `otros-medios-electronicos` u `otra`, que se imprimen con su nombre (`cuenta-corriente` sale "Cuenta Corriente"). Cualquier otro texto se imprime tal cual: `--cv "Billetera virtual"`. `--sin-condicion-venta` permite omitirla en un comprobante aunque exista un valor en la config; no se combina con `--condicion-venta` ni `--cv`. Solo en A, B y C; en la factura `E` va `--forma-pago`, que sí viaja a ARCA.

`--exportar-pdf` y `--sin-pdf` no se combinan. Sin ninguno de los dos, si confirmás la emisión a mano lo decide la opción que elijas (**Sí, emitir ahora** o **Sí, emitir y generar el PDF**); si se emite sin confirmar, decide `config.pdf` (`preguntar` por defecto: en una terminal pregunta después de emitir, con `--json` o sin terminal no genera).

### Comando `arcli pdf`

Instala o revisa el plugin que genera los PDFs. No viene con ARCLI porque pesa unos 160 MB.

| Comando                 | Descripción                                            |
| ----------------------- | ------------------------------------------------------ |
| `arcli pdf`             | Estado del plugin: instalado o no, versión y navegador |
| `arcli pdf estado`      | Igual que `arcli pdf`                                  |
| `arcli pdf instalar`    | Descarga el plugin (y un navegador si no hay Chrome)   |
| `arcli pdf desinstalar` | Borra el plugin y el navegador que haya descargado     |

Todos aceptan `--json`. El formato está en [Entrada y salida](input-output.md#plugin-de-pdf-pdf-estado).

### Comando `arcli certificado`

Arma el pedido del certificado de ARCA y carga el certificado que te devuelve, sin `openssl`. Los pasos en ARCA, con capturas, están en [Cómo obtener los certificados](obtencion-certificados.md).

| Comando                                                                 | Descripción                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `arcli certificado generar [--testing\|--produccion] [--alias <alias>]` | Crea la clave privada y el CSR para subir a ARCA, y muestra los pasos del entorno              |
| `arcli certificado importar <archivo> [--testing\|--produccion]`        | Valida el `.crt` que bajaste de ARCA, lo guarda y configura `cert.<entorno>` y `key.<entorno>` |

- Los archivos van a `certificados/<CUIT>/`, junto al archivo de config: `<entorno>.key` (permisos `0600`), `<entorno>.crt` y `<entorno>.csr`.
- `generar` usa el entorno de `--testing`/`--produccion` o, sin flag, el de la config. `--alias` es el nombre del certificado en ARCA (por defecto `arcli`).
- **Renovar sin cortar la facturación:** `generar` deja la clave nueva como pendiente (`<entorno>.nueva.key`) y no toca la activa: seguís facturando con el certificado actual hasta que `importar` valida el nuevo. Recién ahí la pendiente pasa a ser la activa, y el par anterior queda como `<entorno>.anterior.*`. Si ya hay un pedido pendiente, o no lo puede leer por falta de permiso, `generar` frena sin tocar nada; `--reemplazar` lo descarta y arma otro, también si la carpeta del CUIT no tiene permiso (lo repone). Si lo que no se puede leer es la clave pendiente, o no hay permiso en `certificados/`, frena igual: reponé el permiso.
- `importar` saca el entorno del certificado (ARCA firma los de testing con "Computadores Test" y los de producción con "Computadores"). Antes de tocar nada valida que sea un certificado, que sea de tu CUIT, que no esté vencido y que corresponda a la clave del pedido. Acepta archivos con BOM o finales de línea de Windows. Al terminar, dice qué cargó: entorno, CUIT, alias y vencimiento.
- Si ya había otro certificado configurado para ese entorno, `importar` pregunta antes de reemplazarlo; sin terminal o con `--json`, hace falta `--reemplazar`.
- Las rutas configuradas a mano con `arcli config establecer cert.*`/`key.*` siguen andando igual: `importar` solo las cambia al cargar un certificado nuevo.
- En la terminal, el título va con el color del entorno y la carpeta, el CSR y la clave son links: con un clic se abren (en terminales que los soportan, como la de VS Code, iTerm2 o Windows Terminal; `FORCE_HYPERLINK=0` los apaga).
- Los dos aceptan `--json`. El formato está en [Entrada y salida](input-output.md#certificados-certificado).

### Comandos `arcli estado` y `arcli parametros`

Consultan a ARCA sin emitir nada. Usan el entorno y el punto de venta de la config (o `--testing` / `--produccion`) y aceptan `--json`.

| Comando                                | Descripción                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `arcli estado`                         | Si los servidores de ARCA responden, cuánto tardan y si el punto de venta está habilitado                                    |
| `arcli parametros`                     | Lista las tablas disponibles (no consulta ARCA)                                                                              |
| `arcli parametros <tabla>`             | `puntos-venta`, `comprobantes`, `documentos`, `alicuotas`, `iva-receptor`, `monedas`, `conceptos`, `opcionales` o `tributos` |
| `arcli parametros cotizacion <moneda>` | Cotización oficial de ARCA, por ejemplo `USD`                                                                                |

- Las tablas muestran solo los valores vigentes hoy, salvo `puntos-venta`, que también lista los bloqueados o dados de baja, con su estado.
- En texto, cada tabla tiene una fila de encabezado (`CÓDIGO`, o `NÚMERO` en `puntos-venta`, la descripción y, en `iva-receptor` y `puntos-venta`, una tercera columna) y al pie para qué sirve el código en ARCLI, por ejemplo que `--moneda` acepta el código o el ISO. El `--json` no cambia.
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
- IVA del receptor: `--iva-receptor`, `--ir` o un solo `--ir-*` (con `--cuit` se puede omitir: sale del padrón)

**Opcional**

- identidad del receptor: `--cuit`, `--cuil`, `--dni`, `--consumidor-final` o `--cfinal`. Sin ninguna, es consumidor final (documento 0)
- punto de venta si no está en config: `--punto-venta` o `--pv`
- fecha del comprobante: `--fecha`
- moneda y cotización: `--moneda`, `--mda`, `--cotizacion-moneda`, `--cm`, `--misma-moneda`
- carga JSON: `--cargar`
- fechas de servicio y vencimiento: `--servicio-desde`, `--servicio-hasta`, `--vencimiento` (y `--dia`, deprecado)
- modo de ejecución: `--previsualizar`, `--emitir`
- salida: `--json`, `--bruto`

#### Ejemplo mínimo funcional

Factura C simple:

```bash
arcli fc -m 300000 --cs --consumidor-final
```

Factura A con CUIT:

```bash
arcli fa -m 1 --cs --cuit 20168598204 --ir-ri
```

#### Resumen rápido de parámetros

| Parámetro                                                                       | Alias           | Tipo                                                  | Requerido   | Cuándo usarlo                                             |
| ------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `--monto <numero>`                                                              | `-m`            | `number`                                              | Sí          | Siempre                                                   |
| `--concepto <tipo>`                                                             | `-c`            | `'productos' \| 'servicios' \| 'productos-servicios'` | Sí          | Siempre                                                   |
| `--cs`, `--cp`, `--csp`                                                         | ninguno         | `boolean`                                             | Condicional | Si preferís el atajo en lugar de `--concepto`             |
| `--cuit <numero>` / `--cuil <numero>` / `--dni <numero>` / `--consumidor-final` | `--cfinal`      | `string` / `boolean`                                  | No          | Sin ninguna, consumidor final; una sola identidad         |
| `--iva-receptor <tipo>` / `--ir <tipo>` / `--ir-*`                              | ninguno         | unión de IVA receptor o `boolean`                     | Sí          | Una sola forma; con `--cuit`, sin el flag sale del padrón |
| `--punto-venta <numero>`                                                        | `--pv <numero>` | `integer`                                             | Condicional | Si no está en config                                      |
| `--fecha <fecha>`                                                               | `-f`            | `string`                                              | No          | Si querés fijar una fecha específica                      |
| `--dia <numero>`                                                                | `-d`            | `integer`                                             | No          | Deprecado: usá `--vencimiento` o `--vto`                  |
| `--servicio-desde <fecha>`                                                      | `--sd <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                               |
| `--servicio-hasta <fecha>`                                                      | `--sh <fecha>`  | `string`                                              | Condicional | Si el concepto usa servicio                               |
| `--vencimiento <fecha>`                                                         | `--vto <fecha>` | `string`                                              | No          | Servicios y facturas FCE                                  |

#### Qué no aplica

Las facturas no usan comprobante asociado, así que no aplican:

- `--ac`
- `--at`
- `--apv`
- `--asociado-punto-venta`
- `--ar`
- `--acuit`

### Recibo A, B y C

`arcli ra`, `arcli rb` y `arcli rc` (o `arcli recibo a`, `b` o `c`) emiten el recibo de un cobro: tipos ARCA 4, 9 y 15. Cada uno usa los mismos flags y validaciones que la factura de su letra: el A discrimina IVA y va a un CUIT, el B lleva el IVA incluido y el C no lleva IVA. Ninguno lleva comprobante asociado ni es FCE. Una nota de crédito o débito de la misma letra lo puede asociar con `--ac ra`, `--ac rb` o `--ac rc`. Detalle en [Reglas de validación](validation-rules.md#recibo-a-b-y-c).

```bash
arcli ra -m 121000 --cs --cuit 20168598204
arcli rb -m 12100 --cs --cfinal
arcli rc -m 15000 --cs --cfinal
```

### Notas de crédito y débito `A`, `B` y `C`

Las notas heredan todo lo de una factura, pero suman una regla importante: **siempre requieren un comprobante asociado o un período asociado**.

#### Diferencias clave con facturas

- siempre requieren asociado: una factura puntual (`--ac`…) o un período (`--periodo-desde` y `--periodo-hasta`)
- el asociado debe ser una factura compatible, otra nota de la misma letra (`--ac ndc`, `--ac nca`…) o un recibo de la misma letra (`--ac ra`, `--ac rb`, `--ac rc`)
- la letra del asociado debe coincidir con la de la nota
- `--ac` y `--at` son excluyentes

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- todo lo base de una factura
- además:
  - un comprobante asociado: `--ac` o `--at`, con `--asociado-punto-venta` (o `--apv`) y `--ar`; `--acuit` solo si es de otro CUIT (sin él, el tuyo)
  - o un período asociado: `--periodo-desde` y `--periodo-hasta` (entonces no van `--ac`, `--apv`, `--ar` ni `--acuit`)

**Opcional**

- el resto de flags base de facturas

#### Ejemplo mínimo funcional

```bash
arcli nca -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6
```

#### Nota por período

Si la nota ajusta un período entero y no una factura puntual (por ejemplo, un descuento sobre todo lo facturado en el mes), usá el período en lugar del bloque `--ac`:

```bash
arcli ncb -m 5000 --cs --cfinal --periodo-desde 01-09-2026 --periodo-hasta 30-09-2026
```

El período no puede terminar después de la fecha de la nota. Las notas FCE no lo aceptan.

#### Resumen rápido de parámetros asociados

| Parámetro                         | Alias            | Tipo         | Requerido   | Cuándo usarlo                                                          |
| --------------------------------- | ---------------- | ------------ | ----------- | ---------------------------------------------------------------------- |
| `--ac <atajo>`                    | ninguno          | `string`     | Condicional | Si querés identificar el asociado por shortcut                         |
| `--at <numero>`                   | ninguno          | `integer`    | Condicional | Si querés identificar el asociado por tipo ARCA                        |
| `--asociado-punto-venta <numero>` | `--apv <numero>` | `integer`    | Condicional | Con `--ac`/`--at`                                                      |
| `--ar <numero>`                   | ninguno          | `integer`    | Condicional | Con `--ac`/`--at`                                                      |
| `--acuit <numero>`                | ninguno          | `string(11)` | No          | Si el asociado es de otro CUIT; sin él, el CUIT emisor; no con período |

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
- CBU: `--cbu`, o configurado una vez con su alias: `arcli config establecer cuenta <CBU> [ALIAS]`. Sin alias, borra el guardado y lo avisa. Ver [Cuenta](configuration.md#cuenta)

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
- bloque de asociado: `--ac` o `--at`, `--apv` y `--ar`
- el asociado tiene que ser del propio emisor: `--acuit` se puede omitir y toma el CUIT configurado

**Opcional**

- `--afecha`: sin ella, arcli consulta el asociado en ARCA y toma su fecha; la vista previa ya la muestra
- `--anulacion` si la nota anula una factura que el comprador rechazó

No llevan CBU, alias, transferencia ni vencimiento de pago.

#### Ejemplo mínimo funcional

```bash
arcli ncea -m 1 --cs --cuit 20168598204 --ir-ri --ac fcea --apv 3 --ar 6
```

### Factura de exportación `E` (WSFEX)

`arcli fe` y `arcli factura e` hacen lo mismo: emiten o previsualizan una Factura de exportación `E` con el servicio `wsfex`, que tiene sus propios datos y su propio certificado autorizado. No es una letra más de la familia de facturas: no lleva concepto, IVA ni receptor con CUIT/CUIL/DNI, y en cambio lleva país de destino, incoterm, permisos de embarque e ítems reales.

Las notas de crédito y débito `E` tienen su propia sección: [Notas de crédito y débito de exportación](#notas-de-crédito-y-débito-de-exportación-e).

#### Credenciales

WSFEX pide un certificado autorizado al servicio `wsfex`. ARCLI usa `exportacion.cert.<entorno>` y `exportacion.key.<entorno>` si están configurados; si no, cae en `cert.<entorno>` y `key.<entorno>`. El par se resuelve junto: si configurás solo una de las dos claves de exportación, el comando corta antes de ir a ARCA. Ver [Configuración](configuration.md#certificados-de-exportación-wsfex).

#### Qué necesitás para emitir este comprobante

**Obligatorio**

- importe total: `--monto`
- cliente y domicilio en el exterior: `--cliente`, `--domicilio-cliente`
- país de destino: `--pais-destino`, por código (`203`) o por nombre (`Brasil`)

**Opcional**

- actividad: `--actividad` o la clave `exportacion.actividad` de la config, con un código de la tabla de actividades de WSFEX. Sin ninguna, la `E` va sin el bloque `Actividades`
- `--id-impositivo` y `--cuit-pais` (sin `--cuit-pais` se resuelve desde el país de destino; si ARCA no
  publica un CUIT para ese país —Irlanda, Alemania, las zonas francas…—, la `E` va solo con `--id-impositivo`:
  ARCA pide uno de los dos, error 1580)
- `--tipo-expo` (`1` bienes, `2` servicios, `4` otros; por defecto `2`)
- el detalle, en una de dos formas ([lado a lado](exportacion.md#el-detalle-de-la-e-rápido-o-por-ítems)): rápida, sin `--item`, va un renglón con `--descripcion` (por defecto "Según detalle"), cantidad 1, unidad `unidades` y `--monto` como precio; detallada, un `--item` por renglón, que tienen que sumar `--monto`
- `--incoterm` y `--incoterms-desc`, `--idioma`, `--forma-pago` (por defecto `Transferencia Internacional`)
- `--permiso` y `--permiso-existente` para permisos de embarque (solo con `--tipo-expo 1`; en `2` y `4` ARCA exige `Permiso_existente` vacío)
- `--numero` y `--id-solicitud` si los querés fijar a mano (por defecto, los siguientes de WSFEX)
- punto de venta si no está en config: `--punto-venta` o `--pv`
- moneda y cotización: `--moneda` (por defecto `DOL`), `--mda`, `--cotizacion-moneda`, `--cm`, `--misma-moneda`
- PDF: `--exportar-pdf`, `--pdf` o `--sin-pdf`
- modo y salida: `--previsualizar`, `--emitir`, `--json`, `--bruto`

Sin `--tipo-expo`, `--moneda` ni `--forma-pago`, la `E` sale de servicios (`Tipo_expo` `2`), en dólares (`DOL`) y con forma de pago `Transferencia Internacional`. Las claves `moneda` y `cotizacion` de la config son de los comprobantes locales y no aplican a exportación.

La actividad es opcional y no tiene default: cada emisor tiene la suya. Si no la informás, la `E` va sin actividad, que ARCA no exige. La tabla de actividades de WSFEX (`FEXGetPARAM_Actividades`) no es la del padrón y es más chica (por ejemplo, `620900` no está y `620100` sí), así que un código que no está es error de validación antes de ir a ARCA, con las actividades que empiezan igual.

El pago de una exportación se hace en la moneda extranjera del comprobante (`Moneda_Id`/`Moneda_ctz`). Si además se cobra en esa misma moneda, `--misma-moneda` manda `CanMisMonExt` en `S`, que es el campo de WSFEX que lo declara; sin el flag va en `N`, salvo en pesos, donde ARCA pide que el campo no vaya (error 1605).

La factura `E` no lleva comprobantes asociados ni datos opcionales, así que `solicitud` no incluye `Cmps_asoc` ni `Opcionales`: ARCA rechaza esos bloques vacíos (error 1820 el primero) y no acepta asociados en la factura (error 1755).

#### Ejemplo mínimo funcional

```bash
arcli fe --monto 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203 \
  --actividad 620100
```

Con los datos del receptor del exterior (CUIT del país, ID impositivo, razón social y domicilio), ítems, incoterm y
salida JSON:

```bash
arcli fe -m 1500 --cliente "ACME LLC" --id-impositivo "12-3456789" --domicilio-cliente "123 Main St" \
  --pais-destino 212 --cuit-pais 55000002126 --tipo-expo 1 --incoterm FOB --actividad 620100 \
  --item "001|Bienes varios|1|1500|unidad" --emitir --json
```

Cobrando en dólares, con la cotización de aduana de ARCA (sin `--cm`) y el pago en la misma moneda (`--misma-moneda`):

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --actividad 620100 --misma-moneda --previsualizar
```

#### Resumen rápido de parámetros

| Parámetro                         | Alias           | Tipo                                 | Requerido   | Cuándo usarlo                                                                                                                                                                                                           |
| --------------------------------- | --------------- | ------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--monto <numero>`                | `-m`            | `number`                             | Sí          | Siempre                                                                                                                                                                                                                 |
| `--cliente <texto>`               | ninguno         | `string`                             | Sí          | Siempre: nombre o razón social del cliente del exterior                                                                                                                                                                 |
| `--domicilio-cliente <texto>`     | ninguno         | `string`                             | Sí          | Siempre                                                                                                                                                                                                                 |
| `--pais-destino <codigo\|nombre>` | ninguno         | `string`                             | Sí          | Siempre: código de ARCA o nombre tal como lo informa ARCA                                                                                                                                                               |
| `--id-impositivo <texto>`         | ninguno         | `string`                             | No          | ID fiscal del cliente en su país                                                                                                                                                                                        |
| `--cuit-pais <numero>`            | ninguno         | `integer`                            | No          | CUIT del país del cliente; sin el flag sale de la tabla de ARCA, y si la tabla no trae el destino va solo `--id-impositivo` (1580)                                                                                      |
| `--tipo-expo <1\|2\|4>`           | ninguno         | `1` bienes, `2` servicios, `4` otros | No          | Por defecto `2` (servicios)                                                                                                                                                                                             |
| `--actividad <codigo>`            | ninguno         | `integer`                            | No          | Código de la tabla de WSFEX; por defecto `exportacion.actividad`. Sin ninguno, la `E` va sin actividad                                                                                                                  |
| `--item <partes>`                 | ninguno         | `string` repetible                   | No          | `codigo\|descripcion\|cantidad\|precio\|unidad`; la suma debe dar `--monto`                                                                                                                                             |
| `--incoterm <codigo>`             | ninguno         | `string`                             | Condicional | Obligatorio en bienes (`--tipo-expo 1`, error 1640). Por ejemplo `FOB`; se valida contra la tabla de ARCA                                                                                                               |
| `--incoterms-desc <texto>`        | ninguno         | `string`                             | No          | Por defecto, la descripción de la tabla de ARCA. Solo con `--incoterm` (error 1641) y hasta 20 caracteres (1642)                                                                                                        |
| `--idioma <codigo>`               | ninguno         | `integer`                            | No          | `1` español (por defecto), `2` inglés, `3` portugués                                                                                                                                                                    |
| `--forma-pago <texto>`            | ninguno         | `string`                             | No          | Por defecto `Transferencia Internacional`                                                                                                                                                                               |
| `--permiso <id>`                  | ninguno         | `string` repetible                   | No          | Permiso de embarque ya existente; solo con `--tipo-expo 1`. En la factura requiere `--permiso-existente`                                                                                                                |
| `--permiso-existente`             | ninguno         | `boolean`                            | No          | Marca que los permisos informados ya están en ARCA                                                                                                                                                                      |
| `--numero <numero>`               | ninguno         | `integer`                            | No          | Por defecto, el siguiente al último de ese tipo en el punto de venta. Hasta 99.999.999 (error 1520)                                                                                                                     |
| `--id-solicitud <numero>`         | ninguno         | `integer`                            | No          | Por defecto, el siguiente de WSFEX. Hasta 15 dígitos                                                                                                                                                                    |
| `--punto-venta <numero>`          | `--pv <numero>` | `integer`                            | Condicional | Si no está en config. Hasta 99.998 (error 1510)                                                                                                                                                                         |
| `--fecha <fecha>`                 | `-f`            | `string`                             | No          | De 5 días antes a 5 días después de hoy; en servicios, no después del fin de mes (error 1500). También `hoy`, `ayer`, `+N` o `-N` ([fechas relativas](validation-rules.md#fechas-relativas))                            |
| `--fecha-pago <fecha>`            | ninguno         | `string`                             | No          | Solo en servicios y otros; por defecto, la fecha del comprobante, y no anterior a ella (error 1674). En bienes no se usa (error 1673). También `hoy`, `ayer`, `+N` o `-N`                                               |
| `--moneda <codigo>`               | `--mda`         | `string`                             | No          | Código ISO o de ARCA, por ejemplo `USD` o `DOL`; por defecto `DOL`                                                                                                                                                      |
| `--cotizacion-moneda <numero>`    | `--cm`          | `number`                             | No          | Sin flag se usa la cotización de aduana de ARCA. En servicios y con `--misma-moneda`, ARCA exige la del día hábil anterior a la fecha del comprobante (errores 2053 y 1604): si la pasás, tiene que ser esa, o es error |
| `--misma-moneda`                  | ninguno         | `boolean`                            | No          | El pago se cancela en la misma moneda extranjera: manda `CanMisMonExt` en `S`                                                                                                                                           |
| `--observaciones <texto>`         | ninguno         | `string`                             | No          | Observaciones del comprobante                                                                                                                                                                                           |
| `--obs-comerciales <texto>`       | ninguno         | `string`                             | No          | Observaciones comerciales                                                                                                                                                                                               |
| `--descripcion <texto>`           | ninguno         | `string`                             | No          | Solo sin `--item`: el renglón único (por defecto `Según detalle`); también va al PDF                                                                                                                                    |
| `--cargar <ruta>`                 | ninguno         | `string`                             | No          | Un objeto con un comprobante, no un lote                                                                                                                                                                                |

Los flags globales (`--testing`, `--produccion`, `--json`, `--bruto`) y los de modo (`--previsualizar`, `--emitir`) funcionan igual que en el resto de los comprobantes.

#### Ítems

Cada `--item` se separa con `|` para no pelear con las comas de los importes. La forma completa es `codigo|descripcion|cantidad|precio|unidad`; con cuatro partes se omite el código y con tres la unidad, que queda en `unidad` (código `7` de ARCA). La unidad puede ser el código numérico o el nombre de la tabla de unidades, que se compara sin mayúsculas y acepta singular o plural (`unidad` o `unidades`). Las unidades 0, 97 (seña o anticipo) y 99 (bonificación) no se aceptan: ARCA las pide sin cantidad ni precio (error 1775). El código va hasta 50 caracteres y la descripción hasta 4000.

```bash
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 203 \
  --actividad 620100 --item "001|Servicio de consultoría|1|1000|unidad" \
  --item "002|Soporte|2|250|unidades" --previsualizar
```

WSFEX no valida que `Imp_total` coincida con la suma de los ítems, así que ARCLI lo valida antes de ir a ARCA: si la suma no da `--monto`, el comando corta con un error de validación.

#### Qué no aplica

Estos flags de facturación no existen en `fe`, que los rechaza como opción desconocida. `arcli factura e` comparte el comando con A, B y C, así que los acepta pero los saltea con un aviso en "Avisos" (y en `avisos` del JSON); lo mismo pasa al revés con los flags de la `E` en `arcli factura a`, `b` o `c`:

- concepto (`--concepto`, `--cs`, `--cp`, `--csp`) y fechas de servicio (`--servicio-desde`, `--servicio-hasta`, `--vencimiento` y `--dia`, deprecado)
- identidad del receptor (`--cuit`, `--cuil`, `--dni`, `--consumidor-final`) e `--iva-receptor`
- IVA y alícuotas (`--alicuota`, `--exento`, `--nogravado`; tampoco `alicuotas` en el JSON)
- comprobante asociado (`--ac`, `--at`, `--apv`, `--ar`, `--acuit`, `--afecha`, `--anulacion`, `--periodo-desde`, `--periodo-hasta`)
- datos de cobro FCE (`--cbu`, `--alias`, `--transferencia`); el régimen FCE (`verificarFce` en la config) tampoco se consulta

Los defaults de config de esos campos (concepto, IVA receptor, alícuota, CBU) no se usan al emitir una `E`.

#### Vista previa, numeración y PDF

- La vista previa consulta las tablas de WSFEX (países, monedas, unidades, incoterms, idiomas, actividades), la cotización y el ID de la solicitud, pero no emite.
- WSFEX numera por punto de venta y tipo de comprobante. Sin `--numero`, ARCLI consulta el último (`FEXGetLast_CMP`) y usa el siguiente, también en la vista previa; si pasás otro, ARCA rechaza el comprobante. El ID de la solicitud también se consulta (`FEXGetLast_ID`). Fijá los dos con `--numero` e `--id-solicitud` si emitís en paralelo.
- El PDF se genera después de emitir, como en el resto de los comprobantes. Se guarda como `factura-e_<pv>-<numero>.pdf` y usa el diseño de exportación: ítems reales, país de destino, CUIT del país, ID impositivo, divisa, forma y fecha de pago, incoterm y la leyenda de IVA exento. Ver [PDF](pdf.md#factura-de-exportación-e).
- Un comprobante rechazado por WSFEX sale como respuesta válida con exit code `2`, igual que en las letras A, B y C.

El JSON de salida y el de `--cargar` están en [Entrada y salida](input-output.md#factura-de-exportación-e).

### Notas de crédito y débito de exportación `E`

`arcli nce` (`nota-credito e`, tipo ARCA `21`) y `arcli nde` (`nota-debito e`, tipo `20`) ajustan una Factura de exportación `E` ya emitida por WSFEX. Usan el mismo servicio, credenciales y flags que `fe`, más el comprobante asociado.

Antes de armar la nota, ARCLI consulta el asociado en ARCA (`FEXGetCMP`) y toma de ahí lo que no venga por flag: cliente, domicilio, ID impositivo, país de destino, CUIT del país, tipo de exportación, moneda y cotización, idioma, incoterm, forma de pago y actividad. Por eso alcanza con el monto y el asociado (el número de la nota también sale de ARCA):

```bash
arcli nce -m 500 --ar 1
```

En bienes y otros (`--tipo-expo 1` o `4`) el asociado es opcional, por ejemplo para un descuento por volumen sobre varias facturas: sin `--ar` la nota no hereda nada y cliente, domicilio, país de destino y lo demás van por flag, como en `fe`. En servicios, ARCA lo exige (error 2047).

```bash
arcli nce -m 300 --tipo-expo 1 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 \
  --incoterm FOB --actividad 620100 --descripcion "Descuento por volumen" --previsualizar
```

#### Comprobante asociado

| Parámetro          | Alias                             | Tipo      | Requerido   | Cuándo usarlo                                                                                                                         |
| ------------------ | --------------------------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--ar <numero>`    | ninguno                           | `integer` | Condicional | Número del comprobante que ajusta la nota. Obligatorio en servicios (error 2047); en bienes y otros (`--tipo-expo 1` o `4`), opcional |
| `--apv <numero>`   | `--asociado-punto-venta <numero>` | `integer` | No          | Punto de venta del asociado; por defecto, el de la nota                                                                               |
| `--ac <atajo>`     | ninguno                           | `string`  | No          | `fe` (por defecto), `nde` o `nce`, para ajustar otra nota `E`                                                                         |
| `--at <numero>`    | ninguno                           | `integer` | No          | Lo mismo por tipo ARCA: `19`, `20` o `21`                                                                                             |
| `--acuit <numero>` | ninguno                           | `string`  | No          | No hace falta: el asociado de una `E` siempre es del CUIT emisor (error 2031)                                                         |

`--afecha` no se usa: la fecha del asociado sale de ARCA.

#### Qué valida antes de emitir

- en servicios, que haya asociado (`--ar`, error 2047);
- que el asociado exista en ARCA y esté aprobado;
- que la nota no sea anterior al asociado;
- que una nota de crédito no supere el total del asociado, si van en la misma moneda;
- si la nota es de servicios (`--tipo-expo 2`), lo que ARCA compara contra el asociado: mismo tipo de exportación (2049), mismo país de destino (2050), misma moneda o pesos (2051) y la misma cotización (2053). Además, una nota de débito solo ajusta una factura (2041, 2042) y una nota de crédito, una factura o una nota de débito (2045).

#### Qué no aplica

Las notas `E` no llevan fecha de pago (ARCA la rechaza, error 1673), `--misma-moneda` (1605) ni `--permiso-existente` (`Permiso_existente` va vacío, 1550): `nce` y `nde` no tienen esos flags. En las de bienes (`--tipo-expo 1`), los permisos de embarque son opcionales y van con `--permiso`, sin `--permiso-existente`. En `arcli nota-credito e` y `nota-debito e` los flags de A, B y C se saltean con un aviso, igual que en `factura e`.

#### Ejemplos

```bash
arcli nde -m 200 --ar 1 --apv 4 --item "001|Ajuste de precio|1|200|unidades" --previsualizar
arcli nce -m 100 --ac nde --ar 1 --emitir --json
```

El PDF se guarda como `nota-credito-e_<pv>-<numero>.pdf` o `nota-debito-e_<pv>-<numero>.pdf`, con el comprobante asociado.

## Ejemplos útiles

### `arcli ejemplos`

Muestra ejemplos seguros y listos para copiar de todos los comprobantes soportados.

```bash
arcli ejemplos
```

La salida incluye versión mínima, versión completa, forma larga y forma corta para cada comprobante. Todos usan `--previsualizar` para evitar emisiones reales por error.

### Básico (manual)

```bash
arcli fc -m 300000 --cs --consumidor-final
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

| Comando                           | Argumentos                                                 | Flags                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `arcli ultimos <tipo>`            | `tipo`: atajo del comprobante (`fa`, `fb`, `nca`, `fcea`…) | `--cantidad <n>` (1 a 50; por defecto `config.filasPorLista` o 15), `--pv` / `--punto-venta`, `--json`, `--testing`, `--produccion` |
| `arcli consultar <tipo> <numero>` | `tipo` y número del comprobante                            | `--pv` / `--punto-venta`, `--json`, `--testing`, `--produccion`                                                                     |

`consultar` muestra el CAE, el receptor, los importes con sus alícuotas y tributos, y, si los tiene, el período de servicio, el vencimiento del pago, el comprobante asociado de una nota (o su período asociado), si se cobra en la misma moneda extranjera, los datos de FCE (CBU, alias, transferencia, anulación) y las observaciones de ARCA.

Sin `--pv` usan el punto de venta de la config. Aceptan también la `E` (`fe`, `nde`, `nce`), que se consulta en WSFEX con su certificado. Si el comprobante no existe, `consultar` termina con el error `VOUCHER_NOT_FOUND`. Si en A, B, C, FCE o un recibo ARCA contesta con un error, o en cualquier tipo sin los datos del comprobante, los dos comandos terminan con `ARCA_VOUCHER_QUERY_ERROR`: no se sabe si el comprobante existe, y `ultimos` no muestra una lista incompleta. Una `E` que existe y ARCLI no pudo leer es la excepción: `consultar` falla diciendo que existe, y `ultimos` la saltea con un aviso. El formato del JSON está en [Entrada y salida](input-output.md#comprobantes-emitidos-ultimos-y-consultar).

## Consultar el régimen FCE

`arcli fce-obligado <cuit>` le pregunta a ARCA si un receptor está obligado a recibir Factura de Crédito Electrónica y desde qué monto. Con eso sabés si corresponde `fa/fb/fc` o `fcea/fceb/fcec`.

```bash
arcli fce-obligado 30546689979
arcli fce-obligado 30546689979 --fecha 15/10 --json
```

| Flag                                  | Alias   | Descripción                                                                       |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `--fecha <fecha>`                     | `-f`    | Fecha de emisión a consultar; por defecto hoy. También `hoy`, `ayer`, `+N` o `-N` |
| `--json`, `--testing`, `--produccion` | ninguno | Flags globales                                                                    |

Usa el servicio `wsfecred`, que hay que autorizar aparte de `wsfe`. Ver [Autorizar el servicio web](certificado-testing-completa.md#3-autorizar-el-servicio-web).

Si activás `arcli config establecer verificarFce true`, la misma consulta corre en cada factura con CUIT del receptor y deja un aviso si el comprobante no coincide con el régimen. Por ejemplo, una `fa` a un receptor obligado por encima del mínimo. El aviso no frena la emisión. Ver [Régimen FCE del receptor](validation-rules.md#régimen-fce-del-receptor).

El JSON está en [Entrada y salida](input-output.md#régimen-fce-fce-obligado).

## Consultar el padrón

`arcli padron <cuit>` muestra lo que ARCA tiene de un CUIT: nombre o razón social, domicilio fiscal, condición frente al IVA, impuestos, categoría de monotributo (la letra, el tipo de actividad y desde qué mes rige) y actividad principal.

```bash
arcli padron 20201797064
arcli padron 20201797064 --json
```

| Flag                                  | Alias   | Descripción    |
| ------------------------------------- | ------- | -------------- |
| `--json`, `--testing`, `--produccion` | ninguno | Flags globales |

La condición IVA sale de los impuestos activos: monotributo es `responsable-monotributo`, IVA es `responsable-inscripto` e IVA exento es `sujeto-exento`. Con otros datos queda sin informar (`condicionIva: null`). Si el CUIT no está en el padrón, termina con el error `TAXPAYER_NOT_FOUND`. En testing el padrón tiene datos ficticios: `20201797064` devuelve datos completos y `20333333334` es un monotributista. El JSON está en [Entrada y salida](input-output.md#padrón-padron).

Usa el servicio `ws_sr_constancia_inscripcion`, que hay que autorizar aparte de `wsfe`. Ver [Autorizar el servicio web](certificado-testing-completa.md#3-autorizar-el-servicio-web).

### IVA receptor desde el padrón

Al facturar con `--cuit` sin `--ir` (ni `ivaReceptor` en el JSON), ARCLI consulta el padrón y usa esa condición IVA, aunque la config tenga un `ivaReceptor` por defecto. También completa el nombre y el domicilio del receptor para el PDF, si no los pasaste. La vista previa lo marca: `IVA receptor   Responsable inscripto (padrón)`.

| Caso                                            | Resultado                                                   |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `--ir`, `--ir-*` o `ivaReceptor` en el JSON     | Se usa ese valor; no se consulta el padrón                  |
| El padrón informa la condición                  | Se usa la del padrón                                        |
| El padrón no responde o no informa la condición | Se usa `ivaReceptor` de la config, con un aviso en `avisos` |
| Lo mismo, sin `ivaReceptor` en la config        | Error `INPUT_VALIDATION_ERROR`: indicala con `--ir`         |

Para no consultarlo: `arcli config establecer consultarPadron false`. El modo interactivo hace la misma consulta al cargar un CUIT y propone esa condición, marcada "(según el padrón)".

## Categorías del monotributo

`arcli monotributo` muestra las 11 categorías (A a K) con el tope de ingresos anuales y la cuota mensual de servicios y de ventas. Si el CUIT de la config es monotributista, su fila sale marcada con `❯` y "tu categoría".

```bash
arcli monotributo
arcli monotributo --categoria E
arcli monotributo --completa
arcli monotributo --actualizar
arcli monotributo --json
```

| Flag                                  | Alias   | Descripción                                                                                     |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `--categoria <letra>`                 | ninguno | Una categoría completa: límites anuales, cuota mensual con su desglose y la categoría siguiente |
| `--completa`                          | ninguno | Todas las columnas, en dos bloques: límites anuales y cuota mensual en pesos                    |
| `--actualizar`                        | ninguno | Vuelve a leer la tabla en la página de ARCA y tu categoría en el padrón                         |
| `--json`, `--testing`, `--produccion` | ninguno | Flags globales                                                                                  |

`--categoria` acepta una letra de la A a la K, en mayúscula o minúscula; otra cosa es `INPUT_VALIDATION_ERROR`. No se usa junto con `--completa`.

**De dónde sale la tabla.** ARCA no tiene un web service con las categorías: ARCLI lee la [página de categorías](https://www.afip.gob.ar/monotributo/categorias.asp), que es pública y no usa el certificado, y la guarda en la carpeta de config (`monotributo.json`) con la fecha de consulta y la de vigencia. La lee la primera vez que corrés el comando y después solo con `--actualizar` (o "Actualizar desde ARCA" en el modo interactivo). ARCLI trae además una tabla incluida, con los valores vigentes al publicarse la versión: se usa si no hay conexión, si la página cambió y no se puede leer, o si es más nueva que la guardada.

Antes de usar lo leído, ARCLI lo controla: 11 filas de la A a la K, topes que crecen y cuotas que son la suma de impuesto integrado, aporte jubilatorio (SIPA) y obra social. Si algo no da, descarta la lectura, avisa y sigue con la guardada o la incluida. Los avisos salen arriba de la tabla, en stderr:

| Situación                                               | Aviso                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sin conexión, ARCA no respondió a tiempo o dio un error | "No se pudo consultar la tabla en ARCA (sin conexión). Se muestra la incluida en ARCLI x.y.z, vigente desde el …"     |
| La página cambió y no pasa el control                   | "La página de ARCA cambió y ARCLI no pudo leer la tabla. Se usa la guardada el …. Si sigue, avisanos en GitHub: …"    |
| Ya pasó el 1/2 o el 1/8 y la tabla rige desde antes     | "ARCA actualiza las categorías en febrero y agosto. La tabla guardada es del … y puede haber una nueva. Actualizala…" |

**Tu categoría.** Sale del padrón (`ws_sr_constancia_inscripcion`) con el CUIT y el certificado de la config, en el entorno activo. Se consulta una vez y se guarda junto con la tabla; `--actualizar` la vuelve a leer. Sin certificado, sin el servicio autorizado o si el CUIT no es monotributista, no se marca ninguna fila y el comando sigue igual. En testing el padrón tiene datos ficticios, así que tu CUIT real no aparece.

**Tu tope.** Con `monotributo.tope` en la config (ver [Configuración](configuration.md)), la tabla lo muestra debajo, junto a la fuente.

En una terminal angosta, cada categoría ocupa dos líneas: el tope arriba y las dos cuotas abajo. El JSON está en [Entrada y salida](input-output.md#categorías-del-monotributo-monotributo).

## Autocompletado

Completa con Tab comandos, flags y valores en bash, zsh y fish: atajos (`arcli ultimos nc<Tab>`), flags (`arcli fc --ir-<Tab>`), valores de `--iva-receptor`, `--concepto`, `--alicuota`, `--moneda`, `--transferencia` y `--ac`, claves de config y sus valores (`arcli config establecer entorno <Tab>`), tablas de `parametros` y letras de las familias. Donde va una ruta (`--cargar`), completa archivos.

```bash
arcli completado instalar        # con el shell de $SHELL; o: arcli completado instalar zsh
arcli completado                 # ¿está instalado?
arcli completado desinstalar
```

`arcli completado instalar` agrega al archivo de inicio del shell una línea marcada con un comentario `# arcli` y `desinstalar` saca solo eso:

| Shell | Archivo                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| zsh   | `~/.zshrc` (o `$ZDOTDIR/.zshrc`)                                                                                                                    |
| bash  | `~/.bashrc`; en macOS, el primero que exista de `~/.bash_profile`, `~/.bash_login` y `~/.profile`                                                   |
| fish  | `~/.config/fish/completions/arcli.fish`, o `$XDG_CONFIG_HOME/fish/completions/arcli.fish` si está definida (archivo propio; `desinstalar` lo borra) |

Pedir el comando ya es la confirmación: no vuelve a preguntar, como `arcli pdf instalar`. Con `--json` devuelve `{ "cambio", "instalado", "ruta", "shell" }`. Si no se puede saber el shell, da `INPUT_VALIDATION_ERROR` y hay que indicarlo. Un programa no puede cambiar la terminal que ya está abierta: después de instalar, abrí una nueva.

`arcli completado <bash|zsh|fish>` solo imprime el script, para instalarlo a mano. Cada Tab le pregunta a la versión instalada qué sigue, así que después de actualizar ARCLI no hay que reinstalar nada. En el modo interactivo está en Configuración → Autocompletado.

## Acceso directo

Crea un ícono que abre ARCLI en su modo interactivo con doble clic, sin escribir comandos:

```bash
arcli acceso-directo                # en el escritorio
arcli acceso-directo ~/Documentos   # en otra carpeta, que tiene que existir
```

| Sistema | Qué crea        | Dónde quedan el lanzador y el ícono              |
| ------- | --------------- | ------------------------------------------------ |
| macOS   | `ARCLI.app`     | Dentro de la `.app`                              |
| Windows | `ARCLI.lnk`     | En `acceso-directo/`, junto al archivo de config |
| Linux   | `ARCLI.desktop` | En `acceso-directo/`, junto al archivo de config |

Abre una terminal con ARCLI. Si termina con un error, la ventana espera un Enter para que se pueda leer. Con `--json` devuelve `{ "reemplazado", "ruta", "usaArcliInstalado" }`.

- **Creado desde el código fuente** (`yarn dev acceso-directo`): abre el `arcli` instalado en lugar del `.ts` del repo, que Node no puede correr sin el cargador de `yarn dev`. Lo avisa al crearlo y en `usaArcliInstalado`. Si no hay un `arcli` instalado, el ícono avisa que falta instalarlo.

- **Repetirlo:** actualiza el acceso directo de esa carpeta. En macOS y Linux, si ya hay un archivo con ese nombre que no creó ARCLI, da `INPUT_VALIDATION_ERROR` y no lo toca.
- **Si cambiás Node o ARCLI de lugar:** el acceso directo guarda sus rutas al crearse. Si ya no están, prueba con el `arcli` del `PATH`; si tampoco anda, volvé a correr el comando.
- **Quitarlo:** borrá el ícono como cualquier archivo.
- En el modo interactivo está en Configuración → Acceso directo en el escritorio.

## Configuración

Comandos `config` y claves disponibles: [Configuración](configuration.md).

## Estabilidad

Todos los comandos de esta referencia son estables, salvo `storybook`, una herramienta interna de desarrollo que no aparece en la ayuda ni en `llms.txt`.

## Ver también

- Cada comprobante, con sus opciones: [¿qué comprobante me toca?](comprobantes/README.md). Casos completos paso a paso: [monotributo](comprobantes-monotributo.md), [responsable inscripto](comprobantes-responsable-inscripto.md), [notas](notas-credito-debito.md), [FCE](fce.md), [exportación](exportacion.md) y [lotes](lotes-y-json.md).
- [Reglas de validación](validation-rules.md) y [Troubleshooting](troubleshooting.md): qué rechaza el CLI y cómo resolverlo.
