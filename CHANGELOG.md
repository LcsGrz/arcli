[← Volver al README](README.md)

# Changelog

Todos los cambios relevantes de ARCLI se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/). Cada versión arranca con un resumen (su primera oración es la que muestra el aviso de actualización de ARCLI) y lo más importante, con un comando para probarlo. Como el contrato del CLI es público (comandos, flags, claves de config y `--json`), si algo puede afectar scripts lo dice un aviso, que cierra con lo que no cambia. Después vienen los cambios por sección, uno por línea y con su PR, y el detalle completo, plegado al final de cada sección.

## [Sin publicar]

> [!WARNING]
> **Puede afectar scripts**
>
> - Si ARCA contesta con un error al consultar un comprobante A, B, C, FCE o recibo, `consultar` sale con `ARCA_VOUCHER_QUERY_ERROR`, antes `VOUCHER_NOT_FOUND`.
> - En el mismo caso, `ultimos` sale con `ARCA_VOUCHER_QUERY_ERROR` y exit code `1`, antes `0` con la lista vacía o incompleta.
> - En el mismo caso, una nota A, B, C o FCE que frenaba con "ARCA no tiene…" sigue con un aviso y, con `--emitir`, se emite. Si el punto de venta es de otro sistema ya seguía: cambia el texto del aviso.
> - Una falla con "no existe" en el texto (`El dominio no existe`) ya no es `VOUCHER_NOT_FOUND`: sale con su error, por ejemplo `UNEXPECTED_ERROR`. Por el asociado de una nota es un aviso, y en FCE sin `--afecha` frena.
> - Si de lo que ARCA contestó al emitir no se puede saber si hay CAE (la `E` sin respuesta, o un CAE que no es texto ni número), sale `EMISSION_UNCERTAIN`, antes `UNEXPECTED_ERROR`. Si A, B y C contestan vacío ya era `EMISSION_UNCERTAIN`: cambia el texto de `error` y `detalles.causa`, también si contesta HTML o XML cortado (antes `[object Object]`).
> - Si ARCA contesta la consulta de una `E` sin sus datos, `consultar` sale con `ARCA_VOUCHER_QUERY_ERROR`, antes `VOUCHER_NOT_FOUND`; `ultimos` también, con exit code `1`, antes `0` con la lista incompleta; y una nota `E` sobre ella, antes `INPUT_VALIDATION_ERROR`. Si vino con su número y su CAE, `ultimos` la muestra en su lugar (en `--json`, solo `numero`, `cae` y `error`), antes la salteaba, y avisa, con `--json` en stderr.
> - Si ARCA contesta a la emisión sin CAE y sin un rechazo, sale `EMISSION_UNCERTAIN` con exit code `1` y un lote se corta ahí. Antes: vacía, `estado: "observado"` y `0`; aprobada u observada sin CAE, `aprobado` u `observado` y `0`; y con errores internos (500, 501 o 502; en la `E`, también 1000) o, en A, B y C, sin código, `rechazado` y `2`. En la `E`, un error sin código salía `observado` o `aprobado` y `0`, y sin `ErrCode` no se mostraba.
> - Si ARCA contesta `R` y un CAE legible, sale `EMISSION_UNCERTAIN`, con el CAE en `error` y `detalles.causa`; antes `rechazado` y `2`, en A, B y C sin el CAE.
> - Si ARCA da el CAE y además informa un error, `estado` es `observado` con exit code `0`, antes `rechazado` y `2`. `sugerencias` ya no trae las del error. En la `E` vale también para un error sin código, antes `aprobado` u `observado` y `0`. Una observación con CAE tampoco sugiere ya emitir de nuevo.
> - Un CAE de texto en ceros cuenta como sin CAE y uno que no se puede leer (`NULL`) da `EMISSION_UNCERTAIN` (en un rechazo, `null`); antes salían como `cae`.
> - En A, B y C, un rechazo sin `resultado` y sin otra sugerencia trae en `sugerencias` la de revisar antes de volver a emitir; antes `[]`.
> - Si en A, B y C ARCA rechaza en la cabecera, sin el resultado del detalle, `estado` es `rechazado` con exit code `2` (con un CAE legible, `EMISSION_UNCERTAIN`); sin errores, antes era `observado` y `0`.
> - `caeVencimiento` es `null` si ARCA no mandó una fecha, en A, B y C también, o si no hay CAE, en la `E` también; antes salía tal cual.
> - En una consulta (`ultimos`, `consultar`, `parametros`, `padron`…), la `sugerencia` de `TRANSIENT_ERROR` y, en `ultimos`, la de `ARCA_LAST_VOUCHER_ERROR` dicen que repitas la consulta, no la emisión; antes, "reintentá la emisión" y "No se emitió nada". Los códigos no cambian.
> - Con el certificado sin autorizar, `parametros` sale con `WSFE_SERVICE_NOT_AUTHORIZED` y `ultimos` de una `E` con `WSFEX_SERVICE_NOT_AUTHORIZED`, antes `UNEXPECTED_ERROR`. `estado` sigue en `ARCA_UNAVAILABLE`, con otro texto.
> - Un documento del receptor o un punto de venta inválido sale con `INPUT_VALIDATION_ERROR` antes de consultar a ARCA: si además fallaba la red o el padrón, antes salía ese error.
> - Si falla el padrón al facturar sin IVA receptor, o la consulta del asociado de una nota FCE sin `--afecha`, `detalles` es `{ "codigoCausa": "…" }`, antes `null`. `codigo`, `error` y `sugerencia` no cambian.
> - Si no se puede escribir stdout, con `--json` sale el código nuevo `OUTPUT_WRITE_ERROR`, que puede traer comprobantes ya emitidos en `sugerencia`: no los reemitas. Un rechazo con el disco lleno sale con `2`, antes `1`.
> - Con otra clave inválida en el `config.json`, `config establecer` y `config eliminar` guardan el cambio y salen con `0`, sin las claves rotas en el JSON y con `avisos`; antes, `INPUT_VALIDATION_ERROR` y `1` sin guardar.
> - Sin permiso para leer el pedido pendiente, `certificado generar` sin `--reemplazar` sale con `UNEXPECTED_ERROR` y `1`; antes lo pisaba y salía con `0`.
> - Con `--cuit`, `--cuil`, `--dni` o `--cfinal` de otro receptor que el del JSON ya no van su IVA, nombre ni domicilio: pasá `--ir`, `--receptor-nombre` y `--receptor-domicilio`. Sin IVA, con el padrón apagado o con DNI, `INPUT_VALIDATION_ERROR`.
> - En una FCE, `aliasCbu` de la config va solo si el CBU es el de `cbu`; si usás otro CBU, o no tenés `cbu` en la config, pasá `--alias`. El del JSON no va con un `--cbu` distinto del suyo.
> - Con `--moneda` de otra moneda que la del JSON, `cotizacionMoneda` ya no se usa: va la oficial de ARCA. Para otra, `--cm`.
> - En una nota, `--ac`, `--at`, `--ar` o `--apv` de otro comprobante que el del JSON descartan su `fecha` y su `cuit`: pasá `--afecha` y `--acuit`.
> - En la `E`, otro `--cliente` descarta `domicilioCliente` e `idImpositivo` del JSON: pasá `--domicilio-cliente` e `--id-impositivo`. Otro `--pais-destino` descarta `cuitPais` y otro `--incoterm`, `descripcionIncoterm`.
> - En las notas `E`, con otro cliente, país o incoterm que el asociado, también sin `--cargar`, no se heredan su domicilio e ID impositivo, su CUIT del país o su descripción: pasá `--domicilio-cliente` (sin él, `INPUT_VALIDATION_ERROR`) y los demás. `--moneda` descarta una `cotizacionMoneda` sin `codigoMoneda`.
> - `config establecer cbu` y `aliasCbu` quedan deprecadas hasta la 3.0.0, con un aviso en stderr: usá `config establecer cuenta <CBU> [ALIAS]`. En `--json` y en el archivo, `cbu` y `aliasCbu` no cambian.
> - `config establecer cbu` con otro CBU que el guardado borra `aliasCbu` y lo dice en `avisos`; antes el alias quedaba. Sin CBU guardado, el alias queda, con un aviso. `config eliminar cbu` borra también `aliasCbu` y lo dice en `avisos`; antes quedaba.
> - Ya no son un error y gana el flag: `--ac`, `--at`, `--ar` o `--apv` con `periodoAsociado` en el JSON, `--periodo-desde` o `--periodo-hasta` con `comprobanteAsociado`, `--vto` con `dia` y `--dia` con `vencimientoPago`.
> - En `BATCH_EMISSION_ERROR`, `sugerencia` es siempre un texto, antes `null`, y en `error` "Sin procesar" va en su propia línea, como rango desde tres (`#3 a #100 (98)`). La lista completa sigue en `detalles.sinProcesar`.
> - Si una tabla auxiliar de WSFEX no responde y lo que se emite no sale de ella, los comandos de la `E` y sus notas siguen con un aviso y, con `--emitir`, se emiten; antes salían con el error de la consulta.
> - Una nota A, B, C o FCE sin `--apv` toma el punto de venta de la nota y, con `--emitir`, se emite; antes, `INPUT_VALIDATION_ERROR`. Sigue siendo error si el asociado es de otro CUIT.
> - En una nota, `E` incluida, con `--ac`, `--at` o `--ar` de otro comprobante que uno de CUIT ajeno del JSON, su `puntoVenta` tampoco va: sin `--apv`, o `--acuit` propio, `INPUT_VALIDATION_ERROR`; antes se usaba.
> - En una nota, si el JSON trae el `cuit` del asociado, un `--acuit` que lo cambia entre propio y ajeno descarta su `fecha`: pasá `--afecha`.
> - En una nota, si el asociado del JSON no trae `puntoVenta`, `--apv` o `--pv` de otro punto de venta descartan su `fecha`: pasá `--afecha`.
> - Un comprobante A, B, C, FCE o recibo que ARCA devuelve con su número y su CAE pero no se puede leer: `ultimos` lo trae en su lugar, en `--json` solo con `numero`, `cae` y `error`, y avisa, con `--json` en stderr, y `consultar` sale con `ARCA_VOUCHER_QUERY_ERROR`, antes `VOUCHER_NOT_FOUND`.
> - `estado` suma `servidoresExportacion`, `null` si WSFEX no responde. `listo` y el exit code no cambian.
> - `--testing` con `--produccion` sale con `INPUT_VALIDATION_ERROR` en todos los comandos, antes `CONFIGURATION_ERROR` en casi todos. `error` y el exit code `1` no cambian.
> - En la `E`, `WSFEX_SERVICE_NOT_AUTHORIZED` y el asociado que ARCA no tiene dicen qué hacer en `sugerencia`, antes al final de `error`. `ARCA_EXPORT_ERROR` por el ID de solicitud trae `sugerencia`, antes `null`.
> - En la `E`, `detalles` es `{ "campos": […] }` con un dato inválido en `--cargar` y `{ "errores": [] }` en `ARCA_QUOTATION_ERROR`; antes `null`.
> - `detalles.errores[].code` y `.msg`, de los errores de `wsfe`, quedan deprecadas hasta la 3.0.0, con un aviso en `detalles.deprecado`: usá `codigo` y `mensaje`.
> - En los comandos de la `E` con `exportacion.cert` propio, `avisos` ya no trae el vencimiento del certificado general de ese entorno.
>
> No se saca ni se renombra ningún comando, flag ni clave de config o de `--json`. Un comprobante que no existe sigue siendo `VOUCHER_NOT_FOUND`.

---

### ✨ Agregado

- **Config:** `config establecer cuenta <CBU> [ALIAS]` guarda el CBU y su alias juntos, y `config eliminar cuenta` borra los dos (#284).

<details><summary>Detalle</summary>

**La cuenta de la FCE.** El CBU y el alias se guardaban con dos comandos, y el orden importaba. Ahora `arcli config establecer cuenta <CBU> [ALIAS]` guarda los dos o ninguno. Sin alias borra el guardado, aunque el CBU sea el mismo, y lo avisa: en stderr, o en `avisos` con `--json`. `config eliminar cuenta` borra los dos y avisa si había un alias. En la ayuda, el autocompletado y `arcli config`, `cuenta` reemplaza a las dos claves; "Modificar configuración" del asistente tiene una sola opción, que pide el CBU y después el alias: con el mismo CBU, Enter deja el alias guardado y `-` lo borra; con otro, Enter lo omite y borra el anterior, y la pregunta lo dice. El archivo, `arcli config --json`, `--cbu`, `--alias` y `--cargar` no cambian.

</details>

### 🔧 Cambiado

- **Factura E:** en el asistente, el país de destino y el CUIT del país se eligen de una lista con filtro donde también podés escribir (#257).
- **Factura E:** en el asistente, "¿Cómo te pagan?" arranca en pesos, como A, B y C; antes, en dólares. "Repetir" propone lo de la factura (#286).
- **Notas:** sin `--apv`, el asociado de A, B, C y FCE es del punto de venta de la nota, como en la `E` (#288).
- **Consultas:** `estado` y "Estado de ARCA" muestran también los servidores de exportación, WSFEX (#288).
- **Asistente:** "Repetir" A, B, C, FCE o recibo dice qué copia y propone cómo te pagaron, como la `E` (#288).
- **Factura E:** el asistente ofrece euros y las demás monedas de A, B y C que acepta WSFEX, no solo dólares y pesos (#286).
- **Notas:** en el asistente, una nota `E` sobre un comprobante en otra moneda puede ir en pesos, como en A, B y C (#286).
- **PDF:** en el asistente, la condición de venta se elige o se escribe en la misma lista, sin la pregunta aparte de "Otra" (#257).
- **Factura E:** en el asistente, la actividad de WSFEX y la forma de pago se eligen de una lista donde también podés escribir (#261).
- **Config:** en "Modificar configuración", la moneda y la actividad de exportación se eligen de una lista donde también podés escribir (#261).
- **FCE:** el error de un alias del CBU inválido dice lo mismo en los flags, `--cargar`, la config y el asistente (#262).
- **Facturas:** un flag que cambia a quién, qué comprobante o qué moneda descarta del JSON de `--cargar` lo que dependía del anterior (#282).
- **FCE:** el alias guardado va solo con su CBU, y el asistente siempre pide el alias si pide el CBU (#282).
- **Factura E:** otro `--cliente`, `--pais-destino`, `--incoterm` o `--moneda` descarta del JSON los datos del anterior, también en sus notas (#282).
- **Notas:** una nota `E` con otro cliente, país o incoterm que su asociado ya no toma su domicilio, ID impositivo, CUIT ni descripción (#282).
- **Config:** `config establecer cbu` con otro CBU borra el `aliasCbu` del anterior, y `config eliminar cbu` también; lo avisan (#282, #284).
- **Notas:** un flag del comprobante o del período asociado gana al otro del JSON, y una punta del período conserva la otra (#282).
- **Salida:** A, B, C, FCE, recibos y notas muestran "Consultando ARCA..." mientras se consulta antes de la vista previa, como la `E` (#283).
- **Fechas:** con una fecha futura, A, B, C, FCE, recibos y notas avisan desde qué fecha van los siguientes, como la `E` (#287).
- **Factura E:** sin `--cm` avisa siempre que usa la cotización oficial, y con una fuera del 2 % al 400 %, también (#287).
- **Factura E:** si una tabla auxiliar de WSFEX no responde, los comandos y la vista previa avisan y siguen, salvo que emitan algo suyo (#287).
- **Certificados:** el propio de exportación avisa que vence en los comandos y el asistente, y dice cómo renovarlo (#287).
- **Fechas:** en un lote que cruza la medianoche, `hoy` y las demás fechas relativas son del mismo día en todos los comprobantes (#282).
- **Asistente:** en producción pregunta una sola vez antes de emitir, como los comandos (#289).

<details><summary>Detalle</summary>

**País y CUIT del país de la `E`.** Antes se escribían: el país por nombre o código, y el CUIT por número o buscando el país, que abría una segunda lista. Ahora cada uno es una lista que se filtra escribiendo, con el código o el CUIT a la izquierda; si lo escrito no es una opción, "Usar lo escrito" lo valida como `--pais-destino` o `--cuit-pais`. El CUIT del país trae solo los que acepta `--cuit-pais` para el destino, y en la factura la primera opción, "Sin CUIT del país (solo ID impositivo)", lo deja vacío. "Repetir" E usa la misma lista para el CUIT, sin ninguno marcado la primera vez: es un dato fiscal y Enter vacío pide elegirlo. Los flags, `--cargar`, el `--json` y el comando equivalente no cambian.

**Cómo te pagan una `E`.** El asistente preguntaba "¿Te pagan en dólares?" con Sí primero, así que Enter mandaba `CanMisMonExt` en `S`. Ahora pregunta "¿Cómo te pagan?", con "En pesos" primero: Enter manda `N`, como `arcli fe` sin `--misma-moneda`. "Repetir" copiaba el dato sin preguntar; ahora pregunta siempre que la factura sea en moneda extranjera, con lo que informó marcado o, si ARCA no lo devolvió, "En pesos". Los comandos no cambian.

**Punto de venta del asociado.** En las notas A, B, C y FCE había que pasar siempre `--apv`. Ahora, sin él, es el de la nota (`--pv` o la config), también en `--cargar`; `--ac` o `--at` y `--ar` siguen siendo obligatorios. Si el asociado es de otro CUIT, `--apv` se sigue pidiendo. Si el JSON no dice el punto de venta del asociado y `--apv` o `--pv` lo cambian, su `fecha` del JSON no va; tampoco si el JSON trae su `cuit` y `--acuit` lo cambia entre propio y ajeno. Con otro tipo o número que los de un asociado ajeno del JSON no va su punto de venta ni el de la nota: hay que pasar `--apv`, o `--acuit` si es tuyo, también en la `E`. Si el asociado existe pero ARCLI no pudo leerlo, la nota sigue con un aviso de lo que queda sin controlar; una FCE sin `--afecha` frena y pide la fecha.

**WSFEX en `estado`.** Una línea más, "Exportación (WSFEX)", y en `--json` el campo `servidoresExportacion`, con la forma de `servidores`. Se consulta a la par, sin autenticación. Si falla o no contesta en 5 segundos dice "sin respuesta" (`null`), y `listo`, el exit code y el resto no cambian.

**"Repetir" A, B, C, FCE y recibos.** Al elegir el comprobante, un aviso dice qué se copia. En moneda extranjera, "¿Cómo te pagan?" arranca en lo que informó el original.

**Monedas de la `E`.** La lista es la de A, B y C, limitada a las monedas de la tabla de WSFEX, con los dólares primero. La cotización, la pregunta de cobro y el comando equivalente valen para cualquiera. Si ARCA no devuelve la tabla, quedan dólares, pesos o escribir el código. Si no publica la cotización de aduana de la moneda, en bienes y otros cobrados en pesos la escribís; en servicios o cobrada en la moneda, el asistente avisa y vuelve a elegirla. Si el error aparece en la vista previa (`ARCA_QUOTATION_ERROR`), también en A, B y C, ya no se pierde lo respondido.

**Notas `E` en pesos.** Si el comprobante que ajusta no está en pesos, el asistente pregunta "¿En qué moneda va la nota?": la suya, por defecto, o pesos. En pesos va con cotización 1, sin el tope del total, y los ítems se cargan en vez de copiarse. El comando equivalente lleva `--moneda PES`.

**Condición de venta.** En el PDF del asistente y en "Modificar configuración", la condición de venta es una lista donde también se escribe un texto propio, que se guarda o se imprime tal cual. Un texto propio guardado arranca escrito, sin la opción "Mantener: …". En el PDF, "Omitir" sigue primera y Esc no genera el PDF. Si ARCA no devuelve los incoterms, el incoterm de la `E` se escribe en la misma pregunta, como antes.

**Actividad y forma de pago de la `E`.** Antes se escribían. Ahora la actividad es una lista con la tabla de WSFEX, código y descripción, que se filtra escribiendo el código (`6201`) o parte de la descripción (`consultores`); arranca en "Sin actividad (no se informa)", así que Enter la deja sin informar como antes, y un código escrito se valida contra la tabla como `--actividad`. Si ARCA devuelve la tabla vacía, se escribe. "Repetir" E usa la misma lista cuando la factura no trae actividad. La forma de pago arranca en "Transferencia Internacional" y sugiere Pago anticipado, Carta de crédito, Cobranza documentaria y Cuenta corriente; cualquier otro texto de hasta 50 caracteres vale, como `--forma-pago`, y lo escrito gana: "Transferencia" va tal cual, aunque una sugerencia lo contenga. Lo mismo en la condición de venta del PDF y de la config. Las notas E no las preguntan, y los flags, `--cargar`, el `--json` y el comando equivalente no cambian.

**Flags sobre el JSON de `--cargar`.** Antes un flag cambiaba solo su dato: con `--cuit` de otro cliente salían el nombre, el domicilio y el IVA del que traía el archivo, y con `--moneda EUR` sobre un archivo en dólares, la cotización del dólar. Ahora, si el flag dice algo distinto del archivo, lo que dependía del valor anterior no va. Con otro documento, el IVA sale del padrón o de la config, o es el error de falta de IVA; pasalo con `--ir`, y el nombre y el domicilio con sus flags. Con otra moneda va la cotización oficial de ARCA, aunque la config tenga `cotizacion`; para otra, `--cm`. `--vto` gana a `dia` del archivo y `--dia` a `vencimientoPago`. El mismo valor, o uno que el archivo no trae, no descarta nada; en un lote se decide por comprobante. La lista completa está en [Datos del JSON que un flag descarta](docs/validation-rules.md#datos-del-json-que-un-flag-descarta).

**Alias del CBU.** Con `--cbu` o `cbu` del JSON de otra cuenta se informaba el `aliasCbu` de la config, que es de la guardada. Ahora va solo con su CBU: si el tuyo tiene alias, pasalo con `--alias` o `aliasCbu` del JSON. Un alias guardado sin `cbu` en la config ya no se usa hasta que guardes los dos con `arcli config establecer cuenta`. El asistente, si pide el CBU, pide también el alias (Enter lo omite). Al ofrecer guardar el CBU después de emitir, si lo omitiste y la config tiene un alias de antes, la pregunta dice que se borra; con uno escrito, se guardan los dos.

**Cambiar el CBU guardado.** `arcli config establecer cbu` con otro CBU dejaba el `aliasCbu` del anterior. Ahora lo borra en el mismo cambio y dice cuál era y cómo guardar el nuevo con `cuenta`: en stderr, o en `avisos` con `--json`. Con el mismo CBU no cambia nada; sin CBU guardado antes, el alias queda, porque puede ser el suyo, y el aviso dice que se va a usar. `config eliminar cbu` dejaba el alias y ahora lo borra y lo avisa; `config eliminar aliasCbu` sigue borrando solo el alias.

**Notas `E` y su asociado.** Una nota con otro `--cliente` que su asociado salía con el domicilio y el ID impositivo del asociado; con otro `--pais-destino`, con su CUIT del país; y con otro `--incoterm`, con su descripción. Ahora no los toma, vengan de flags o del archivo: hay que pasarlos, salvo el CUIT del país, que sale de la tabla de ARCA. El mismo dato, con otras mayúsculas, tildes o espacios, o el país por nombre o por código, hereda como antes. `EUR` y `060` (y los demás equivalentes) son la misma moneda: con `--moneda EUR` sobre una factura en `060` va su cotización; antes iba la oficial, que en servicios es el error 2053. Sin `codigoMoneda` en el archivo, `--moneda` descarta siempre `cotizacionMoneda`. La actividad y el asistente no cambian.

**`E` y sus notas.** Con otro `--cliente` ya no van `domicilioCliente` ni `idImpositivo` del archivo; el país se conserva. Con otro `--pais-destino` no va `cuitPais`, que sale de la tabla de ARCA; en el archivo, un código y un nombre del mismo país se toman por distintos. Con otro `--incoterm` no va su descripción, y con otra `--moneda`, la cotización (sin `codigoMoneda`, en la factura el archivo está en `DOL`). `--cm` descarta `mismaMoneda` del archivo y `--misma-moneda`, `cotizacionMoneda`, como en A, B y C. En las notas, `--ac` y `--at` descartan `tipo` y `atajo` del archivo, y con otro comprobante no va su `cuit`.

**Asociado de las notas.** Si `--ac`, `--at`, `--ar` o `--apv` apuntan a otro comprobante que el del archivo, su `fecha` y su `cuit` no van: pasá `--afecha` y `--acuit` si hacen falta. Además descartan `periodoAsociado`, y `--periodo-desde` y `--periodo-hasta` descartan `comprobanteAsociado`; antes, juntos eran un error. `--acuit` o `--afecha` solos no eligen. Con una sola punta del período en los flags, la otra sale del archivo; antes se perdía.

**Consultando ARCA.** Con el padrón, la cotización, el asociado de una nota o el régimen FCE, los comandos y el asistente quedaban sin señal hasta la vista previa. Ahora giran con "Consultando ARCA..." si hay una consulta en curso. No aparece con `--json` ni sin terminal.

**Fecha futura.** ARCA numera en orden de fecha: después de un comprobante con fecha futura, los de ese tipo y punto de venta no pueden ir con una anterior (10016; en la `E`, 1535). La `E` ya lo avisaba en la vista previa; ahora también A, B, C, FCE, recibos y notas, en comandos, en cada comprobante de un lote y en el asistente. No frena.

**Cotización de la `E`.** En bienes y otros, sin `--cm` avisa que se usa la oficial, la de aduana, como A, B y C; si es de otro día, lo dice el mismo aviso, en vez del anterior. En servicios y con `--misma-moneda`, donde es obligatoria, sigue avisando solo si es de otro día. Con `--cm` en una factura de bienes u otros la compara con la oficial (una consulta más a WSFEX) y avisa, sin frenar, si está fuera del 2 % al 400 % (1667). Si no se puede consultar, no avisa.

**Tablas de WSFEX.** En los comandos y en la vista previa del asistente, si la de CUIT de países, unidades, incoterms, idiomas, monedas o actividades contesta con un error o se corta la conexión, lo escrito va sin validar y decide ARCA, o faltan solo los nombres. Nunca se emite un dato distinto del que saldría con la tabla: corta, como antes, si de ella sale algo que se emite (el CUIT del país sin `--cuit-pais`, una unidad por nombre, la descripción del incoterm sin `--incoterms-desc`). También cortan dos errores de conexión, los países, la cotización sin `--cm` y cualquier otro error, como el certificado o WSAA. Si no se pudo comparar `--cm` en servicios o con `--misma-moneda`, avisa y sigue. En el PDF, una unidad sin su nombre sale con el código.

**Certificado de exportación.** El de `exportacion.cert`, con su clave, entra en los avisos de vencimiento, como "El certificado de exportación de testing", también en los comandos de A, B y C. Los comandos de la `E` que lo usan no avisan por el general de ese entorno. Vencido, `CERTIFICATE_EXPIRED` lo nombra y ya no manda a `arcli certificado generar`, que renueva el general; `config revisar` tampoco.

**Moneda y actividad de exportación en la config.** La moneda lista las monedas de ARCA, que se buscan por nombre, código de ARCA o ISO (`usd`), y elegir una guarda el código de ARCA (`DOL`), como el default `PES`. La actividad lista la tabla de WSFEX, consultada como en `arcli fe`: hacen falta el CUIT y el certificado y la clave de facturación del entorno, y el de exportación se usa si está configurado; sin eso o si ARCA no responde, se escribe el código como antes. Sin valor guardado, la lista arranca en "Dejar sin configurar": Enter ya no guarda la primera opción sin elegirla, también en la condición de venta. Lo escrito se valida como `arcli config establecer`, y las claves no cambian.

**Una sola confirmación en producción.** El asistente preguntaba "¿Emitimos…?" y, en producción, otra vez con **Sí, emitir en producción**. Ahora pregunta una sola vez, como los comandos con flags, en la factura, el recibo, las notas, "Repetir" y la `E`. La pregunta sigue diciendo PRODUCCIÓN. **No, dejar sin emitir** termina sin emitir y Esc vuelve a la última pregunta. Los comandos no cambian.

</details>

### ⏳ Deprecado

- **Config:** `cbu` y `aliasCbu` en `config establecer` y `config eliminar`, hasta la 3.0.0: usá `cuenta` (#284).
- **Errores:** `code` y `msg` de `detalles.errores`, hasta la 3.0.0: usá `codigo` y `mensaje` (#290).

<details><summary>Detalle</summary>

**`cbu` y `aliasCbu` por separado.** Siguen guardando y borrando, con un aviso en stderr que muestra el comando nuevo. Ya no salen en la ayuda ni en el autocompletado. Leerlos no avisa: siguen en el archivo y en `arcli config --json`, y una FCE los usa como antes.

**`code` y `msg` de los errores de ARCA.** En los errores de `wsfe` (el último número, `consultar`, `ultimos`, `parametros` y la cotización de A, B, C, FCE y recibos), cada elemento de `detalles.errores` trae lo mismo dos veces: `codigo` y `mensaje`, y `code` y `msg`. Las dos últimas siguen saliendo y `detalles.deprecado` lo avisa si vienen; se van en la 3.0.0, con `detalles.errors`. La terminal no muestra el aviso.

</details>

### 🐛 Corregido

- **Facturas:** si la medianoche pasa en "¿Emitimos?", se emite lo que mostró la vista previa, con sus fechas, como en la `E` (#274).
- **Facturas:** una respuesta sin CAE ni rechazo, o con un error interno de ARCA, sale como `EMISSION_UNCERTAIN`, y con CAE y un error, como emitido (#273).
- **Factura E:** en texto, la `E` y sus notas muestran el CAE antes de preguntar, instalar y generar el PDF, como A, B y C (#283).
- **Consultas:** `ultimos` muestra en su lugar, con `error`, un comprobante que existe pero no se puede leer; el asistente lo saltea y avisa (#288).
- **PDF:** en la `E`, "Generando PDF..." ya no gira sobre la pregunta de instalar el plugin (#283).
- **Facturas:** un evento u observación con otra forma ya no pierde el CAE; si no se sabe si lo hay, sale `EMISSION_UNCERTAIN` (#272).
- **Consultas:** `consultar` y `ultimos` dan `ARCA_VOUCHER_QUERY_ERROR` si ARCA contesta con un error, en vez de decir que no existe (#268).
- **Consultas:** un error pasajero o del último número ya no dice que no se emitió nada ni manda a emitir de nuevo (#273).
- **Factura E:** si ARCA devuelve una `E` sin sus datos, `consultar`, `ultimos`, las notas y el asistente ya no dicen que no existe (#273).
- **Factura E:** un error de ARCA al consultarla avisa que no se sabe si existe, y el asistente sigue sin perder lo cargado (#285).
- **Errores:** en la `E`, los de moneda, incoterm y punto de venta ya no mandan a `arcli parametros`: dicen qué usar (#285).
- **Notas:** si ARCA contesta con un error por el asociado, A, B, C y FCE ya no dicen que no existe (#268).
- **Asistente:** si ARCA contesta con un error al listar A, B, C, FCE o recibos, lo muestra y podés reintentar o buscar a mano (#268).
- **Facturas:** Ctrl+C en "¿Emitimos?" dice que se canceló y que no se emitió nada, en vez de "Error inesperado" (#270).
- **Facturas:** un lote cortado dice qué pasó y qué reintentar, igual en el panel y en `sugerencia`, y trae `detalles.codigoCausa` (#270, #280).
- **Errores:** una sugerencia propia para los errores de red, detalles que no se repiten y el mismo texto para la misma regla (#270).
- **Facturas:** un CUIT mal escrito o un punto de venta inválido da error antes de consultar a ARCA (#272).
- **Consultas:** con el certificado sin autorizar, `parametros` y `ultimos` de una `E` dicen qué autorizar (#272).
- **Certificados:** `generar` ya no pisa un pedido pendiente que no puede leer por falta de permiso (#279).
- **Config:** con varios datos inválidos guardados, `config establecer` y `config eliminar` los arreglan de a uno y avisan cuáles quedan (#279).
- **Config:** un dato inválido guardado dice que está en la configuración, con qué clave y cómo arreglarlo (#276).
- **Errores:** si no se puede leer o escribir un archivo, el error dice cuál, por qué y qué hacer, en castellano (#276).
- **Errores:** un JSON de `--cargar` ilegible dice la línea y la columna, y ya no muestra un trozo del archivo (#276).
- **Certificados:** si `importar` no puede leer la clave, lo dice en vez de mandar a armar otro pedido (#276).
- **Asistente:** con los opcionales o la fecha de pago abiertos al pasar la medianoche, las fechas se validan con el día nuevo (#269).
- **Errores:** en `--cargar` y la config, el tipo equivocado ya no dice "Falta el dato", y los largos y máximos salen en castellano (#269).
- **Salida:** con el disco lleno al escribir la salida, la emisión, su PDF y el lote terminan, y un aviso dice qué se emitió (#271).
- **Salida:** cortar la salida (`arcli ayuda | head`) ya no muestra un error de Node ni corta el comando a mitad de camino (#266).
- **Facturas:** en un lote inválido, cada comprobante de `detalles.comprobantes` trae su `codigo` y su `sugerencia` (#275).
- **Errores:** si falta un dato porque falló una consulta a ARCA, `detalles.codigoCausa` dice cuál fue la falla (#275).
- **Factura E:** los errores de `--cargar` dicen qué llegó y sugieren la clave parecida, como en A, B y C (#275).
- **Facturas:** `EMISSION_UNCERTAIN` trae `entorno`, `puntoVenta` y `tipoArca` en `detalles`, para conciliar sin leer la sugerencia (#280).
- **Errores:** en `--cargar`, una clave `constructor` ya no sugiere un texto interno de JavaScript (#275).
- **Asistente:** con un consumidor final en moneda extranjera, Esc en "¿Emitimos…?" vuelve a la última pregunta; podía repetir la vista previa (#289).
- **Factura E:** un dato inválido en `--cargar` trae `detalles.campos`, y `ARCA_QUOTATION_ERROR`, `detalles.errores`, como A, B y C (#290).
- **Factura E:** sin autorización de WSFEX, o si ARCA no tiene el asociado, qué hacer va en `sugerencia`, como A, B y C (#290).
- **Factura E:** un error de ARCA al pedir el ID de solicitud dice que no se emitió nada (#290).
- **Errores:** `--testing` con `--produccion` da `INPUT_VALIDATION_ERROR` en todos los comandos (#290).

<details><summary>Detalle</summary>

**Un error de ARCA no es "no existe".** Al consultar un comprobante A, B, C, FCE o recibo, solo el error 602 de ARCA significa que no existe. Antes, cualquier otro error (por ejemplo 600) y una respuesta sin datos se leían igual: `consultar` daba `VOUCHER_NOT_FOUND` y `ultimos` terminaba bien con la lista vacía o incompleta, que al verificar una emisión sin confirmar podía llevar a emitir dos veces. Ahora los dos dan `ARCA_VOUCHER_QUERY_ERROR`, con los errores de ARCA en `detalles.errores` (`codigo` es `null` si ARCA no lo mandó) y una `sugerencia`; `ultimos` falla si no se puede leer uno de los comprobantes, y saltea como antes el que no existe. Una falla con "no existe" en el texto, como `El dominio no existe`, también se tomaba por inexistente: ahora sale con su propio error (`UNEXPECTED_ERROR`). `VOUCHER_NOT_FOUND`, `WSFE_SERVICE_NOT_AUTHORIZED`, `TRANSIENT_ERROR` no cambian. En la `E` solo el 1020 es que no existe: una respuesta sin el número, el tipo de exportación o la moneda sale con el mismo código, y una que tiene su número y su CAE dice que existe y que ARCLI no pudo leer sus datos; las listas la siguen salteando, ahora con un aviso que la nombra. Un error de ARCA en la `E` sigue en `ARCA_EXPORT_ERROR`.

**Notas.** Si ARCA contesta con un error por el asociado, se mira si su punto de venta es de web service. Si no lo es (Comprobantes en línea, controlador fiscal), la nota sigue como antes, con `--afecha` y, en el asistente, las mismas preguntas, pero el texto ya no dice que ARCA no lo tiene: dice que no se pudo consultar y el motivo. Si es de web service, la nota que frenaba con "ARCA no tiene…" sigue con "No se pudo verificar en ARCA…" en `avisos`, también al emitir. Si no se puede saber (la lista de puntos de venta viene vacía, como en testing, o falla), con flags la nota sigue con ese aviso; el asistente muestra el error y vuelve a la lista, donde antes podía seguir con las preguntas. Una nota FCE sin `--afecha` sigue frenando con `INPUT_VALIDATION_ERROR`, porque no hay de dónde tomar la fecha, y el mensaje dice que no se pudo consultar. Una falla con "no existe" en el texto tampoco es ya un asociado inexistente: con flags sale como "No se pudo verificar en ARCA…" y en el asistente vuelve al menú.

**Asistente.** En las listas de comprobantes A, B, C, FCE y recibos (Mis comprobantes, Repetir y notas), el error se muestra y seguís en la lista, con lo que ya estaba cargado y lo que respondiste. Si falla la primera carga, quedan "Volver a cargar" e "Ingresar el número a mano". En la `E`, lo mismo si ARCA contesta sin los datos, y al preguntar el asociado de una nota `E` se muestra el error y se vuelve a preguntar el número.

**Spinner del PDF de la `E`.** Arrancaba antes de preguntar por el plugin; ahora, después de instalarlo y cargarlo, como en A, B y C, en los comandos y en el asistente.

**CAE de la `E` antes del PDF.** `arcli fe`, `nce`, `nde` y `factura`, `nota-credito` y `nota-debito` con la letra `e` mostraban el resultado recién después de preguntar, instalar el plugin y generar el PDF: si se cortaba ahí, o si fallaba la pregunta, la `E` quedaba emitida sin mostrar su CAE. Ahora en texto se muestra primero y después va el PDF. Con `--json` no cambia: es un solo documento, con el PDF adentro.

**Ctrl+C en una pregunta.** Cortar "¿Emitimos?" en A, B, C, FCE, recibos, notas, la `E` o un lote mostraba `User force closed the prompt` como error inesperado. Ahora dice "Cancelado. No se emitió nada." y sale con 1, como antes. En la `E`, cortar la pregunta de instalar el componente de PDF, con el comprobante ya emitido, también mostraba ese texto: ahora cuenta como "No", igual que en A, B y C, y sale con 0.

**Lote cortado.** La sugerencia del panel decía siempre que "los comprobantes de arriba ya se emitieron", aunque no hubiera ninguno o alguno fuera un rechazo, y en el JSON `sugerencia` era `null`. Ahora las dos dicen lo mismo, según haya procesados, pendientes o uno sin confirmar, que manda a verificar por su número; el comando para verificarlo está en `error`. `detalles` suma `codigoCausa` (el `codigo` del que falló; `UNEXPECTED_ERROR`, por ejemplo, sin red). "Sin procesar" pasa a su propia línea, en `error` y en el panel, y desde tres comprobantes es un rango con la cantidad; `detalles.sinProcesar` sigue con la lista completa. Si falla la entrega de los ya procesados, por ejemplo la pregunta del PDF, un aviso dice los números que se emitieron y con qué comando verlos, y después sale el error del lote. Con `--json` no hay aviso.

**Respuesta con otra forma.** Si en la respuesta a la emisión venía un dato suelto donde va una lista (un evento, una observación), uno nulo o de otro tipo, o el vencimiento del CAE no era una fecha, el comando terminaba en `UNEXPECTED_ERROR` con un texto interno de JavaScript y sin mostrar el CAE, o lo mostraba mal. Ahora el comprobante se muestra con su CAE, en texto, `--json`, lote y asistente, en A, B, C, FCE, recibos, notas y la `E`; en A, B y C también si el detalle viene suelto, donde antes salía sin CAE. Un texto suelto en `errores` o `eventos` sale como `{codigo: null, mensaje}`. Un error suelto junto con un CAE se ve igual que una lista con un error, con el CAE a la vista. Sin el vencimiento no hay PDF, y `pdf.error` lo dice. Solo si no se puede saber si hay CAE sale `EMISSION_UNCERTAIN`, con el comando para verificarlo, y un lote se corta ahí, con `sinConfirmar`. Un rechazo sigue siendo un rechazo, con exit code `2`; un error del login o del último número, y los de red al emitir, salen como antes. En un lote cortado sin `sinConfirmar`, el que falló no se emitió, y la sugerencia lo dice en vez de mandar a revisar `arcli ultimos`.

**Respuesta incompleta.** Cuando ARCA contestaba a la emisión sin decir si emitió, el resultado parecía definitivo: vacía, `observado`; con resultado `A` y sin CAE, `aprobado`; con un error interno (500, 501 o 502, transacción activa; en la `E`, también 1000) o sin código, `rechazado`. Lo mismo con un CAE en ceros, o con un rechazo que trae CAE. En todos puede haberse emitido. Ahora sale `EMISSION_UNCERTAIN`, con lo que contestó ARCA en `error` y `detalles.causa` y el comando para verificarlo, y un lote se corta ahí con `sinConfirmar`. Al revés, un comprobante con CAE y un error salía `rechazado`, sin PDF y a veces con la sugerencia de volver a emitirlo: ahora es `observado`, con el error en `errores`, el PDF y una sugerencia que dice que está emitido. Vale para A, B, C, FCE, recibos, notas y la `E` y sus notas, en texto, `--json`, lote y asistente. Un `R` sin CAE, y un error de validación sin detalle (600, 10016…), también junto con uno interno, siguen siendo rechazos con exit code `2`.

**Validar antes de ir a ARCA.** El documento del receptor (A, B, C, FCE, recibos y notas) y el punto de venta (también en la `E` y sus notas) se controlan antes del login en WSAA, el padrón, la cotización y las tablas, con flags, `--cargar` y en el asistente. Antes, un CUIT con un dígito mal terminaba en un error del padrón o de la red. En un lote, el ítem inválido no consulta y los demás sí: el error sigue listando todos. Un comprobante suelto inválido falla sin consultar el régimen FCE (`verificarFce`), en los comandos y en el asistente: antes se consultaba y después salía el mismo error. Con dos datos mal en A, B y C, el del documento o el punto de venta sale ahora antes que el de fechas, asociado, moneda o IVA. La config incompleta y el certificado vencido siguen saliendo primero.

**Certificado sin autorizar.** `arcli parametros` y `arcli ultimos fe` (o `nce`, `nde`) mostraban el texto de WSAA (`coe.notAuthorized`) como error inesperado; ahora dan el mismo código y texto que facturar. También en el asistente: "Estado de ARCA", las consultas de tablas y la lista de comprobantes `E` muestran qué autorizar; la barra de estado no cambia. `estado` sigue en `ARCA_UNAVAILABLE`, y solo cambia lo que sigue a "ARCA no respondió:". Otros errores de WSAA o de red no cambian.

**Textos de los errores.** El panel no repite en "Detalles" lo que ya dijo, y un error de red manda a revisar la conexión. `--pv 0` dice que el punto de venta no es válido, igual al facturar y al consultar, y sin autorización a `wsfe` el error ya no dice "No se emitió nada", que en un lote podía ser falso. La falta del punto de venta o del IVA receptor dice lo mismo en todos los comandos. A una nota con el asociado incompleto se le dice qué dato falta y con qué flag (`--apv`, `--ar`, `--ac`), y a quien le falta la ruta del certificado o la clave, el comando para configurarla. Los importes van en formato argentino, las claves entre backticks y `producción` con tilde. En el asistente, si falla el acceso directo se ve la sugerencia y seguís en el menú. En `--json` cambian textos, no claves ni formas: `error`, `detalles[].mensaje`, `detalles.comprobantes[].error` de un lote, `detalle` de `config revisar` y `avisos`. `codigo`, `sugerencia` y el código de salida no cambian.

**Pedido de certificado ilegible.** Con la carpeta `certificados/<CUIT>` sin permiso, `arcli certificado generar` no veía el pedido pendiente, reponía el permiso y pisaba la clave del CSR que quizás ya estaba en ARCA. Ahora frena sin tocar nada y dice qué no se pudo abrir, también en el asistente. Con `--reemplazar`, como antes: repone el permiso de la carpeta del CUIT, pero frena si no puede leer la clave pendiente o entrar a `certificados/`.

**Config de a una clave.** Con más de una clave inválida en el `config.json`, `config establecer` y `config eliminar` no guardaban nada y había que editar el archivo. Ahora guardan el cambio pedido sin tocar el resto y avisan qué queda y cómo arreglarlo: en stderr, o en `avisos` con `--json`, que no trae las claves rotas ni su valor por defecto. Un valor inválido, o un cambio que produce un problema nuevo, se rechaza como antes. Los demás comandos siguen frenando, con todas las claves a arreglar en `sugerencia`, y ya no completan el `config.json` con valores por defecto mientras esté roto. Con la config sana no cambia nada.

**Config guardada inválida.** Con un valor malo en el `config.json`, todos los comandos decían "Hay parámetros inválidos o incompletos en la entrada.", como si fuera de lo que escribiste, y con el nombre interno (`entornoPorDefecto`). Ahora dicen que está en la configuración guardada, con la clave pública y el motivo, y `sugerencia` (antes `null`) trae `arcli config establecer` y `arcli config eliminar`; con varias mal, los de cada una. `codigo` (`INPUT_VALIDATION_ERROR`) y `detalles` no cambian.

**Archivos.** Un archivo o una carpeta sin permiso, una carpeta donde va un archivo, un disco lleno o de solo lectura salían con el texto de Node (`EACCES: permission denied, open '…'`) y la ruta completa. Ahora el error dice qué se quiso hacer, la ruta abreviada (salvo si se llena el disco a mitad de una escritura: ahí Node no la informa) y por qué, y `sugerencia` (antes `null`) qué hacer: en `--cargar`, la config, los certificados, el acceso directo, el autocompletado y el asistente; en el PDF de A, B, C y la `E`, en `pdf.error`, también con `sugerencia`. Los códigos (`UNEXPECTED_ERROR`, `PDF_GENERATION_ERROR`) y `detalles` no cambian. También van traducidos adentro de otros textos, como los de `config revisar`, `estado` o los avisos al facturar.

**`--cargar` ilegible.** El error repetía la ruta completa y el motivo en inglés, con el comienzo del archivo: si se pasaba una clave por error, se veía. Ahora `error` y `detalles.cause` dicen en castellano si está vacío, cortado o mal escrito, con línea y columna si Node las informa, y la ruta va abreviada y una sola vez. `detalles.ruta` sigue completa y las claves no cambian.

**Clave ilegible al importar.** Si la clave existía y no se podía leer, `arcli certificado importar` decía que faltaba armar el pedido. Ahora dice que no la pudo leer, con su ruta abreviada y el motivo. El código sigue siendo `CERTIFICATE_KEY_MISMATCH`.

**Medianoche en el asistente.** Con la lista de opcionales abierta al pasar la medianoche, "Fecha del comprobante" y "Vencimiento" se controlaban a la vez con el día en que se abrió la lista y con el nuevo; "Fecha de pago" de la `E`, con el día en que se abrió la pregunta. Ahora vale solo el día nuevo, en A, B, C, FCE, recibos, notas, la `E`, sus notas y "Repetir". Una fecha respondida antes que deja de valer se avisa al terminar y vuelve a su pregunta, como siempre. No cambia el "mes pasado" de "Repetir".

**Medianoche en "¿Emitimos?".** En A, B, C, FCE, recibos y notas, la solicitud se armaba para la vista previa y otra vez al confirmar: si la medianoche pasaba con la pregunta abierta, salía con otra fecha, otro período u otro vencimiento que los mostrados, o un error cortaba la emisión. Ahora se emite la solicitud de la vista previa, en el asistente y en los comandos en una terminal, suelto o en lote, y el PDF y el texto dicen lo mismo. Si ARCA ya no acepta la fecha, sale su rechazo. Sin la pregunta (`--emitir`, `emitir true`, `--json`, sin terminal) no cambia: cada comprobante lleva la fecha del momento en que se emite.

**Textos de los errores de entrada.** Con `"puntoVentaPorDefecto": "a"` en el `config.json` el error decía `Falta el dato: puntoVentaPorDefecto.`; ahora, `` `puntoVentaPorDefecto` tiene que ser un número. ``. Lo mismo en `--cargar`, suelto o en un lote, con un `puntoVenta` de `1.5`: `Punto de venta tiene que ser un entero.`; y una clave adentro de otra se nombra como en el JSON (`comprobanteAsociado.numero`, `alicuotas.0.monto`). El largo de un texto se leía como un número (`MonedaPorDefecto debe ser mayor a 3.`) y ahora dice cuántos caracteres van; un mínimo o un máximo que se puede usar dice `debe ser 1 o más` o `debe ser 31 o menos`, y los máximos, como el de `--receptor-nombre`, ya no salen en inglés. Los valores de `config establecer` dicen "El valor" en lugar de "Entrada" en `detalles`. Cambian solo los textos (`detalles[].mensaje` y, en un lote, el de cada comprobante): `codigo`, las claves y `ruta` quedan igual.

**Disco lleno.** Si la salida no se podía escribir, por ejemplo redirigida a un disco lleno, ARCLI cortaba con el detalle interno de Node y salía con 1: un comprobante autorizado podía quedar sin PDF, un lote a medias y sin saber qué se emitió; con stderr, podía cortar antes de emitir. Ahora termina lo que hacía y avisa por la otra salida que no se pudo escribir, por qué y, si se emitió, los números con CAE y el comando para verlos, en A, B, C, FCE, recibos, notas, la `E` y el asistente. Sale con 1, o con 2 si hubo un rechazo (antes 1). Con `--json` y stdout roto, el aviso es un código nuevo, `OUTPUT_WRITE_ERROR`, en stderr, con las claves de siempre y lo emitido en `sugerencia`; si el comando ya daba un error, sale ese, con lo mismo al final de su `sugerencia`. Con `--json` y stderr roto, stdout trae solo el resultado. Si fallan las dos, sale con 1 sin aviso. El asistente, si no puede escribir en stdout, no pregunta ni emite más: termina con 1 y el aviso por stderr, que dice si el PDF elegido no se generó (no se pide por sus datos a ciegas y no se puede generar después); si lo que falla es stderr, muestra sus errores en stdout. Si el sistema no informa el error, por ejemplo porque entró una parte, no hay aviso. Con la salida sana no cambia nada.

**Salida cortada.** Si quien lee la salida la cerraba antes de tiempo (`| head`, o `less` y `q`), ARCLI mostraba `Error: write EPIPE` con el detalle interno de Node y salía con 1. Ahora el comando termina sin ese error y, con la salida cortada, el código de salida pasa de 1 al del comando (0, 1 o 2), también si lo que se cerró es stderr: un 0 no garantiza que alguien haya leído la salida, así que si se cortó al emitir conviene buscar el comprobante antes de reintentar. Una emisión, su PDF o un lote se completan igual que con la salida abierta: antes podían cortarse ahí, por ejemplo con el comprobante ya autorizado y sin PDF. La salida y el `--json` no cambian.

**Lote: código y sugerencia de cada comprobante.** En `BATCH_VALIDATION_ERROR`, cada elemento de `detalles.comprobantes` traía solo `error` e `indice`. Ahora suma `codigo` y `sugerencia` (texto o `null`), con los valores que daría ese comprobante solo. `error`, `indice` y el texto del panel no cambian. Si el error de ese comprobante trae `detalles.codigoCausa`, el ítem suma `codigoCausa` con el mismo valor (#280).

**Emisión sin confirmar.** En A, B, C, FCE, recibos, la `E` y sus notas, `detalles` suma `entorno`, `puntoVenta` y `tipoArca`. `codigo`, `error`, `sugerencia` y el panel no cambian.

**Qué falló al consultar a ARCA.** Al facturar a un CUIT sin IVA receptor con el padrón caído, y en una nota FCE sin `--afecha` si falla la consulta del asociado, el error es `INPUT_VALIDATION_ERROR` y no decía si era la red, ARCA o el certificado. Ahora `detalles`, antes `null`, es `{ "codigoCausa": "…" }` con el código de la falla, por ejemplo `UNEXPECTED_ERROR` o `WSFE_SERVICE_NOT_AUTHORIZED`. `codigo`, `error`, `sugerencia` y el panel no cambian, y si ARCA contestó que no figura o no lo tiene, `detalles` sigue en `null`.

**`--cargar` de la `E`.** Un tipo equivocado dice qué llegó y, si es un número entre comillas, "Escribilo sin comillas."; una clave mal escrita sugiere la parecida o la del flag, también dentro de `items` y `comprobanteAsociado`; y un archivo con `"x"`, `5` o `null` dice qué tiene que ser, en vez de `"" tiene que ser un objeto`. Los elementos de una lista se nombran `items[0].cantidad`, como en A, B y C. Vale para `fe`, `nce` y `nde`; `codigo` y `detalles: null` no cambian.

**Un error de ARCA al consultar una `E`.** `consultar` y `ultimos` con `fe`, `nce` o `nde` decían "al consultar el comprobante asociado" y no avisaban que podía existir. Ahora `error` nombra el comprobante, dice que no se sabe si existe y trae el código de ARCA, y `sugerencia` (antes `null`) pide no reintentar una emisión hasta saberlo, como en A, B y C. En las notas `E` sigue diciendo que es el asociado, con su número. En el asistente ese error salía al menú y se perdía lo cargado: ahora se muestra y se sigue en la lista o en la pregunta. Un error al pedir el último número de una `E` también trae `sugerencia`: la de consultar en `ultimos`, la de emitir al facturar. `codigo` sigue en `ARCA_EXPORT_ERROR` y `detalles` no cambia.

**Qué usar en la `E`.** `arcli parametros` tiene las tablas de A, B y C, no las de WSFEX. Un incoterm o un idioma que no existe ahora lista los válidos en `sugerencia`; una moneda o una unidad, los más comunes de la tabla de WSFEX; el país, los parecidos, y el CUIT del país, el del destino. Un rechazo por el punto de venta aclara que en producción la `E` usa uno propio, y por el del asociado, `--apv`. El `error` del incoterm ya no trae la indicación, que pasó a `sugerencia`.

**Esc en "¿Emitimos…?" en moneda extranjera.** Con un consumidor final, después de los opcionales el asistente consulta la cotización para saber si el total llega al tope. Esa consulta contaba como una pregunta: Esc volvía a ella, que no pregunta nada, y salía otra vez la vista previa, siempre si la consulta había fallado. Ahora vuelve a la última pregunta, en la factura, el recibo, las notas y "Repetir".

**Los mismos datos en los errores de la `E`.** En `fe`, `nce`, `nde` y sus formas largas, un dato inválido en `--cargar` lista cada problema en `detalles.campos`, con `mensaje` y `ruta`; `error` no cambia, y un JSON que no es un objeto o con `monto` y `montoTotal` juntos sigue con `detalles` en `null`. `ARCA_QUOTATION_ERROR` trae `detalles.errores`, vacío: WSFEX contestó, sin esa moneda. El "Autorizalo igual que wsfe…" de `WSFEX_SERVICE_NOT_AUTHORIZED` y el "Revisá `--ar`…" del asociado que ARCA no tiene pasan de `error` a `sugerencia`; el panel muestra lo mismo. En el padrón y `fce-obligado` el texto no cambia. Si ARCA contesta con un error al pedir el ID de solicitud, `sugerencia` es "No se emitió nada. Revisá el mensaje de ARCA y reintentá.", como con el último número.

**`--testing` con `--produccion`.** Salía con `CONFIGURATION_ERROR`, menos en `certificado generar` y `certificado importar`. Ahora es `INPUT_VALIDATION_ERROR` en todos, también al abrir el asistente, y el panel dice "Error de entrada" en vez de mandar a revisar la configuración. `error` y el exit code no cambian. `parametros` sin tabla sigue sin usar el entorno ni dar error.

</details>

## [2.6.0] - 2026-11-22 · Monotributo y recibos

El monotributo en la terminal, Recibo A y Recibo B y fechas relativas como `hoy` o `mes-pasado`. También un asistente que ya no pierde lo que respondiste y que frena antes lo que ARCA iba a rechazar.

#### El monotributo en la terminal

Las 11 categorías con topes y cuotas, con la tuya marcada, y una categoría completa con `--categoria`. Si tu tope es otro, `monotributo.tope`.

```sh
arcli monotributo --categoria E
```

#### Recibo A y Recibo B

Para documentar un cobro como responsable inscripto: cada uno se arma como la factura de su letra.

```sh
arcli ra -m 121000 --cs --cuit 20168598204
```

#### Fechas relativas

`hoy`, `ayer`, `+N` y `-N` en todo flag de fecha, en `--cargar` y en las preguntas del asistente, y `mes-actual` o `mes-pasado` en los períodos de los flags y de `--cargar`. Sirve para un abono mensual por cron.

```sh
arcli fc -m 50.000 --cs --cfinal --sd mes-pasado --sh mes-pasado --vto +10
```

#### Un asistente que no pierde lo que respondiste

"Volver" lleva a la pregunta anterior con la respuesta marcada, los opcionales no se pierden y, si cambiás algo, solo se descarta lo que depende de eso. Las fechas y los importes se controlan al preguntarlos.

#### Controles de ARCA antes de emitir

La vista previa frena con el código de ARCA lo que ARCA iba a rechazar al emitir, controla los dígitos verificadores del CBU y verifica los permisos de embarque de la `E`.

> [!WARNING]
> **Puede afectar scripts**
>
> - Una moneda que no existe sale con `INPUT_VALIDATION_ERROR`, antes `ARCA_QUOTATION_ERROR`.
> - Frenan antes de ir a ARCA, con `INPUT_VALIDATION_ERROR`, casos que ARCA rechazaba al emitir. Por ejemplo, en A, B, C, FCE y recibos: un CBU con un dígito verificador mal, una A o una FCE a un DNI, CUIL o consumidor final, el receptor igual al emisor (10069), una B al No Categorizado con neto gravado (10067), un punto de venta mayor a 99.998, un `--ar` mayor a 99.999.999 o un importe de más de 13 enteros.
> - En las notas FCE: otra moneda, otro receptor u otra `--afecha` que su asociado (10181, 10183 y 10160), y una nota de débito con `--anulacion` sobre la factura.
> - Una cotización por debajo del 2 % o por encima del 500 % de la oficial, también la de la clave `cotizacion` de la config (10119).
> - En la `E`: los permisos de embarque que ARCA da por inválidos y las reglas de incoterm, fecha de pago, cotización, unidades, topes y largo de los textos.
> - A consumidor final por defecto, la `solicitud` del `--json` suma `DocNro: 0`.
>
> No se saca ni se renombra ningún comando, flag ni clave de config o de `--json`: lo nuevo del `--json` son campos que se suman.

---

### ✨ Agregado

- **Monotributo:** `arcli monotributo` muestra las categorías con topes y cuotas y tu categoría marcada; también en Consultas del asistente (#210).
- **Monotributo:** la clave `monotributo.tope` guarda tu tope de ingresos anuales si es otro que el de la categoría (#210).
- **Recibos:** Recibo A y Recibo B con `arcli ra` y `arcli rb`, en las notas, el PDF, el `--json` y el asistente (#202).
- **Fechas:** `hoy`, `ayer`, `+N`, `-N`, `mes-actual` y `mes-pasado` en los flags de fecha y en `--cargar` (#217).
- **Fechas:** `hoy`, `ayer`, `+N` y `-N` en las preguntas de fecha del asistente (#249).
- **Asistente:** consumidor final con datos: desde $ 10.000.000 pregunta su documento, y por debajo es un opcional (#238).
- **Consultas:** `arcli consultar` muestra el asociado, los períodos, las alícuotas, los tributos, los datos de FCE y las observaciones (#230).
- **Notas:** una nota A, B o C puede ajustar otra nota de la misma letra, como permite ARCA (#192).
- **FCE:** con `--anulacion`, una nota FCE puede ajustar otra nota FCE (#192).
- **FCE:** la vista previa avisa si el comprador no rechazó el asociado de una nota de anulación (error `10154`) (#200).
- **Factura E:** los permisos de embarque se verifican en ARCA antes de la vista previa (#201).
- **Asistente:** notas sobre una factura de Comprobantes en línea o de un controlador fiscal, con el número a mano (#218).
- **Asistente:** las notas eligen el comprobante que ajustan en dos pasos: primero el tipo y después cuál (#192).
- **Asistente:** la `E`, sus notas y "Repetir" una `E` suman el opcional Fecha del comprobante (#232).
- **Asistente:** una nota sobre una factura en dólares pregunta si va en esa moneda o en pesos (#220).
- **Monotributo:** las observaciones de tope `10236` y `10235` aclaran que el comprobante está emitido y qué implica (#220).
- **Consultas:** `arcli padron` muestra la letra de la categoría del monotributo y desde qué mes rige (#199).

<details><summary>Detalle</summary>

**`arcli monotributo`: categorías, topes y cuotas del monotributo.** Muestra las 11 categorías (A a K) con el tope de ingresos anuales y la cuota mensual de servicios y de ventas, con tu categoría marcada si el CUIT de la config es monotributista (la lee una vez del padrón). `--categoria E` muestra una categoría completa: límites anuales (ingresos, superficie, energía, alquileres, precio unitario máximo), la cuota con su desglose (impuesto integrado, SIPA y obra social) y la categoría siguiente. `--completa` muestra todas las columnas en dos bloques, y `--json` la tabla con `vigenteDesde`, `fuente`, `consultadaEl`, `tuCategoria`, `categorias` y `avisos` (ver [Entrada y salida](docs/input-output.md#categorías-del-monotributo-monotributo)). La tabla sale de la página pública de ARCA, sin certificado, y se guarda en la carpeta de config: se lee la primera vez y después con `--actualizar`. Sin conexión, o si la página cambió, se usa la guardada o la que viene con ARCLI, con un aviso; también avisa si ya pasó febrero o agosto y la tabla puede estar vieja. En el modo interactivo está en Consultas, **Categorías del monotributo**, con ver una categoría, ver todas las columnas (con ←/→) y actualizar desde ARCA.

**Clave `monotributo.tope`.** Tu tope de ingresos anuales, si querés pisar el de la categoría (`arcli config establecer monotributo.tope 30.000.000`). Por ahora `arcli monotributo` lo muestra debajo de la tabla; en `arcli config --json` sale como `monotributo: { tope }` solo si está configurada.

**Recibo A y Recibo B.** `arcli ra` (o `arcli recibo a`, tipo ARCA 4) y `arcli rb` (o `arcli recibo b`, tipo ARCA 9), para documentar un cobro como responsable inscripto. Cada uno se arma como la factura de su letra: el A va a un CUIT y discrimina IVA, y el B lleva el IVA incluido. Las notas A y B los asocian con `--ac ra` y `--ac rb` (o `--at 4` y `--at 9`), como las C al Recibo C. Salen en `ultimos`, `consultar`, el PDF (`RECIBO A`, `RECIBO B`) y el `--json` (`atajo` `ra`/`rb`, `tipoArca` 4/9). En el modo interactivo, "Emitir recibo" pregunta cuál (C, B o A) y "Repetir" los ofrece junto al C. `arcli recibo c` y `arcli rc` no cambian.

**Fechas relativas en los flags y en `--cargar`.** Todo flag de fecha (`--fecha`, `--vto`/`--vencimiento`, `--sd`/`--sh`, `--afecha`, `--pd`/`--ph`, `--fecha-pago` de la `E` y `--fecha` de `fce-obligado`) acepta `hoy`, `ayer`, `+N` y `-N` (N días desde hoy, hasta 999). En desde y hasta (`--sd`/`--sh`, `--pd`/`--ph`) también `mes-actual` y `mes-pasado`: en desde dan el día 1 del mes y en hasta, el último día, como "Este mes" y "El mes pasado" del modo interactivo. Las mismas palabras valen en las claves de fecha del JSON de `--cargar`, sin distinguir mayúsculas. Sirve para un abono mensual por cron: `arcli fc -m 50.000 --cs --cfinal --sd mes-pasado --sh mes-pasado --vto +10 --emitir`. "Hoy" es la fecha argentina, las validaciones de fechas se aplican sobre la fecha resuelta y la vista previa y el `--json` la muestran, nunca la palabra. Las fechas escritas a mano y el `--json` no cambian.

**Fechas relativas en el modo interactivo.** Toda pregunta de fecha del asistente (fecha del comprobante, período del servicio, vencimiento del pago, período y fecha del asociado de una nota, fecha de pago de la `E`, en facturas, FCE, recibos, notas, la `E` y "Repetir") acepta `hoy`, `ayer`, `+N` y `-N`, como los flags; la ayuda de la pregunta lo recuerda. La línea de la respuesta, la vista previa y el comando equivalente llevan la fecha resuelta (`-1` el 25/11/2026 queda `24/11/2026`), así el comando se puede repetir otro día. Las validaciones de ARCA no cambian. Los flags, que ya las aceptaban, y el `--json` no cambian.

**Consumidor final con datos en el modo interactivo.** La primera pregunta ofrece **Consumidor final** (ya no "Consumidor final (sin identificar)"). Si el total en pesos llega a $ 10.000.000 (RG 5700/2025, monto × cotización), el asistente avisa que ARCA pide los datos del consumidor final y pregunta su documento (DNI, CUIT o CUIL) y el número, con la condición IVA consumidor final. Si la moneda o la cotización se eligen en los opcionales, o es la oficial de ARCA, lo pregunta después de los opcionales, antes de la vista previa. Por debajo de ese monto, **Datos del consumidor final** está entre los opcionales de las facturas, recibos y notas de período B y C. Vale también en recibos, notas y "Repetir". "Volver" va pregunta por pregunta: del número al tipo de documento y de ahí al monto. Si lo respondiste como obligatorio y después bajás el monto, queda entre los opcionales, marcado y con lo escrito; si cambiás de receptor (en "Repetir", de comprobante) y seguís, lo escrito se descarta. El comando equivalente lleva `--dni N --ir-cf` (o `--cuit`, `--cuil`), como con flags; sin identificar sigue con `--consumidor-final`. Antes, a consumidor final desde ese monto la vista previa frenaba con un error y había que volver a empezar con DNI. Los flags y el `--json` no cambian.

**`arcli consultar` muestra lo que faltaba de A, B, C, FCE y recibos.** El comprobante asociado de una nota (con su CUIT y fecha) o su período asociado, el período de servicio, el vencimiento del pago, si se cobra en la misma moneda extranjera, la condición IVA del receptor, cada alícuota de IVA y cada tributo, los datos de FCE (CBU, alias, transferencia y anulación) y las observaciones de ARCA. Antes ARCLI no los recibía. También en `ultimos --json` y en el historial del modo interactivo. En `--json` son campos nuevos: `comprobantesAsociados`, `periodoAsociado`, `servicioDesde`, `servicioHasta`, `vencimientoPago`, `mismaMoneda`, `condicionIvaReceptor`, `alicuotasIva`, `tributos`, `opcionales` y `observaciones` (`[]` o `null` si ARCA no los informa, ver [Entrada y salida](docs/input-output.md#comprobantes-emitidos-ultimos-y-consultar)). Los campos que ya estaban no cambian.

**Notas sobre otras notas en A, B y C.** Una nota de crédito o débito puede ajustar otra nota de la misma letra, como permite ARCA (regla 10040): `arcli ncc --ac ndc …`, `arcli nda --ac nca …`. Antes era un error de validación. Una nota de crédito sobre una de débito tiene como tope el total de esa nota; sobre otra nota de crédito no hay tope, como en la `E`. El Recibo C sigue siendo asociado válido de las notas C.

**Notas FCE sobre otras notas FCE, con `--anulacion`.** Con anulación, la nota de crédito FCE puede ajustar la factura o una nota de débito FCE, y la nota de débito FCE solo una nota de crédito FCE. Sin anulación, el asociado sigue siendo solo la factura FCE. ARCLI lo valida antes de ir a ARCA, con la sugerencia de sumar o sacar `--anulacion`.

**Notas FCE de anulación: aviso si el comprador no rechazó el asociado.** Una NC o ND FCE con `--anulacion` necesita que el comprador haya rechazado antes el comprobante asociado en el Registro de FCE; si no, ARCA la rechaza con el error `10154`. Ahora la vista previa consulta su estado en `wsfecred` y lo avisa en `avisos` (con flags y en el modo interactivo), sin frenar la emisión. Si la consulta falla, por ejemplo porque el certificado no tiene autorizado `wsfecred`, también sale como aviso. Y si ARCA rechaza con `10154`, `sugerencias` explica qué hacer. No cambia ninguna clave del `--json`.

**Permisos de embarque verificados antes de emitir la `E`.** En una factura o nota `E` de bienes (`--tipo-expo 1`) con `--permiso`, ARCLI consulta cada permiso en ARCA (`FEXCheck_Permiso`) con el país de destino antes de la vista previa. Si ARCA dice que no es válido, frena con `INPUT_VALIDATION_ERROR` (los permisos en `detalles.permisos`) en lugar de enterarse por el rechazo al emitir; si la consulta falla, sigue con un aviso. La vista previa muestra el resultado al lado de cada permiso y el JSON suma `exportacion.verificacionPermisos` (`[]` sin permisos); el resto del JSON no cambia. En testing ARCA contesta `OK` a cualquier permiso.

**Notas sobre una factura de otro sistema en el modo interactivo.** En una nota de crédito o débito, **Ingresar el número a mano…** con una factura que ARCA no tiene y de un punto de venta que no es de web service (Comprobantes en línea, controlador fiscal) ya no frena: el asistente pregunta lo que no puede copiar (fecha de la factura, receptor, concepto, monto, IVA del receptor, alícuota y moneda) y sigue, con el mismo aviso que con flags. El comando equivalente lleva `--apv`, `--ar` y `--afecha`. Con un punto de venta de web service sigue avisando que no existe.

**Notas en el selector del modo interactivo.** En las notas de crédito y débito, "¿Sobre qué comprobante?" se elige en dos pasos: primero el tipo de documento (facturas, notas de crédito, notas de débito o recibos) y después el comprobante, de C a A, los FCE y el de exportación `E` (en recibos, el C, B o A), así la lista no se alarga. Suma las notas de cada letra que se pueden ajustar y las notas de exportación `E`. La pregunta "¿La nota va sobre la factura E o sobre otra nota E?" ya no está: se elige en ese selector. En FCE, la anulación se completa sola cuando el asociado la define, y solo se pregunta en una nota de crédito sobre la factura.

**Fecha del comprobante en el asistente de la `E`.** La factura `E`, sus notas y "Repetir" una `E` suman el opcional **Fecha del comprobante** (por defecto hoy), como en A, B y C. Valida lo mismo que `--fecha`: hasta 5 días antes o después de hoy y, en servicios, no después del fin de mes (error `1500`). En una nota, no puede ser anterior al comprobante que ajusta. La fecha de pago de la factura (servicios u otros), como `--fecha-pago`, no puede ser anterior a la del comprobante elegida (antes no podía ser anterior a hoy). Dónde se pregunta está en "Fecha de pago" de la `E`, en Cambiado. La cotización de aduana es la de esa fecha (en servicios o cobrada en dólares, la del día hábil anterior) y el comando equivalente lleva `--fecha`. Antes el asistente usaba siempre la de hoy.

**Notas en pesos sobre una factura en otra moneda, en el modo interactivo.** Al elegir una factura en dólares (u otra moneda extranjera), el asistente pregunta si la nota va en esa moneda o en pesos, por ejemplo una nota de débito por diferencia de cambio. En pesos no ofrece anular el total ni controla el tope de la nota de crédito. Con flags ya se podía.

**Observaciones de tope del Monotributo explicadas.** Cuando ARCA aprueba un comprobante con la observación `10236` (`817` con CAEA: el importe excede el límite de tu categoría) o `10235` (`816`: excede el de la categoría máxima), `sugerencias` aclara que no es un rechazo y que el comprobante está emitido, qué significa para la próxima recategorización o la exclusión del Monotributo, y que los topes están en `arcli monotributo`. No cambia ninguna clave del `--json`.

**Categoría completa del monotributo en `arcli padron`.** Además de la descripción de ARCA, muestra la letra (`A` a `K`) aparte y desde qué mes rige (`09/2013`). En `--json` hay dos campos nuevos: `categoriaMonotributoLetra` (`"E"`) y `categoriaMonotributoDesde` (`"201309"`, formato ARCA `yyyymm`), en `null` si no es monotributista o ARCA no los informa. `categoriaMonotributo` no cambia. También en "Datos de un CUIT" del modo interactivo.

</details>

### 🔧 Cambiado

- **Errores:** una moneda que no está en la tabla de ARCA sale con `INPUT_VALIDATION_ERROR`, no con `ARCA_QUOTATION_ERROR` (#229).
- **Errores:** la vista previa frena lo que ARCA rechazaba, como una A o FCE sin CUIT o el receptor igual al emisor (#220).
- **Factura E:** frena antes lo que ARCA rechaza: incoterm, fecha de pago, cotización, unidades, topes y largo de los textos (#219).
- **FCE:** el CBU se controla con sus dígitos verificadores en los flags, `--cargar`, la config y el asistente (#209).
- **FCE:** una nota de débito FCE con `--anulacion` sobre la factura frena antes de ir a ARCA (#192).
- **Factura E:** `--fecha` acepta hasta 5 días adelante y frena las de más de 5 días atrás, como ARCA (#219).
- **Notas:** `--acuit` es opcional en las notas A, B y C: sin él, el asociado es del CUIT emisor (#220).
- **Factura E:** `--ar` es opcional en las notas `E` de bienes y otros (#219).
- **Factura E:** la actividad es opcional: sin `--actividad`, la `E` va sin el bloque `Actividades` (#219).
- **Factura E:** una nota `E` de bienes u otros puede ajustar un comprobante de servicios (#219).
- **Salida:** sin "N/D": las filas sin dato que no aportan no se muestran y las demás dicen qué pasa (#248).
- **Asistente:** la pregunta del monto dice en qué moneda va y, si cambiás la moneda, lo vuelve a pedir (#245).
- **Asistente:** la `E` siempre pregunta los ítems, el total es su suma y un editor nuevo los modifica (#245).
- **Asistente:** la cotización de "En pesos" y de la `E` cobrada en pesos arranca escrita con la que tomaría el CLI (#245).
- **Asistente:** el CBU y la actividad se ofrecen guardar solo si ARCA autoriza el comprobante (#245).
- **Asistente:** las listas se filtran escribiendo, sin tildes ni mayúsculas, como Monedas y cotizaciones (#247).
- **Asistente:** Consultas suma Monedas y cotizaciones, y Configuración ya no tiene "Dónde está la config" (#196).
- **Asistente:** las listas largas avisan cuántas opciones quedan arriba y abajo, y `Filtrar:` tiene aire (#196).
- **Asistente:** la vista previa de la `E` termina en el importe total, con el importe de cada ítem alineado (#245).
- **Asistente:** "Fecha de pago" de la `E` va antes de los opcionales, y "Solo hoy" pasa a "Un solo día" (#245).
- **Asistente:** "Emitir factura" tiene descripción en el menú y una pregunta opcional vacía queda limpia en el historial (#246).
- **Docs:** los ejemplos de FCE B y C de `--ayuda` y `arcli ejemplos` van a un CUIT (#220).

<details><summary>Detalle</summary>

**Una moneda que no está en la tabla de ARCA es `INPUT_VALIDATION_ERROR`, no `ARCA_QUOTATION_ERROR`.** `fe --moneda XYZ` (y `nce`/`nde`, o `codigoMoneda` de `--cargar`) salía con `ARCA_QUOTATION_ERROR` porque ARCLI no encontraba su cotización, cuando el problema es la entrada: el código no existe en la tabla de monedas de WSFEX (ARCA lo rechaza con 1590). Ahora la `E` busca la moneda en esa tabla antes de la cotización y frena con `INPUT_VALIDATION_ERROR`, el error de ARCA y una `sugerencia` de revisar `--moneda`, también con `--cotizacion-moneda` (antes llegaba a ARCA). En A, B, C, FCE y recibos pasaba lo mismo: sin `--cm` salía `ARCA_QUOTATION_ERROR`, y con `--cm` llegaba a ARCA, que la rechazaba al emitir (10037). Ahora una moneda que ARCLI no conoce se busca en la tabla de WSFEv1 (`arcli parametros monedas`) y, si no está, es el mismo `INPUT_VALIDATION_ERROR`; si la tabla no se puede consultar, sigue como antes. **Cambia el `codigo` del `--json` para este caso:** un script que esperaba `ARCA_QUOTATION_ERROR` por una moneda inexistente ahora recibe `INPUT_VALIDATION_ERROR`, que es el que corresponde a un dato mal escrito. `ARCA_QUOTATION_ERROR` sigue para una moneda que existe y ARCA no cotiza.

**Controles de ARCA antes de la vista previa.** ARCLI frena con `INPUT_VALIDATION_ERROR` y una `sugerencia` lo que ARCA igual rechazaba al emitir, con flags, con `--cargar` y en el modo interactivo. No cambia ninguna clave del `--json`.

Frenan: un comprobante A (`fa`, `nca`, `nda`, `ra`) con `--dni` o `--cuil`, porque la A va a un CUIT (10013). Una FCE de cualquier letra con `--dni`, `--cuil` o consumidor final, porque también va a un CUIT (10015). El asistente ya no ofrece otros receptores en FCE. El receptor con el mismo CUIT que emite (10069). Una factura o nota B al No Categorizado (`23000000000`) con neto gravado, que lleva la percepción de IVA No Categorizado (10067), porque ARCLI no informa tributos. Una nota FCE en otra moneda que su asociado (salvo pesos, para una diferencia de cambio, 10181), a otro receptor (10183) o con `--afecha` distinta de la del asociado en ARCA (10160). Una cotización (`--cm`, `cotizacionMoneda` del JSON o la clave `cotizacion` de la config) por debajo del 2 % o por encima del 500 % de la oficial (10119): para compararla, la vista previa consulta la oficial, y si la consulta falla, solo avisa.

En A, B, C, FCE y recibos frena también lo que no entra en el campo de ARCA: un importe (`--monto`, `--exento`, `--nogravado`, los de `--alicuotas` o los del JSON) de más de 13 enteros, el punto de venta (`--pv` o el de la config) o el del asociado (`--apv`) mayor a 99.998 (10004 y 10058), y `--ar` mayor a 99.999.999 (10059). El error dice el máximo, como ya hacía la `E`.

**La `E` frena antes lo que ARCA rechaza.** Estos casos llegaban a ARCA y salían rechazados. Ahora frenan en la vista previa con `INPUT_VALIDATION_ERROR` y el código de ARCA, con flags, con `--cargar` y en el modo interactivo. Si un script los mandaba, ya fallaba al emitir. No cambia ninguna clave del `--json`.

Incoterm y fecha de pago: una factura de bienes (`--tipo-expo 1`) sin `--incoterm` (1640), y en el modo interactivo el incoterm de bienes ya no ofrece "Sin incoterm". `--incoterms-desc` sin `--incoterm` (1641) o de más de 20 caracteres (1642). `--fecha-pago` anterior a la fecha del comprobante (1674).

Cotización: `--cotizacion-moneda` en la factura de servicios o con `--misma-moneda` distinta de la que exige ARCA, la de aduana del día hábil anterior (2053 y 1604). ARCLI la compara con la de ARCA y el error dice cuál corresponde. Si coincide, sigue. En el modo interactivo la cotización a mano ya no se ofrece en esos casos.

Unidades: ítems con las unidades 0, 97 (seña o anticipo) o 99 (bonificación), que ARCA pide sin cantidad ni precio (1775). En el modo interactivo no aparecen en la lista de unidades, y "Repetir" no copia los ítems de una factura que las tenga.

Números: el punto de venta (`--pv`, `--apv`) mayor a 99.998 (1510), y `--numero` mayor a 99.999.999 (1520), también cuando lo pasás a mano. `--id-solicitud`, en cambio, ahora acepta hasta 15 dígitos, como el campo de ARCA (antes, 99.999.999).

Textos más largos que los de ARCA: `--cliente` 200 caracteres (1651), `--domicilio-cliente` 300 (1661), `--observaciones` 1000 y `--obs-comerciales` 4000 (1665), `--descripcion` y la descripción de un ítem 4000 (1770), el código de un ítem 50 (1760, que ARCA testing no aplica pero producción puede), y `--forma-pago` e `--id-impositivo` 50.

**CBU con dígitos verificadores.** El CBU de una FCE ya no se acepta solo por tener 22 dígitos: ARCLI controla sus dos dígitos verificadores (el del bloque de banco y sucursal y el de la cuenta) en `--cbu`, la clave `cbu` del JSON de `--cargar`, `arcli config establecer cbu` y el modo interactivo. Si alguno no coincide, frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR` y dice qué bloque está mal. Un CBU real siempre los cumple: si uno que usabas ahora da error, tiene un dígito mal escrito. Si el CBU mal está guardado en la config, los comandos frenan con `El CBU guardado en la config no es válido`, el bloque que falla y la sugerencia de cambiarlo con `arcli config establecer cbu <CBU>`, que funciona aunque la config tenga el CBU mal. No cambia ninguna clave del `--json`.

**Nota de débito FCE con `--anulacion` sobre la factura.** Ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR` y la sugerencia de sacar `--anulacion`. Antes llegaba a ARCA, que la rechazaba: con anulación, una nota de débito FCE solo ajusta una nota de crédito FCE.

**La `E` acepta fechas de hasta 5 días adelante y frena las de más de 5 días atrás.** La factura y las notas `E` (`fe`, `nde`, `nce`) frenaban toda fecha futura y no ponían límite hacia atrás. Ahora `--fecha` (o `fechaComprobante` de `--cargar`) va de 5 días antes a 5 días después de hoy y, en servicios, no después del fin de mes, como ARCA (error 1500): por ejemplo, facturar el viernes con la fecha del embarque del lunes. Una fecha de más de 5 días atrás, que ARCA rechazaba, ahora frena antes con `INPUT_VALIDATION_ERROR`. Con fecha futura, la cotización de aduana es la de hoy (en servicios y con `--misma-moneda`, la del día hábil anterior a hoy), y la vista previa avisa en `avisos` que las siguientes de ese punto de venta y tipo van a tener que llevar esa fecha o una posterior (ARCA las rechaza con el error 1535). No cambia ninguna clave del `--json`.

**`--acuit` es opcional en las notas A, B y C.** Sin él, el comprobante asociado es del CUIT emisor de la config, como ya pasaba en las notas FCE. ARCA solo exige el CUIT del asociado en FCE (10151). Pasarlo sigue funcionando igual.

**`--ar` opcional en las notas `E` de bienes y otros.** `nce` y `nde` pedían siempre el comprobante asociado, y ARCA solo lo exige en las notas de servicios (error 2047). Con `--tipo-expo 1` o `4` ahora se pueden emitir sin `--ar` (ni `comprobanteAsociado` en `--cargar`), por ejemplo para un descuento por volumen sobre varias facturas: la nota no hereda nada, así que cliente, domicilio, país de destino y lo demás van por flag, `solicitud` no trae `Cmps_asoc` y `exportacion.comprobanteAsociado` sale `null`, como en la factura. En servicios (el default) sin `--ar` sigue siendo `INPUT_VALIDATION_ERROR`, ahora citando el 2047.

**La actividad de la `E` es opcional.** Sin `--actividad` ni `exportacion.actividad`, la factura y las notas `E` frenaban con "Falta la actividad de exportación", y ARCA no la exige (el error 2100 es solo para el bloque vacío). Ahora van sin el bloque `Actividades`: `solicitud` no lo trae y `exportacion.actividad` sale `[]`. Si la informás, se sigue validando contra la tabla de WSFEX (error 2105). En el modo interactivo la pregunta de la actividad (en la factura `E` y en Repetir) se puede dejar vacía con Enter, y entonces no ofrece guardarla.

**Notas `E` de bienes u otros sobre un comprobante de servicios.** Una `nce` o `nde` de `--tipo-expo 1` o `4` sobre una factura o nota `E` de servicios frenaba con `INPUT_VALIDATION_ERROR` (tipo distinto, otro destino, otra moneda u otra cotización). ARCA solo aplica esos controles (2040 a 2055) cuando la **nota** es de servicios, así que ahora pasa. Una nota de servicios sigue igual. No cambia ninguna clave del `--json`.

**Sin "N/D" en la salida.** Las filas sin dato que no aportan ya no se muestran (el incoterm de una `E` de servicios, la fecha de una cotización que ARCA no informa, el alias de un certificado que no lo tiene, el período de la categoría de monotributo en `padron`). Las que tienen que estar dicen qué pasa: el CAE de un comprobante rechazado o sin CAE dice `sin CAE` (al emitir, en `consultar` y en el detalle de la `E`), en `padron` el nombre, el estado, el domicilio y la condición IVA que ARCA no informa dicen `ARCA no lo informa`, igual que un servidor sin estado en `arcli estado` ("Estado de ARCA"), y una actividad sin descripción sale como `Actividad <id>`. Una nota `E` sobre un comprobante del que ARCA no trae la fecha lo muestra sin la fecha, y un período asociado con una sola punta, como `desde …` o `hasta …`. El `--json` no cambia.

**Preguntas del modo interactivo.** Ninguno de estos cambios del asistente toca un comando, un flag ni el `--json`.

**El monto dice en qué moneda.** Con una moneda extranjera en `config.moneda`, "Emitir factura" y "Emitir recibo" preguntaban "Monto total:" aunque el monto fuera en esa moneda. Ahora la pregunta la nombra: "Monto total en USD:". Lo mismo en las notas ("Monto de la nota de crédito en USD:", con la moneda de la factura o, en una de período, la de la config). Si después elegís otra moneda en los opcionales, el asistente avisa ("Cambiaste la moneda a EUR: escribí el monto en EUR.") y vuelve a pedir el monto en la moneda nueva, antes de la vista previa: el número escrito ya no vale en otra moneda. En la `E` el precio de los ítems nombra la moneda por su código ISO ("Importe en USD:", antes "(DOL)"), y la nota sobre una factura en dólares ofrece "En USD, como el comprobante" (antes "En DOL").

**La `E` siempre pregunta los ítems y el total es su suma.** ARCA exige al menos un ítem, y si no se cargaban, el asistente armaba uno solo con la descripción y el monto, que estaba mal si exportabas, por ejemplo, jugo en litros. Ahora la factura `E` pregunta siempre el primer ítem, con valores por defecto ("Según detalle", cantidad 1 y "unidades", elegida de una lista que se filtra por nombre o código), y del segundo en adelante hasta Enter vacío. Con cantidad 1 la pregunta del precio dice "Importe:", así un servicio se carga con la descripción, Enter, Enter y el importe. Ya no hay pregunta "Monto total" ni "Descripción": el total es la suma de los ítems, y el aviso de que no coincidía con el monto ya no puede pasar. Al terminar muestra el total, para **Confirmar** o **Modificar los ítems** en un editor nuevo: espacio marca un ítem para modificarlo, Backspace para borrarlo (con un punto rojo; otro Backspace lo desmarca), Enter sigue (o aplica lo marcado) y vuelve al total, y "+ Agregar ítem", un botón debajo de la lista, carga uno nuevo. Siempre queda al menos uno. Volver lleva a la pregunta anterior, también entre ítems (de la descripción del ítem 2 al importe del 1), sin perder nada. Si cambiás la moneda, los ítems se conservan y un aviso pide revisar los importes. "Ítems" deja de ser un opcional, y el editor reemplaza "¿Qué hacemos con los ítems ya cargados?": al volver con ítems cargados arranca en él. "Repetir" `E` ya no pregunta "¿Mismo monto?" y las notas `E` ya no preguntan el monto ni el detalle: arrancan en el editor con los ítems de la factura o del comprobante que ajustan (en una nota de crédito, el total no puede superar el de ese comprobante). El comando equivalente lleva `-m` con la suma y, si queda un solo renglón con cantidad 1, "unidades" y sin código, la forma rápida con `--descripcion`; si no, un `--item` por renglón. Con los valores por defecto, la solicitud a ARCA es la misma que antes sin ítems. El CLI no cambia: `--monto` sigue obligatorio y `--item` opcional.

**"En pesos" arranca con la cotización escrita.** En un comprobante en moneda extranjera que se cobra en pesos (opcional "Moneda extranjera" y "Repetir"), la cotización arranca escrita con la que tomaría el CLI sin `--cm`, y la pregunta dice cuál es: la de `cotizacion` de la config si aplica a esa moneda (``Cotización de USD (la de tu config, `cotizacion`, es 1.400):``, con el aviso de clave deprecada) o, si no, la oficial de ARCA (`Cotización de USD (la oficial de ARCA es 1.450):`). Si dejás lo que arrancó escrito, va como con flags sin `--cm` y el comando equivalente no lleva `--cm`; si lo cambiás, es la cotización acordada y va con `--cm`. Antes había que escribirla siempre. Si no se puede consultar la oficial, arranca vacía, como antes. La opción "En pesos" aclara que el comprobante va en la moneda extranjera y se cobra en pesos.

**La `E` en dólares cobrada en pesos pregunta la cotización.** En la factura `E`, sus notas y "Repetir" de bienes u otros, la cotización estaba escondida entre los opcionales: si no se marcaba, iba la de ARCA sin que se viera. Ahora se pregunta después de la moneda (en las notas, después del comprobante que ajustan), con la misma pregunta que "En pesos": arranca escrita con la que toma el CLI sin `--cm`, la de aduana de ARCA (`Cotización de USD (la oficial de ARCA es 1.174,60):`) o, en las notas, la del asociado (`Cotización de USD (la de la factura E es 1.174,60):`). Sin tocarla, el comando equivalente no lleva `--cm`; si la cambiás, sí. Sin conexión arranca vacía. El opcional **Cotización** de la `E` ya no está. En servicios y si te pagan en dólares no se pregunta, porque ARCA exige la suya (errores 2053 y 1604): ahora se muestra en el lugar de la pregunta, con el motivo (`Cotización: 1.174,60 por USD, la de aduana del día hábil anterior. ARCA no acepta otra en servicios.`). En pesos, nada.

**El CBU y la actividad se ofrecen guardar solo si ARCA autoriza el comprobante.** En "Emitir factura" y "Repetir", con un CBU escrito a mano, el asistente preguntaba si guardarlo en la config aunque dejaras la FCE sin emitir o ARCA la rechazara, y en la `E` ofrecía guardar la actividad escrita a mano aunque la dejaras sin emitir. Ahora los dos se ofrecen solo si ARCA autorizó el comprobante (aprobado u observado, con CAE). Las claves `cbu` y `exportacion.actividad` y lo que se guarda no cambian.

**Buscar escribiendo en las listas.** En "Moneda del comprobante" (opcional "Moneda extranjera" de facturas, recibos y notas, y "Repetir") se podía escribir una sola letra: la lista buscaba por el comienzo del nombre, con tildes ("dolar" no encontraba "Dólares"), y borraba lo escrito a los 0,7 segundos sin mostrarlo. Ahora las listas para elegir una opción buscan como **Monedas y cotizaciones** (las de confirmar, la selección múltiple y el editor de ítems no filtran): escribir filtra por palabras, sin tildes ni mayúsculas, lo escrito se ve en `Filtrar:` y queda hasta que lo borrás, y la ayuda de teclas avisa "escribí para filtrar". La moneda se encuentra también por código ISO o de ARCA (`usd`, `dol`, `060`), el incoterm de la `E` por su nombre y el CUIT del país por el número.

**Monedas y cotizaciones en el modo interactivo.** En Consultas, "Cotización de una moneda" pasa a ser **Monedas y cotizaciones**, la tabla de monedas de ARCA donde Enter muestra la cotización oficial de la que elegís, con su nombre (`Euro (060)`); monedas sale de **Tablas de ARCA**, que ya no la repite. Volver a elegir una moneda no consulta ARCA otra vez. `arcli parametros monedas` y `arcli parametros cotizacion` no cambian.

**Configuración del modo interactivo sin "Dónde está la config".** La ruta sigue en `arcli config ruta`, y la carpeta de certificados, en Ver configuración.

**Listas largas del modo interactivo.** Si no entran en la pantalla, avisan cuántas opciones quedan arriba y abajo (`↑ 3 más`, `↓ 12 más`). Si entran, no cambian.

**Listas que se filtran escribiendo.** `Filtrar:` tiene una línea en blanco arriba y abajo, así no queda pegado a la pregunta ni a la lista.

**La vista previa de la `E` termina en el importe total.** El total iba entre las fechas y los ítems, y el importe de cada ítem quedaba pegado a su descripción, a distinta altura en cada renglón. Ahora van los datos hasta las fechas, una línea en blanco, los ítems, otra línea en blanco y el importe total. El importe de cada ítem va en la columna de valores, alineado a la derecha con el total (también con tildes, caracteres de ancho doble o una descripción larga, que se parte dentro de la columna de las etiquetas). Las observaciones y los permisos de embarque pasan arriba de las fechas. En una terminal angosta, cada ítem va con la descripción arriba y el importe debajo, como las demás filas. Es la misma vista previa que muestran `arcli fe`, `nce` y `nde`; `--json` no cambia.

**"Fecha de pago" de la `E` va antes de los opcionales.** En la factura `E` y "Repetir" una `E` de servicios u otros, la fecha de pago se preguntaba al final, después de los opcionales, porque depende de la fecha del comprobante. Ahora va antes: al preguntarla solo rechaza una anterior a la fecha más temprana que ARCA acepta para el comprobante (5 días antes de hoy), y el control exacto lo hacen "Fecha del comprobante" de los opcionales, que no acepta una posterior a la de pago, y el asistente antes de la vista previa: si no elegiste fecha y la de pago queda antes de hoy, vuelve a "Fecha de pago" con el aviso (error 1674). Con Enter sigue siendo la del comprobante. `--fecha-pago` no cambia.

**"Solo hoy" pasa a "Un solo día".** En el período del servicio de "Repetir", la opción aclara que es la fecha del comprobante: hoy o la que elijas en los opcionales.

**"Emitir factura" tiene su descripción en el menú principal,** como las demás opciones: "Factura A, B o C, de crédito (FCE) o de exportación (E)".

**Las preguntas opcionales quedan vacías en el historial.** Al dejar vacía con Enter una pregunta de texto opcional (el ID impositivo y la actividad de la `E`, el alias del CBU de la FCE, el nombre y el domicilio del receptor del PDF), la línea que queda arriba repetía "(Enter para omitirlo)" al lado de la respuesta vacía. Ahora esa aclaración se ve solo mientras se responde, y la línea queda con la pregunta y la respuesta vacía, como cualquier otra.

**Ejemplos de FCE B y C a un CUIT.** Los de `arcli <atajo> --ayuda` y `arcli ejemplos` usaban consumidor final, que ARCA rechaza en FCE.

</details>

### 🐛 Corregido

- **Asistente:** ya no pierde ni cambia lo que respondiste: opcionales, ítems, moneda, Esc al emitir y comando equivalente (#245).
- **Asistente:** controla las fechas y los importes al preguntarlos, en lugar de fallar en la vista previa (#245).
- **Asistente:** "Volver" lleva a la pregunta inmediatamente anterior, con la respuesta marcada (#233).
- **Asistente:** al cambiar una respuesta, solo se descarta lo que depende de ella (#237).
- **Factura E:** una `E` aprobada con observaciones ya no sugiere volver a emitir (#243).
- **Facturas:** consumidor final por defecto, sin flag de receptor, manda `DocNro: 0`, como `--cfinal` (#236).
- **Asistente:** a consumidor final manda `DocNro: 0` y muestra la misma vista previa que el comando (#226).
- **Asistente:** el comando equivalente va con comillas simples y se puede pegar con cualquier texto (#197).
- **Fechas:** `--misma-moneda` con una `--fecha` pasada usa la cotización del día hábil anterior, en lugar de dar error (#220).
- **Facturas:** `--dni` acepta documentos de 6 dígitos (#220).
- **Factura E:** con la tabla de incoterms vacía, `--incoterm` va sin validar y con un aviso (#231).
- **Asistente:** repetir una A o una FCE cuyo receptor era un DNI pide el CUIT al elegirla (#231).
- **Asistente:** el comando equivalente de una nota sobre un comprobante propio ya no lleva `--acuit` (#231).
- **Errores:** las sugerencias de los rechazos `10016` y `10152` explican la fecha, y se reconoce el `10069` (#220).
- **Errores:** el error de `mismaMoneda` con `cotizacionMoneda` en `--cargar` nombra las claves del JSON (#220).
- **Asistente:** "← Volver" queda fijo debajo de las listas largas (#196).
- **Salida:** los paneles miden emojis, caracteres chinos y acentos como la terminal (#198).
- **Salida:** `TERM=dumb` apaga los colores, como `NO_COLOR` (#198).
- **Fechas:** `29/2` sin año toma el año en que esa fecha existe (#193).

<details><summary>Detalle</summary>

**El modo interactivo ya no pierde ni cambia lo que respondiste.** En factura, recibo, FCE, notas, "Repetir" y la `E`. Con flags, `--cargar` y `--json` no cambia nada:

**Los opcionales ya no se pierden al volver atrás.** Si marcabas opcionales, volvías a un paso anterior (por ejemplo, al monto, o con Esc en la fecha de pago de la `E`) y regresabas, la lista aparecía vacía y lo respondido no se aplicaba, aunque la lista lo mostrara; en la `E` había que cargar de nuevo los ítems uno por uno. Ahora arranca con lo marcado y respondido, y los ítems cargados se pueden usar como están (**Usar los N ítems**) o **Cargar de nuevo**. Si cambiás el monto, los ítems se descartan porque tienen que sumarlo. En "Repetir", si elegís otro comprobante, la alícuota y el exento arrancan con lo copiado del nuevo; en "Repetir" una `E`, los ítems, el idioma, el CUIT del país y la descripción del incoterm. En una nota `E`, si elegís otro comprobante asociado, solo la descripción del incoterm arranca de nuevo.

**Un opcional desmarcado de la `E` ya no llega a ARCA.** Si marcabas un opcional, lo respondías, volvías a la lista y lo desmarcabas, igual se aplicaba: por ejemplo, la fecha del comprobante, la cotización o el idioma. Ahora lo desmarcado vuelve a como estaba, como en A, B y C.

**Esc en "¿Emitimos…?" vuelve a la última pregunta.** Después de la vista previa, Esc contaba como "no emitir" y volvía al menú: para corregir un dato había que empezar de cero. Ahora vuelve a la última pregunta con todo lo respondido, y si seguís sin cambiar nada llegás a la misma vista previa. **No, dejar sin emitir** sigue terminando sin emitir, y en producción Esc en la segunda confirmación sigue contando como no. En los comandos con flags, Esc en "¿Emitimos…?" sigue siendo no.

**Si la vista previa rechaza algo, el asistente no vuelve al menú.** Un dato que la vista previa rechazaba (por ejemplo, un "Período hasta" de una nota posterior a su fecha, repetido después del aviso) volvía al menú y se perdía todo. Ahora muestra el error y vuelve a la última pregunta con todo lo respondido; un error de ARCA o de la red sigue como antes. Además, de vuelta en "Período hasta", en la fecha de una factura de otro sistema o en la fecha de pago de la `E` por ese aviso, la misma respuesta ya no pasa, y el aviso dice las dos salidas: corregirla o volver y elegir otra fecha en los opcionales.

**El CUIT del país de la `E` arranca escrito al volver.** En la factura `E` y "Repetir" una `E`, si escribías el CUIT del país y volvías desde la pregunta siguiente, aparecía vacío. Ahora arranca con lo que habías escrito, como el resto de las preguntas.

**La lista de opcionales muestra lo que va.** "CUIT del país" decía "el de la tabla de ARCA" si ARCA no publica un CUIT para el destino y lo dejaste vacío; ahora dice "sin CUIT (va el ID impositivo)". "Período del servicio", sin fechas de servicio, decía "hoy" aunque hubieras cambiado la fecha del comprobante, que es la que se usa (como el CLI sin `--sd` ni `--sh`); ahora muestra esa fecha.

**"Repetir" ya no cambia la moneda de un monto confirmado.** Al repetir una factura en pesos con "¿Mismo monto? Sí", los opcionales ofrecían **Moneda extranjera**, y elegir dólares la emitía por el mismo número en dólares ($ 150.000 pasaba a US$ 150.000). Ahora, con el mismo monto, la moneda queda la del original, en pesos o en otra moneda. Con un monto nuevo en moneda extranjera sigue en esa moneda, como antes; con un monto nuevo en pesos, la moneda se elige en los opcionales, como en "Emitir factura".

**"Repetir" de la `E` valida la actividad como la factura `E`.** Si la factura no traía actividad y la escribías, el asistente aceptaba un código que no está en la tabla de WSFEX y recién la vista previa lo rechazaba (error 2105), volviendo al menú. Ahora la pregunta lo frena con el mismo control y el mismo texto que "Emitir factura" `E` y `--actividad`, y si ARCA autoriza la `E`, ofrece guardar la actividad en la config, como en "Emitir factura". La tabla de actividades se consulta solo si hay que preguntar la actividad.

**Aviso de `cotizacion` deprecada.** Con una moneda extranjera y `cotizacion` en la config, la vista previa del asistente no avisaba que la clave está deprecada, y si la cotización quedaba fuera de rango la sugerencia hablaba de `--cm`. Ahora muestra el mismo aviso y la misma sugerencia que con flags.

**El comando equivalente ya no fija la cotización oficial.** Con una moneda extranjera en `config.moneda` y sin `config.cotizacion`, el comando que muestra el asistente llevaba `--cm` con la cotización oficial de ARCA del día (por ejemplo `--moneda USD --cm 1450`), aunque la vista previa decía que se usaba la oficial: pegado otro día emitía con la cotización vieja. Ahora va sin `--cm`, como lo escribirías con flags, y emite con la oficial del día en que se pega. Lo mismo con `config.cotizacion` (deprecada): el comando no la repite y la toma de la config. Lo que se emite desde el asistente no cambia.

**Fechas completas en el comando equivalente.** Una fecha escrita a medias (`25` en el vencimiento, `1/11` en el período del servicio, el período de la nota o la fecha del asociado) iba igual en el comando equivalente (`--vto 25`), y pegado otro mes daba otra fecha. Lo mismo con la fecha de pago de la factura `E` y de "Repetir" una `E` (`--fecha-pago 25`). Ahora van completas (`--vto 25/11/2026`, `--fecha-pago 25/11/2026`), como ya iba la fecha del comprobante de la `E`. Al volver a la pregunta, arranca escrita completa.

**El modo interactivo controla las fechas y los importes al preguntarlos.** Algunas respuestas pasaban la pregunta y recién fallaban en la vista previa, que volvía al menú y se perdía todo. Ahora cada pregunta aplica la misma regla que los flags y no deja seguir hasta corregirla.

En el período del servicio, "Servicio hasta" no puede ser anterior a "Servicio desde" (10032), y el vencimiento del pago no puede ser anterior a la fecha del comprobante (en una factura FCE, tampoco a hoy, 10164).

La parte exenta más la no gravada no puede superar el monto total. En "Repetir" con otro monto, el exento y el no gravado del original ya no se copian tal cual: el opcional **Importe exento o no gravado** arranca marcado y se vuelven a preguntar. Con el mismo monto se copian como antes.

En una nota por período, el período no puede empezar antes del 01/01/2006, y "Período hasta" no puede ser anterior a "Período desde" ni posterior a la fecha de la nota. Como la fecha de la nota se elige después, en los opcionales, al preguntar el período se acepta hasta la más tardía que ARCA admite para la nota. Si termina después de hoy, elegí esa fecha en "Fecha del comprobante" (si no, el asistente vuelve al período con el aviso). "A un período" ya no sugiere un descuento sobre todo el mes. En las notas, la fecha del comprobante tampoco puede ser anterior al asociado, y la fecha de una factura de otro sistema no puede ser posterior a la nota.

"CUIT del receptor" (y el CUIT o CUIL del consumidor final) no puede ser el CUIT que emite (10069).

Si después cambiás una respuesta anterior y una regla deja de cumplirse, antes de la vista previa el asistente vuelve a la pregunta que la resuelve, con el aviso. Los mensajes nombran la pregunta: "En el período asociado, "Período desde" no puede ser posterior a "Período hasta"." en lugar de los flags. Con flags y con `--cargar` no cambia nada: los mismos controles, con los mismos textos y el mismo `--json`.

**"Volver" en el modo interactivo vuelve a la pregunta anterior, con la respuesta marcada.** En los pasos con dos preguntas, "Volver" desde la segunda saltaba al paso anterior en vez de a la primera (por ejemplo, de "Monto total" a la pregunta previa a "¿Mismo monto?" al repetir, o de "Servicio hasta" a la lista de opcionales). Ahora cada pregunta es un paso y "Volver" lleva a la inmediatamente anterior, en la factura, el recibo, las notas, "Repetir", la `E` y sus opcionales. Además, al volver a una pregunta, lo respondido antes arranca marcado en las listas (moneda de la nota, alícuota, condición IVA, comprobante) y escrito en las de texto (montos, fechas, CUIT, CBU); si cambiás una respuesta, las posteriores que dependían de ella se descartan. No cambia ningún comando, flag ni `--json`.

**El asistente conserva las respuestas que no dependen de la que cambiás.** Al volver y cambiar una respuesta, se olvidaba todo lo respondido después, aunque no tuviera que ver (cambiar la fecha borraba la moneda; cambiar el comprobante, el concepto y el monto). Ahora se descarta solo lo que depende de ella: si cambiás el comprobante, se pregunta de cero a quién va y su condición frente al IVA; si cambiás la moneda, cómo te pagan y la cotización. Lo demás arranca escrito o marcado como lo dejaste. En los opcionales de A, B y C, volver a la lista ya no descarta lo respondido: la lista lo muestra (por ejemplo, la alícuota elegida en lugar de 21%), y si desmarcás un opcional y seguís, lo que habías respondido de él no se aplica. No cambia ningún comando, flag ni `--json`.

**Una `E` aprobada con observaciones ya no sugiere volver a emitir.** Cuando ARCA aprueba una factura o nota `E` con observaciones, el comprobante tiene CAE, pero la salida (y `sugerencias` en `--json`) decía "Revisá observaciones y errores de ARCA antes de volver a emitir.", lo que podía llevar a emitirlo dos veces. Ahora esa sugerencia sale solo cuando ARCA la rechaza, como en A, B y C. No cambia ninguna clave del `--json`.

**Consumidor final por defecto con `DocNro: 0`.** Sin flag de receptor (`arcli fc -m 100 --cs`) y en `--cargar` con `tipoDocumento: consumidor-final` sin `numeroDocumento`, la solicitud a ARCA salía sin `DocNro` y la vista previa mostraba "Número de documento: N/D". Ahora manda `DocNro: 0` y muestra "Receptor: Consumidor final", igual que con `--cfinal`. En el `--json`, la `solicitud` de esos comprobantes suma `DocNro: 0`, como ya tenía con `--cfinal`; el resto no cambia.

**Consumidor final en el modo interactivo.** A consumidor final, el asistente (facturas, recibos, notas y "Repetir") armaba la solicitud a ARCA sin `DocNro`, mientras `--cfinal` y el comando equivalente que muestra mandan `DocNro: 0`, y la vista previa mostraba "Tipo de documento: Consumidor final" y "Número de documento: N/D" en lugar de "Receptor: Consumidor final". Ahora el asistente manda `DocNro: 0` y muestra la misma vista previa que el comando.

**El comando equivalente del modo interactivo se puede pegar con cualquier texto.** Iba entre comillas dobles, así que un `!` en el nombre del receptor (`--receptor-nombre "Hola!"`) disparaba el historial de bash y zsh, en fish un backtick dejaba la barra y en PowerShell `$` no quedaba escapado. Ahora los textos van entre comillas simples (`'Hola!'`; la comilla se escribe `'\''`), y en Windows con las de PowerShell (`''` para la comilla). Los argumentos sin espacios ni símbolos siguen sin comillas.

**`--misma-moneda` con una fecha que no es hoy.** Daba error diciendo que solo se podía consultar la cotización vigente. Ahora, con una `--fecha` pasada, ARCLI pide a ARCA la cotización del día hábil anterior a esa fecha, y con una futura usa la vigente, como dice la regla 10038. ARCA testing aprobó un Recibo B en dólares fechado dos días antes.

**DNI de 6 dígitos.** `--dni` (y el DNI del modo interactivo) aceptaba solo 7 u 8 dígitos; ahora de 6 a 8. ARCA acepta los documentos viejos de menos de un millón.

**Tablas de WSFEX vacías en la `E`.** Si ARCA devuelve vacía la tabla de incoterms, `--incoterm` (y el de una nota `E` de bienes, que sale del asociado) ya no frena con "El incoterm … no existe": va sin validar, como la actividad con su tabla vacía, y las dos suman un aviso en `avisos`. En el modo interactivo, el incoterm se escribe a mano. No cambia ninguna clave del `--json`.

**Repetir una A a un DNI en el modo interactivo.** Repetir una factura o un recibo A (o una FCE) cuyo receptor era un DNI, un CUIL o consumidor final avisa al elegirlo que ARCA solo lo acepta a un CUIT (10013, 10015) y pide el CUIT, en lugar de llegar a la vista previa y rechazarse ahí.

**Comando equivalente de una nota en el modo interactivo sin `--acuit`.** En una nota A, B o C sobre un comprobante propio, el comando que muestra el asistente ya no lleva `--acuit` con tu CUIT, que es lo que toma el CLI sin el flag. En las notas FCE sigue, porque ARCA exige el CUIT del asociado.

**Sugerencias de los rechazos por fecha.** La del `10016` ahora también explica la fecha fuera de rango, que es lo que ARCA rechaza con ese código, y la del `10152` dice lo que es: una fecha futura en otro mes, en productos y FCE. El receptor igual al emisor se reconoce también por el código `10069`.

**Mensaje de `mismaMoneda` con `cotizacionMoneda` en el JSON de `--cargar`.** El error nombraba los flags `--misma-moneda` y `--cm` aunque los dos datos vinieran del archivo; ahora nombra las claves del JSON.

**"← Volver" se iba de la pantalla en las listas largas del modo interactivo.** Se desplazaba con las opciones y quedaba fuera de la vista hasta llegar al final. Ahora queda fijo debajo de la lista, también en las que se filtran escribiendo (monedas y tablas largas de ARCA), que no lo tenían; se llega con la flecha abajo desde la última opción, y Esc sigue volviendo. En una terminal baja, la lista se achica para que entre.

**Paneles desarmados con emojis, caracteres chinos o una `é` pegada desde macOS.** ARCLI medía el texto por cantidad de caracteres y no por las columnas que ocupa en la terminal, así que con un nombre como `Café 🧾` o `東京` el borde derecho quedaba corrido. Ahora se mide como la terminal, y una palabra larga se corta sin partir un emoji ni separar una letra de su acento. No cambia el `--json`.

**`TERM=dumb` sin colores.** En terminales que no entienden códigos de escape (Emacs `M-x shell`, algunas consolas de CI) la salida traía códigos de color sueltos. Ahora `TERM=dumb` los apaga, como `NO_COLOR`. `FORCE_COLOR=1` sigue forzándolos y `NO_COLOR` sigue ganando sobre los dos.

**`29/2` sin año cerca de un bisiesto.** El año se elegía sin mirar si ese 29/02 existía, así que el 1/9/2028 `--fecha 29/2` (o `--vto`, `--sd`, `--sh`) daba "no es válida" en lugar de tomar el 29/02/2028. Ahora solo cuentan los años donde la fecha existe. No cambia ninguna otra fecha.

</details>

## [2.5.2] - 2026-11-18

Arreglos de la factura `E` y de las notas, revisados contra los manuales de ARCA: se pueden volver a hacer notas sobre facturas de Comprobantes en línea o de un controlador fiscal. La `E` de servicios en moneda extranjera y la `E` en pesos ya no salen rechazadas en producción.

> [!WARNING]
> **Puede afectar scripts**
>
> - En la `E` en pesos, `solicitud` del `--json` ya no trae `CanMisMonExt`.
> - En la `E` a un destino sin CUIT en la tabla de ARCA, con `--id-impositivo` y sin `--cuit-pais`, ya no hay error: `solicitud` no trae `Cuit_pais_cliente` y `exportacion.cuitPaisCliente` es `null`.
> - Una nota A, B, C o FCE cuyo asociado no está en ARCA y es de un punto de venta que no es de web service ya no frena: sigue con un aviso en `avisos`.
>
> Fuera de eso, no cambia ningún comando, flag, clave de config ni clave de `--json`.

---

### 🐛 Corregido

- **Notas:** una nota sobre una factura de Comprobantes en línea o de un controlador fiscal se puede volver a hacer (#212).
- **Factura E:** la `E` en pesos ya no manda `CanMisMonExt`, que ARCA rechaza en producción (#212).
- **Factura E:** la `E` de servicios en moneda extranjera usa la cotización del día hábil anterior y no sale rechazada (#212).
- **Factura E:** `--cuit-pais` no es obligatorio si ARCA no publica el CUIT del destino: alcanza con `--id-impositivo` (#212).
- **Factura E:** acepta cotizaciones menores a 1, como las del guaraní o el peso colombiano (#212).

<details><summary>Detalle</summary>

**Una nota sobre una factura de Comprobantes en línea o de un controlador fiscal se puede volver a hacer.** Desde la 2.5.1, una nota A, B, C o FCE cuyo asociado no estaba en ARCA frenaba con `INPUT_VALIDATION_ERROR`, y la consulta de ARCA (`FECompConsultar`) solo ve lo emitido por web service: quien pasaba de Comprobantes en línea a ARCLI no podía hacer una NC sobre una factura vieja. Ahora frena solo si el punto de venta del asociado es uno de tus puntos de venta de web service (ahí es casi seguro un número mal escrito). Si no lo es, la nota sigue con un aviso en `avisos`, sin controlar el tope de la NC, que recuerda pasar `--afecha` (ARCA la exige para controlador fiscal y FactuWeb, error 10211); en NC/ND FCE sin `--afecha` sigue siendo error, porque la fecha no se puede tomar de ARCA. Si no se pueden consultar los puntos de venta, también es un aviso. En el modo interactivo, al ingresar a mano una factura así, el aviso explica que la nota se hace por período o con flags.

**La factura `E` en pesos ya no manda `CanMisMonExt`.** ARCLI lo mandaba en `N` en toda factura `E`, y con `--moneda ARS` (o `PES`) ARCA pide que ese campo no se informe (error 1605). Testing lo acepta, pero en producción la `E` en pesos saldría rechazada. Ahora no se manda, así que `solicitud` del `--json` de una `E` en pesos deja de traer `CanMisMonExt`; `exportacion.mismaMoneda` sigue en `false`. En moneda extranjera no cambia nada.

**La `E` de servicios en moneda extranjera ya no sale rechazada por la cotización (error 2053).** Sin `--cotizacion-moneda`, ARCLI pedía la cotización de aduana del día del comprobante, y en servicios ARCA exige la del día hábil anterior. Una `E` de servicios con fecha pasada salía rechazada siempre, y una de hoy, en cuanto ARCA publicaba la del día. Ahora en servicios (`--tipo-expo 2`, el default) se usa la del día hábil anterior a la fecha del comprobante: un lunes o después de un feriado, la del último día hábil, con un aviso. Con `--misma-moneda` también, en cualquier tipo, como pide el manual de ARCA. Bienes, otros y las notas `E` (que heredan la cotización del asociado) no cambian.

**`--cuit-pais` ya no es obligatorio en la `E` cuando ARCA no publica el CUIT del destino.** 155 de los 303 destinos no tienen CUIT en la tabla de ARCA (Irlanda, Alemania, Emiratos, Panamá, Hong Kong, Rusia, las zonas francas y el AAE de Tierra del Fuego, entre otros), y la única salida era pasar el CUIT de otro país. ARCA pide el CUIT del país **o** el ID impositivo del cliente (error 1580), así que ahora alcanza con `--id-impositivo` (o `idImpositivo` de `--cargar`): `Cuit_pais_cliente` no se manda, `solicitud` del `--json` no lo trae y `exportacion.cuitPaisCliente` sale `null`. Sin ninguno de los dos, `INPUT_VALIDATION_ERROR` pide uno. En el modo interactivo el CUIT del país se puede dejar vacío y entonces se pide el ID impositivo. Cuando la tabla trae el CUIT, todo sigue igual.

**La `E` acepta cotizaciones menores a 1.** `--cotizacion-moneda` (o `cotizacionMoneda` de `--cargar`, o la cotización del modo interactivo) tenía que ser mayor a 1, y hay monedas que valen menos de un peso, como el guaraní (`029`) o el peso colombiano (`032`). Además, toda nota `E` sobre una factura en esas monedas fallaba, porque hereda su cotización. Ahora alcanza con que sea mayor a 0, como pide ARCA (error 1600). En A, B y C no había esa regla: solo se rechaza la cotización 1 en moneda extranjera.

</details>

## [2.5.1] - 2026-11-18

Arreglos de un chequeo de la 2.5.0 contra ARCA testing: la factura `E` de bienes se puede volver a emitir (ARCA la rechazaba con el error 1673). Además, una nota cuyo asociado propio no existe ya no se emite.

> [!WARNING]
> **Puede afectar scripts**
>
> - Una nota A, B, C o FCE cuyo asociado propio no existe en ARCA ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR`. Las notas de débito también consultan el asociado antes de la vista previa.
> - `arcli padron --json` trae cada actividad una sola vez.
> - En la `E` de bienes, `solicitud` del `--json` ya no trae `Fecha_pago`, porque no se manda a ARCA; `--fecha-pago` se acepta y se ignora con un aviso.
>
> Fuera de `Fecha_pago` en la `solicitud` de la `E` de bienes, no cambia ningún comando, flag, clave de config ni clave de `--json`.

---

### 🐛 Corregido

- **Factura E:** la `E` de bienes se puede emitir: la fecha de pago va solo en servicios y otros (#204).
- **Notas:** una nota A, B, C o FCE con un asociado propio que no existe frena antes de emitirse (#205).
- **Consultas:** `arcli padron --json` ya no repite actividades (#205).
- **Errores:** las sugerencias de las observaciones `10217` y `10017` explican cada una la suya (#205).
- **Errores:** un receptor que no está en los padrones de ARCA tiene una sugerencia propia (#205).
- **Config:** los errores de `arcli config establecer` nombran la clave, el valor recibido y los valores válidos (#205).
- **Errores:** los avisos de `--cargar` nombran las claves del JSON en lugar de los flags (#205).
- **Docs:** los ejemplos de la `E` ya no traen un número fijo, que ARCA rechazaba por correlatividad (#205).

<details><summary>Detalle</summary>

**La factura `E` de bienes se puede emitir.** ARCLI mandaba siempre la fecha de pago y ARCA rechazaba la `E` de bienes (`--tipo-expo 1`) con el error 1673. Ahora la fecha de pago va solo en servicios y otros (`--tipo-expo 2` y `4`), como pide ARCA. En bienes, `--fecha-pago` (o `fechaPago` de `--cargar`) se sigue aceptando pero no se usa y sale un aviso en `avisos`; `solicitud` del `--json` deja de traer `Fecha_pago`, porque ya no se manda. El modo interactivo no pregunta la fecha de pago en bienes. Las notas `E` no cambian.

**Una nota A, B, C o FCE con un asociado propio que no existe ya no se emite.** Antes de la vista previa ARCLI consultaba el asociado, veía que no estaba y seguía, y ARCA testing llegó a aprobar una NC asociada a una factura inexistente. Ahora frena con `INPUT_VALIDATION_ERROR` ("ARCA no tiene la factura B 00003-00099999.", con la sugerencia de revisar `--ar`, `--apv` y `--ac`), como en las notas `E`. También en las notas de débito, que antes no se consultaban. El asociado de otro CUIT no se puede consultar y sigue decidiéndolo ARCA; si ARCA no responde, la nota sigue con un aviso.

**`arcli padron --json` repetía actividades.** ARCA informa las mismas en el régimen general y en el monotributo, y `actividades` las traía dos veces (también el "y N más" de la salida humana). Ahora van sin repetir, en el mismo orden. Las claves no cambian.

**La sugerencia de la observación `10217` decía otra cosa.** Hablaba de "la condición del receptor (padrón)", igual que la `10017`. Ahora cada una explica la suya: la `10217` es la del crédito fiscal de una factura A a un monotributista ("Procedimiento permanente de transición al Régimen General") y la `10017`, la de un receptor que no figura activo en el padrón.

**Receptor que no está en los padrones de ARCA.** El rechazo "DocNro … no se encuentra registrado en los padrones" llega en `observaciones` con `errores` vacío y solo traía la sugerencia genérica. Ahora `sugerencias` dice que se revise el documento del receptor y que en testing muchos CUITs no están en el padrón de facturación.

**Errores de `arcli config establecer` que no decían qué clave fallaba.** `config establecer emisor.condicionIva Inscripto` respondía "Entrada tiene un valor no soportado" y sugería `arcli ayuda`. Ahora el mensaje nombra la clave, el valor recibido y los valores válidos (`` `emisor.condicionIva` no acepta "Inscripto". Valores válidos: … ``), y la sugerencia lleva a `arcli config establecer --ayuda` y `arcli config`. Igual en `entorno`, `concepto`, `ivaReceptor`, `pdf`, `moneda`, las claves de sí/no, los números y los textos vacíos, y una clave que no existe lo dice. En `--json` cambian solo `error` y `sugerencia`: `codigo` sigue siendo `INPUT_VALIDATION_ERROR` y `detalles` trae lo mismo que antes.

**Los avisos de `--cargar` nombraban flags.** Con `descripcion`, `condicionVenta`, `receptorNombre` o `receptorDomicilio` en el JSON y sin PDF, el aviso hablaba de `--descripcion`, `--receptor-nombre`… aunque los datos vinieron del archivo. Ahora nombra las claves del JSON (`Las claves "descripcion" y "receptorNombre" del JSON de \`--cargar\` solo se usan en el PDF…`), y solo las que vinieron. Igual con `"dia"`(deprecada), con`"descripcion"`junto a`"items"`en la`E`y con`"comprobanteAsociado.fecha"`en las notas`E`. Solo cambia el texto de `avisos`.

**Ejemplos de la `E` con número fijo.** `ejemplos/factura-exportacion-e.json` traía `"numero": 3` y los ejemplos de `fe`, `nce` y `nde` de la documentación, `--numero` o `"numero"`: copiados tal cual, ARCA los rechazaba por correlatividad. Desde la 2.5.0 el número es opcional, así que los ejemplos ya no lo traen y ARCLI toma el siguiente.

</details>

## [2.5.0] - 2026-11-17 · Notas E y consultas

Las notas de crédito y débito de la factura de exportación `E`, Consultas en el asistente y el sitio de documentación en [arcli.com.ar](https://arcli.com.ar). Completa lo que trajo la 2: el modo interactivo queda al nivel del CLI, con opcionales, repetir la `E` y el PDF al confirmar.

#### Notas de crédito y débito de la `E`

`arcli nce` y `arcli nde` ajustan una factura `E` ya emitida: el cliente, el destino, la moneda y la cotización salen de la factura, y el número lo toma ARCLI de ARCA.

```sh
arcli nce -m 500 --ar 1 --apv 4
```

#### Consultas en el asistente

Tus comprobantes, los datos de un CUIT, si un cliente recibe FCE, la cotización de una moneda y las tablas de ARCA, sin salir del modo interactivo. Después del padrón, la factura a ese CUIT arranca con sus datos.

```sh
arcli
```

#### La `E` sin número a mano

`--numero` deja de ser obligatorio en `fe`, `nde` y `nce`, y la `E` entra en `ultimos` y `consultar`.

```sh
arcli ultimos fe
```

#### El PDF se elige al emitir

"¿Emitimos…?" ofrece emitir, emitir y generar el PDF o dejar sin emitir, diga lo que diga la clave `pdf`.

#### Documentación en arcli.com.ar

Una página por comprobante, guías cortas, buscador y problemas frecuentes que se filtran mientras escribís.

> [!WARNING]
> **Puede afectar scripts**
>
> - Una nota de crédito A, B, C o FCE mayor que su factura ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR`.
> - `--afecha` en las notas FCE y `--numero` en `fe`, `nde` y `nce` dejan de ser obligatorios: sin ellos, ARCLI los toma de ARCA.
> - `arcli config --json` trae `filasPorLista` y, mientras dure la deprecación, también `comprobantesPorLista` y `deprecado`.
> - En `arcli certificado generar --json`, `guia` apunta a arcli.com.ar.
>
> No cambian los nombres de comandos, flags ni claves existentes, ni las claves del `--json` y de `--cargar`, ni los `codigo` de error. Hay deprecaciones para la 3.0.0: ver "Deprecado".

---

### ✨ Agregado

- **Factura E:** notas de crédito y débito de exportación con `arcli nce` y `arcli nde`, que toman los datos de la factura (#140).
- **Factura E:** `arcli ultimos fe` y `arcli consultar fe` listan y muestran los comprobantes de exportación (#144).
- **Asistente:** Consultas reúne tus comprobantes, datos de un CUIT, régimen FCE, cotizaciones y tablas de ARCA (#166).
- **Asistente:** la `E` y sus notas suman opcionales, como ítems, idioma y descripción del incoterm; la factura, también el CUIT del país (#162).
- **Asistente:** más opcionales: fecha del comprobante, receptor por CUIL, todas las monedas de ARCA y opcionales en las notas (#160).
- **Asistente:** "Repetir un comprobante anterior" ofrece la factura `E` (#163).
- **Asistente:** la `E` y sus notas en "Consultar comprobantes", con el mismo detalle que `arcli consultar fe` (#159).
- **Asistente:** la `E` de bienes y sus notas preguntan los permisos de embarque (#148).
- **Asistente:** en una FCE pide el alias del CBU y ofrece guardar el CBU escrito a mano (#163).
- **Config:** la clave `filasPorLista` reemplaza a `comprobantesPorLista` y cuenta también las filas de las tablas (#167).
- **Config:** la variable `ARCLI_CONFIG_DIR` usa otra carpeta de config sin tocar la de siempre (#142).
- **Consultas:** `arcli parametros <tabla>` tiene encabezado y dice para qué sirve el código en ARCLI (#166).
- **Docs:** el sitio de documentación [arcli.com.ar](https://arcli.com.ar), con buscador y problemas frecuentes que se filtran (#150).
- **Docs:** una página por comprobante y guías cortas por tema, con link a la guía completa (#158).
- **Instalación:** un prompt para instalar o actualizar ARCLI con un asistente de IA (#146).

<details><summary>Detalle</summary>

**Notas de crédito y débito de exportación E.** `arcli nce` y `arcli nde` (también `arcli nota-credito e` y `arcli nota-debito e`) ajustan una Factura de exportación `E` ya emitida. Alcanza con el monto, el asociado (`--ar`, y `--apv` si es de otro punto de venta) y `--numero`: el cliente, el destino, la moneda, la cotización y la actividad salen de la factura, que ARCLI consulta en ARCA. En las de bienes, los permisos de embarque son opcionales y van con `--permiso`, sin `--permiso-existente`. Antes de emitir valida lo que ARCA va a controlar contra el asociado: que exista, que la nota no sea anterior, que una nota de crédito no lo supere y, en servicios, el mismo destino, moneda y cotización. En `--cargar`, `comprobanteAsociado`; en el `--json`, `exportacion.comprobanteAsociado` (`null` en la factura). También en el modo interactivo, al elegir la factura de exportación como comprobante original de una nota. No cambia nada de la factura `E` ni de A, B y C.

**`ultimos` y `consultar` con la E.** `arcli ultimos fe` (también `nde` y `nce`) lista los últimos comprobantes de exportación y `arcli consultar fe <numero>` muestra uno, con cliente, destino, moneda, total y comprobante asociado. El JSON de la E tiene sus propias claves (`cliente`, `destino`, `moneda`, `total`, `comprobanteAsociado`), porque no tiene receptor con documento ni IVA.

**Consultas en el modo interactivo.** "Consultar comprobantes" pasa a ser **Consultas**, con todo lo que el CLI consulta: **Mis comprobantes** (lo de antes), **Datos de un CUIT** (`arcli padron`), **Si un cliente recibe FCE** (`arcli fce-obligado`, con la fecha de hoy), **Cotización de una moneda** y **Tablas de ARCA** (las nueve de `arcli parametros`). Después del padrón, **Emitir una factura a este CUIT** arranca la factura con el CUIT, el nombre, el domicilio y la condición IVA ya cargados. Las tablas largas y la lista de monedas se filtran escribiendo (`eur`, `060` o `usd`) y se desplazan con las flechas; las filas por página son las de `filasPorLista`. Un error de ARCA vuelve a Consultas en lugar de al menú. Configuración suma **Dónde está la config** (`arcli config ruta`).

**La E completa en el modo interactivo.** La factura `E` y sus notas terminan con "¿Agregamos algún opcional?", como A, B y C: ítems (descripción, cantidad, precio y unidad, uno por uno), idioma, observaciones y observaciones comerciales, descripción del incoterm y cotización a mano. La factura también deja elegir el CUIT del país y, si ARCA no publica uno para el destino, lo pide (se escribe o se busca el país por nombre): antes el asistente no tenía salida. Las notas `E` ahora pueden ajustar otra nota `E`, no solo la factura. El comando equivalente incluye los flags nuevos (`--item`, `--idioma`, `--cuit-pais`, `--observaciones`, `--obs-comerciales`, `--incoterms-desc`, `--cm` y `--ac`). Sin marcar nada, todo sigue igual.

**Más opciones en el modo interactivo.** El paso de opcionales suma la **fecha del comprobante** (`--fecha`), en facturas, recibos, notas y al repetir, con la misma ventana de días que el CLI según el concepto: sirve, por ejemplo, para facturar con fecha de fin de mes. El receptor se puede identificar por **CUIL** (en B y C), y la moneda extranjera ofrece **euros y el resto de las monedas de ARCA**, con la cotización acordada o la oficial. Las notas de crédito y débito tienen ahora sus opcionales: fechas de servicio y vencimiento (`--sd`, `--sh`, `--vto`), exento y no gravado en las parciales, y moneda en las de período. El comando equivalente incluye todos esos flags.

**Repetir una factura E en el modo interactivo.** "Repetir un comprobante anterior" ahora ofrece la factura de exportación `E`. Copia de la factura que devuelve ARCA el cliente, el destino, la moneda, el incoterm, los ítems, la forma de pago, el idioma y la actividad; sale con fecha de hoy y la cotización del día, y pregunta el monto, los permisos de embarque y la fecha de pago. Si algún ítem tiene bonificación o no suman el total, avisa y sale un renglón con el monto total.

**La E en "Consultar comprobantes" del modo interactivo.** La lista de tipos ahora incluye la factura de exportación `E` y sus notas de crédito y débito (`fe`, `nce`, `nde`), con los últimos emitidos, **Cargar más…**, **Ingresar el número a mano…** y el mismo detalle que `arcli consultar fe`. Antes solo estaban los 19 tipos de A, B y C.

**Permisos de embarque en el modo interactivo.** La factura `E` de bienes pregunta los permisos de embarque ya existentes (opcional, separados por coma), igual que `--permiso` con `--permiso-existente`. Las notas `E` sobre una factura de bienes también los preguntan.

**Alias del CBU y guardar el CBU escrito a mano.** Si en una FCE del modo interactivo el CBU se escribe porque no está en la config, también pide el alias cuando falta `aliasCbu` (Enter lo omite, como sin `--alias`), y al final ofrece guardar los dos (`cbu` y `aliasCbu`), como ya pasaba con la actividad de la `E`.

**Clave de config `filasPorLista`** (1 a 50, por defecto 15): reemplaza a `comprobantesPorLista`, que ya no cuenta solo comprobantes sino también las filas de las tablas de ARCA y la lista de monedas del modo interactivo. Hace lo mismo: cuántas filas muestran `arcli ultimos` (sin `--cantidad`) y las listas del modo interactivo. `arcli config establecer filasPorLista 25`.

**`ARCLI_CONFIG_DIR`.** Una variable de entorno para usar otra carpeta de config, con su `config.json`, tickets, plugins y certificados. Sirve para tener una config aparte sin tocar la de siempre. Sin la variable, todo sigue igual.

**Encabezado y ayuda en `arcli parametros <tabla>`.** El listado tiene una fila de encabezado (`CÓDIGO`, la descripción y, en `iva-receptor` y `puntos-venta`, una tercera columna) y al pie para qué sirve el código en ARCLI. Es salida humana: el `--json` no cambia.

**Sitio de documentación.** [arcli.com.ar](https://arcli.com.ar), con menú por tarea (Empezar, Formas de uso, Comprobantes, Más, Referencia, Ayuda), buscador, problemas frecuentes que se filtran mientras escribís, tema claro u oscuro según el sistema y buena lectura en el celular. Tiene las mismas guías que `docs/` y se actualiza con cada versión. Cada página tiene su descripción para los buscadores y para la vista previa al compartir el link, y el ícono de ARCLI se ve también en la pantalla de inicio del celular. Cuenta las visitas con Cloudflare Web Analytics, que no usa cookies ni sigue a nadie entre sitios.

**Docs por tema.** Una página por comprobante ([¿qué comprobante me toca?](docs/comprobantes/README.md)), con un ejemplo y sus opciones en Obligatorio, Opcional y Al ejecutar, cada flag con su largo, su corto y sus valores; las notas de crédito y débito por separado. Formas de uso ([asistente](docs/formas-de-uso/asistente.md), [comandos](docs/formas-de-uso/comandos.md) y [con IA](docs/formas-de-uso/con-ia.md)), el certificado de [testing](docs/certificado-testing.md) y de [producción](docs/certificado-produccion.md) en pasos cortos con las capturas plegadas, [cómo funciona](docs/mental-model.md), un índice de [comandos](docs/comandos.md) y el [PDF](docs/pdf-en-corto.md) en corto, cada uno con link a su guía completa. Suman [cambiar de entorno](docs/entornos.md), [consultas](docs/consultas.md), [notas](docs/notas-credito-debito.md), [FCE](docs/fce.md), [exportación](docs/exportacion.md) y [lotes y JSON](docs/lotes-y-json.md). Los links viejos siguen andando: `obtencion-certificados.md` y `usage-patterns.md` quedan como índice. El sitio publica además `llms-full.txt`, con toda la documentación en un archivo para asistentes de IA.

**Instalar o actualizar con IA.** El README trae un prompt corto, listo para copiar en un asistente de IA (Claude, ChatGPT, Gemini, Copilot…), que revisa Node, instala o actualiza ARCLI, lo verifica y crea el acceso directo la primera vez. Si el asistente no puede ejecutar comandos, te guía paso a paso.

</details>

### 🔧 Cambiado

- **PDF:** el PDF se elige al confirmar la emisión: emitir, emitir y generar el PDF o dejar sin emitir (#165).
- **Notas:** una nota de crédito mayor que su factura frena antes de ir a ARCA (#161).
- **FCE:** `--afecha` deja de ser obligatoria en las notas FCE: ARCLI toma la fecha del asociado (#161).
- **Factura E:** `--numero` deja de ser obligatorio en `fe`, `nde` y `nce`: ARCLI usa el siguiente de ARCA (#144).
- **Asistente:** "¿Emitimos…?" tiene los mismos botones que el CLI con flags (#164).
- **Asistente:** pide el punto de venta al empezar si la config no tiene uno (#164).
- **Asistente:** las listas dicen "Factura C" sin el atajo del comando (#172).
- **Docs:** los links del CLI llevan a [arcli.com.ar](https://arcli.com.ar) en lugar de GitHub (#176).
- **Docs:** las guías muestran las dos formas de cargar el certificado, con la recomendada primero (#149).

<details><summary>Detalle</summary>

**El PDF se elige al confirmar la emisión.** Cuando ARCLI pregunta "¿Emitimos…?" antes de emitir (sin `--emitir`, en una terminal), en el CLI y en el modo interactivo, las opciones son siempre **Sí, emitir ahora**, **Sí, emitir y generar el PDF** y **No, dejar sin emitir**, diga lo que diga la config `pdf`, y lo elegido decide. Con `pdf preguntar` (el valor por defecto) ya no hay una segunda pregunta, "¿Generamos el PDF del comprobante?", después de emitir. Con `pdf siempre` se puede emitir sin PDF (el cursor arranca en la opción con PDF), y con `pdf nunca` aparece la opción para generarlo esa vez. Con `--exportar-pdf` o `--sin-pdf` el PDF ya está decidido y la pregunta solo ofrece emitir o no. Al emitir sin confirmar (`--emitir`, `emitir true`, `--json` o sin terminal) todo sigue igual: decide la config. Vale para todos los comprobantes, también la `E`, sus notas y el Recibo C.

**Una nota de crédito mayor que su factura ya no se emite.** En una NC A, B, C o FCE, ARCLI consulta en ARCA el comprobante asociado antes de la vista previa y, si la nota supera su total (en la misma moneda), frena con un error de validación (`INPUT_VALIDATION_ERROR`) que sugiere el `--monto` para anularla entera. Antes la mandaba igual y decidía ARCA. Es el mismo control que ya tenían las notas `E` y el modo interactivo, y ahora los tres dicen lo mismo: `La nota de crédito por $ 150.000 no puede superar el total de la factura C 00003-00000045, de $ 120.000.` La consulta es una por nota y se reusa al emitir. En un lote, el error sale con su índice antes de preguntar si se emite. Solo se consulta un asociado tuyo; con `--acuit` de otro CUIT no se controla, y si ARCA no responde la nota sigue con un aviso.

**`--afecha` deja de ser obligatoria en las notas FCE.** En `ncea`…`ndec`, sin `--afecha`, ARCLI toma la fecha del asociado de ARCA, como en las notas `E`, y la vista previa ya la muestra. Si la pasás, se sigue usando la tuya. Si ARCA no tiene el asociado o no responde, frena y sugiere pasar `--afecha`.

**`--numero` deja de ser obligatorio en `fe`, `nde` y `nce`.** Sin el flag, ARCLI consulta en ARCA el último número de ese tipo en el punto de venta y usa el siguiente, también en la vista previa. `--numero` (o `numero` en `--cargar`) sigue andando para fijarlo a mano. El modo interactivo ya no lo pregunta. Si una emisión de la E queda sin confirmar (`EMISSION_UNCERTAIN`), la sugerencia ahora también manda a verificarla con `arcli consultar`.

**Mismos botones al emitir en el modo interactivo y en el CLI.** El asistente pregunta "¿Emitimos…?" con **Sí, emitir ahora** y **No, dejar sin emitir**, como los comandos con flags (antes, "Emitir ahora" y "Cancelar"). En producción sigue pidiendo una segunda confirmación, ahora con **Sí, emitir en producción** y **No, dejar sin emitir**. El CLI con flags sigue preguntando una sola vez.

**El modo interactivo pide el punto de venta al empezar si la config no tiene uno.** Factura, recibo, factura `E`, notas, repetir y consultar lo preguntan antes del primer paso, en lugar de completar todo y frenar al final con un error que hablaba de flags del CLI. El comando equivalente lo lleva con `--pv`. Con un punto de venta en la config, no cambia nada.

**Listas del modo interactivo sin el atajo del comando.** Al elegir el comprobante (al emitir, en las notas y en Consultas) dice "Factura C" en lugar de "Factura C (fc)". El comando se sigue mostrando al final, en el comando equivalente.

**Los links del CLI llevan al sitio de documentación.** Las guías que nombran los mensajes (certificado, punto de venta para web service, problemas frecuentes y novedades) abren su página en [arcli.com.ar](https://arcli.com.ar) en lugar del archivo en GitHub. El aviso de un certificado de producción por vencer lleva a cómo renovarlo. `arcli --ayuda` suma `Documentación: https://arcli.com.ar`, y el modo interactivo lo muestra al empezar la configuración guiada y al salir. En `arcli certificado generar --json`, el campo `guia` trae la URL nueva; los campos no cambian.

**Certificados.** La guía para obtenerlos, el README y la resolución de problemas muestran las dos formas de cargar el certificado: `arcli certificado generar` e `importar` (la recomendada, con la que ya no hay que configurar nada) o, si la clave se hizo con openssl, las rutas a mano con `arcli config establecer`.

</details>

### ⏳ Deprecado

- **Config:** `comprobantesPorLista` pasa a `filasPorLista` y se saca en la 3.0.0 (#167).

<details><summary>Detalle</summary>

**`comprobantesPorLista`**, ahora `filasPorLista`; se saca en la 3.0.0. Hasta entonces se sigue leyendo del archivo de config (si están las dos, gana `filasPorLista`), `arcli config establecer comprobantesPorLista N` avisa y guarda `filasPorLista` (y saca la vieja), y `arcli config --json` trae las dos con el mismo valor, más `deprecado`.

</details>

### 🐛 Corregido

- **PDF:** sin documento ni domicilio, el PDF muestra `-` y no `- -` (#178).
- **Asistente:** el comando equivalente lleva el nombre y el domicilio del padrón, así saca el mismo PDF (#164).
- **Asistente:** usa los defaults de la config (moneda, IVA receptor, alícuota y concepto), como el CLI (#164).
- **Asistente:** la configuración guiada pide el certificado del entorno activo, no siempre el de testing (#164).
- **Asistente:** repetir un comprobante en moneda extranjera sale en la moneda del original (#155).
- **Asistente:** avisa lo mismo que los comandos con flags, como el uso de la cotización oficial (#143).

<details><summary>Detalle</summary>

**Datos vacíos del receptor en el PDF.** A un consumidor final sin identificar, el PDF muestra `Documento: -` en lugar de `Documento: - -`, y sin domicilio, `Domicilio: -`. Lo mismo con el nombre de un receptor identificado que no lo tiene cargado. Vale para A, B, C y el Recibo C.

**El comando equivalente del modo interactivo saca el mismo PDF.** Con un CUIT, ahora lleva el nombre y el domicilio que trajo el padrón (`--receptor-nombre` y `--receptor-domicilio`). Como siempre lleva `--ir`, el CLI no consultaba el padrón y el comando pegado generaba el PDF sin esos datos.

**El modo interactivo usa los defaults de la config, como el CLI.** La factura y el recibo arrancan en la moneda de la config (`moneda`) en lugar de siempre en pesos; con una extranjera, sin tocar nada, va con la cotización oficial de ARCA (o la guardada en `cotizacion`), igual que sin `--moneda`. Las notas de crédito y débito proponen el IVA receptor de la config (`ivaReceptor`), la alícuota (`alicuota`) cuando no sale de la factura y, en las de período, el concepto (`concepto`) y la moneda. Al repetir un comprobante se sigue usando la moneda del original.

**Configuración guiada en el entorno activo.** Pide el certificado y la clave del entorno en que se va a emitir (`entorno`, o `arcli interactivo --produccion`/`--testing`), no siempre los de testing. Con `entorno produccion`, el asistente proponía la guiada al abrir pero nunca completaba lo que faltaba. El chequeo al abrir también respeta `--produccion`/`--testing`.

**Repetir un comprobante en moneda extranjera.** En el modo interactivo, repetir una factura o un recibo en dólares, euros u otra moneda ahora sale en la moneda del original y solo pregunta la cotización (la acordada o la oficial de ARCA). Antes arrancaba en pesos: si se desmarcaba "Moneda extranjera", el monto en dólares se emitía como si fueran pesos, y uno en euros no se podía repetir. Si ARCA no tiene la cotización oficial, no se emite.

**El modo interactivo avisa lo mismo que los comandos con flags.** En moneda extranjera, que usa la cotización oficial de ARCA. Antes ese aviso solo salía con flags. La preparación de la emisión ahora es una sola para los dos.

</details>

## [2.4.0] - 2026-11-08 · Acceso directo

El acceso directo con doble clic, una salida en terminal más prolija y pareja, y arreglos para quien empieza sin saber de terminal. Los rechazos de ARCA más comunes dicen qué hacer, y la moneda extranjera usa la cotización oficial si no pasás otra.

#### Acceso directo con doble clic

`arcli acceso-directo` crea un ícono para abrir ARCLI en macOS, Windows y Linux, en el escritorio o en la carpeta que indiques. También está en Configuración del asistente.

```sh
arcli acceso-directo
```

#### Cotización oficial por defecto

En moneda extranjera sin `--cm`, ARCLI usa la cotización oficial de ARCA y lo avisa. Antes era un error.

```sh
arcli fc -m 1.500 --cs --cfinal --moneda USD
```

#### Rechazos de ARCA que dicen qué hacer

Los códigos de rechazo más comunes traen en `sugerencias` qué pasó, qué hacer y el link a la guía, y el certificado sin autorizar a facturar sale como `WSFE_SERVICE_NOT_AUTHORIZED`.

#### Una salida más pareja

Importes, CUIT, fechas y comprobantes con el mismo formato en todos los comandos, una vista previa más corta y paneles que se acomodan a una terminal angosta.

> [!WARNING]
> **Puede afectar scripts**
>
> - En la vista previa, `estado` del `--json` pasa de `"observado"` a `"previsualizacion"`.
> - `fe --cargar` con `"previsualizar": false` ya no emite por sí solo (como A, B y C).
> - `--moneda USD` sin `--cm` ya no da error: usa la cotización oficial de ARCA.
> - Cambian textos de `error`, `sugerencia` y `avisos` (opciones entre backticks, tildes), no sus claves ni los códigos.
> - El certificado sin autorizar a facturar sale como `WSFE_SERVICE_NOT_AUTHORIZED` en lugar de `UNEXPECTED_ERROR`.
> - En la `E`, un fallo en la llamada que emite sale como `EMISSION_UNCERTAIN`, no como error inesperado.
> - En `fe --cargar`, `--exportar-pdf` con `--sin-pdf` es un error, y un monto con más de 2 decimales también, en lugar de redondearse.
>
> No se saca ningún comando, flag ni clave de config. Hay deprecaciones para la 3.0.0: ver "Deprecado".

---

### ✨ Agregado

- **Instalación:** `arcli acceso-directo` crea un ícono para abrir ARCLI con doble clic, también desde el asistente (#128).
- **Errores:** los rechazos de ARCA más comunes traen en `sugerencias` qué pasó, qué hacer y la guía (#101).
- **Errores:** `WSFE_SERVICE_NOT_AUTHORIZED` dice qué hacer si el certificado no está autorizado a facturar (#134).
- **Facturas:** todas las monedas de ARCA con su código ISO en `--moneda`, `--cargar` y la config (#96).
- **Instalación:** el aviso de versión nueva muestra el comando del gestor con que instalaste ARCLI (#100).
- **PDF:** `config revisar` revisa el plugin de PDF, como `arcli pdf estado` (#99).
- **Salida:** el `--json` de las emisiones suma `entorno`, `puntoVenta` y, en la factura `E`, `numero` (#112).
- **Asistente:** las opciones nuevas del menú llevan `(nuevo)` durante dos versiones menores (#131).

<details><summary>Detalle</summary>

**`arcli acceso-directo [ruta]`.** Crea un ícono para abrir ARCLI con doble clic en macOS, Windows y Linux, en el escritorio o en la carpeta que indiques. También está en el modo interactivo, en Configuración. Creado desde el código fuente (`yarn dev`), abre el `arcli` instalado y lo informa en `usaArcliInstalado`. Si no encuentra un `arcli` instalado, el ícono lo dice y muestra cómo instalarlo, en lugar de "command not found".

**Sugerencias para los rechazos de ARCA más comunes.** Cuando ARCA rechaza o deja una observación con un código conocido (`10016`, `10152`, `10243`, `10174`, `10119`, `10038`, `10017`/`10217`, además del punto de venta `10005`/`11002`), `sugerencias` dice qué pasó, qué hacer y el link a la guía. Antes solo se reconocían unos pocos mensajes, y los códigos que venían en las observaciones no se miraban. La tabla completa está en [Troubleshooting](docs/troubleshooting.md#rechazos-de-arca-por-código). La forma del JSON no cambia.

**`WSFE_SERVICE_NOT_AUTHORIZED`.** El certificado sin autorizar a facturar, el error más común la primera vez, ahora dice qué hacer en ARCA en lugar de salir como error inesperado con el texto de WSAA.

**Todas las monedas de ARCA con su código ISO.** `--moneda`, `codigoMoneda` del JSON y la clave `moneda` de la config aceptan el código ISO o el de ARCA, indistinto: `ARS` o `PES`, `USD` o `DOL`, `UYU` o `011`, `CLP` o `033`, `GBP` o `021`, y así con todas las de la tabla de ARCA que tienen ISO. Antes solo se traducían `ARS`, `USD`, `EUR` y `BRL`, y otro ISO se mandaba tal cual y ARCA lo rechazaba. La vista previa y `consultar` muestran el nombre con el ISO (`Pesos uruguayos (UYU)`), el PDF de la `E` muestra el ISO de cualquier moneda y el autocompletado de `--moneda` ofrece todos los ISO. Un código que no está en la tabla se sigue mandando tal cual.

**Comando para actualizar según el gestor.** El aviso de versión nueva, la ayuda y "Cerrar para actualizar" del modo interactivo muestran el comando del gestor con que instalaste ARCLI (`npm install -g`, `pnpm add -g`, `yarn global add` o `bun add -g`), deducido de la carpeta donde está instalado. Si no lo reconoce, sigue siendo el de npm. El plugin de PDF se sigue instalando con npm.

**`config revisar` revisa el plugin de PDF.** Un chequeo "Plugin de PDF" en la sección PDF dice si está instalado, si es la versión que usa ARCLI y si encontró un navegador, como `arcli pdf estado`. Con `pdf=siempre` avisa si falta; con `preguntar` (por defecto) solo lo revisa si está instalado, así `ok` no pasa a `false` para quien no genera PDFs; con `nunca` no lo revisa.

**Más datos en el JSON de las emisiones.** `entorno` y `puntoVenta` en todos los comprobantes, y `numero` en la factura E, también en la vista previa.

**Opciones nuevas marcadas en el modo interactivo.** Lo que se sumó en las últimas versiones lleva `(nuevo)` al final (Emitir recibo, Recibo C en las notas, y Certificados de ARCA y Acceso directo en Configuración, que también lo lleva). La marca se va sola dos versiones menores después. Ver [modo interactivo](docs/modo-interactivo.md#menú-principal).

</details>

### 🔧 Cambiado

- **Salida:** en la vista previa, `estado` del `--json` pasa de `"observado"` a `"previsualizacion"` (#134).
- **Facturas:** en moneda extranjera sin `--cm`, ARCLI usa la cotización oficial de ARCA y lo avisa (#97).
- **Salida:** un solo formato para los importes: `$ 1.500,50` en pesos y el código ISO en otras monedas (#108).
- **Salida:** CUIT, DNI, comprobantes, cotizaciones, porcentajes y fechas se muestran igual en todos lados (#110).
- **Salida:** tildes, voseo y los mismos textos en toda la salida; cambian textos de `error`, no los códigos (#111).
- **Salida:** la pregunta antes de emitir dice el entorno, como en el asistente (#109).
- **Salida:** la letra del comprobante va siempre en mayúscula y las frases concuerdan (#109).
- **Salida:** la vista previa ya no muestra importes en cero que nadie cargó (#116).
- **Errores:** los rechazos de ARCA se muestran como una lista y no como JSON crudo (#116).
- **Errores:** un comando u opción desconocida sale en el panel de errores, entre backticks (#116).
- **Salida:** en una terminal angosta, las tablas apilan etiqueta y valor sin cortar palabras (#116).
- **Salida:** errores, avisos y sugerencias citan las opciones entre backticks (#127).
- **Salida:** padrón, plugin de PDF, régimen FCE y certificados alinean sus valores en la misma columna (#130).
- **Config:** `config revisar` no repite el CUIT faltante (#119).
- **Salida:** el logo de `arcli ejemplos` sale alineado y con la versión (#116).
- **Asistente:** en la selección múltiple, "Volver" es un botón común (#118).

<details><summary>Detalle</summary>

**`estado` de la vista previa en el `--json`.** Pasa de `"observado"` a `"previsualizacion"`, en A, B, C y la `E`. Antes parecía que ARCA había observado algo, pero no se emitió nada. `previsualizacion: true` sigue igual. Un script que compara `estado === "aprobado"` no cambia; uno que trate cualquier otro valor como observado tiene que sumar el nuevo.

**Cotización oficial por defecto en moneda extranjera.** `arcli fc --moneda USD` sin `--cm` ni `--misma-moneda` usa la cotización oficial de ARCA y lo avisa en "Avisos" (y en `avisos` del JSON). Antes daba error "Falta la cotización". `--cm` sigue pisándola y `--cm 1` sigue siendo error.

**Un solo formato para los importes.** La salida en terminal muestra los pesos como `$ 1.500` o `$ 1.500,50`, con el espacio que usa el PDF y sin `,00` si no hay centavos. Antes convivían `1.500$`, `$1.500` y `$ 1.500,00`. En moneda extranjera todos los comprobantes muestran el código ISO en lugar del `$` (`1.500,50 USD`), y el error de `fe` cuando los ítems no suman `--monto` deja de usar punto decimal (`1.500,50` en lugar de `1500.50`). Los textos de errores y avisos toman el mismo formato, también en el `--json`. El PDF no cambia y los importes del `--json` siguen siendo números.

**Los datos se muestran igual en todos lados.** CUIT con guiones (`20-33333333-4`) y DNI con puntos (`12.345.678`) en los paneles; comprobantes como `00001-00001234`, también el asociado y la factura `E`; cotización con dos decimales o más (`1.250,50`, `1.250,123456`) y porcentajes con coma (`10,5%`); fechas `dd/mm/aaaa`; `N/D` para lo que ARCA no informa y `sin configurar` para la config. El vencimiento del certificado se calcula siempre en hora de Argentina. El `--json` no cambia, salvo el texto de los avisos que nombran la cotización.

**Textos más parejos.** Tildes y voseo en toda la salida (`¿A quién le facturás?`, `22 dígitos`, `Usá`), comandos siempre entre backticks y el mismo texto en los errores que se repiten. El dato faltante sale como `Falta el dato: monto.`. Fechas inválidas dicen qué formatos sirven. "Monto" al pedir y en errores, "importe" al mostrar; "comprobante" donde también puede ser un recibo. Mientras se emite, el progreso dice `Emitiendo la factura B en ARCA...`. En la ayuda, `--previsualizar` ya no dice que muestra algo "antes de emitir" (no emite), los alias nombran su flag y los ejemplos dicen `COMPLETA` en lugar de `FULL`. El modo interactivo de config muestra etiquetas (`Responsable inscripto`, `21%`) en lugar de valores crudos; lo que se guarda no cambia. Son textos: pueden cambiar `error`, `sugerencia` y `avisos` en el `--json`, no sus claves ni los códigos de error.

**La pregunta antes de emitir dice el entorno.** Con flags ahora es `¿Emitimos la factura B en PRODUCCIÓN?`, igual que en el modo interactivo, y si respondés que no avisa `No se emitió nada.`. La doble confirmación en producción sigue siendo solo del modo interactivo.

**La letra del comprobante siempre va en mayúscula y las frases concuerdan.** `La factura B no admite…`, `El recibo C no lleva…`, `Últimas facturas B`, `No hay recibos C emitidos`. Antes salían `La factura b`, `La recibo c` y `Últimas Factura B`. Son textos: también cambian dentro de `error` en el `--json`, pero la clave `comprobante` y los códigos de error no. Los atajos siguen en minúscula (`fb`, `rc`).

**Vista previa más corta.** Los importes en cero que nadie cargó (IVA, tributos, exento, no gravado) no se muestran, y la cotización solo en moneda extranjera. A consumidor final sin identificar, una sola fila `Receptor` en lugar de tres. Lo que tiene valor se sigue mostrando, venga de una flag, de la config o de un default. `consultar` tampoco muestra `Importe IVA` en cero. El `--json` y `--bruto` siguen trayendo todo.

**Rechazos de ARCA legibles.** Los paneles de errores y eventos muestran una lista (`1. 502: mensaje`) en lugar de JSON crudo. El panel de resultado ya no lista `Observaciones`, `Eventos` ni `Errores` en cero.

**Errores de uso en panel.** Un comando u opción desconocida se muestra en el mismo panel que el resto de los errores, con la sugerencia de ayuda. Comandos, opciones y argumentos van entre backticks (`` opción desconocida `--montoo` ``), también en `error` con `--json`. El panel ya no repite la palabra `Error`. El mensaje de CUIT, certificado o clave faltante no repite `arcli config revisar`, que queda en la sugerencia del panel (cambia el texto de `error` y `detalle` en el `--json`, no las claves ni los códigos).

**Terminales angostas.** Si una fila de una tabla no entra, todas las de esa columna ponen la etiqueta arriba y el valor debajo, las etiquetas ya no se cortan a mitad de palabra y la barra de estado pasa a dos líneas en lugar de romperse. En listas, una línea partida sigue alineada al texto.

**Opciones entre backticks en todos los mensajes.** Errores, avisos, sugerencias y paneles citan las opciones como `` `--monto` `` o `` `--pv <numero>` ``, igual que los comandos (`` `arcli padron` `` en la lista de servicios del certificado, el paso para importarlo y el pie de `parametros`). Son textos: cambian `error`, `sugerencias` y `avisos` en el `--json`, no sus claves ni los códigos de error. La ayuda (`--ayuda`) y los ejemplos para copiar no cambian.

**Fichas con los valores en la misma columna.** Padrón, plugin de PDF, régimen FCE y certificados ponen la columna de etiquetas en el mismo lugar (antes cada una usaba un ancho distinto), y en el pedido y la importación de un certificado todas las secciones quedan alineadas con la lista de servicios. Los comprobantes y la config no cambian. El `--json` tampoco.

**`config revisar` no repite el CUIT.** Si falta, la terminal muestra una sola fila en rojo, en Cuenta, en lugar de un aviso y un error. El `--json` sigue trayendo los dos chequeos.

**`arcli ejemplos`.** El logo sale alineado y con la versión.

**Selección múltiple.** El cursor deja un espacio antes del círculo (`❯ ◯`), como en las demás listas del modo interactivo. "Volver" es un botón común: no lleva círculo, ni espacio ni `a` lo marcan, y Enter sobre él vuelve al paso anterior.

</details>

### ⏳ Deprecado

- **Salida:** claves del `--json` que se sacan en la 3.0.0, con `deprecado` que dice qué usar (#112).
- **Config:** la clave `cotizacion` se saca en la 3.0.0: una cotización guardada queda vieja (#97).

<details><summary>Detalle</summary>

**Claves del JSON que se sacan en la 3.0.0.** Siguen funcionando, y la respuesta suma `deprecado` con qué usar. `Code`/`Msg` (A, B y C) y `code`/`message` (E) en `errores` y `eventos` pasan a `codigo`/`mensaje`, que ya están. `detalles.errors` pasa a `detalles.errores`. En `estado`, `puntoVenta` será un número: el detalle ya está en `puntoVentaDetalle`. En `padron` y `fce-obligado`, `cuit` será texto. En `--cargar` de `fe`, `monto` pasa a `montoTotal`, que ya se acepta; mandar las dos es un error. La tabla está en [Entrada y salida](docs/input-output.md#estabilidad-del-contrato).

**La clave `cotizacion` de la config se saca en la 3.0.0.** Una cotización guardada queda vieja en días y factura con un tipo de cambio viejo sin que te enteres. Mientras tanto sigue andando: si está guardada (distinta de `1`), cada factura en moneda extranjera sin `--cm` la usa y avisa que está deprecada, y `config establecer cotizacion` avisa lo mismo. Para dejar de usarla, `arcli config eliminar cotizacion`. `config --json` sigue trayendo `cotizacion`.

</details>

### 🐛 Corregido

- **Errores:** `EMISSION_UNCERTAIN` sugiere verificar en el entorno en que se emitió (#134).
- **Facturas:** en `--cargar`, la `E` respeta `"pdf"` y rechaza montos con más de 2 decimales, y las notas combinan el asociado (#134).
- **Facturas:** la cotización deprecada de la config ya no se aplica a otra moneda extranjera (#134).
- **Asistente:** arreglos de la configuración guiada, "Cerrar para actualizar", rutas arrastradas y el comando equivalente (#134).
- **Errores:** mensajes más claros para `--cm 1` y para una nota con período y asociado a la vez (#134).
- **Factura E:** `arcli fe --cargar` con `"previsualizar": false` ya no emite sin preguntar (#133).
- **Asistente:** la barra y las respuestas pasan por el filtro de secuencias de terminal (#120).
- **Salida:** el color de los errores depende de stderr, no de stdout (#115).
- **Salida:** `ARCLI_ASCII=1` cambia también los símbolos y lo que dibuja el asistente (#115).
- **Salida:** "producción" lleva tilde en títulos y mensajes; el `--json` no cambia (#115).
- **Config:** `arcli config` muestra el CUIT con guiones (#115).
- **Salida:** tildes y voseo que faltaban en varios textos (#115).
- **Facturas:** las llamadas de producción ya no fallan con `dh key too small` en sistemas como Debian 13 (#103).
- **PDF:** el PDF de la `E` desde el asistente pide los datos del emisor que faltan (#109).
- **Factura E:** si falla la llamada que emite, la `E` sale como `EMISSION_UNCERTAIN`, como A, B y C (#96).
- **Docs:** la ayuda de `arcli fe` dice que `--numero` es obligatorio (#96).
- **Certificados:** `CERTIFICATE_EXPIRED` sugiere renovarlo con `arcli certificado generar` e `importar` (#96).

<details><summary>Detalle</summary>

**`EMISSION_UNCERTAIN` sugiere verificar en el entorno en que se emitió.** Antes `arcli ultimos` consultaba el de la config, y emitido con `--produccion` con la config en testing, el comprobante "no figuraba" y reintentar lo duplicaba. También el aviso del lote, que ahora trae el comando completo.

**`--cargar`.** En la `E`, `"pdf"` del archivo se ignoraba, `--exportar-pdf` con `--sin-pdf` no era error y un monto con más de 2 decimales se redondeaba sin avisar: ahora `"pdf"` se respeta y los otros dos son error. En las notas, un flag del asociado (por ejemplo, solo `--acuit`) descartaba todo `comprobanteAsociado` del archivo. Ahora se combinan. `importeExento` e `importeNoGravado` en `0` cuentan como ausentes.

**La cotización deprecada de la config** ya no se aplica a otra moneda extranjera (la de USD no vale para EUR).

**Modo interactivo.** La configuración guiada ya no dice "Ya podés emitir" con el certificado pendiente; "Cerrar para actualizar" dice dónde pegar el comando y espera, para leerlo al abrir ARCLI con el acceso directo; las rutas aceptan un archivo arrastrado; la barra se actualiza al volver de Configuración; pide el certificado del entorno activo y no siempre el de testing; sin punto de venta, dice dónde cargarlo. El comando equivalente ya no repite `--ir consumidor-final` después de `--consumidor-final`, que lo implica.

**Mensajes que confundían.** `--moneda USD --cm 1` decía "Falta la cotización" y ahora explica que 1 es la cotización del peso. Una nota con período (`--periodo-desde`/`--periodo-hasta`) y parte de un comprobante asociado (`--apv`, `--acuit`) pedía el comprobante completo y ahora dice que se usa uno o el otro.

**`arcli fe --cargar` con `"previsualizar": false` emitía sin preguntar.** En A, B y C eso no emite y decide la config (en una terminal pregunta); ahora la `E` hace lo mismo. Para emitir desde el archivo, `"emitir": true`. `"emitir"` y `"previsualizar"` en `true` a la vez son un error, como en el resto.

**Modo interactivo.** La barra con la razón social y las respuestas ya respondidas pasan por el mismo filtro que el resto de la salida, así un dato externo no puede meter secuencias de terminal.

**Colores de los errores.** Dependían de stdout aunque los errores se escriben en stderr. `arcli ... 2> errores.log` guardaba códigos de color en el archivo, y con `arcli ... | jq` el error salía sin color en la terminal. Ahora dependen de stderr. También vale para los avisos de nueva versión y de certificado.

**`ARCLI_ASCII=1` cubre toda la salida.** También cambia los símbolos (`✓`, `•`, `·`, `…`, `→`) y lo que dibuja el modo interactivo (`✔`, `❯`, `↑↓`, `⏎`, `←`, `┈`, el spinner). Antes solo cambiaba los bordes. Las tildes y la `ñ` se mantienen.

**Entorno con tilde.** Los títulos de `parametros` y `ultimos` dicen `PRODUCCIÓN` en lugar de `PRODUCCION`, y `estado`, `config`, `config revisar` y los errores de comprobante o CUIT no encontrado dicen `producción`. El `--json` conserva `entorno: "produccion"`; solo cambia el texto de `error` y `detalle`.

**`arcli config` muestra el CUIT con guiones.** `20-33333333-4`, igual que el resto de los comandos. `config --json` no cambia.

**Textos.** Tildes que faltaban en `sí`, `automático`, `Cuándo generar el PDF`, `puntos críticos` y `Estás utilizando el entorno de TESTING`. La ayuda de `--moneda` dice `etc.` en lugar de `…`. Tildes y voseo en mensajes que habían quedado sin corregir (fecha fuera de rango, instalación del plugin de PDF, emisión sin confirmar, `coe.alreadyAuthenticated`). Los códigos de error y la forma del JSON no cambian.

**`dh key too small` en producción.** En sistemas con OpenSSL en `SECLEVEL=2`, como Debian 13, las llamadas a WSFE y WSFEX de producción fallaban con ese error aunque el certificado, la clave y el punto de venta fueran correctos. Ahora ARCLI no ofrece DHE en producción, sin aflojar el resto de la seguridad de la conexión. Testing no cambia. Ya no hace falta el wrapper con `--tls-cipher-list`.

**PDF de la factura E en el modo interactivo.** Si faltan datos del emisor, los pide y ofrece guardarlos, como en el resto de los comprobantes. Antes el PDF no se generaba.

**Emisión incierta en la factura E.** Si falla la llamada que emite una `fe` (red, timeout), sale como `EMISSION_UNCERTAIN`, igual que A, B y C, en lugar de un error inesperado que invitaba a reintentar. `detalles` trae `numero` e `idSolicitud`, y la sugerencia es reintentar con esos mismos valores: ARCA no autoriza dos comprobantes con el mismo número, así que no se duplica.

**Ayuda de `arcli fe`.** `--numero` decía "por defecto el siguiente de ARCA", pero es obligatorio. Ahora la ayuda lo dice.

**Certificado vencido.** La sugerencia de `CERTIFICATE_EXPIRED` manda a renovarlo con `arcli certificado generar` e `importar`, en lugar de cargar las rutas a mano con `arcli config establecer`.

</details>

## [2.3.0] - 2026-11-04 · Recibo C y certificados

El Recibo C (`rc`), `arcli certificado generar` e `importar` para sacar el certificado de ARCA sin `openssl`, y la condición de venta en el PDF. Gracias a [Guillermo Britos](https://github.com/guillermobr) y a [Kevin Tea](https://github.com/kevintea), que trajeron el recibo y la condición de venta.

#### Recibo C

Con los mismos flags y validaciones que la Factura C, su propia opción en el asistente y su PDF.

```sh
arcli rc -m 15000 --cs --cfinal
```

#### El certificado sin `openssl`

`arcli certificado generar` arma la clave y el pedido para ARCA, también en Windows, e `importar` carga el certificado que devuelve ARCA y configura las rutas.

```sh
arcli certificado generar --testing
```

#### Condición de venta en el PDF

`--condicion-venta` (o la clave `condicionVenta`) imprime en el PDF de A, B y C cómo se cobra.

```sh
arcli fc -m 15000 --cs --cfinal --condicion-venta transferencia --exportar-pdf
```

> [!WARNING]
> **Puede afectar scripts**
>
> - `--dia` está deprecado y ya no fija el período del servicio, solo el vencimiento. Sigue andando con un aviso.
>
> No se saca ningún comando, flag ni clave de config, y el `--json` no cambia.

---

### ✨ Agregado

- **Recibos:** Recibo C con `arcli rc`, con los flags de la Factura C, notas asociadas, PDF y asistente (#78).
- **Certificados:** `arcli certificado generar` e `importar` sacan y cargan el certificado sin `openssl`, también en el asistente (#87).
- **PDF:** la condición de venta en el PDF de A, B y C, con `--condicion-venta` o la clave `condicionVenta` (#74).

<details><summary>Detalle</summary>

**Recibo C (`rc`, `arcli recibo c`).** Emite o previsualiza un Recibo C (tipo ARCA 15) con los mismos flags y validaciones que la Factura C. La familia `recibo` solo tiene la letra C: `arcli recibo a` da error y el autocompletado ofrece solo `c`. Las notas de crédito y débito C pueden asociarse a un Recibo C (`arcli ncc --ac rc ...`). En el modo interactivo tiene su propia opción, **Emitir recibo**, y se puede elegir como comprobante original de una nota. "Repetir una factura anterior" pasa a llamarse **Repetir un comprobante anterior** y deja elegir entre una factura y un recibo. El PDF lleva el título `RECIBO C`, `COD.15` y el QR de ARCA con el tipo 15, y se guarda como `recibo-c_<pv>-<numero>.pdf`. Gracias a [Guillermo Britos](https://github.com/guillermobr), que lo trajo en [#78](https://github.com/LcsGrz/arcli/pull/78).

**`arcli certificado generar` e `importar`.** Arman la clave y el CSR para ARCA sin `openssl` (también en Windows) y cargan el certificado que devuelve ARCA. `importar` deduce el entorno del certificado, valida CUIT, vencimiento y clave, lo guarda en `certificados/<CUIT>/` junto a la config y configura `cert.*`/`key.*`. Para renovar, la clave nueva queda pendiente hasta importar, así que se sigue facturando con el certificado actual. Las rutas configuradas a mano siguen andando. En el modo interactivo: Configuración → Certificados de ARCA, y la configuración guiada ofrece sacarlo si no tenés uno.

**Condición de venta en el PDF de A, B y C.** `--condicion-venta` (alias `--cv`), `condicionVenta` en el JSON de `--cargar` y la clave `condicionVenta` de la config como default. `--sin-condicion-venta` y `"condicionVenta": null` permiten omitir ese default para un comprobante. Acepta `contado`, `tarjeta-debito`, `tarjeta-credito`, `cuenta-corriente`, `cheque`, `transferencia`, `otros-medios-electronicos` y `otra`, que se imprimen con su nombre, o un texto libre que se imprime tal cual. El modo interactivo la pregunta con una lista y la de la config marcada; "Omitir" la suprime y "Otra" pide el texto. Es un dato exclusivo del PDF: WSFE no lo recibe. Gracias a [Kevin Tea](https://github.com/kevintea), que la trajo en [#74](https://github.com/LcsGrz/arcli/pull/74).

</details>

### 🔧 Cambiado

- **Fechas:** `--dia` fija solo el vencimiento, no el período del servicio (#79).
- **Facturas:** `--consumidor-final` implica IVA receptor consumidor final, sin sumar `--ir-cf` (#84).
- **Salida:** las rutas se abren con un clic en las terminales que soportan links (#87).
- **Config:** `arcli config revisar` agrupa los chequeos por sección y sugiere `arcli certificado generar` (#87).

<details><summary>Detalle</summary>

**`--dia` está deprecado y fija solo el vencimiento.** Antes también ponía el período del servicio en ese día (`--dia 10` facturaba un servicio "del 10/11 al 10/11"). Ahora el período es el de `--servicio-desde`/`--servicio-hasta` o, sin ellos, la fecha del comprobante, como sin `--dia`. Se puede combinar con `--fecha` y `--servicio-hasta`, y da error junto con `--vencimiento`/`--vto`. Sigue andando con un aviso; usá `--vencimiento` o `--vto`. Lo mismo la clave `dia` del JSON de `--cargar`.

**`--consumidor-final` (`--cfinal`) implica IVA receptor consumidor final.** Ya no hace falta sumar `--ir-cf`, y anda aunque la config tenga otro `ivaReceptor`, que antes daba error. Lo mismo `tipoDocumento: "consumidor-final"` en el JSON de `--cargar`. Un IVA explícito distinto (`--cfinal --ir-rm`) sigue siendo error.

**Rutas clickeables.** En terminales que soportan links (VS Code, iTerm2, Windows Terminal, Kitty, WezTerm, Ghostty), las rutas de `arcli config`, `arcli pdf`, el PDF guardado y `arcli certificado` se abren con un clic. `FORCE_HYPERLINK=0` los apaga. `arcli config` muestra además la carpeta de certificados.

**`arcli config revisar` más fácil de leer.** Los chequeos van agrupados por sección (Cuenta, Al facturar, Certificados, Salida, PDF y Validaciones), con lo que falta en color, y los avisos de certificados sugieren `arcli certificado generar`. El JSON no cambia de forma.

</details>

### ⏳ Deprecado

- **Fechas:** `--dia` y la clave `dia` de `--cargar`: usá `--vencimiento` o `--vto` (#79).

### 🐛 Corregido

- **Fechas:** una fecha sin año toma la más cercana a hoy, también en el cambio de año (#79).
- **Facturas:** `--moneda EUR` y `BRL` se traducen a sus códigos de ARCA (#79).
- **Fechas:** `--misma-moneda` con `--fecha` futura pide la fecha de hoy en lugar de llegar a ARCA (#79).
- **Asistente:** repetir una factura con montos chicos deduce bien la alícuota de IVA (#79).

<details><summary>Detalle</summary>

**Fechas sin año en el cambio de año.** Se tomaba siempre el año actual, así que el 5/1/2027 `--sd 1/12` era diciembre de 2027. Ahora se toma la fecha más cercana a hoy: diciembre de 2026, y el 28/12 `--vto 10/1` es enero que viene.

**`--moneda EUR` y `BRL`** se mandaban tal cual y ARCA las rechazaba: ahora se traducen a sus códigos (`060` y `012`) en `fc`/`fb`/`fa`, `fe` y `parametros cotizacion`.

**`--misma-moneda` con `--fecha` futura** llegaba a ARCA y fallaba con el error 10038: ahora pide que la fecha sea la de hoy, porque ARCA solo publica la cotización vigente.

**Repetir una factura con montos chicos** podía deducir mal la alícuota de IVA (por ejemplo, 2,5% en vez de 21%).

</details>

### 🔒 Seguridad

- **Instalación:** el paquete de npm se publica desde el tag de la release y se prueba antes de publicarlo (#80).

<details><summary>Detalle</summary>

**Publicación en npm más estricta.** El paquete se publica desde el tag de la release de GitHub (antes, desde lo último de `main`) y el release falla si el tag no coincide con la versión. Se arma en un job sin permiso para publicar, sin cache y sin scripts de dependencias, y antes de publicarlo se instala y se prueba que arranque.

</details>

## [2.2.1] - 2026-11-03

Corrige `arcli pdf instalar` en Windows y suma lo necesario para recibir contribuciones: plantillas de issue y de PR, código de conducta y Discussions para preguntas. No cambian comandos, flags, claves de config ni el `--json`.

---

### ✨ Agregado

- **Docs:** el README explica cómo instalar con pnpm y Yarn, probar con `npx`, actualizar y pedir ayuda (#77).
- **Docs:** plantillas de issue y de PR, código de conducta y Discussions para preguntas (#77).

<details><summary>Detalle</summary>

El README explica cómo instalar con pnpm y Yarn además de npm, cómo probarlo con `npx` y cómo actualizar, y suma las secciones "Ayuda y soporte" (preguntas en [Discussions](https://github.com/LcsGrz/arcli/discussions), bugs en issues) y "Estabilidad" (qué es contrato público y qué puede cambiar entre versiones).

Plantillas de issue y de PR, y [código de conducta](CODE_OF_CONDUCT.md).

</details>

### 🐛 Corregido

- **PDF:** `arcli pdf instalar` funciona en Windows con espacios en la ruta del usuario (#77).

<details><summary>Detalle</summary>

**`arcli pdf instalar` en Windows.** La descarga del navegador pasaba por `cmd.exe`, que corta las rutas con espacios (como `C:\Users\Nombre Apellido`), y fallaba. Ahora la shell se usa solo para correr `npm.cmd`.

</details>

## [2.2.0] - 2026-11-02 · Factura de exportación

La factura de exportación `E` (`arcli fe`) sobre WSFEX, con ítems, país de destino, incoterm, permisos de embarque, PDF de exportación y modo interactivo. Además, autocompletado con Tab, el número del comprobante en el JSON, el dígito verificador de todo CUIT y una ayuda más corta y en español. Gracias a [Manuel Aller](https://github.com/itManuel), que trajo la `E` en [#67](https://github.com/LcsGrz/arcli/pull/67).

#### Factura de exportación E

Ítems, país de destino, incoterm, permisos de embarque y credenciales propias para `wsfex`. La actividad es obligatoria: por flag o en `exportacion.actividad`.

```sh
arcli fe -m 1500 --cliente "ACME LLC" --domicilio-cliente "123 Main St" --pais-destino 212 --numero 1 --actividad 620100
```

#### Autocompletado con Tab

Comandos, flags, valores y claves de config en bash, zsh y fish. No hay que reinstalarlo al actualizar.

```sh
arcli completado instalar
```

#### Ayuda más corta y en español

`arcli --ayuda` pasa de unas 145 líneas a 57, y la de cada comprobante muestra solo los flags que le aplican.

```sh
arcli fc --ayuda
```

#### CUIT con dígito verificador

Todo CUIT se acepta con o sin guiones y uno mal tipeado se rechaza antes de llegar a ARCA.

> [!WARNING]
> **Puede afectar scripts**
>
> - Los mensajes usan voseo y tildes: si un script compara el texto de un error en lugar de `codigo`, puede necesitar un ajuste.
> - Un `montoTotal` con más de 2 decimales en el JSON da error en lugar de redondearse.
> - Un CUIT con el dígito verificador mal se rechaza antes de llegar a ARCA.
> - Los números con letras o notación científica dan error: `config establecer puntoVenta 3a` ya no guarda `3` y `arcli consultar fc 1e3` ya no busca el 1000.
> - Un punto de venta inválido corta con `ARCA_LAST_VOUCHER_ERROR` en lugar de seguir con el número 1.
>
> La `E` es todo agregado: los comandos, flags y claves de config de A, B, C y FCE siguen igual.

---

### ✨ Agregado

- **Factura E:** `arcli fe` y `arcli factura e` emiten o previsualizan la factura de exportación sobre WSFEX (#67).
- **Asistente:** la factura `E` tiene su propio asistente, con vista previa, comando equivalente y PDF (#67).
- **PDF:** el PDF de la `E` tiene el diseño de exportación, como el de Comprobantes en línea (#67).
- **Certificados:** claves `exportacion.cert.*` y `exportacion.key.*` para un certificado propio de `wsfex` (#67).
- **Factura E:** la actividad va con `--actividad` o la clave `exportacion.actividad`, validada contra la tabla de WSFEX (#67).
- **Factura E:** `--item` carga el detalle real, y los ítems tienen que sumar `--monto` (#67).
- **Factura E:** `--cargar` acepta un objeto con claves propias; el lote no está soportado (#67).
- **Factura E:** sin flags, la `E` sale de servicios, en dólares, con la cotización de aduana (#67).
- **Salida:** el `--json` de la `E` suma el bloque `exportacion`, y `solicitud` es el `Cmp` de WSFEX (#67).
- **Factura E:** `--numero` es obligatorio, porque todavía no se puede consultar el último número de la `E` (#67).
- **Facturas:** en `arcli factura <letra>`, los flags de otra letra se saltean con un aviso (#67).
- **Instalación:** autocompletado con Tab para bash, zsh y fish, con `arcli completado instalar` (#65).
- **Facturas:** todo CUIT se acepta con o sin guiones y se controla su dígito verificador (#62).
- **Salida:** el JSON de facturación trae el `numero` del comprobante emitido (#68).
- **Errores:** `ARCA_LAST_VOUCHER_ERROR` corta si ARCA rechaza el pedido del último número (#62).
- **Salida:** Esc cierra la pregunta "¿Querés emitir…?" como un "no" (#63).
- **Docs:** la `E` en la referencia, las reglas de validación, la config, el PDF y el asistente (#67).

<details><summary>Detalle</summary>

**`arcli fe` y `arcli factura e`.** Emiten o previsualizan la Factura de exportación `E` (tipo 19) con WSFEX. Obligatorios: `--monto`, `--cliente`, `--domicilio-cliente`, `--pais-destino` (código o nombre), `--numero` y la actividad. Opcionales: `--id-impositivo`, `--cuit-pais`, `--tipo-expo` (`1` bienes, `2` servicios, `4` otros), `--incoterm`, `--incoterms-desc`, `--idioma`, `--forma-pago`, `--permiso` con `--permiso-existente`, `--id-solicitud`, `--fecha-pago`, `--observaciones` y `--obs-comerciales`. No lleva concepto, IVA ni receptor con CUIT/CUIL/DNI. `fe` va en la tabla de atajos de `arcli --ayuda` y en `arcli ejemplos`, y Tab completa la letra `e` en `arcli factura`.

**Factura E en el modo interactivo.** Se elige en el mismo selector que A, B y C y tiene su propio asistente (cliente, país, tipo, monto, moneda, incoterm en bienes, pago, actividad y número), con vista previa, comando equivalente y PDF. Ver [modo interactivo](docs/modo-interactivo.md#factura-de-exportación-e).

**PDF de exportación.** Se guarda como `factura-e_<pv>-<numero>.pdf` con el diseño de exportación de `@arcasdk/pdf` y los mismos datos que la E de Comprobantes en línea: título `FACTURA DE EXPORTACIÓN`, items de WSFEX, país de destino, CUIT del país con su tipo de entidad, ID impositivo, divisa con su código ISO (`USD - Dólar Estadounidense`), forma y fecha de pago, incoterm y la leyenda `IVA EXENTO OPERACIÓN DE EXPORTACIÓN`, sin discriminar IVA.

**`exportacion.cert.testing`, `exportacion.cert.produccion`, `exportacion.key.testing`, `exportacion.key.produccion`.** Credenciales del servicio `wsfex`, para cuando el certificado general no está autorizado a exportación. Si no están las dos de un entorno, se usan `cert.*`/`key.*`; con la mitad del par configurada el comando corta antes de ir a ARCA. Se muestran en la sección **Certificados** de `arcli config` (también en el modo interactivo), se validan como PEM al guardarlas y `arcli config revisar` las revisa con el resto. Sin autorización a `wsfex`, el error es `WSFEX_SERVICE_NOT_AUTHORIZED`.

**Actividad de la `E`.** `--actividad` o la clave nueva `exportacion.actividad` (sección "Factura de exportación (E)" de `arcli config`), con un código de la tabla de actividades de WSFEX, que no es la del padrón. No hay default; un código que no está en la tabla es error de validación con los que empiezan igual.

**`--item` con detalle real.** `codigo|descripcion|cantidad|precio|unidad`, repetible; el código y la unidad son opcionales y la unidad puede ser el código de ARCA o su nombre. La suma de los items tiene que dar `--monto` y se valida antes de autenticar en WSAA, porque WSFEX no lo controla.

**`--cargar` para `E`.** Un objeto, con claves propias (`cliente`, `domicilioCliente`, `paisDestino`, `monto`, `numero`, `actividad`, `items`, `tipoExpo`…). El lote no está soportado: un array es error de entrada.

**Defaults de la `E`.** Sin flags, la exportación sale de servicios (`Tipo_expo` `2`), en dólares (`Moneda_Id` `DOL`), con la cotización de aduana que publica ARCA (si la del día todavía no salió, la última, con un aviso) y con forma de pago `Transferencia Internacional`. Las claves `moneda` y `cotizacion` de la config no aplican a exportación.

**Salida JSON de exportación.** El mismo resumen que A, B y C (`atajo: "fe"`, `tipoArca: 19`, `comprobante: "Factura de exportación E"`) más un bloque `exportacion` con cliente, destino, domicilio, actividad, incoterm, items y permisos; `solicitud` es el `Cmp` de WSFEX, con los nombres de ARCA. Forma exacta en [entrada y salida](docs/input-output.md#factura-de-exportación-e).

**`--numero` obligatorio en la `E`.** WSFEX numera por punto de venta y tipo, pero `@arcasdk/core` todavía no permite consultar el último comprobante E. Pasá el siguiente al último que emitiste (`1` si es el primero).

**Flags de otra letra en `arcli factura <letra>`.** Como `factura` comparte el comando para A, B, C y E, los flags que no aplican a la letra elegida se saltean con un aviso en "Avisos" y en `avisos` del JSON (`factura a --incoterm`, `factura e --alicuota`). Los atajos (`fa`, `fe`…) siguen rechazándolos como opción desconocida.

**Autocompletado con Tab** para bash, zsh y fish. Se instala con `arcli completado instalar`, que agrega una línea al archivo de inicio del shell (`~/.zshrc`, `~/.bashrc`…), y se saca con `arcli completado desinstalar`; también desde el modo interactivo, en Configuración → Autocompletado. Completa comandos y atajos, flags, valores (`--iva-receptor`, `--concepto`, `--alicuota`, `--moneda`, `--transferencia`, `--ac`), claves de config y sus valores, tablas de `parametros` y letras de las familias; donde va una ruta, archivos. No hay que reinstalarlo al actualizar ARCLI. Ver [Autocompletado](docs/cli-reference.md#autocompletado).

**CUIT con dígito verificador y con o sin guiones en todos lados.** `arcli padron`, `arcli fce-obligado`, `--cuit`, `--cuil`, `--acuit`, `comprobanteAsociado.cuit` en el JSON, `config establecer cuit` y el modo interactivo aceptan `20-33333333-4` o `20333333334`, y rechazan un CUIT mal tipeado antes de llegar a ARCA. Antes `arcli padron 20-20179706-4` fallaba y nadie chequeaba el dígito verificador.

**`numero` en el JSON de facturación.** El número que le tocó al comprobante emitido (`null` en una previsualización), y `solicitud` lo trae en `CbteDesde`/`CbteHasta`. El panel de texto muestra `Número: 00003-00000125`. Antes el número solo se veía con `--bruto`.

**Error `ARCA_LAST_VOUCHER_ERROR`.** Si ARCA rechaza el pedido del último número (por ejemplo, con un punto de venta no habilitado para web service), la facturación y `arcli ultimos` cortan ahí con el mensaje de ARCA y una sugerencia. No se emite nada.

**Esc en las preguntas del CLI.** "¿Querés emitir … ahora?", que aparece sin `--emitir` en una terminal, ahora se cierra con Esc como un "no", igual que en el modo interactivo y en las preguntas del PDF.

Nueva sección de la `E` en [referencia del CLI](docs/cli-reference.md#factura-de-exportación-e-wsfex) y en [reglas de validación](docs/validation-rules.md#factura-de-exportación-e); credenciales de WSFEX en [configuración](docs/configuration.md#certificados-de-exportación-wsfex); items, JSON y limitaciones (`--numero` obligatorio, sin notas E, sin lote) en [entrada y salida](docs/input-output.md), [PDF](docs/pdf.md) y [limitaciones](docs/limitations.md); el asistente de la `E` en [modo interactivo](docs/modo-interactivo.md) y sus problemas comunes en [troubleshooting](docs/troubleshooting.md).

</details>

### 🔧 Cambiado

- **Salida:** la ayuda es más corta, está toda en español y cada comprobante muestra solo sus flags (#70).
- **Errores:** los errores de uso están en español, también en el `error` del `--json` (#70).
- **Salida:** voseo y tildes en mensajes, ayuda, asistente y PDF; flags y claves no cambian (#70).

<details><summary>Detalle</summary>

**Ayuda más corta y toda en español.** `arcli --ayuda` pasa de unas 145 líneas a 57: los 18 atajos van en una tabla familia × letra y `storybook` (herramienta de desarrollo) ya no aparece, aunque sigue funcionando. La ayuda de cada comprobante (`arcli fc --ayuda`) pasa de 177 a 79 líneas: muestra solo los flags que aplican a ese comprobante, menciona los alias en la opción principal (`punto de venta (alias: --pv)`) y ya no repite la tabla de parámetros. Los flags ocultos se siguen aceptando igual. "Usage", "Options", `[options]`, `<number>` y la descripción de `--version` ahora están en español.

**Errores de uso en español.** Opción o comando desconocido, valor faltante y argumentos de más (`opción desconocida '--montoo' (¿quisiste decir --monto?)`). También en el `error` del JSON con `--json`; el `codigo` sigue siendo `INPUT_VALIDATION_ERROR`.

**Voseo y tildes en toda la salida.** Mensajes, ayuda, modo interactivo y PDF ("Usá", "Revisá", "número", "configuración"). Los flags, claves de config, valores (`produccion`, `cotizacion`) y claves JSON no cambian. Si un script compara el texto de un mensaje de error en lugar de `codigo`, puede necesitar un ajuste.

</details>

### 🐛 Corregido

- **PDF:** los comprobantes B y los A a un monotributista traen las leyendas obligatorias (#64).
- **Facturas:** un `montoTotal` del JSON con más de 2 decimales da error en lugar de redondearse (#63).
- **Errores:** un punto de venta inválido corta con `ARCA_LAST_VOUCHER_ERROR` en lugar de seguir con el número 1 (#62).
- **Facturas:** un lote cortado antes de emitir lista el comprobante que falló en `sinProcesar` (#62).
- **PDF:** sin `emisor.iibb`, el PDF muestra "-" en lugar de "Exento" (#62).
- **Config:** los números con letras o notación científica dan error en lugar de leerse a medias (#62).
- **PDF:** `arcli pdf instalar` ya no queda colgado con un proxy que no responde (#62).
- **Config:** `consultarPadron false` se respeta siempre (#68).
- **Salida:** ya no sale el aviso de flags solo del PDF si no los pasaste (#68).
- **Asistente:** el PDF propone el nombre y el domicilio del padrón, y el comando equivalente lleva `--moneda ARS` si hace falta (#68).

<details><summary>Detalle</summary>

**Leyendas obligatorias en el PDF.** Los comprobantes B ahora traen el bloque del Régimen de Transparencia Fiscal al Consumidor (Ley 27.743, RG 5614), con el IVA contenido, y los comprobantes A a un monotributista la leyenda de la RG 5003 sobre el crédito fiscal. Salen debajo del CAE. Ver [PDF](docs/pdf.md#leyendas-obligatorias).

**`montoTotal` del JSON nunca se redondea.** Con más de 2 decimales se redondeaba en silencio antes de validar (`1.005` se emitía por `$1`). Ahora da `INPUT_VALIDATION_ERROR` ("Use hasta 2 decimales"), igual que `--monto` y el resto de los importes.

**Punto de venta inválido.** La facturación seguía con el número 1 y recién fallaba al emitir con un error confuso, y `arcli ultimos` mostraba que no había comprobantes. Ahora cortan con `ARCA_LAST_VOUCHER_ERROR`.

**Lote cortado antes de emitir.** Si el lote se cortaba en el login o en el pedido del último número, el comprobante que falló no figuraba en `detalles.sinProcesar` de `BATCH_EMISSION_ERROR`, y reintentar solo esa lista lo perdía. Ahora figura. Si la emisión quedó sin confirmar, sigue en `sinConfirmar` y no en `sinProcesar`, como antes.

**IIBB en el PDF.** Sin `emisor.iibb`, el PDF decía "Exento"; ahora muestra "-". Si sos exento, configuralo con `arcli config establecer emisor.iibb Exento`. La configuración guiada del modo interactivo ahora lo pregunta junto a los otros datos del emisor.

**Números con letras o notación científica.** `config establecer puntoVenta 3a` guardaba `3`, y `arcli consultar fc 1e3` buscaba el 1000. Ahora dan error, igual que en el modo interactivo.

**`arcli pdf instalar` colgado.** Con un proxy que no responde, npm o la descarga del navegador no terminaban nunca. Ahora se cortan a los 5 y 15 minutos con `PDF_PLUGIN_INSTALL_ERROR`.

**`consultarPadron false` se respeta siempre.** Con un `ivaReceptor` en la config, facturar con `--cuit` igual consultaba el padrón y su condición IVA pisaba la de la config.

**Aviso falso en `avisos`.** "--descripcion, --receptor-nombre y --receptor-domicilio solo se usan en el PDF" salía sin haber pasado esos flags, cuando el nombre o el domicilio los había completado el padrón.

**Modo interactivo.** Al generar el PDF, apretar Enter en el nombre o el domicilio del receptor borraba lo que había traído el padrón; ahora lo propone y Enter lo deja. En una FCE se informa el `aliasCbu` de la config, como con flags. Y si la config tiene una moneda extranjera, el comando equivalente de un comprobante en pesos lleva `--moneda ARS`, así al pegarlo hace lo mismo.

</details>

## [2.1.0] - 2026-10-23 · Padrón de ARCA

`arcli padron` y el IVA receptor desde el padrón al facturar con `--cuit`, el aviso de vencimiento del certificado y una guía para el punto de venta de web service. Además, el JSON de `--cargar` se valida clave por clave, los errores con `--json` tienen siempre la misma forma y los ejemplos de la ayuda y de los docs se pueden copiar y andan.

#### Datos de un CUIT desde el padrón

Nombre o razón social, domicilio fiscal, condición IVA, impuestos, categoría de monotributo y actividad, desde el padrón de ARCA.

```sh
arcli padron 20201797064
```

#### IVA receptor desde el padrón

Al facturar con `--cuit` y sin `--ir`, ARCLI usa la condición IVA del padrón y completa el nombre y el domicilio para el PDF.

```sh
arcli fa -m 121000 --cs --cuit 20168598204
```

#### Aviso de vencimiento del certificado

A menos de 30 días de vencer, los comandos que van a ARCA lo avisan, y con el certificado vencido cortan con `CERTIFICATE_EXPIRED` antes de autenticar.

#### Exit code `2` en un rechazo

Un comprobante que ARCA rechaza sale con exit code `2`, así un script se entera sin leer `estado`.

> [!WARNING]
> **Puede afectar scripts**
>
> - **Exit code `2`** cuando ARCA rechaza un comprobante (antes, `0`).
> - **Validación estricta del JSON de `--cargar`:** una clave desconocida o con otro tipo ahora es error.
> - **Un array de un elemento en `--cargar`** sale como array.
> - **`--bruto`** agrega `respuesta` en lugar de reemplazar el resumen.
> - **`config revisar`** ya no recibe `--testing` ni `--produccion`.
> - **Los PDFs** se guardan en una subcarpeta por CUIT.
> - **`sugerencia` siempre** en el JSON de error, en `null` si no hay nada que sugerir.
> - **Un certificado vencido, un fallo de login en WSAA o un error al pedir el último número** ya no salen como `EMISSION_UNCERTAIN`, sino como `UNEXPECTED_ERROR` o `TRANSIENT_ERROR`.
> - **Un `config.json` inválido** sale como `CONFIGURATION_ERROR`, y **`config establecer` con un valor inválido**, como `INPUT_VALIDATION_ERROR`, no como error inesperado.
> - **`--dia 31`** en un mes sin día 31 da error.
>
> Los comandos, los flags de facturación y las claves de config siguen siendo los mismos. El detalle está en "Cambiado" y "Corregido".

---

### ✨ Agregado

- **Consultas:** `arcli padron <cuit>` muestra los datos de un CUIT desde el padrón de ARCA (#44).
- **Facturas:** con `--cuit` y sin `--ir`, el IVA receptor, el nombre y el domicilio salen del padrón (#44).
- **Certificados:** aviso a menos de 30 días de vencer, y `CERTIFICATE_EXPIRED` con el certificado vencido (#57).
- **Errores:** el rechazo `10005` y `arcli estado` explican cómo crear un punto de venta para web service (#53).

<details><summary>Detalle</summary>

**`arcli padron <cuit>`.** Nombre o razón social, domicilio fiscal, condición IVA, impuestos, categoría de monotributo y actividad de un CUIT, desde el padrón de ARCA (`ws_sr_constancia_inscripcion`). Con `--json` para scripts.

**IVA receptor desde el padrón.** Al facturar con `--cuit` y sin `--ir`, ARCLI usa la condición IVA del padrón, antes que el `ivaReceptor` de la config. También completa el nombre y el domicilio del receptor para el PDF. Si el padrón no responde o no la informa, sigue con la config y avisa. El modo interactivo propone la misma condición al cargar un CUIT. Se desactiva con `arcli config establecer consultarPadron false`.

**Aviso de vencimiento del certificado.** A menos de 30 días de vencer cualquiera de los certificados configurados (testing o producción, sin importar con cuál estés trabajando), los comandos que van a ARCA (facturación, `ultimos`, `consultar`, `padron`, `fce-obligado`, `parametros`, `estado`) avisan al principio, en stderr: `El certificado de produccion vence el 20/11/2026 (en 10 días)`, con el link a la [guía para renovarlo](docs/obtencion-certificados.md). Con `--json`, stdout queda solo con el JSON y en facturación el aviso va también en `avisos`. En el modo interactivo es un recuadro debajo de la barra de estado. Si vencen los dos, van en el mismo recuadro. Si ya venció el del entorno que se usa, cortan antes de autenticar en ARCA con el error `CERTIFICATE_EXPIRED` (antes fallaba el login en WSAA con un error inesperado).

**Punto de venta para web service.** Si ARCA rechaza el comprobante porque el punto de venta no es de web service (error `10005`), la `sugerencia` lo dice y apunta a la [guía para crear uno](docs/obtencion-certificados.md#punto-de-venta-para-web-service). `arcli estado` avisa lo mismo cuando el punto de venta configurado no está entre los habilitados. Desde el 1/11/2026 ARCA da de alta de oficio puntos de venta "Factura en línea" a monotributistas (RG 5893/2026), y esos no sirven para ARCLI.

</details>

### 🔧 Cambiado

- **Errores:** un comprobante rechazado por ARCA sale con exit code `2` (antes, `0`) (#42).
- **Facturas:** el JSON de `--cargar` se valida clave por clave: una clave desconocida o con otro tipo es error (#51).
- **Facturas:** un array de un elemento en `--cargar` es un lote y sale como array (#52).
- **Salida:** `--bruto` agrega `respuesta` sin quitar el resumen (#52).
- **Errores:** todo error con `--json` trae `sugerencia`, en `null` si no hay nada que sugerir (#56).
- **Config:** `config revisar` revisa los dos entornos y ya no recibe `--testing` ni `--produccion` (#41).
- **PDF:** los PDFs se guardan en una subcarpeta por CUIT emisor y no se pisan (#42).
- **Salida:** `--bruto` es solo de los comandos de facturación; en los demás se ignora con un aviso (#54).
- **Asistente:** `arcli interactivo --json` ya no falla: ignora `--json` y `--bruto` con un aviso (#54).
- **Asistente:** el comando equivalente lleva siempre `--testing` o `--produccion` (#42).

<details><summary>Detalle</summary>

**Exit code `2` cuando ARCA rechaza un comprobante.** Antes salía con `0` y había que leer `estado` para enterarse. En un lote, `2` si ARCA rechazó al menos uno. `observado` sigue saliendo con `0`. Si un script trataba cualquier exit distinto de `0` como error de ARCLI, ahora también corta en un rechazo.

**El JSON de `--cargar` se valida clave por clave.** Una clave desconocida (`"montototal"`, `"vencimiento"`, `"moneda"`) o un valor con otro tipo (`"puntoVenta": "3"`, `"emitir": "true"`, `null`) ahora es error de entrada (`INPUT_VALIDATION_ERROR`, o `BATCH_VALIDATION_ERROR` con el índice en un lote) que nombra la clave y sugiere la correcta. Antes se ignoraban sin aviso: con `"puntoVenta": "3"` se emitía en el punto de venta de la config. Si un archivo que te funcionaba ahora falla, corregí la clave o sacale las comillas al número; las claves documentadas siguen igual. Un lote vacío (`[]`) también es error: antes se ignoraba el archivo y se usaban solo los flags. La tabla de claves y su flag equivalente está en [entrada y salida](docs/input-output.md#flags-y-claves-del-json).

**Un array de un elemento en `--cargar` es un lote.** Si el JSON es un array sale un array (con `indice`) y los errores son `BATCH_VALIDATION_ERROR` / `BATCH_EMISSION_ERROR`, tenga uno o muchos elementos. Antes un array de un elemento salía como objeto y con los errores de un comprobante suelto. Un objeto sigue devolviendo un objeto. Si un script leía `[0]` solo cuando había más de uno, ya puede leer siempre el array.

**`--bruto` agrega la respuesta cruda sin quitar el resumen.** Con `--json --bruto` ahora salen `cae`, `caeVencimiento`, `estado`, `resultado`, `errores`, `observaciones` y el resto del JSON de siempre, más `respuesta` con la respuesta cruda de ARCA. Antes `--bruto` reemplazaba el resumen y esos campos desaparecían, aunque la documentación decía que agregaba. En texto pasa lo mismo: el resultado se muestra como siempre y el panel `Respuesta bruta` va al final. Vale igual para `bruto=true` en la config.

**`sugerencia` siempre en el JSON de error.** Todos los errores con `--json` traen las mismas cuatro claves (`codigo`, `detalles`, `error`, `sugerencia`), con `sugerencia: null` cuando no hay nada que sugerir. Antes faltaba en los errores sin sugerencia (`CONFIGURATION_ERROR`, `INPUT_VALIDATION_ERROR`…) y era `null` solo en los inesperados. Si un script chequeaba si la clave existe, ahora tiene que chequear si es `null`.

**`config revisar` revisa los dos entornos.** Valida el entorno por defecto y cualquier otro que tenga `cert` o `key` configurados, cada uno en su línea (`Validacion testing`, `Validacion produccion`). La línea `Revision activa` del JSON ya no existe. Ya no recibe `--testing` ni `--produccion`: antes los aceptaba pero los ignoraba y revisaba siempre testing.

**PDFs en una subcarpeta por CUIT emisor.** `~/arcli/comprobantes/20123456789/factura-c_0003-00000125.pdf` (en testing, `testing/20123456789/`). Si el archivo ya existe no se pisa: se guarda con `-2`, `-3` y así.

**`--bruto` solo en los comandos de facturación.** `padron`, `fce-obligado`, `ultimos`, `consultar`, `parametros`, `estado` e `interactivo` ya no lo declaran (no lo usaban): pasado ahí, el comando corre igual y avisa en stderr que se ignora. Ya no aparece en su ayuda.

**`arcli interactivo --json` ya no falla.** El asistente acepta solo `--testing` y `--produccion`; `--json` y `--bruto` se ignoran con un aviso. Sin terminal interactiva sigue fallando, con o sin `--json`.

**Comando equivalente del modo interactivo.** Siempre lleva `--testing` o `--produccion`. Antes, en testing no llevaba nada, y si la config pasaba a producción el comando pegado emitía ahí.

</details>

### 🐛 Corregido

- **Errores:** `EMISSION_UNCERTAIN` queda solo para un fallo en la llamada que emite (#50).
- **PDF:** si un lote se corta, los comprobantes ya emitidos tienen su PDF (#49).
- **Facturas:** en un lote, un fallo del padrón o de la cotización sale con su índice antes de emitir (#49).
- **Config:** un `config.json` inválido es `CONFIGURATION_ERROR`, con la ruta del archivo y qué hacer (#48).
- **Salida:** la clave `json` de la config vale en todos los comandos (#54).
- **Errores:** los errores de uso salen en JSON con `--json` o `json=true` (#54).
- **Salida:** una opción global que no aplica al comando avisa que se ignora (#43).
- **Config:** `config` y sus subcomandos respetan `json=true` de la config (#43).
- **Fechas:** `--dia` ya no corre un mes de más a fin de mes (#42).
- **Salida:** con `FORCE_COLOR`, el `--json` redirigido sale sin colores (#47).
- **Config:** `config` y sus subcomandos respetan `--json` (#41).
- **Config:** `config --ayuda` y `config establecer --ayuda` listan todas las claves, por sección (#56).
- **Docs:** los links de `llms.txt` y del README en el paquete de npm apuntan a GitHub (#56).
- **Config:** `config establecer` con un valor inválido es `INPUT_VALIDATION_ERROR` (#41).
- **Docs:** los ejemplos de la ayuda y de los docs se pueden copiar y andan (#55).

<details><summary>Detalle</summary>

**"Puede haberse emitido" cuando seguro no se emitió.** Un certificado vencido, un fallo de login en WSAA o un error al pedir el último número salían como `EMISSION_UNCERTAIN`, con la sugerencia de verificar con `arcli ultimos` antes de reintentar. En esos casos no llegó nada a ARCA: ahora salen con su error (`UNEXPECTED_ERROR` o `TRANSIENT_ERROR` en el JSON) y se puede reintentar directo. `EMISSION_UNCERTAIN` queda solo para un fallo en la llamada que emite (red, timeout, transacción activa). En un lote, ese caso ya no suma `detalles.sinConfirmar`.

**Lote interrumpido, PDFs de los ya emitidos.** Si un lote se cortaba a mitad, los comprobantes que ya tenían CAE quedaban sin PDF. Ahora se generan antes de mostrar el error, según `pdf` o `--exportar-pdf` como en un lote completo, y en `--json` cada uno lleva su campo `pdf`. Si falla el PDF, el error que se muestra sigue siendo el de la emisión.

**Lote, fallos del padrón o de la cotización con su índice.** Si la consulta al padrón (IVA receptor desde `--cuit`) o a la cotización oficial fallaba para un ítem, el lote cortaba con un error que no decía cuál era. Ahora sale en `BATCH_VALIDATION_ERROR`, junto con los demás ítems con problemas y su `#n`, antes de emitir ninguno.

**`config.json` con JSON inválido** salía como "Error inesperado", sin decir qué archivo ni qué hacer. Ahora es un error de configuración (`CONFIGURATION_ERROR`) con la ruta del archivo y la sugerencia de corregirlo a mano o renombrarlo y volver a configurar. ARCLI no lo borra ni lo pisa.

**`json=true` de la config en todos los comandos.** `pdf` (y sus subcomandos) y `parametros` sin tabla solo salían en JSON con `--json`. Ahora todos los comandos resuelven la salida igual: `--json` o, si no está, la clave `json` de la config. `config ruta` acepta `--json` y devuelve `{"ruta": "..."}`.

**Errores de uso en JSON.** Una opción desconocida (`arcli fc --montoo 1 --json`), un valor faltante o un comando que no existe salían en texto aunque se pidiera JSON. Ahora, con `--json` o `json=true`, salen como `INPUT_VALIDATION_ERROR` en el mismo formato que el resto de los errores, con exit code `1`. Sin JSON se ven igual que antes.

**Opciones globales que no aplican.** `--testing`, `--produccion`, `--json` o `--bruto` en un comando que no las usa (`arcli config ruta --produccion`) se aceptaban sin decir nada. Ahora el comando corre igual y avisa en stderr que la opción se ignora.

**`json=true` en `config`.** `config`, `config revisar`, `config establecer` y `config eliminar` respetan `json=true` de la config, como el resto de los comandos.

**`--dia` corría un mes de más** a fin de mes: `--dia 15` el 31/03 daba el 15/05 en vez del 15/04, y ARCA lo aceptaba con las fechas de servicio y vencimiento equivocadas. Si el día no existe en ese mes (`--dia 31` con abril), ahora da error.

**`--json` con `FORCE_COLOR`.** Con `FORCE_COLOR=1` en el entorno, el JSON redirigido a un archivo o a otro programa salía con colores y no se podía parsear. Ahora solo se colorea en una terminal.

**`--json` en `config`.** `config`, `config revisar`, `config establecer` y `config eliminar` ignoraban `--json` y salían en texto.

**`config --ayuda` listaba la mitad de las claves.** Mostraba 15 de 30. Ahora `config --ayuda` y `config establecer --ayuda` listan todas, por sección, con sus valores posibles.

**Links de `llms.txt` y del README en el paquete de npm.** Apuntaban a `docs/`, que no se publica en npm. Ahora son links a GitHub.

**`config establecer` con un valor inválido** (`puntoVenta abc`, `comprobantesPorLista 99`) sale como error de entrada (`INPUT_VALIDATION_ERROR`) y no como error inesperado.

**Ejemplos de la ayuda y de los docs que fallaban.** Los ejemplos de `--ayuda` de las notas B y C, las B, las FCE y las familias, las NC/ND FCE de `arcli ejemplos` y varios de los docs (`pdf.md`, `usage-patterns.md`, `cli-reference.md`, el JSON de `llms.txt` y de `input-output.md`) daban error al copiarlos: asociado de otra letra, IVA receptor que la letra no admite, FCE sin `--cbu` o con `--acuit` ajeno, fechas fijas viejas o sin IVA receptor. Ahora cada nota asocia una factura de su letra y categoría, y un test pasa todos los ejemplos por el parser y arma la solicitud a ARCA.

</details>

## [2.0.0] - 2026-10-12 · Montos en formato argentino

Montos en formato argentino (`1.500,50`), enteros estrictos y una emisión que avisa antes de duplicar un comprobante: es una versión mayor que sale de una auditoría del proyecto. El resto son correcciones: fecha argentina en cualquier zona horaria, `ImpTotal` exacto, PDF escapado, archivos privados y validaciones más estrictas.

#### Montos en formato argentino

Punto para miles y coma para decimales en todos los flags de montos: `15.000` es quince mil y `1.500,50`, mil quinientos con cincuenta.

```sh
arcli fc -m 1.500,50 --cs --cfinal --ir-cf
```

#### Sin comprobantes duplicados

Si falla la llamada que emite, `EMISSION_UNCERTAIN` avisa que el comprobante puede haberse emitido y da el comando para verificarlo antes de reintentar.

#### Estado de ARCA en el asistente

La barra muestra si ARCA funciona, anda con demoras o no responde, y el menú ofrece actualizar a la versión nueva.

#### Tus archivos, solo para vos

Tickets, config y PDFs se crean con permisos privados, y el PDF escapa los textos que vienen de afuera.

> [!WARNING]
> **Puede afectar scripts**
>
> - **Montos en formato argentino:** punto para miles y coma para decimales (`15.000`, `1.500,50`). `-m 1500.50` ahora da error; escribí `1500,50`.
> - **Enteros solo con dígitos:** `--pv 3a` da error en vez de leerse como 3.
> - **`--dia` no se combina con `--fecha` ni `--servicio-hasta`.**
> - **Varias alícuotas:** la suma tiene que coincidir exacta con `--monto`.
> - **Un error de red al emitir** sale como `EMISSION_UNCERTAIN`, no como `TRANSIENT_ERROR`/`UNEXPECTED_ERROR`.
> - **Montos del JSON de `--cargar` con 2 decimales como máximo** (la cotización, 6): antes se aceptaban más.
> - **`cae` y `caeVencimiento` son `null`** en un comprobante rechazado, antes `""`.
> - **Errores en JSON también con `json=true`** en la config, no solo con `--json`.
> - **`--at` se valida como `--ac`:** una nota A ya no asocia una factura B por código.
> - **`config establecer` rechaza** valores inválidos y una clave privada cifrada, que antes guardaba.
>
> Para pasar a la 2: revisá los montos de los scripts (antes `-m 15.000` se leía como 15 y `-m 1500,50` como 1500, sin aviso) y, ante `EMISSION_UNCERTAIN`, verificá con `arcli ultimos` antes de reintentar. No se saca ningún comando, flag ni clave de config.

---

### ✨ Agregado

- **Asistente:** la barra muestra si ARCA funciona, anda con demoras o no responde, con el entorno y el punto de venta (#38).
- **Asistente:** si hay una versión nueva, el menú ofrece actualizar y muestra sus novedades (#38).
- **Salida:** las cajas, la barra de estado y el logo ocupan el mismo ancho (#38).
- **Salida:** la versión aparece debajo del logo, en el asistente y en la ayuda (#38).
- **Asistente:** las filas de las listas de comprobantes ocupan todo el ancho (#38).

<details><summary>Detalle</summary>

**Modo interactivo, estado de ARCA en la barra.** La barra de arriba del menú ya no dice "Modo interactivo": muestra **ARCA funcionando**, **con demoras** (más de 3 segundos), **con problemas** (algún servidor no responde OK) o **sin respuesta**, en color, seguido del entorno (`TESTING` en naranja, `PRODUCCION` en celeste). A la izquierda, la razón social del emisor (o el CUIT, si no está configurada) y el punto de venta.

**Modo interactivo, actualizar.** Si hay una versión nueva, la primera opción del menú es **Actualizar a la versión X.Y.Z**. Muestra tu versión, la nueva y sus novedades, y con **Cerrar para actualizar** copia `npm install -g arcli@latest` al portapapeles y cierra el asistente para que lo ejecutes. En el modo interactivo el aviso de nueva versión ya no aparece al salir.

**Mismo ancho para todo.** Las cajas de la salida en texto, la barra de estado y el logo (ahora centrado) ocupan 92 columnas, o menos si la terminal es más angosta. Antes cada caja medía distinto según su contenido. Los comprobantes (vista previa, resultado de la emisión y `consultar`) mantienen su ancho de ticket, de 68 a 80 columnas, y van centrados. El JSON no cambia.

**Versión debajo del logo** (`v1.8.0 | LcsGrz`), en el modo interactivo y en la ayuda.

**Modo interactivo, listas de comprobantes.** Las filas ocupan todo el ancho de la línea punteada que las enmarca.

</details>

### 🔧 Cambiado

- **Facturas:** los montos van en formato argentino, con punto para miles y coma para decimales (#34).
- **Asistente:** los montos siguen la misma regla, y el comando equivalente los escribe con coma (#34).
- **Facturas:** los enteros aceptan solo dígitos; CUIT, CUIL y DNI aceptan además guiones y puntos (#36).
- **Fechas:** `--dia` con `--fecha` o `--servicio-hasta` da error en lugar de ignorarse (#36).
- **Facturas:** los montos del JSON aceptan 2 decimales como máximo, y la cotización 6 (#36).
- **Facturas:** con varias alícuotas, la suma tiene que coincidir exacta con `--monto` (#36).

<details><summary>Detalle</summary>

**Montos en formato argentino, y es un cambio que rompe.** `--monto`, `--exento`, `--nogravado`, `--cotizacion-moneda`/`--cm`, el monto de `--alicuota TASA:MONTO` y `config establecer cotizacion` usan punto para miles y coma para decimales. `15.000` es quince mil y `1.500,50` es mil quinientos con cincuenta. Antes `-m 15.000` se leía como 15 y `-m 1500,50` como 1500, sin aviso. Ahora `1500.50` da error ("use coma para los decimales"), igual que el texto sobrante (`12abc`) y más de 2 decimales (la cotización acepta hasta 6). El JSON de `--cargar` no cambia: ahí los montos son números.

**Modo interactivo.** Los montos siguen la misma regla. `1500.50` ya no se acepta y más de 2 decimales da error en lugar de redondearse en silencio. El comando equivalente que muestra al final escribe los montos con coma.

**Enteros estrictos, y es un cambio que rompe.** `--pv`, `--punto-venta`, `--ar`, `--apv`, `--at`, `--dia` y `--cantidad` aceptan solo dígitos; antes `--pv 3a` se leía como 3. `--cuit`, `--cuil` y `--dni` aceptan además guiones y puntos (`20-11111111-2`), como el modo interactivo; antes `--cuit 20111111112xyz` pasaba.

**`--dia` con `--fecha` o `--servicio-hasta` da error.** Antes `--dia` se ignoraba sin aviso.

**Montos del JSON con 2 decimales como máximo** (la cotización, 6), igual que los flags.

**Varias alícuotas: la suma tiene que coincidir exacta** con `--monto`; antes se aceptaba un centavo de diferencia, y el `ImpTotal` enviado podía no coincidir con la suma de sus partes.

</details>

### 🐛 Corregido

- **Errores:** si falla la llamada que emite, el error es `EMISSION_UNCERTAIN` y dice cómo verificarlo antes de reintentar (#35).
- **Asistente:** las notas y "Repetir factura" copian más de la original, como la moneda, el exento y el no gravado (#39).
- **Config:** las rutas de certificados y tickets se guardan absolutas (#39).
- **Certificados:** una clave privada cifrada se rechaza al guardarla, con cómo descifrarla (#39).
- **Config:** `config establecer` ya no guarda valores inválidos que dejaban el CLI inutilizable (#37).
- **Fechas:** "hoy" es siempre el día en Argentina, en cualquier zona horaria (#36).
- **Facturas:** `ImpTotal` se calcula exacto con aritmética decimal (#36).
- **Notas:** `--at` se valida como `--ac` (#36).
- **Salida:** `ayuda` como valor de un flag ya no abre la ayuda (#36).
- **PDF:** Ctrl+C en las preguntas del PDF no genera el PDF y avisa que el comprobante quedó emitido (#35).
- **Facturas:** un flag escrito siempre gana a la config o al JSON (#35).
- **Errores:** los errores salen en JSON también con `json=true` en la config (#35).
- **Salida:** `cae` y `caeVencimiento` son `null` en un comprobante rechazado (#35).
- **Errores:** los errores con sugerencia la incluyen en `sugerencia` también en JSON (#35).
- **Docs:** la documentación explica bien cuándo se emite en producción sin flags (#34).

<details><summary>Detalle</summary>

**Emisión sin confirmar.** Si falla la llamada que emite en ARCA (red, timeout, transacción activa), el error ahora es `EMISSION_UNCERTAIN` y avisa que el comprobante puede haberse emitido igual, con el `arcli ultimos <tipo> --pv <n>` para verificarlo antes de reintentar. Antes salía como `TRANSIENT_ERROR` o `UNEXPECTED_ERROR` y sugería reintentar, lo que podía duplicarlo. En un lote, `BATCH_EMISSION_ERROR` suma `detalles.sinConfirmar`.

**Modo interactivo, notas y repetir factura copian más de la original.** Una NC o ND sobre una factura en dólares va en dólares, con la cotización de la factura; antes salía en pesos. "Anular el total" copia también exento y no gravado. "Repetir factura" copia exento y no gravado. Si la factura tiene varias alícuotas o tributos, ARCA no devuelve el detalle para reproducirla. En ese caso se avisa, no se ofrece "anular el total" ni "mismo monto", y se pide elegir la alícuota.

**Rutas absolutas en la config.** `cert.*`, `key.*` y `ticketPath` se guardan resueltas, como `pdfCarpeta`. Antes una ruta relativa dependía de la carpeta desde donde se corría ARCLI.

**Clave privada cifrada.** `config establecer key.*` la rechaza con un mensaje claro y cómo descifrarla. Antes se aceptaba y fallaba recién al hablar con ARCA.

**`config establecer` ya no guarda valores inválidos.** Antes `config establecer cuit abc` lo guardaba igual y dejaba el CLI inutilizable, incluso `config eliminar`. Ahora se valida antes de guardar, y una config que ya estaba rota se arregla con `config establecer` o `config eliminar` de la clave que falla.

**Fecha argentina siempre.** En un equipo con otra zona horaria (por ejemplo un servidor en UTC), entre las 21 y las 24 h la fecha del comprobante salía con el día siguiente. Ahora "hoy" es siempre el día en Argentina.

**`ImpTotal` exacto.** Se calcula como la suma de no gravado, exento, neto e IVA con aritmética decimal. Con varias alícuotas, el total ya no sale como `300.29999999999995`.

**`--at` se valida como `--ac`.** Una NC A ya no puede asociar una factura B por código; si `tipo` y `atajo` vienen juntos tienen que coincidir.

**`ayuda` como valor de un flag** (`--descripcion ayuda`) ya no abre la ayuda.

**Ctrl+C en las preguntas del PDF**, que llegan después de emitir: el modo interactivo decía "Cancelado. No se emitio nada." aunque el comprobante ya estaba emitido, y el comando terminaba en "Error inesperado" con exit 1. Ahora se toma como "no generar el PDF" y se avisa que el comprobante quedó emitido.

**Un flag escrito siempre gana.** `--previsualizar` ya no choca con `emitir=true` en la config o `"emitir": true` en el JSON, y `--emitir` gana a `"previsualizar": true`. Lo mismo con `--alicuota TASA` sobre las `alicuotas` del JSON, `--cm` sobre `"mismaMoneda"` y `--misma-moneda` sobre `"cotizacionMoneda"`. El error de "ambos a la vez" queda solo si los dos vienen del mismo lugar.

**Errores en JSON con `json=true` en la config.** Antes solo salían en JSON con el flag `--json`.

**`cae` y `caeVencimiento` son `null` en un comprobante rechazado**, como dice la documentación; antes venían como `""`.

Los errores con sugerencia la incluyen en `sugerencia` también en JSON (antes solo los del PDF).

**Documentación de la emisión en producción.** Decía que emitir en producción exige `--produccion --emitir`. En realidad el entorno sale de `config.entorno` y la emisión de `config.emitir` cuando no pasás flags: con `entorno produccion` y `emitir true` se emite en producción sin flags. El comportamiento no cambió; se corrigieron SECURITY.md, README, `llms.txt`, la ayuda y los docs.

</details>

### 🔒 Seguridad

- **PDF:** los textos se escapan antes de generar el PDF, así un `<script>` no se ejecuta (#37).
- **Config:** tickets, config y PDFs se crean solo para tu usuario (`0600`/`0700`) (#37).
- **Salida:** los datos de afuera ya no pueden meter secuencias de control en la terminal (#39).

<details><summary>Detalle</summary>

**PDF: textos escapados.** La plantilla de `@arcasdk/pdf` no escapa HTML y Chromium la renderiza con JavaScript: una razón social o descripción con `<script>` (por ejemplo, de un JSON de terceros) se ejecutaba, y un `&` legítimo se veía mal. Ahora todos los textos se escapan antes de generar el PDF.

**Tickets de ARCA y config solo para tu usuario.** ARCLI crea sus archivos con permisos `0600`/`0700` (umask `077`), incluidos los tickets que escribe el SDK, y deja en `0700` la carpeta de config y la de tickets que ya existían. Antes quedaban `0644`/`0755`, y en Linux otro usuario del equipo podía leer un ticket y usarlo para emitir durante su validez. Los PDFs nuevos también quedan solo para tu usuario.

**Salida de terminal sin secuencias de control.** Observaciones de ARCA, datos del JSON o errores de npm ya no pueden mover el cursor, borrar la pantalla, pisar una línea ni meter hipervínculos. Solo pasan colores, saltos de línea y tabs. `--json` no cambia.

</details>

## [1.8.0] - 2026-10-09 · Listas de comprobantes

Notas sobre cualquier factura desde el asistente, la clave `comprobantesPorLista` y `arcli ultimos` con 15 comprobantes por defecto. El resto son cambios del modo interactivo: notas separadas, Esc para volver y la config por secciones.

#### Notas sobre cualquier factura

En las notas, "Repetir factura" y "Consultar comprobantes", la lista trae los últimos 15, **Cargar más…** e **Ingresar el número a mano…**, así se puede hacer una nota sobre una factura vieja o de otro punto de venta.

#### Cuántos comprobantes por lista

La clave `comprobantesPorLista` fija cuántos muestran `arcli ultimos` y las listas del asistente.

```sh
arcli config establecer comprobantesPorLista 25
```

#### Esc para volver

**Esc** vuelve al paso anterior del asistente, en listas y en preguntas de texto, y en el menú principal lo cierra.

> [!WARNING]
> **Puede afectar scripts**
>
> - `arcli ultimos` muestra 15 comprobantes por defecto (antes 10). Si un script dependía de que vinieran 10, agregá `--cantidad 10`.
>
> Ningún otro flag ni formato JSON cambia.

---

### ✨ Agregado

- **Asistente:** las listas para elegir una factura traen los últimos 15, **Cargar más…** e **Ingresar el número a mano…** (#32).
- **Config:** la clave `comprobantesPorLista` fija cuántos comprobantes muestran `arcli ultimos` y el asistente (#32).

<details><summary>Detalle</summary>

**Modo interactivo, elegir factura.** En notas de crédito/débito, en "Repetir factura" y en "Consultar comprobantes", la lista ahora muestra los últimos 15, con el formato de `arcli ultimos`, y tiene **Cargar más…** para traer los anteriores e **Ingresar el número a mano…**, que pide punto de venta y número. Así se puede hacer una nota sobre una factura vieja o emitida desde otro punto de venta.

**Nueva clave de config `comprobantesPorLista`** (1 a 50, por defecto 15): cuántos comprobantes muestran `arcli ultimos` y las listas del modo interactivo. `arcli config establecer comprobantesPorLista 25`.

</details>

### 🔧 Cambiado

- **Consultas:** `arcli ultimos` muestra 15 comprobantes por defecto, o los de `comprobantesPorLista` (#32).
- **Asistente:** **Emitir nota de crédito** y **Emitir nota de débito** pasan a ser opciones separadas (#32).
- **Asistente:** "Ver últimos comprobantes" y "Consultar un comprobante" se unifican en **Consultar comprobantes** (#32).
- **Asistente:** **Esc** vuelve al paso anterior, en listas y en preguntas de texto (#32).
- **Config:** `arcli config` muestra la config por secciones; `--json` queda igual (#32).
- **Asistente:** Configuración suma **Ver configuración** y **Modificar configuración**, con las mismas secciones (#32).
- **Asistente:** Esc en el menú principal cierra el asistente, y hay más aire entre preguntas (#32).
- **Asistente:** la pregunta activa tiene una línea en blanco arriba, para distinguirla de las respondidas (#32).
- **Docs:** GIF del asistente regrabados y README con el logo en alta resolución (#32).

<details><summary>Detalle</summary>

**`arcli ultimos` muestra 15 comprobantes por defecto** (antes 10), o los de `config.comprobantesPorLista`. `--cantidad` sigue mandando. Si un script dependía de que vinieran 10, agregá `--cantidad 10`.

**Modo interactivo.** "Nota de crédito o débito sobre una factura" se separó en **Emitir nota de crédito** y **Emitir nota de débito**, así el flujo ya no pregunta cuál.

**Modo interactivo.** "Ver últimos comprobantes" y "Consultar un comprobante" se unificaron en **Consultar comprobantes**: elegís el tipo, la lista muestra los últimos y al elegir uno ves el detalle y volvés a la lista.

**Modo interactivo.** **Esc** vuelve al paso anterior, en listas y en preguntas de texto (antes había que escribir `<`, que sigue funcionando). La pregunta abandonada no queda en pantalla. La ayuda de teclas de las listas pasó a castellano.

**`arcli config` por secciones.** Cuenta, certificados, al facturar, FCE, datos del emisor, PDF, y salida y listados. Cambia solo la salida en texto; `arcli config --json` queda igual.

**Modo interactivo, configuración.** Nueva opción **Ver configuración**. "Cambiar un dato" pasó a llamarse **Modificar configuración**: usa las mismas secciones que `arcli config`, suma moneda, cotización y carpeta de tickets, y vuelve a la lista después de cada cambio.

**Modo interactivo.** Esc en el menú principal cierra el asistente. Más aire entre preguntas: dos líneas arriba de la activa, una debajo de la pregunta y otra entre la descripción y la ayuda de teclas.

**Modo interactivo.** La pregunta activa tiene una línea en blanco arriba, así se distingue de las ya respondidas, que quedan juntas. "← Volver" queda separado de las opciones por una línea en blanco.

**Docs.** GIF del modo interactivo regrabado y uno nuevo de "Consultar comprobantes" en la guía del modo interactivo. README con el logo en alta resolución y los chips centrados.

</details>

## [1.7.1] - 2026-10-06

Versión de documentación: un índice nuevo, la guía de arquitectura, un README más corto y correcciones en el glosario, la referencia y `llms.txt`. No cambia ningún comando, flag, clave de config ni JSON.

---

### 🔧 Cambiado

- **Docs:** documentación reorganizada, con un índice en `docs/README.md` y un README más corto (#31).
- **Docs:** `SECURITY.md` apunta al reporte privado de vulnerabilidades de GitHub (#31).

<details><summary>Detalle</summary>

**Documentación reorganizada.** Nuevo índice en `docs/README.md` y nueva guía de [arquitectura](https://github.com/LcsGrz/arcli/blob/main/docs/architecture.md). El README quedó más corto, con instalación, configuración y uso mínimos. Se eliminaron secciones duplicadas entre documentos y el checklist manual de UI, que usaba comandos que ya no existen.

**Seguridad.** `SECURITY.md` apunta al reporte privado de vulnerabilidades de GitHub.

</details>

### 🐛 Corregido

- **Docs:** correcciones en el glosario, la referencia del CLI, `llms.txt` y la guía de configuración (#31).

<details><summary>Detalle</summary>

**Docs.** El glosario decía que la alícuota de IVA era fija al 21%; la referencia del CLI citaba claves de config inexistentes; `llms.txt` documentaba un campo JSON (`confirmarProduccion`) que no existe; faltaban en la guía de configuración `NO_UPDATE_NOTIFIER` y `PUPPETEER_EXECUTABLE_PATH`.

</details>

## [1.7.0] - 2026-10-05 · Configuración guiada

Configuración guiada en el asistente, repetir una factura anterior y consultar un comprobante o el estado de ARCA sin salir del modo interactivo. También corrige el PDF de la Factura B, enlaza la guía de certificados desde la configuración y suma GIF e imágenes al README; no se rompe ningún comando, flag ni JSON existente.

#### Configuración guiada

CUIT, certificado, punto de venta y defaults, más los datos del PDF, paso a paso. Si falta algo obligatorio, el asistente la ofrece al abrirse.

```sh
arcli
```

#### Repetir una factura anterior

Copia receptor, concepto, monto y alícuota de una de las últimas, con fecha de hoy y el período que elijas.

#### PDF de la Factura B

Los renglones y el subtotal van con IVA incluido, así el total cierra.

---

### ✨ Agregado

- **Asistente:** "Repetir una factura anterior" copia una de las últimas, con fecha de hoy y el período que elijas (#27).
- **Asistente:** el submenú Configuración trae la configuración guiada, cambiar un dato y el plugin de PDF (#27).
- **Asistente:** consultar un comprobante por tipo y número, y Estado de ARCA con la cotización del dólar (#27).

<details><summary>Detalle</summary>

**Repetir una factura anterior.** Copia receptor, concepto, monto y alícuota de una de las últimas emitidas, con fecha de hoy y el período que elijas (este mes, el mes pasado, hoy u otro).

**Configuración.** Submenú con revisar, **configuración guiada** (CUIT, certificado, punto de venta y defaults, más los datos del PDF), **cambiar un dato** de una lista con su valor actual, y el **plugin de PDF**. Si falta algo obligatorio, el asistente ofrece la configuración guiada al abrirse.

**Consultar un comprobante** por tipo y número, y **Estado de ARCA** con la cotización del dólar.

</details>

### 🔧 Cambiado

- **Certificados:** el asistente y `arcli config revisar` enlazan la guía para obtener los certificados de ARCA (#30).

<details><summary>Detalle</summary>

**Guía de certificados en la configuración.** El asistente de configuración y `arcli config revisar` ahora muestran el link a [Cómo obtener los certificados de ARCA](https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md): en el mensaje inicial, justo antes de pedir el certificado de testing si todavía no hay uno cargado, y en el aviso de credenciales de testing faltantes. Antes el asistente apuntaba a una ruta relativa que no existe al instalar desde npm.

</details>

### 🐛 Corregido

- **PDF:** en la Factura B, los renglones y el subtotal van con IVA incluido (#29).

<details><summary>Detalle</summary>

**PDF de la Factura B.** El renglón y el subtotal mostraban el importe neto y el total con IVA, sin el IVA en ningún lado, así que no cerraba. Ahora los renglones y el subtotal de la B van con IVA incluido, como corresponde a una B. La A y la C no cambian.

</details>

## [1.6.0] - 2026-10-05 · Estado y parámetros

`arcli estado` y `arcli parametros` para consultar ARCA sin emitir, y una factura del asistente que pregunta primero lo requerido y después todos los opcionales juntos. No se rompe ningún comando, flag ni JSON existente.

#### Estado de ARCA

Si los servidores de ARCA responden, cuánto tardan y si tu punto de venta está habilitado. Con `--json`, `listo` dice si se puede emitir.

```sh
arcli estado
```

#### Tablas de ARCA

Puntos de venta, comprobantes, documentos, alícuotas, monedas y el resto de las tablas vigentes, y la cotización oficial de una moneda.

```sh
arcli parametros cotizacion USD
```

#### Opcionales en una sola pregunta

La factura del asistente pregunta primero lo requerido y después todos los opcionales juntos: se marcan con espacio y Enter sigue.

---

### ✨ Agregado

- **Consultas:** `arcli estado` muestra si ARCA responde, cuánto tarda y si el punto de venta está habilitado (#24).
- **Consultas:** `arcli parametros <tabla>` consulta las tablas de ARCA y la cotización oficial de una moneda (#24).

<details><summary>Detalle</summary>

`arcli estado`: muestra si los servidores de ARCA responden, cuánto tardan y si el punto de venta configurado está habilitado para tu CUIT (en producción; en testing ARCA no informa puntos de venta). Con `--json`, `listo` dice si se puede emitir.

`arcli parametros <tabla>`: consulta las tablas de ARCA vigentes (`puntos-venta`, `comprobantes`, `documentos`, `alicuotas`, `iva-receptor`, `monedas`, `conceptos`, `opcionales` y `tributos`). `arcli parametros cotizacion USD` muestra la cotización oficial. Sin tabla, lista las disponibles.

</details>

### 🔧 Cambiado

- **Asistente:** la factura pregunta primero lo requerido y después todos los opcionales en una sola pregunta (#25).

<details><summary>Detalle</summary>

**Modo interactivo.** La factura pregunta primero solo lo requerido y después, en **una sola pregunta**, todos los opcionales: se marcan con espacio y Enter sigue. Sin marcar nada se usan los valores por defecto. La alícuota de IVA (A y B) y la modalidad de transferencia (FCE) pasan a ser opcionales: antes se preguntaban siempre, aunque casi siempre quedaban en 21% y SCA. Las opciones avanzadas ya no son un menú que se recorre de a una.

</details>

## [1.5.0] - 2026-10-04 · PDF con QR

El PDF del comprobante con el QR de ARCA, para mandarle al cliente, con un plugin que se descarga solo si lo usás. No se rompe ningún comando, flag ni JSON existente: todo lo nuevo es opcional, y el JSON suma la clave `pdf` solo cuando se intenta generar el PDF.

#### PDF con el QR de ARCA

`--exportar-pdf` lo genera después de emitir, o la clave `pdf` decide si se pregunta, se genera siempre o nunca.

```sh
arcli fc -m 15000 --cs --cfinal --ir-cf --exportar-pdf
```

#### El plugin se descarga si lo usás

El PDF lo genera `@arcasdk/pdf`, que no viene con ARCLI porque pesa unos 160 MB. En una terminal, ARCLI lo ofrece la primera vez.

```sh
arcli pdf instalar
```

#### Datos del emisor en el PDF

Razón social, domicilio, inicio de actividades, IIBB y logo se configuran una vez, y el asistente pide los que falten.

---

### ✨ Agregado

- **PDF:** el PDF del comprobante con el QR de ARCA, con `--exportar-pdf` o la clave `pdf` (#22).
- **PDF:** `arcli pdf` instala, revisa o desinstala el plugin, que se descarga solo si querés PDFs (#22).
- **Config:** `config revisar` avisa si `pdf` es `siempre` y faltan datos del emisor (#22).

<details><summary>Detalle</summary>

**PDF del comprobante con el QR de ARCA**, para mandarle al cliente. Ver [PDF de comprobantes](docs/pdf.md). `--exportar-pdf` (alias `--pdf`) lo genera después de emitir y `--sin-pdf` no. Sin flag decide la config `pdf`: `preguntar` (por defecto), `siempre` o `nunca`. Con `preguntar`, sin terminal o con `--json` no se genera. Datos que solo van en el PDF, porque ARCA no los guarda: `--descripcion`, `--receptor-nombre` y `--receptor-domicilio`, y en el JSON de `--cargar`, `pdf`, `descripcion`, `receptorNombre` y `receptorDomicilio`. Claves de config nuevas: `pdf`, `pdfCarpeta` (por defecto `~/arcli/comprobantes`), `pdfNavegador` y los datos del emisor: `emisor.razonSocial`, `emisor.domicilio`, `emisor.inicioActividades`, `emisor.iibb`, `emisor.condicionIva` y `emisor.logo`. El archivo se llama `factura-c_0003-00000125.pdf`. Los de testing van a la subcarpeta `testing/` con un pie que dice que no tienen validez fiscal. En JSON, cada resultado suma la clave `pdf` (`{ ruta }` o `{ error }`) **solo si se intentó generar**. Un error del PDF no cambia el código de salida, porque el comprobante ya está emitido. El modo interactivo pregunta si generar el PDF después de emitir, y pide los datos del emisor que falten (ofrece guardarlos).

**`arcli pdf`** (`estado`, `instalar`, `desinstalar`): el PDF lo genera [`@arcasdk/pdf`](https://www.afipts.com/packages/pdf), que **no viene con ARCLI** porque pesa unos 160 MB (más un navegador de unos 200 MB si no hay Chrome, Chromium o Edge instalado). Se descarga recién cuando alguien quiere PDFs: en una terminal, ARCLI lo ofrece la primera vez; sin terminal nunca se descarga solo.

`config revisar` avisa si `pdf` es `siempre` y faltan datos del emisor.

</details>

## [1.4.0] - 2026-10-02 · Ver lo emitido

`arcli ultimos` y `arcli consultar` para ver lo emitido, facturas con varias alícuotas de IVA y un modo interactivo más completo. Los lotes ahora se validan enteros antes de emitir.

#### Ver lo emitido

`arcli ultimos` lista los últimos comprobantes y `arcli consultar` muestra uno, con CAE, vencimiento, importes y receptor. Antes solo se podía desde el asistente.

```sh
arcli ultimos fb
```

#### Varias alícuotas por comprobante

Repetí `--alicuota TASA:MONTO` con el monto IVA incluido de cada una: el total se calcula solo.

```sh
arcli fb --cs --cfinal --ir-cf --alicuota general:1210 --alicuota reducida:552.50
```

#### Volver en el asistente

"← Volver" en las opciones o `<` en los textos, y opciones avanzadas antes de la vista previa.

> [!WARNING]
> **Puede afectar scripts**
>
> - En un lote (`--cargar` con un array), si un comprobante es inválido no se emite ninguno: `BATCH_VALIDATION_ERROR` los lista a todos con su índice.
>
> No se rompe ningún comando, flag ni JSON existente: `--alicuota` con un solo número funciona igual que antes.

---

### ✨ Agregado

- **Consultas:** `arcli ultimos <tipo>` lista los últimos comprobantes emitidos en ARCA, con `--json` y `--pv` (#17).
- **Consultas:** `arcli consultar <tipo> <numero>` muestra el detalle de un comprobante emitido (#17).
- **Facturas:** varias alícuotas por comprobante, repitiendo `--alicuota TASA:MONTO` (#19).
- **Facturas:** alias de alícuotas: `general` (21), `reducida` (10.5), `incrementada` (27) y `cero` (0) (#19).
- **Asistente:** volver al paso anterior con "← Volver" en las opciones o `<` en los textos (#20).
- **Asistente:** opciones avanzadas antes de la vista previa: moneda extranjera, exento y no gravado, período del servicio y vencimiento (#20).
- **Asistente:** las notas comunes se pueden asociar a un período en lugar de a una factura (#20).

<details><summary>Detalle</summary>

`arcli ultimos <tipo>`: lista los últimos comprobantes emitidos en ARCA (`--cantidad` de 1 a 50, por defecto 10).

`arcli consultar <tipo> <numero>`: muestra el detalle de un comprobante emitido, con CAE, vencimiento, importes y receptor.

Los dos tienen `--json` y `--pv`. Antes esto solo se podía ver desde el modo interactivo.

**Varias alícuotas por comprobante.** Repetí `--alicuota TASA:MONTO` con el monto IVA incluido de cada una, por ejemplo `--alicuota general:1210 --alicuota reducida:552.50`. El total se calcula solo y se envía una entrada de IVA por alícuota. En JSON: `alicuotas: [{tasa, monto}]`.

**Alias de alícuotas.** `general` (21), `reducida` (10.5), `incrementada` (27) y `cero` (0). Se aceptan igual que el número en `--alicuota`, `alicuotaIva` y `config alicuota`.

</details>

### 🔧 Cambiado

- **Facturas:** los lotes se validan enteros antes de emitir el primero, y un corte muestra lo ya procesado (#18).

<details><summary>Detalle</summary>

**Lotes (`--cargar` con un array).** Se validan **todos** los comprobantes antes de emitir el primero. Si alguno es inválido, no se emite ninguno y el error `BATCH_VALIDATION_ERROR` los lista a todos con su índice. Antes, las reglas de negocio se validaban mientras se emitía: si el #3 era inválido, el #1 y el #2 ya estaban emitidos y sus resultados no se mostraban. Si la emisión se corta a mitad (red, ARCA), se muestran los comprobantes ya procesados y después el error `BATCH_EMISSION_ERROR`, con el ítem que falló y los que quedaron sin procesar.

</details>

### 🐛 Corregido

- **Asistente:** el comando equivalente incluye la moneda extranjera (`--moneda`, `--cm`, `--misma-moneda`) (#20).
- **Salida:** el `--json` redirigido ya no trae códigos de color (#15).
- **Asistente:** el logo tiene el mismo espacio abajo que arriba (#14).

<details><summary>Detalle</summary>

El comando equivalente del modo interactivo no incluía la moneda extranjera (`--moneda`, `--cm`, `--misma-moneda`).

**La salida `--json` traía códigos de color ANSI cuando se redirigía** (`arcli ... --json | jq` fallaba con `parse error`). Ahora solo hay colores si la salida es una terminal real. `FORCE_COLOR=1` los fuerza y `NO_COLOR` los apaga.

En el modo interactivo, el logo ahora tiene 3 líneas en blanco abajo, igual que arriba. Antes la barra de estado quedaba pegada.

</details>

## [1.3.0] - 2026-10-02 · Modo interactivo

El modo interactivo, para quien factura de vez en cuando, y una salida de terminal renovada: bordes según el tipo de panel, paneles que se ajustan a ventanas angostas y arreglos de color.

#### Modo interactivo

`arcli` sin argumentos abre un asistente paso a paso: facturas A, B y C, notas eligiendo la factura de una lista, vista previa y el comando equivalente.

```sh
arcli
```

#### Bordes según el tipo de panel

Comprobantes, errores, avisos, configuración y JSON tienen cada uno su borde, para reconocerlos antes de leerlos.

#### Paneles para terminales angostas

Los paneles se ajustan al ancho de la ventana en lugar de romperse.

> [!WARNING]
> **Puede afectar scripts**
>
> - `arcli` sin argumentos, en una terminal interactiva, abre el asistente en lugar de la ayuda. Sin terminal (pipes, CI, agentes) o con `--json` sigue mostrando la ayuda.
>
> No se rompe ningún comando, flag ni JSON existente.

---

### ✨ Agregado

- **Asistente:** `arcli` sin argumentos en una terminal abre un asistente paso a paso, también con `arcli interactivo` (#11).
- **Salida:** `ARCLI_ASCII=1` dibuja los paneles con ASCII puro (#12).

<details><summary>Detalle</summary>

**Modo interactivo.** `arcli` sin argumentos en una terminal interactiva abre un asistente paso a paso (también `arcli interactivo`): Emitir facturas A, B o C, comunes o FCE. Notas de crédito y débito eligiendo la factura de una lista de las últimas emitidas, consultadas a ARCA. Ver los últimos comprobantes y revisar la configuración. Antes de emitir muestra la vista previa y el comando equivalente. En producción pide una segunda confirmación. Usa las mismas validaciones y la misma emisión que los comandos con flags. Ver [Modo interactivo](docs/modo-interactivo.md).

`ARCLI_ASCII=1` dibuja los paneles con ASCII puro, para terminales que no muestran caracteres de caja.

</details>

### 🔧 Cambiado

- **Asistente:** `arcli` sin argumentos abre el asistente en lugar de la ayuda, solo en una terminal interactiva (#11).
- **Salida:** cada tipo de panel tiene su borde, para reconocerlo antes de leerlo (#12).
- **Salida:** etiquetas, pies y el logo usan el color por defecto de la terminal en lugar de blanco fijo (#12).
- **Salida:** los títulos de los paneles de JSON, respuesta bruta y eventos pasan a gris (#12).
- **Errores:** **Detalles** sale en cian y **Sugerencia** en amarillo, como dice la paleta (#12).

<details><summary>Detalle</summary>

`arcli` sin argumentos en una terminal interactiva abre el asistente en lugar de la ayuda. Sin terminal (pipes, CI, agentes) o con `--json` sigue mostrando la ayuda. `arcli ayuda` y `arcli --ayuda` no cambian.

**Bordes según el tipo de panel**, para reconocerlo antes de leerlo: Comprobantes: la línea antes del estado ahora es de puntos y llega al borde (`├┄┄┤`). Errores del CLI y de ARCA: `╭─╮`, con una franja gruesa `┃` a la izquierda. Observaciones y avisos del régimen FCE: la misma forma, con la franja a trazos `╏`. Sugerencias: franja fina `┆`. Configuración y régimen FCE: ficha `┌─┐` con el título a la izquierda. Revisión de configuración: `╓─╖` con el veredicto en el pie (`╟──╢`). Últimos comprobantes (modo interactivo): solo reglas `══` arriba y abajo, sin costados. Avisos simples ("No se emitió nada"): solo las esquinas `┌ ┐ └ ┘`. Banner de TESTING: `┌╌┐`. Aviso de nueva versión: `╭─╮`. JSON y respuestas crudas: `┌┈┐`. Encabezado del modo interactivo: una barra de estado de una línea (`━━ MODO INTERACTIVO ━━ testing · PV 3 ━━`). Títulos de `arcli ejemplos`: una línea de sección (`── FACTURA C ──`) en lugar de una caja. "Esto equivale a:" del modo interactivo: solo `▎` a la izquierda, sin borde derecho, para que el comando se copie limpio. `arcli storybook bordes` muestra cada estilo con el panel donde se usa.

Las etiquetas de las tablas, los pies de los paneles y el "CLI" del logo usan el color por defecto de la terminal en lugar de blanco fijo, que casi no se leía en terminales con fondo claro.

Los títulos de los paneles de JSON, respuesta bruta y eventos pasan de celeste a gris, para que no compitan con los paneles informativos.

Los errores muestran **Detalles** en cian y **Sugerencia** en amarillo, como dice la paleta. Antes estaban al revés. El panel "Sugerencias" de la respuesta también pasa a amarillo.

</details>

### 🐛 Corregido

- **Salida:** los títulos de los paneles respetan su color: verde, amarillo o rojo según el resultado (#12).
- **Salida:** el texto atenuado ya no apaga lo que se imprime después (#12).
- **Salida:** en terminales angostas los paneles se ajustan al ancho de la ventana (#12).
- **Docs:** el README pide Node.js 22.22.1, el mínimo real (#11).

<details><summary>Detalle</summary>

Los títulos de los paneles ignoraban el color pedido desde la primera versión. Ahora el comprobante sale verde si fue aprobado, amarillo si quedó observado y rojo si fue rechazado; los errores, en rojo.

El texto atenuado dejaba el atenuado prendido y apagaba lo que se imprimía después: el comando del "Esto equivale a:" y el comienzo del panel siguiente hasta el título.

En terminales angostas los paneles medían al menos 68 columnas y se rompían. Ahora se ajustan al ancho de la ventana: las filas etiqueta/valor parten el valor debajo de su columna y, si no hay lugar, apilan etiqueta y valor. El logo se reemplaza por el nombre si no entra.

El README decía que alcanzaba con Node.js 20. El mínimo es Node.js 22.22.1, como pide `engines`.

</details>

## [1.2.0] - 2026-10-02 · FCE completa

La Factura de Crédito Electrónica completa, alícuotas de IVA, importes exentos y no gravados y período asociado en las notas. Además, lo que ARCLI envía a ARCA se revisó contra el manual de WSFEv1 y se corrigieron los casos que ARCA rechazaba.

#### FCE completa

Facturas con CBU, alias y transferencia, notas con anulación y fecha del asociado, y `arcli fce-obligado` para saber si un cliente está obligado a recibir FCE.

```sh
arcli fce-obligado 30546689979
```

#### Alícuotas, exento y no gravado

`--alicuota` para A y B (con default en la config), y `--exento` y `--nogravado` para repartir el total.

#### Período asociado en las notas

`--periodo-desde` y `--periodo-hasta` asocian una nota común a un período en lugar de a una factura.

> [!WARNING]
> **Puede afectar scripts**
>
> - **Moneda extranjera sin cotización:** `--moneda USD` sin `--cotizacion-moneda` da error. Antes se enviaba cotización `1`. En pesos, una cotización distinta de `1` también da error.
> - **IVA receptor según la letra:** `fa` con `--ir-cf`, o `fb` con `--ir-ri`, da error y sugiere la letra correcta. Se usa la tabla de `FEParamGetCondicionIvaReceptor`.
> - **Consumidor final desde $10.000.000:** `--consumidor-final` da error desde ese monto (RG 5700/2025). Hay que identificar al receptor con `--dni`, `--cuit` o `--cuil`.
> - **Fecha del comprobante:** `--fecha` fuera de la ventana de ARCA da error. La ventana es ±5 días en productos, ±10 en servicios y de −5 a +1 en FCE. En productos y FCE, una fecha futura tiene que caer en el mes actual.
> - **FCE:** las facturas FCE sin CBU, y las NC/ND FCE sin `--afecha`, dan error.
> - **Flags de FCE fuera de FCE:** `--cbu`, `--alias`, `--transferencia` y `--anulacion` dan error en comprobantes que no son FCE.
> - **Salida JSON:** la salida de facturación suma el campo `avisos` (siempre presente, vacío si no hay avisos).
>
> Ninguno de estos cambios quita flags. Todos convierten en un error local, con el motivo en castellano, algo que antes llegaba a ARCA y ARCA rechazaba.

---

### ✨ Agregado

- **FCE:** soporte completo: CBU, alias y transferencia en las facturas, y anulación y fecha del asociado en las notas (#4).
- **Consultas:** `arcli fce-obligado <cuit>` consulta si un receptor está obligado a recibir FCE y desde qué monto (#6).
- **Config:** la clave `verificarFce` avisa en cada factura con CUIT si corresponde FCE, sin frenar la emisión (#6).
- **Facturas:** `--alicuota` para A y B y la clave `alicuota` para fijarla por defecto (#5).
- **Facturas:** `--exento` y `--nogravado` reparten el total en importe exento y no gravado (#5).
- **Notas:** `--periodo-desde` y `--periodo-hasta` asocian una nota común a un período, como alternativa a `--ac` (#8).
- **Facturas:** `--misma-moneda` para cobrar en la moneda extranjera, con la cotización oficial de ARCA (#1).
- **Fechas:** `--vencimiento` (o `--vto`) separa el vencimiento del pago del período del servicio (#3).
- **Notas:** `--afecha` también está disponible, opcional, en las notas comunes (#4).
- **Salida:** la vista previa muestra CBU, transferencia, anulación, asociado, alícuota, no gravado y avisos.
- **Errores:** los errores de valores no soportados listan los valores válidos.
- **Docs:** las reglas de validación suman moneda, IVA receptor, vencimiento, fecha del comprobante y FCE.
- **Docs:** la guía de certificados explica cómo autorizar `wsfecred` (#6).

<details><summary>Detalle</summary>

Soporte completo de FCE: Facturas: `--cbu`, `--alias` y `--transferencia sca|adc`. NC/ND: `--anulacion` y `--afecha`. El CUIT del asociado se toma del emisor. Claves de config `cbu` y `aliasCbu`, aplicadas solo a facturas FCE. Claves JSON `cbu`, `aliasCbu`, `transferencia`, `anulacion` y `comprobanteAsociado.fecha`.

Comando `arcli fce-obligado <cuit>`: consulta en ARCA (`wsfecred`) si un receptor está obligado a recibir FCE y desde qué monto.

Clave de config `verificarFce` (opt-in): hace esa consulta en cada factura con CUIT y avisa si corresponde FCE en lugar de factura común, o al revés. No frena la emisión.

`--alicuota 0|2.5|5|10.5|21|27` para letras A y B, y la clave de config `alicuota` para fijarla por defecto. Clave JSON: `alicuotaIva`.

`--exento <monto>` y `--nogravado <monto>`: reparten el total en importe exento (`ImpOpEx`) y no gravado (`ImpTotConc`). Claves JSON: `importeExento` e `importeNoGravado`.

`--periodo-desde` / `--periodo-hasta` (alias `--pd` / `--ph`): período asociado en notas comunes, como alternativa a `--ac`. Clave JSON: `periodoAsociado`.

`--misma-moneda` para comprobantes en moneda extranjera que se cobran en esa moneda. Consulta la cotización oficial a ARCA y envía `CanMisMonExt = S`. Clave JSON: `mismaMoneda`.

`--vencimiento <fecha>` (alias `--vto`) para separar el vencimiento de pago del período de servicio. Clave JSON: `vencimientoPago`.

`--afecha` también disponible, opcional, en notas comunes.

La vista previa muestra CBU, transferencia, anulación, fecha y período asociado, alícuota, importe no gravado y avisos.

Los errores de valores no soportados listan los valores válidos.

Secciones nuevas en reglas de validación: moneda y cotización, IVA receptor por letra, vencimiento de pago, fecha del comprobante, crédito electrónico (FCE) y régimen FCE del receptor.

La guía de certificados explica cómo autorizar `wsfecred`.

</details>

### 🔧 Cambiado

- **Docs:** la referencia del CLI, entrada y salida, configuración, troubleshooting, glosario y `llms.txt` al día.

<details><summary>Detalle</summary>

Se actualizaron la referencia del CLI, entrada y salida, configuración, patrones de uso (con uno de FCE), troubleshooting, glosario, checklist de testing y `llms.txt`.

</details>

### 🐛 Corregido

- **Facturas:** el dólar se envía como `DOL`, el código de ARCA, y no como `USD` (#1).
- **Facturas:** A y B siempre discriminan IVA, también la A a un receptor que no es responsable inscripto (#2).
- **FCE:** `FchVtoPago` va en las facturas FCE de productos y no en las notas FCE (#3).
- **Fechas:** el vencimiento del pago nunca es anterior a la fecha del comprobante (#3).
- **Fechas:** la fecha por defecto del comprobante es la de Argentina, no la de UTC (#3).
- **Docs:** `arcli ejemplos` usa fechas relativas a hoy e incluye los datos de FCE.
- **Facturas:** con `cotizacion` en la config, las facturas en pesos ya no toman esa cotización (#1).
- **Facturas:** `@arcasdk/core` 2.0.2 valida el total sumando exento y no gravado.

<details><summary>Detalle</summary>

Dólar se enviaba como `USD`; ahora se envía `DOL`, el código de ARCA.

La factura A a un receptor que no era responsable inscripto salía sin IVA discriminado. Ahora A y B siempre discriminan IVA.

Las facturas FCE de productos no enviaban `FchVtoPago`, y las NC/ND FCE lo enviaban cuando no correspondía.

Un servicio facturado después de su fin enviaba un vencimiento de pago anterior a la fecha del comprobante. Ahora nunca es anterior.

La fecha por defecto del comprobante se calculaba en UTC: después de las 21 hs en Argentina salía con el día siguiente.

`arcli ejemplos` usaba fechas fijas que quedaban fuera de la ventana de ARCA. Ahora son relativas a hoy e incluyen los datos de FCE.

Con `config cotizacion` configurada, las facturas en pesos ya no toman esa cotización.

`@arcasdk/core` 2.0.0 → 2.0.2. La 2.0.0 validaba el total sin sumar exento ni no gravado ([ralcorta/arcasdk#190](https://github.com/ralcorta/arcasdk/issues/190)). La 2.0.2 además expone `wsfecred` y tipa `PeriodoAsoc`.

</details>

## [1.1.0] - 2026-08-24 · Primera versión

Primera versión publicada en npm: facturas, notas de crédito y notas de débito A, B y C desde la terminal, con vista previa antes de emitir y `testing` como entorno por defecto.

#### Facturas y notas A, B y C

Comunes y de crédito electrónica, por atajo (`fc`, `nca`…) o por familia y letra (`factura c`…).

```sh
arcli fc --monto 15000 --cs --ir-cf --cfinal
```

#### Para scripts y agentes de IA

`--cargar` lee comprobantes de un JSON, también por lotes, `--json` da una salida para scripts y `llms.txt` resume el CLI para un agente con terminal.

---

### ✨ Agregado

- **Facturas:** facturas, notas de crédito y notas de débito A, B y C, comunes y de crédito electrónica, por atajo o por familia y letra.
- **Config:** configuración persistente con `arcli config`, revisión del entorno con `arcli config revisar` y `testing` por defecto.
- **Facturas:** vista previa antes de emitir, carga desde JSON con `--cargar`, también por lotes, y salida humana, `--json` o `--bruto`.
- **Docs:** `arcli ejemplos` con comandos listos para copiar.
- **Docs:** `llms.txt`, una referencia condensada para que un agente de IA con acceso a terminal ejecute el CLI.

### 🔒 Seguridad

- **Instalación:** se publica en npm con Trusted Publishers (OIDC).

[Sin publicar]: https://github.com/LcsGrz/arcli/compare/v2.6.0...HEAD
[2.6.0]: https://github.com/LcsGrz/arcli/compare/v2.5.2...v2.6.0
[2.5.2]: https://github.com/LcsGrz/arcli/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/LcsGrz/arcli/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/LcsGrz/arcli/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/LcsGrz/arcli/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/LcsGrz/arcli/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/LcsGrz/arcli/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/LcsGrz/arcli/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/LcsGrz/arcli/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/LcsGrz/arcli/compare/v1.8.0...v2.0.0
[1.8.0]: https://github.com/LcsGrz/arcli/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/LcsGrz/arcli/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/LcsGrz/arcli/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/LcsGrz/arcli/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/LcsGrz/arcli/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/LcsGrz/arcli/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/LcsGrz/arcli/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/LcsGrz/arcli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/LcsGrz/arcli/releases/tag/v1.1.0
