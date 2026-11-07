[← Volver al README](README.md)

# Changelog

Todos los cambios relevantes de ARCLI se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/). Como el contrato del CLI es público (comandos, flags, claves de config y JSON), cada entrada aclara qué cambia para quien ya lo usa.

## [Sin publicar]

### Cambiado

- **Cotización oficial por defecto en moneda extranjera:** `arcli fc --moneda USD` sin `--cm` ni `--misma-moneda` usa la cotización oficial de ARCA y lo avisa en "Avisos" (y en `avisos` del JSON). Antes daba error "Falta la cotización". `--cm` sigue pisándola y `--cm 1` sigue siendo error.
- **Un solo formato para los importes:** la salida en terminal muestra los pesos como `$ 1.500` o `$ 1.500,50`, con el espacio que usa el PDF y sin `,00` si no hay centavos. Antes convivían `1.500$`, `$1.500` y `$ 1.500,00`. En moneda extranjera todos los comprobantes muestran el código ISO en lugar del `$` (`1.500,50 USD`), y el error de `fe` cuando los ítems no suman `--monto` deja de usar punto decimal (`1.500,50` en lugar de `1500.50`). Los textos de errores y avisos toman el mismo formato, también en el `--json`. El PDF no cambia y los importes del `--json` siguen siendo números.
- **Los datos se muestran igual en todos lados:** CUIT con guiones (`20-33333333-4`) y DNI con puntos (`12.345.678`) en los paneles; comprobantes como `00001-00001234`, también el asociado y la factura `E`; cotización con dos decimales o más (`1.250,50`, `1.250,123456`) y porcentajes con coma (`10,5%`); fechas `dd/mm/aaaa`; `N/D` para lo que ARCA no informa y `sin configurar` para la config. El vencimiento del certificado se calcula siempre en hora de Argentina. El `--json` no cambia, salvo el texto de los avisos que nombran la cotización.
- **Textos más parejos:** tildes y voseo en toda la salida (`¿A quién le facturás?`, `22 dígitos`, `Usá`), comandos siempre entre backticks y el mismo texto en los errores que se repiten. El dato faltante sale como `Falta el dato: monto.`. Fechas inválidas dicen qué formatos sirven. "Monto" al pedir y en errores, "importe" al mostrar; "comprobante" donde también puede ser un recibo. Mientras se emite, el progreso dice `Emitiendo la factura B en ARCA...`. En la ayuda, `--previsualizar` ya no dice que muestra algo "antes de emitir" (no emite), los alias nombran su flag y los ejemplos dicen `COMPLETA` en lugar de `FULL`. El modo interactivo de config muestra etiquetas (`Responsable inscripto`, `21%`) en lugar de valores crudos; lo que se guarda no cambia. Son textos: pueden cambiar `error`, `sugerencia` y `avisos` en el `--json`, no sus claves ni los códigos de error.
- **La pregunta antes de emitir dice el entorno:** con flags ahora es `¿Emitimos la factura B en PRODUCCIÓN?`, igual que en el modo interactivo, y si respondés que no avisa `No se emitió nada.`. La doble confirmación en producción sigue siendo solo del modo interactivo.
- **La letra del comprobante siempre va en mayúscula y las frases concuerdan:** `La factura B no admite…`, `El recibo C no lleva…`, `Últimas facturas B`, `No hay recibos C emitidos`. Antes salían `La factura b`, `La recibo c` y `Últimas Factura B`. Son textos: también cambian dentro de `error` en el `--json`, pero la clave `comprobante` y los códigos de error no. Los atajos siguen en minúscula (`fb`, `rc`).

- **Vista previa más corta:** los importes en cero que nadie cargó (IVA, tributos, exento, no gravado) no se muestran, y la cotización solo en moneda extranjera. A consumidor final sin identificar, una sola fila `Receptor` en lugar de tres. Lo que tiene valor se sigue mostrando, venga de una flag, de la config o de un default. `consultar` tampoco muestra `Importe IVA` en cero. El `--json` y `--bruto` siguen trayendo todo.
- **Rechazos de ARCA legibles:** los paneles de errores y eventos muestran una lista (`1. 502: mensaje`) en lugar de JSON crudo. El panel de resultado ya no lista `Observaciones`, `Eventos` ni `Errores` en cero.
- **Errores de uso en panel:** un comando u opción desconocida se muestra en el mismo panel que el resto de los errores, con la sugerencia de ayuda. Comandos, opciones y argumentos van entre backticks (`` opción desconocida `--montoo` ``), también en `error` con `--json`. El panel ya no repite la palabra `Error`. El mensaje de CUIT, certificado o clave faltante no repite `arcli config revisar`, que queda en la sugerencia (cambia el texto de `error` y `detalle` en el `--json`, no las claves ni los códigos).
- **Terminales angostas:** si una fila de una tabla no entra, todas las de esa columna ponen la etiqueta arriba y el valor debajo, las etiquetas ya no se cortan a mitad de palabra y la barra de estado pasa a dos líneas en lugar de romperse. En listas, una línea partida sigue alineada al texto.
- **Opciones entre backticks en todos los mensajes:** errores, avisos, sugerencias y paneles citan las opciones como `` `--monto` `` o `` `--pv <numero>` ``, igual que los comandos (`` `arcli padron` `` en la lista de servicios del certificado, el paso para importarlo y el pie de `parametros`). Son textos: cambian `error`, `sugerencias` y `avisos` en el `--json`, no sus claves ni los códigos de error. La ayuda (`--ayuda`) y los ejemplos para copiar no cambian.
- **Fichas con los valores en la misma columna:** padrón, plugin de PDF, régimen FCE y certificados ponen la columna de etiquetas en el mismo lugar (antes cada una usaba un ancho distinto), y en el pedido y la importación de un certificado todas las secciones quedan alineadas con la lista de servicios. Los comprobantes y la config no cambian. El `--json` tampoco.
- **`config revisar` no repite el CUIT:** si falta, la terminal muestra una sola fila en rojo, en Cuenta, en lugar de un aviso y un error. El `--json` sigue trayendo los dos chequeos.
- **`arcli ejemplos`:** el logo sale alineado y con la versión.
- **Selección múltiple:** el cursor deja un espacio antes del círculo (`❯ ◯`), como en las demás listas del modo interactivo. "Volver" es un botón común: no lleva círculo, ni espacio ni `a` lo marcan, y Enter sobre él vuelve al paso anterior.

### Deprecado

- **Claves del JSON que se sacan en la 3.0.0:** siguen funcionando, y la respuesta suma `deprecado` con qué usar. `Code`/`Msg` (A, B y C) y `code`/`message` (E) en `errores` y `eventos` pasan a `codigo`/`mensaje`, que ya están. `detalles.errors` pasa a `detalles.errores`. En `estado`, `puntoVenta` será un número: el detalle ya está en `puntoVentaDetalle`. En `padron` y `fce-obligado`, `cuit` será texto. En `--cargar` de `fe`, `monto` pasa a `montoTotal`, que ya se acepta; mandar las dos es un error. La tabla está en [Entrada y salida](docs/input-output.md#estabilidad-del-contrato).
- **La clave `cotizacion` de la config se saca en la 3.0.0:** una cotización guardada queda vieja en días y factura con un tipo de cambio viejo sin que te enteres. Mientras tanto sigue andando: si está guardada (distinta de `1`), cada factura en moneda extranjera sin `--cm` la usa y avisa que está deprecada, y `config establecer cotizacion` avisa lo mismo. Para dejar de usarla, `arcli config eliminar cotizacion`. `config --json` sigue trayendo `cotizacion`.

### Agregado

- **Más datos en el JSON de las emisiones:** `entorno` y `puntoVenta` en todos los comprobantes, y `numero` en la factura E, también en la vista previa.
- **Sugerencias para los rechazos de ARCA más comunes:** cuando ARCA rechaza o deja una observación con un código conocido (`10016`, `10152`, `10243`, `10174`, `10119`, `10038`, `10017`/`10217`, además del punto de venta `10005`/`11002`), `sugerencias` dice qué pasó, qué hacer y el link a la guía. Antes solo se reconocían unos pocos mensajes, y los códigos que venían en las observaciones no se miraban. La tabla completa está en [Troubleshooting](docs/troubleshooting.md#rechazos-de-arca-por-código). La forma del JSON no cambia.
- **Comando para actualizar según el gestor:** el aviso de versión nueva, la ayuda y "Cerrar para actualizar" del modo interactivo muestran el comando del gestor con que instalaste arcli (`npm install -g`, `pnpm add -g`, `yarn global add` o `bun add -g`), deducido de la carpeta donde está instalado. Si no lo reconoce, sigue siendo el de npm. El plugin de PDF se sigue instalando con npm.
- **`config revisar` revisa el plugin de PDF:** un chequeo "Plugin de PDF" en la sección PDF dice si está instalado, si es la versión que usa arcli y si encontró un navegador, como `arcli pdf estado`. Con `pdf=siempre` avisa si falta; con `preguntar` (por defecto) solo lo revisa si está instalado, así `ok` no pasa a `false` para quien no genera PDFs; con `nunca` no lo revisa.
- **Todas las monedas de ARCA con su código ISO:** `--moneda`, `codigoMoneda` del JSON y la clave `moneda` de la config aceptan el código ISO o el de ARCA, indistinto: `ARS` o `PES`, `USD` o `DOL`, `UYU` o `011`, `CLP` o `033`, `GBP` o `021`, y así con todas las de la tabla de ARCA que tienen ISO. Antes solo se traducían `ARS`, `USD`, `EUR` y `BRL`, y otro ISO se mandaba tal cual y ARCA lo rechazaba. La vista previa y `consultar` muestran el nombre con el ISO (`Pesos uruguayos (UYU)`), el PDF de la `E` muestra el ISO de cualquier moneda y el autocompletado de `--moneda` ofrece todos los ISO. Un código que no está en la tabla se sigue mandando tal cual.

### Corregido

- **Modo interactivo:** la barra con la razón social y las respuestas ya respondidas pasan por el mismo filtro que el resto de la salida, así un dato externo no puede meter secuencias de terminal.
- **Colores de los errores:** dependían de stdout aunque los errores se escriben en stderr. `arcli ... 2> errores.log` guardaba códigos de color en el archivo, y con `arcli ... | jq` el error salía sin color en la terminal. Ahora dependen de stderr. También vale para los avisos de nueva versión y de certificado.
- **`ARCLI_ASCII=1` cubre toda la salida:** también cambia los símbolos (`✓`, `•`, `·`, `…`, `→`) y lo que dibuja el modo interactivo (`✔`, `❯`, `↑↓`, `⏎`, `←`, `┈`, el spinner). Antes solo cambiaba los bordes. Las tildes y la `ñ` se mantienen.
- **Entorno con tilde:** los títulos de `parametros` y `ultimos` dicen `PRODUCCIÓN` en lugar de `PRODUCCION`, y `estado`, `config`, `config revisar` y los errores de comprobante o CUIT no encontrado dicen `producción`. El `--json` conserva `entorno: "produccion"`; solo cambia el texto de `error` y `detalle`.
- **`arcli config` muestra el CUIT con guiones:** `20-33333333-4`, igual que el resto de los comandos. `config --json` no cambia.
- **Textos:** tildes que faltaban en `sí`, `automático`, `Cuándo generar el PDF`, `puntos críticos` y `Estás utilizando el entorno de TESTING`. La ayuda de `--moneda` dice `etc.` en lugar de `…`.
- **`dh key too small` en producción:** en sistemas con OpenSSL en `SECLEVEL=2`, como Debian 13, las llamadas a WSFE y WSFEX de producción fallaban con ese error aunque el certificado, la clave y el punto de venta fueran correctos. Ahora arcli no ofrece DHE en producción, sin aflojar el resto de la seguridad de la conexión. Testing no cambia. Ya no hace falta el wrapper con `--tls-cipher-list`.
- **PDF de la factura E en el modo interactivo:** si faltan datos del emisor, los pide y ofrece guardarlos, como en el resto de los comprobantes. Antes el PDF no se generaba.
- **Emisión incierta en la factura E:** si falla la llamada que emite una `fe` (red, timeout), sale como `EMISSION_UNCERTAIN`, igual que A, B y C, en lugar de un error inesperado que invitaba a reintentar. `detalles` trae `numero` e `idSolicitud`, y la sugerencia es reintentar con esos mismos valores: ARCA no autoriza dos comprobantes con el mismo número, así que no se duplica.
- **Ayuda de `arcli fe`:** `--numero` decía "por defecto el siguiente de ARCA", pero es obligatorio. Ahora la ayuda lo dice.
- **Certificado vencido:** la sugerencia de `CERTIFICATE_EXPIRED` manda a renovarlo con `arcli certificado generar` e `importar`, en lugar de cargar las rutas a mano con `arcli config establecer`.
- **Textos:** tildes y voseo en mensajes que habían quedado sin corregir (fecha fuera de rango, instalación del plugin de PDF, emisión sin confirmar, `coe.alreadyAuthenticated`). Los códigos de error y la forma del JSON no cambian.

## [2.3.0] - 2026-11-04

Trae el Recibo C (`rc`), `arcli certificado generar` e `importar` para sacar el certificado de ARCA sin `openssl`, y la condición de venta en el PDF. Gracias a [Guillermo Britos](https://github.com/guillermobr) y a [Kevin Tea](https://github.com/kevintea), que trajeron el recibo y la condición de venta.

Un cambio puede afectar scripts: `--dia` está deprecado y ya no fija el período del servicio, solo el vencimiento. Sigue andando con un aviso. Ver "Cambiado".

### Agregado

- **`arcli certificado generar` e `importar`:** arman la clave y el CSR para ARCA sin `openssl` (también en Windows) y cargan el certificado que devuelve ARCA. `importar` deduce el entorno del certificado, valida CUIT, vencimiento y clave, lo guarda en `certificados/<CUIT>/` junto a la config y configura `cert.*`/`key.*`. Para renovar, la clave nueva queda pendiente hasta importar, así que se sigue facturando con el certificado actual. Las rutas configuradas a mano siguen andando. En el modo interactivo: Configuración → Certificados de ARCA, y la configuración guiada ofrece sacarlo si no tenés uno.
- **Recibo C (`rc`, `arcli recibo c`):** emite o previsualiza un Recibo C (tipo ARCA 15) con los mismos flags y validaciones que la Factura C. La familia `recibo` solo tiene la letra C: `arcli recibo a` da error y el autocompletado ofrece solo `c`. Las notas de crédito y débito C pueden asociarse a un Recibo C (`arcli ncc --ac rc ...`). En el modo interactivo tiene su propia opción, **Emitir recibo**, y se puede elegir como comprobante original de una nota. "Repetir una factura anterior" pasa a llamarse **Repetir un comprobante anterior** y deja elegir entre una factura y un recibo. El PDF lleva el título `RECIBO C`, `COD.15` y el QR de ARCA con el tipo 15, y se guarda como `recibo-c_<pv>-<numero>.pdf`. Gracias a [Guillermo Britos](https://github.com/guillermobr), que lo trajo en [#78](https://github.com/LcsGrz/arcli/pull/78).
- **Condición de venta en el PDF de A, B y C:** `--condicion-venta` (alias `--cv`), `condicionVenta` en el JSON de `--cargar` y la clave `condicionVenta` de la config como default. `--sin-condicion-venta` y `"condicionVenta": null` permiten omitir ese default para un comprobante. Acepta `contado`, `tarjeta-debito`, `tarjeta-credito`, `cuenta-corriente`, `cheque`, `transferencia`, `otros-medios-electronicos` y `otra`, que se imprimen con su nombre, o un texto libre que se imprime tal cual. El modo interactivo la pregunta con una lista y la de la config marcada; "Omitir" la suprime y "Otra" pide el texto. Es un dato exclusivo del PDF: WSFE no lo recibe. Gracias a [Kevin Tea](https://github.com/kevintea), que la trajo en [#74](https://github.com/LcsGrz/arcli/pull/74).

### Cambiado

- **Rutas clickeables:** en terminales que soportan links (VS Code, iTerm2, Windows Terminal, Kitty, WezTerm, Ghostty), las rutas de `arcli config`, `arcli pdf`, el PDF guardado y `arcli certificado` se abren con un clic. `FORCE_HYPERLINK=0` los apaga. `arcli config` muestra además la carpeta de certificados.
- **`arcli config revisar` más fácil de leer:** los chequeos van agrupados por sección (Cuenta, Al facturar, Certificados, Salida, PDF y Validaciones), con lo que falta en color, y los avisos de certificados sugieren `arcli certificado generar`. El JSON no cambia de forma.
- **`--consumidor-final` (`--cfinal`) implica IVA receptor consumidor final:** ya no hace falta sumar `--ir-cf`, y anda aunque la config tenga otro `ivaReceptor`, que antes daba error. Lo mismo `tipoDocumento: "consumidor-final"` en el JSON de `--cargar`. Un IVA explícito distinto (`--cfinal --ir-rm`) sigue siendo error.
- **`--dia` está deprecado y fija solo el vencimiento:** antes también ponía el período del servicio en ese día (`--dia 10` facturaba un servicio "del 10/11 al 10/11"). Ahora el período es el de `--servicio-desde`/`--servicio-hasta` o, sin ellos, la fecha del comprobante, como sin `--dia`. Se puede combinar con `--fecha` y `--servicio-hasta`, y da error junto con `--vencimiento`/`--vto`. Sigue andando con un aviso; usá `--vencimiento` o `--vto`. Lo mismo la clave `dia` del JSON de `--cargar`.

### Corregido

- **Fechas sin año en el cambio de año:** se tomaba siempre el año actual, así que el 5/1/2027 `--sd 1/12` era diciembre de 2027. Ahora se toma la fecha más cercana a hoy: diciembre de 2026, y el 28/12 `--vto 10/1` es enero que viene.
- **`--moneda EUR` y `BRL`** se mandaban tal cual y ARCA las rechazaba: ahora se traducen a sus códigos (`060` y `012`) en `fc`/`fb`/`fa`, `fe` y `parametros cotizacion`.
- **`--misma-moneda` con `--fecha` futura** llegaba a ARCA y fallaba con el error 10038: ahora pide que la fecha sea la de hoy, porque ARCA solo publica la cotización vigente.
- **Repetir una factura con montos chicos** podía deducir mal la alícuota de IVA (por ejemplo, 2,5% en vez de 21%).

### Seguridad

- **Publicación en npm más estricta:** el paquete se publica desde el tag de la release de GitHub (antes, desde lo último de `main`) y el release falla si el tag no coincide con la versión. Se arma en un job sin permiso para publicar, sin cache y sin scripts de dependencias, y antes de publicarlo se instala y se prueba que arranque.

## [2.2.1] - 2026-11-03

Corrige `arcli pdf instalar` en Windows y suma lo necesario para recibir contribuciones: plantillas de issue y de PR, código de conducta, Discussions para preguntas, y un CI que también corre en Windows, macOS y Node 26. No cambian comandos, flags, claves de config ni el `--json`.

### Corregido

- **`arcli pdf instalar` en Windows:** la descarga del navegador pasaba por `cmd.exe`, que corta las rutas con espacios (como `C:\Users\Nombre Apellido`), y fallaba. Ahora la shell se usa solo para correr `npm.cmd`.

### Documentación

- El README explica cómo instalar con pnpm y Yarn además de npm, cómo probarlo con `npx` y cómo actualizar, y suma las secciones "Ayuda y soporte" (preguntas en [Discussions](https://github.com/LcsGrz/arcli/discussions), bugs en issues) y "Estabilidad" (qué es contrato público y qué puede cambiar entre versiones).
- Plantillas de issue y de PR, y [código de conducta](CODE_OF_CONDUCT.md).
- El CI corre también en Windows, macOS y Node 26.

## [2.2.0] - 2026-11-02

Trae la factura de exportación `E` (`arcli fe`) sobre WSFEX: items, país de destino, incoterm y permisos de embarque, con credenciales propias para `wsfex`, PDF con el diseño de exportación y modo interactivo. Es todo agregado: los comandos y flags de A, B, C y FCE siguen igual. Gracias a [Manuel Aller](https://github.com/itManuel), que la trajo en [#67](https://github.com/LcsGrz/arcli/pull/67).

Además suma el autocompletado con Tab, el número del comprobante en el JSON, la validación del dígito verificador de todo CUIT y una ayuda más corta y en español, y corrige varios errores de la revisión del repo.

Dos cambios pueden afectar scripts: los mensajes ahora usan voseo y tildes (si comparás el texto de un error en lugar de `codigo`), y un `montoTotal` con más de 2 decimales en el JSON da error en lugar de redondearse. Ver "Cambiado" y "Corregido".

### Agregado

- **`arcli fe` y `arcli factura e`:** emiten o previsualizan la Factura de exportación `E` (tipo 19) con WSFEX. Obligatorios: `--monto`, `--cliente`, `--domicilio-cliente`, `--pais-destino` (código o nombre), `--numero` y la actividad. Opcionales: `--id-impositivo`, `--cuit-pais`, `--tipo-expo` (`1` bienes, `2` servicios, `4` otros), `--incoterm`, `--incoterms-desc`, `--idioma`, `--forma-pago`, `--permiso` con `--permiso-existente`, `--id-solicitud`, `--fecha-pago`, `--observaciones` y `--obs-comerciales`. No lleva concepto, IVA ni receptor con CUIT/CUIL/DNI. `fe` va en la tabla de atajos de `arcli --ayuda` y en `arcli ejemplos`, y Tab completa la letra `e` en `arcli factura`.
- **`--numero` obligatorio en la `E`:** WSFEX numera por punto de venta y tipo, pero `@arcasdk/core` todavía no permite consultar el último comprobante E. Pasá el siguiente al último que emitiste (`1` si es el primero).
- **Actividad de la `E`:** `--actividad` o la clave nueva `exportacion.actividad` (sección "Factura de exportación (E)" de `arcli config`), con un código de la tabla de actividades de WSFEX, que no es la del padrón. No hay default; un código que no está en la tabla es error de validación con los que empiezan igual.
- **Flags de otra letra en `arcli factura <letra>`:** como `factura` comparte el comando para A, B, C y E, los flags que no aplican a la letra elegida se saltean con un aviso en "Avisos" y en `avisos` del JSON (`factura a --incoterm`, `factura e --alicuota`). Los atajos (`fa`, `fe`…) siguen rechazándolos como opción desconocida.
- **`--item` con detalle real:** `codigo|descripcion|cantidad|precio|unidad`, repetible; el código y la unidad son opcionales y la unidad puede ser el código de ARCA o su nombre. La suma de los items tiene que dar `--monto` y se valida antes de autenticar en WSAA, porque WSFEX no lo controla.
- **`--cargar` para `E`:** un objeto, con claves propias (`cliente`, `domicilioCliente`, `paisDestino`, `monto`, `numero`, `actividad`, `items`, `tipoExpo`…). El lote no está soportado: un array es error de entrada.
- **`exportacion.cert.testing`, `exportacion.cert.produccion`, `exportacion.key.testing`, `exportacion.key.produccion`:** credenciales del servicio `wsfex`, para cuando el certificado general no está autorizado a exportación. Si no están las dos de un entorno, se usan `cert.*`/`key.*`; con la mitad del par configurada el comando corta antes de ir a ARCA. Se muestran en la sección **Certificados** de `arcli config` (también en el modo interactivo), se validan como PEM al guardarlas y `arcli config revisar` las revisa con el resto. Sin autorización a `wsfex`, el error es `WSFEX_SERVICE_NOT_AUTHORIZED`.
- **Defaults de la `E`:** sin flags, la exportación sale de servicios (`Tipo_expo` `2`), en dólares (`Moneda_Id` `DOL`), con la cotización de aduana que publica ARCA (si la del día todavía no salió, la última, con un aviso) y con forma de pago `Transferencia Internacional`. Las claves `moneda` y `cotizacion` de la config no aplican a exportación.
- **Salida JSON de exportación:** el mismo resumen que A, B y C (`atajo: "fe"`, `tipoArca: 19`, `comprobante: "Factura de exportación E"`) más un bloque `exportacion` con cliente, destino, domicilio, actividad, incoterm, items y permisos; `solicitud` es el `Cmp` de WSFEX, con los nombres de ARCA. Forma exacta en [entrada y salida](docs/input-output.md#factura-de-exportación-e).
- **PDF de exportación:** se guarda como `factura-e_<pv>-<numero>.pdf` con el diseño de exportación de `@arcasdk/pdf` y los mismos datos que la E de Comprobantes en línea: título `FACTURA DE EXPORTACIÓN`, items de WSFEX, país de destino, CUIT del país con su tipo de entidad, ID impositivo, divisa con su código ISO (`USD - Dólar Estadounidense`), forma y fecha de pago, incoterm y la leyenda `IVA EXENTO OPERACIÓN DE EXPORTACIÓN`, sin discriminar IVA.
- **Factura E en el modo interactivo:** se elige en el mismo selector que A, B y C y tiene su propio asistente (cliente, país, tipo, monto, moneda, incoterm en bienes, pago, actividad y número), con vista previa, comando equivalente y PDF. Ver [modo interactivo](docs/modo-interactivo.md#factura-de-exportación-e).
- **CUIT con dígito verificador y con o sin guiones en todos lados:** `arcli padron`, `arcli fce-obligado`, `--cuit`, `--cuil`, `--acuit`, `comprobanteAsociado.cuit` en el JSON, `config establecer cuit` y el modo interactivo aceptan `20-33333333-4` o `20333333334`, y rechazan un CUIT mal tipeado antes de llegar a ARCA. Antes `arcli padron 20-20179706-4` fallaba y nadie chequeaba el dígito verificador.
- **Error `ARCA_LAST_VOUCHER_ERROR`:** si ARCA rechaza el pedido del último número (por ejemplo, con un punto de venta no habilitado para web service), la facturación y `arcli ultimos` cortan ahí con el mensaje de ARCA y una sugerencia. No se emite nada.
- **Esc en las preguntas del CLI:** "¿Querés emitir … ahora?", que aparece sin `--emitir` en una terminal, ahora se cierra con Esc como un "no", igual que en el modo interactivo y en las preguntas del PDF.
- **`numero` en el JSON de facturación:** el número que le tocó al comprobante emitido (`null` en una previsualización), y `solicitud` lo trae en `CbteDesde`/`CbteHasta`. El panel de texto muestra `Número: 00003-00000125`. Antes el número solo se veía con `--bruto`.
- **Autocompletado con Tab** para bash, zsh y fish. Se instala con `arcli completado instalar`, que agrega una línea al archivo de inicio del shell (`~/.zshrc`, `~/.bashrc`…), y se saca con `arcli completado desinstalar`; también desde el modo interactivo, en Configuración → Autocompletado. Completa comandos y atajos, flags, valores (`--iva-receptor`, `--concepto`, `--alicuota`, `--moneda`, `--transferencia`, `--ac`), claves de config y sus valores, tablas de `parametros` y letras de las familias; donde va una ruta, archivos. No hay que reinstalarlo al actualizar arcli. Ver [Autocompletado](docs/cli-reference.md#autocompletado).

### Cambiado

- **Ayuda más corta y toda en español.** `arcli --ayuda` pasa de unas 145 líneas a 57: los 18 atajos van en una tabla familia × letra y `storybook` (herramienta de desarrollo) ya no aparece, aunque sigue funcionando. La ayuda de cada comprobante (`arcli fc --ayuda`) pasa de 177 a 79 líneas: muestra solo los flags que aplican a ese comprobante, menciona los alias en la opción principal (`punto de venta (alias: --pv)`) y ya no repite la tabla de parámetros. Los flags ocultos se siguen aceptando igual. "Usage", "Options", `[options]`, `<number>` y la descripción de `--version` ahora están en español.
- **Errores de uso en español:** opción o comando desconocido, valor faltante y argumentos de más (`opción desconocida '--montoo' (¿quisiste decir --monto?)`). También en el `error` del JSON con `--json`; el `codigo` sigue siendo `INPUT_VALIDATION_ERROR`.
- **Voseo y tildes en toda la salida:** mensajes, ayuda, modo interactivo y PDF ("Usá", "Revisá", "número", "configuración"). Los flags, claves de config, valores (`produccion`, `cotizacion`) y claves JSON no cambian. Si un script compara el texto de un mensaje de error en lugar de `codigo`, puede necesitar un ajuste.

### Corregido

- **Punto de venta inválido:** la facturación seguía con el número 1 y recién fallaba al emitir con un error confuso, y `arcli ultimos` mostraba que no había comprobantes. Ahora cortan con `ARCA_LAST_VOUCHER_ERROR`.
- **Lote cortado antes de emitir:** si el lote se cortaba en el login o en el pedido del último número, el comprobante que falló no figuraba en `detalles.sinProcesar` de `BATCH_EMISSION_ERROR`, y reintentar solo esa lista lo perdía. Ahora figura. Si la emisión quedó sin confirmar, sigue en `sinConfirmar` y no en `sinProcesar`, como antes.
- **IIBB en el PDF:** sin `emisor.iibb`, el PDF decía "Exento"; ahora muestra "-". Si sos exento, configuralo con `arcli config establecer emisor.iibb Exento`. La configuración guiada del modo interactivo ahora lo pregunta junto a los otros datos del emisor.
- **Números con letras o notación científica:** `config establecer puntoVenta 3a` guardaba `3`, y `arcli consultar fc 1e3` buscaba el 1000. Ahora dan error, igual que en el modo interactivo.
- **`arcli pdf instalar` colgado:** con un proxy que no responde, npm o la descarga del navegador no terminaban nunca. Ahora se cortan a los 5 y 15 minutos con `PDF_PLUGIN_INSTALL_ERROR`.
- **`montoTotal` del JSON nunca se redondea:** con más de 2 decimales se redondeaba en silencio antes de validar (`1.005` se emitía por `$1`). Ahora da `INPUT_VALIDATION_ERROR` ("Use hasta 2 decimales"), igual que `--monto` y el resto de los importes.
- **`consultarPadron false` se respeta siempre:** con un `ivaReceptor` en la config, facturar con `--cuit` igual consultaba el padrón y su condición IVA pisaba la de la config.
- **Aviso falso en `avisos`:** "--descripcion, --receptor-nombre y --receptor-domicilio solo se usan en el PDF" salía sin haber pasado esos flags, cuando el nombre o el domicilio los había completado el padrón.
- **Modo interactivo:** al generar el PDF, apretar Enter en el nombre o el domicilio del receptor borraba lo que había traído el padrón; ahora lo propone y Enter lo deja. En una FCE se informa el `aliasCbu` de la config, como con flags. Y si la config tiene una moneda extranjera, el comando equivalente de un comprobante en pesos lleva `--moneda ARS`, así al pegarlo hace lo mismo.
- **Leyendas obligatorias en el PDF:** los comprobantes B ahora traen el bloque del Régimen de Transparencia Fiscal al Consumidor (Ley 27.743, RG 5614), con el IVA contenido, y los comprobantes A a un monotributista la leyenda de la RG 5003 sobre el crédito fiscal. Salen debajo del CAE. Ver [PDF](docs/pdf.md#leyendas-obligatorias).

### Documentación

- Nueva sección de la `E` en [referencia del CLI](docs/cli-reference.md#factura-de-exportación-e-wsfex) y en [reglas de validación](docs/validation-rules.md#factura-de-exportación-e); credenciales de WSFEX en [configuración](docs/configuration.md#certificados-de-exportación-wsfex); items, JSON y limitaciones (`--numero` obligatorio, sin notas E, sin lote) en [entrada y salida](docs/input-output.md), [PDF](docs/pdf.md) y [limitaciones](docs/limitations.md); el asistente de la `E` en [modo interactivo](docs/modo-interactivo.md) y sus problemas comunes en [troubleshooting](docs/troubleshooting.md).

## [2.1.0] - 2026-10-23

Trae `arcli padron` y el IVA receptor desde el padrón al facturar con `--cuit`, el aviso de vencimiento del certificado y una guía para el punto de venta de web service. Además corrige un montón de cosas que salen de una revisión del repo: el JSON de `--cargar` se valida clave por clave, los errores con `--json` tienen siempre la misma forma, y los ejemplos de la ayuda y de los docs se pueden copiar y andan.

Algunos cambios rompen scripts que dependían del comportamiento anterior. Revisá la sección "Cambiado":

- **Exit code `2`** cuando ARCA rechaza un comprobante (antes, `0`).
- **Validación estricta del JSON de `--cargar`:** una clave desconocida o con otro tipo ahora es error.
- **Un array de un elemento en `--cargar`** sale como array.
- **`--bruto`** agrega `respuesta` en lugar de reemplazar el resumen.
- **`config revisar`** ya no recibe `--testing` ni `--produccion`.
- **Los PDFs** se guardan en una subcarpeta por CUIT.

Los comandos, los flags de facturación y las claves de config siguen siendo los mismos.

### Agregado

- **`arcli padron <cuit>`:** nombre o razón social, domicilio fiscal, condición IVA, impuestos, categoría de monotributo y actividad de un CUIT, desde el padrón de ARCA (`ws_sr_constancia_inscripcion`). Con `--json` para scripts.
- **IVA receptor desde el padrón:** al facturar con `--cuit` y sin `--ir`, ARCLI usa la condición IVA del padrón, antes que el `ivaReceptor` de la config. También completa el nombre y el domicilio del receptor para el PDF. Si el padrón no responde o no la informa, sigue con la config y avisa. El modo interactivo propone la misma condición al cargar un CUIT. Se desactiva con `arcli config establecer consultarPadron false`.
- **Aviso de vencimiento del certificado:** a menos de 30 días de vencer cualquiera de los certificados configurados (testing o producción, sin importar con cuál estés trabajando), los comandos que van a ARCA (facturación, `ultimos`, `consultar`, `padron`, `fce-obligado`, `parametros`, `estado`) avisan al principio, en stderr: `El certificado de produccion vence el 20/11/2026 (en 10 días)`, con el link a la [guía para renovarlo](docs/obtencion-certificados.md). Con `--json`, stdout queda solo con el JSON y en facturación el aviso va también en `avisos`. En el modo interactivo es un recuadro debajo de la barra de estado. Si vencen los dos, van en el mismo recuadro. Si ya venció el del entorno que se usa, cortan antes de autenticar en ARCA con el error `CERTIFICATE_EXPIRED` (antes fallaba el login en WSAA con un error inesperado).
- **Punto de venta para web service:** si ARCA rechaza el comprobante porque el punto de venta no es de web service (error `10005`), la `sugerencia` lo dice y apunta a la [guía para crear uno](docs/obtencion-certificados.md#punto-de-venta-para-web-service). `arcli estado` avisa lo mismo cuando el punto de venta configurado no está entre los habilitados. Desde el 1/11/2026 ARCA da de alta de oficio puntos de venta "Factura en línea" a monotributistas (RG 5893/2026), y esos no sirven para arcli.

### Cambiado

- **`--bruto` agrega la respuesta cruda sin quitar el resumen:** con `--json --bruto` ahora salen `cae`, `caeVencimiento`, `estado`, `resultado`, `errores`, `observaciones` y el resto del JSON de siempre, más `respuesta` con la respuesta cruda de ARCA. Antes `--bruto` reemplazaba el resumen y esos campos desaparecían, aunque la documentación decía que agregaba. En texto pasa lo mismo: el resultado se muestra como siempre y el panel `Respuesta bruta` va al final. Vale igual para `bruto=true` en la config.
- **Un array de un elemento en `--cargar` es un lote:** si el JSON es un array sale un array (con `indice`) y los errores son `BATCH_VALIDATION_ERROR` / `BATCH_EMISSION_ERROR`, tenga uno o muchos elementos. Antes un array de un elemento salía como objeto y con los errores de un comprobante suelto. Un objeto sigue devolviendo un objeto. Si un script leía `[0]` solo cuando había más de uno, ya puede leer siempre el array.
- **El JSON de `--cargar` se valida clave por clave:** una clave desconocida (`"montototal"`, `"vencimiento"`, `"moneda"`) o un valor con otro tipo (`"puntoVenta": "3"`, `"emitir": "true"`, `null`) ahora es error de entrada (`INPUT_VALIDATION_ERROR`, o `BATCH_VALIDATION_ERROR` con el índice en un lote) que nombra la clave y sugiere la correcta. Antes se ignoraban sin aviso: con `"puntoVenta": "3"` se emitía en el punto de venta de la config. Si un archivo que te funcionaba ahora falla, corregí la clave o sacale las comillas al número; las claves documentadas siguen igual. Un lote vacío (`[]`) también es error: antes se ignoraba el archivo y se usaban solo los flags. La tabla de claves y su flag equivalente está en [entrada y salida](docs/input-output.md#flags-y-claves-del-json).
- **`config revisar` revisa los dos entornos:** valida el entorno por defecto y cualquier otro que tenga `cert` o `key` configurados, cada uno en su línea (`Validacion testing`, `Validacion produccion`). La línea `Revision activa` del JSON ya no existe. Ya no recibe `--testing` ni `--produccion`: antes los aceptaba pero los ignoraba y revisaba siempre testing.
- **Exit code `2` cuando ARCA rechaza un comprobante:** antes salía con `0` y había que leer `estado` para enterarse. En un lote, `2` si ARCA rechazó al menos uno. `observado` sigue saliendo con `0`. Si un script trataba cualquier exit distinto de `0` como error de ARCLI, ahora también corta en un rechazo.
- **PDFs en una subcarpeta por CUIT emisor:** `~/arcli/comprobantes/20123456789/factura-c_0003-00000125.pdf` (en testing, `testing/20123456789/`). Si el archivo ya existe no se pisa: se guarda con `-2`, `-3` y así.
- **`sugerencia` siempre en el JSON de error:** todos los errores con `--json` traen las mismas cuatro claves (`codigo`, `detalles`, `error`, `sugerencia`), con `sugerencia: null` cuando no hay nada que sugerir. Antes faltaba en los errores sin sugerencia (`CONFIGURATION_ERROR`, `INPUT_VALIDATION_ERROR`…) y era `null` solo en los inesperados. Si un script chequeaba si la clave existe, ahora tiene que chequear si es `null`.
- **`--bruto` solo en los comandos de facturación:** `padron`, `fce-obligado`, `ultimos`, `consultar`, `parametros`, `estado` e `interactivo` ya no lo declaran (no lo usaban): pasado ahí, el comando corre igual y avisa en stderr que se ignora. Ya no aparece en su ayuda.
- **`arcli interactivo --json` ya no falla:** el asistente acepta solo `--testing` y `--produccion`; `--json` y `--bruto` se ignoran con un aviso. Sin terminal interactiva sigue fallando, con o sin `--json`.
- **Comando equivalente del modo interactivo:** siempre lleva `--testing` o `--produccion`. Antes, en testing no llevaba nada, y si la config pasaba a producción el comando pegado emitía ahí.

### Corregido

- **Ejemplos de la ayuda y de los docs que fallaban:** los ejemplos de `--ayuda` de las notas B y C, las B, las FCE y las familias, las NC/ND FCE de `arcli ejemplos` y varios de los docs (`pdf.md`, `usage-patterns.md`, `cli-reference.md`, el JSON de `llms.txt` y de `input-output.md`) daban error al copiarlos: asociado de otra letra, IVA receptor que la letra no admite, FCE sin `--cbu` o con `--acuit` ajeno, fechas fijas viejas o sin IVA receptor. Ahora cada nota asocia una factura de su letra y categoría, y un test pasa todos los ejemplos por el parser y arma la solicitud a ARCA.
- **"Puede haberse emitido" cuando seguro no se emitió:** un certificado vencido, un fallo de login en WSAA o un error al pedir el último número salían como `EMISSION_UNCERTAIN`, con la sugerencia de verificar con `arcli ultimos` antes de reintentar. En esos casos no llegó nada a ARCA: ahora salen con su error (`UNEXPECTED_ERROR` o `TRANSIENT_ERROR` en el JSON) y se puede reintentar directo. `EMISSION_UNCERTAIN` queda solo para un fallo en la llamada que emite (red, timeout, transacción activa). En un lote, ese caso ya no suma `detalles.sinConfirmar`.
- **Lote interrumpido, PDFs de los ya emitidos:** si un lote se cortaba a mitad, los comprobantes que ya tenían CAE quedaban sin PDF. Ahora se generan antes de mostrar el error, según `pdf` o `--exportar-pdf` como en un lote completo, y en `--json` cada uno lleva su campo `pdf`. Si falla el PDF, el error que se muestra sigue siendo el de la emisión.
- **Lote, fallos del padrón o de la cotización con su índice:** si la consulta al padrón (IVA receptor desde `--cuit`) o a la cotización oficial fallaba para un ítem, el lote cortaba con un error que no decía cuál era. Ahora sale en `BATCH_VALIDATION_ERROR`, junto con los demás ítems con problemas y su `#n`, antes de emitir ninguno.
- **`config.json` con JSON inválido** salía como "Error inesperado", sin decir qué archivo ni qué hacer. Ahora es un error de configuración (`CONFIGURATION_ERROR`) con la ruta del archivo y la sugerencia de corregirlo a mano o renombrarlo y volver a configurar. ARCLI no lo borra ni lo pisa.
- **`json=true` de la config en todos los comandos:** `pdf` (y sus subcomandos) y `parametros` sin tabla solo salían en JSON con `--json`. Ahora todos los comandos resuelven la salida igual: `--json` o, si no está, la clave `json` de la config. `config ruta` acepta `--json` y devuelve `{"ruta": "..."}`.
- **Errores de uso en JSON:** una opción desconocida (`arcli fc --montoo 1 --json`), un valor faltante o un comando que no existe salían en texto aunque se pidiera JSON. Ahora, con `--json` o `json=true`, salen como `INPUT_VALIDATION_ERROR` en el mismo formato que el resto de los errores, con exit code `1`. Sin JSON se ven igual que antes.
- **Opciones globales que no aplican:** `--testing`, `--produccion`, `--json` o `--bruto` en un comando que no las usa (`arcli config ruta --produccion`) se aceptaban sin decir nada. Ahora el comando corre igual y avisa en stderr que la opción se ignora.
- **`json=true` en `config`:** `config`, `config revisar`, `config establecer` y `config eliminar` respetan `json=true` de la config, como el resto de los comandos.
- **`--dia` corría un mes de más** a fin de mes: `--dia 15` el 31/03 daba el 15/05 en vez del 15/04, y ARCA lo aceptaba con las fechas de servicio y vencimiento equivocadas. Si el día no existe en ese mes (`--dia 31` con abril), ahora da error.
- **`--json` con `FORCE_COLOR`:** con `FORCE_COLOR=1` en el entorno, el JSON redirigido a un archivo o a otro programa salía con colores y no se podía parsear. Ahora solo se colorea en una terminal.
- **`--json` en `config`:** `config`, `config revisar`, `config establecer` y `config eliminar` ignoraban `--json` y salían en texto.
- **`config --ayuda` listaba la mitad de las claves:** mostraba 15 de 30. Ahora `config --ayuda` y `config establecer --ayuda` listan todas, por sección, con sus valores posibles.
- **Links de `llms.txt` y del README en el paquete de npm:** apuntaban a `docs/`, que no se publica en npm. Ahora son links a GitHub.
- **`config establecer` con un valor inválido** (`puntoVenta abc`, `comprobantesPorLista 99`) sale como error de entrada (`INPUT_VALIDATION_ERROR`) y no como error inesperado.

## [2.0.0] - 2026-10-12

Versión mayor: sale de una auditoría del proyecto. Lo que rompe es cómo se escriben algunos valores en los flags:

- **Montos en formato argentino:** punto para miles y coma para decimales (`15.000`, `1.500,50`). `-m 1500.50` ahora da error; escribí `1500,50`.
- **Enteros solo con dígitos:** `--pv 3a` da error en vez de leerse como 3.
- **`--dia` no se combina con `--fecha` ni `--servicio-hasta`.**
- **Varias alícuotas:** la suma tiene que coincidir exacta con `--monto`.
- **Un error de red al emitir** sale como `EMISSION_UNCERTAIN`, no como `TRANSIENT_ERROR`/`UNEXPECTED_ERROR`.

El resto son correcciones: evitar comprobantes duplicados, fecha argentina en cualquier zona horaria, `ImpTotal` exacto, PDF escapado, archivos privados y validaciones más estrictas.

### Agregado

- **Modo interactivo, estado de ARCA en la barra:** la barra de arriba del menú ya no dice "Modo interactivo": muestra **ARCA funcionando**, **con demoras** (más de 3 segundos), **con problemas** (algún servidor no responde OK) o **sin respuesta**, en color, seguido del entorno (`TESTING` en naranja, `PRODUCCION` en celeste). A la izquierda, la razón social del emisor (o el CUIT, si no está configurada) y el punto de venta.
- **Versión debajo del logo** (`v1.8.0 | LcsGrz`), en el modo interactivo y en la ayuda.
- **Mismo ancho para todo:** las cajas de la salida en texto, la barra de estado y el logo (ahora centrado) ocupan 92 columnas, o menos si la terminal es más angosta. Antes cada caja medía distinto según su contenido. Los comprobantes (vista previa, resultado de la emisión y `consultar`) mantienen su ancho de ticket, de 68 a 80 columnas, y van centrados. El JSON no cambia.
- **Modo interactivo, listas de comprobantes:** las filas ocupan todo el ancho de la línea punteada que las enmarca.
- **Modo interactivo, actualizar:** si hay una versión nueva, la primera opción del menú es **Actualizar a la versión X.Y.Z**. Muestra tu versión, la nueva y sus novedades, y con **Cerrar para actualizar** copia `npm install -g arcli@latest` al portapapeles y cierra el asistente para que lo ejecutes. En el modo interactivo el aviso de nueva versión ya no aparece al salir.

### Cambiado

- **Enteros estrictos, y es un cambio que rompe:** `--pv`, `--punto-venta`, `--ar`, `--apv`, `--at`, `--dia` y `--cantidad` aceptan solo dígitos; antes `--pv 3a` se leía como 3. `--cuit`, `--cuil` y `--dni` aceptan además guiones y puntos (`20-11111111-2`), como el modo interactivo; antes `--cuit 20111111112xyz` pasaba.
- **`--dia` con `--fecha` o `--servicio-hasta` da error:** antes `--dia` se ignoraba sin aviso.
- **Montos del JSON con 2 decimales como máximo** (la cotización, 6), igual que los flags.
- **Varias alícuotas: la suma tiene que coincidir exacta** con `--monto`; antes se aceptaba un centavo de diferencia, y el `ImpTotal` enviado podía no coincidir con la suma de sus partes.
- **Montos en formato argentino, y es un cambio que rompe:** `--monto`, `--exento`, `--nogravado`, `--cotizacion-moneda`/`--cm`, el monto de `--alicuota TASA:MONTO` y `config establecer cotizacion` usan punto para miles y coma para decimales. `15.000` es quince mil y `1.500,50` es mil quinientos con cincuenta. Antes `-m 15.000` se leía como 15 y `-m 1500,50` como 1500, sin aviso. Ahora `1500.50` da error ("use coma para los decimales"), igual que el texto sobrante (`12abc`) y más de 2 decimales (la cotización acepta hasta 6). El JSON de `--cargar` no cambia: ahí los montos son números.
- **Modo interactivo:** los montos siguen la misma regla. `1500.50` ya no se acepta y más de 2 decimales da error en lugar de redondearse en silencio. El comando equivalente que muestra al final escribe los montos con coma.

### Corregido

- **Modo interactivo, notas y repetir factura copian más de la original:**
  - Una NC o ND sobre una factura en dólares va en dólares, con la cotización de la factura; antes salía en pesos.
  - "Anular el total" copia también exento y no gravado.
  - "Repetir factura" copia exento y no gravado.
  - Si la factura tiene varias alícuotas o tributos, ARCA no devuelve el detalle para reproducirla. En ese caso se avisa, no se ofrece "anular el total" ni "mismo monto", y se pide elegir la alícuota.
- **Salida de terminal sin secuencias de control:** observaciones de ARCA, datos del JSON o errores de npm ya no pueden mover el cursor, borrar la pantalla, pisar una línea ni meter hipervínculos. Solo pasan colores, saltos de línea y tabs. `--json` no cambia.
- **Rutas absolutas en la config:** `cert.*`, `key.*` y `ticketPath` se guardan resueltas, como `pdfCarpeta`. Antes una ruta relativa dependía de la carpeta desde donde se corría ARCLI.
- **Clave privada cifrada:** `config establecer key.*` la rechaza con un mensaje claro y cómo descifrarla. Antes se aceptaba y fallaba recién al hablar con ARCA.
- **PDF: textos escapados.** La plantilla de `@arcasdk/pdf` no escapa HTML y Chromium la renderiza con JavaScript: una razón social o descripción con `<script>` (por ejemplo, de un JSON de terceros) se ejecutaba, y un `&` legítimo se veía mal. Ahora todos los textos se escapan antes de generar el PDF.
- **Tickets de ARCA y config solo para tu usuario:** ARCLI crea sus archivos con permisos `0600`/`0700` (umask `077`), incluidos los tickets que escribe el SDK, y deja en `0700` la carpeta de config y la de tickets que ya existían. Antes quedaban `0644`/`0755`, y en Linux otro usuario del equipo podía leer un ticket y usarlo para emitir durante su validez. Los PDFs nuevos también quedan solo para tu usuario.
- **`config establecer` ya no guarda valores inválidos:** antes `config establecer cuit abc` lo guardaba igual y dejaba el CLI inutilizable, incluso `config eliminar`. Ahora se valida antes de guardar, y una config que ya estaba rota se arregla con `config establecer` o `config eliminar` de la clave que falla.
- **Fecha argentina siempre:** en un equipo con otra zona horaria (por ejemplo un servidor en UTC), entre las 21 y las 24 h la fecha del comprobante salía con el día siguiente. Ahora "hoy" es siempre el día en Argentina.
- **`ImpTotal` exacto:** se calcula como la suma de no gravado, exento, neto e IVA con aritmética decimal. Con varias alícuotas, el total ya no sale como `300.29999999999995`.
- **`--at` se valida como `--ac`:** una NC A ya no puede asociar una factura B por código; si `tipo` y `atajo` vienen juntos tienen que coincidir.
- **`ayuda` como valor de un flag** (`--descripcion ayuda`) ya no abre la ayuda.
- **Emisión sin confirmar:** si falla la llamada que emite en ARCA (red, timeout, transacción activa), el error ahora es `EMISSION_UNCERTAIN` y avisa que el comprobante puede haberse emitido igual, con el `arcli ultimos <tipo> --pv <n>` para verificarlo antes de reintentar. Antes salía como `TRANSIENT_ERROR` o `UNEXPECTED_ERROR` y sugería reintentar, lo que podía duplicarlo. En un lote, `BATCH_EMISSION_ERROR` suma `detalles.sinConfirmar`.
- **Ctrl+C en las preguntas del PDF**, que llegan después de emitir: el modo interactivo decía "Cancelado. No se emitio nada." aunque el comprobante ya estaba emitido, y el comando terminaba en "Error inesperado" con exit 1. Ahora se toma como "no generar el PDF" y se avisa que el comprobante quedó emitido.
- **Un flag escrito siempre gana:** `--previsualizar` ya no choca con `emitir=true` en la config o `"emitir": true` en el JSON, y `--emitir` gana a `"previsualizar": true`. Lo mismo con `--alicuota TASA` sobre las `alicuotas` del JSON, `--cm` sobre `"mismaMoneda"` y `--misma-moneda` sobre `"cotizacionMoneda"`. El error de "ambos a la vez" queda solo si los dos vienen del mismo lugar.
- **Errores en JSON con `json=true` en la config:** antes solo salían en JSON con el flag `--json`.
- **`cae` y `caeVencimiento` son `null` en un comprobante rechazado**, como dice la documentación; antes venían como `""`.
- Los errores con sugerencia la incluyen en `sugerencia` también en JSON (antes solo los del PDF).
- **Documentación de la emisión en producción:** decía que emitir en producción exige `--produccion --emitir`. En realidad el entorno sale de `config.entorno` y la emisión de `config.emitir` cuando no pasás flags: con `entorno produccion` y `emitir true` se emite en producción sin flags. El comportamiento no cambió; se corrigieron SECURITY.md, README, `llms.txt`, la ayuda y los docs.

## [1.8.0] - 2026-10-09

Suma la clave `comprobantesPorLista` y sube a 15 el default de `arcli ultimos`; el resto son cambios del modo interactivo. Ningún flag ni formato JSON cambia.

### Agregado

- **Modo interactivo, elegir factura:** en notas de crédito/débito, en "Repetir factura" y en "Consultar comprobantes", la lista ahora muestra los últimos 15, con el formato de `arcli ultimos`, y tiene **Cargar más…** para traer los anteriores e **Ingresar el número a mano…**, que pide punto de venta y número. Así se puede hacer una nota sobre una factura vieja o emitida desde otro punto de venta.
- **Nueva clave de config `comprobantesPorLista`** (1 a 50, por defecto 15): cuántos comprobantes muestran `arcli ultimos` y las listas del modo interactivo. `arcli config establecer comprobantesPorLista 25`.

### Cambiado

- **`arcli ultimos` muestra 15 comprobantes por defecto** (antes 10), o los de `config.comprobantesPorLista`. `--cantidad` sigue mandando. Si un script dependía de que vinieran 10, agregá `--cantidad 10`.
- **Modo interactivo:** "Nota de crédito o débito sobre una factura" se separó en **Emitir nota de crédito** y **Emitir nota de débito**, así el flujo ya no pregunta cuál.
- **Modo interactivo:** "Ver últimos comprobantes" y "Consultar un comprobante" se unificaron en **Consultar comprobantes**: elegís el tipo, la lista muestra los últimos y al elegir uno ves el detalle y volvés a la lista.
- **Modo interactivo:** **Esc** vuelve al paso anterior, en listas y en preguntas de texto (antes había que escribir `<`, que sigue funcionando). La pregunta abandonada no queda en pantalla. La ayuda de teclas de las listas pasó a castellano.
- **`arcli config` por secciones:** cuenta, certificados, al facturar, FCE, datos del emisor, PDF, y salida y listados. Cambia solo la salida en texto; `arcli config --json` queda igual.
- **Modo interactivo, configuración:** nueva opción **Ver configuración**. "Cambiar un dato" pasó a llamarse **Modificar configuración**: usa las mismas secciones que `arcli config`, suma moneda, cotización y carpeta de tickets, y vuelve a la lista después de cada cambio.
- **Docs:** GIF del modo interactivo regrabado y uno nuevo de "Consultar comprobantes" en la guía del modo interactivo. `scripts/demo/record.sh` acepta los guiones a grabar. README con el logo en alta resolución y los chips centrados.
- **Modo interactivo:** Esc en el menú principal cierra el asistente. Más aire entre preguntas: dos líneas arriba de la activa, una debajo de la pregunta y otra entre la descripción y la ayuda de teclas.
- **Modo interactivo:** la pregunta activa tiene una línea en blanco arriba, así se distingue de las ya respondidas, que quedan juntas. "← Volver" queda separado de las opciones por una línea en blanco.

## [1.7.1] - 2026-10-06

Versión de documentación. No cambia ningún comando, flag, clave de config ni JSON.

### Cambiado

- **Documentación reorganizada:** nuevo índice en `docs/README.md` y nueva guía de [arquitectura](https://github.com/LcsGrz/arcli/blob/main/docs/architecture.md). El README quedó más corto, con instalación, configuración y uso mínimos. Se eliminaron secciones duplicadas entre documentos y el checklist manual de UI, que usaba comandos que ya no existen.
- **Seguridad:** `SECURITY.md` apunta al reporte privado de vulnerabilidades de GitHub.

### Corregido

- **Docs:** el glosario decía que la alícuota de IVA era fija al 21%; la referencia del CLI citaba claves de config inexistentes; `llms.txt` documentaba un campo JSON (`confirmarProduccion`) que no existe; faltaban en la guía de configuración `NO_UPDATE_NOTIFIER` y `PUPPETEER_EXECUTABLE_PATH`.

## [1.7.0] - 2026-10-05

Esta versión completa el modo interactivo: configuración guiada la primera vez, cambiar cualquier dato desde un menú, repetir una factura anterior con fechas nuevas, consultar un comprobante y ver el estado de ARCA. También corrige el PDF de la Factura B, enlaza la guía de certificados desde la configuración y suma GIF e imágenes al README. No se rompe ningún comando, flag ni JSON existente.

### Corregido

- **PDF de la Factura B:** el renglón y el subtotal mostraban el importe neto y el total con IVA, sin el IVA en ningún lado, así que no cerraba. Ahora los renglones y el subtotal de la B van con IVA incluido, como corresponde a una B. La A y la C no cambian.

### Agregado

- **Modo interactivo:**
  - **Repetir una factura anterior:** copia receptor, concepto, monto y alícuota de una de las últimas emitidas, con fecha de hoy y el período que elijas (este mes, el mes pasado, hoy u otro).
  - **Configuración:** submenú con revisar, **configuración guiada** (CUIT, certificado, punto de venta y defaults, más los datos del PDF), **cambiar un dato** de una lista con su valor actual, y el **plugin de PDF**. Si falta algo obligatorio, el asistente ofrece la configuración guiada al abrirse.
  - **Consultar un comprobante** por tipo y número, y **Estado de ARCA** con la cotización del dólar.

### Cambiado

- **Guía de certificados en la configuración:** el asistente de configuración y `arcli config revisar` ahora muestran el link a [Cómo obtener los certificados de ARCA](https://github.com/LcsGrz/arcli/blob/main/docs/obtencion-certificados.md): en el mensaje inicial, justo antes de pedir el certificado de testing si todavía no hay uno cargado, y en el aviso de credenciales de testing faltantes. Antes el asistente apuntaba a una ruta relativa que no existe al instalar desde npm.

## [1.6.0] - 2026-10-05

Esta versión suma `arcli estado` y `arcli parametros` para consultar ARCA sin emitir, y simplifica la factura del modo interactivo: primero lo requerido y después todos los opcionales en una sola pregunta. No se rompe ningún comando, flag ni JSON existente.

### Agregado

- `arcli estado`: muestra si los servidores de ARCA responden, cuánto tardan y si el punto de venta configurado está habilitado para tu CUIT (en producción; en testing ARCA no informa puntos de venta). Con `--json`, `listo` dice si se puede emitir.
- `arcli parametros <tabla>`: consulta las tablas de ARCA vigentes (`puntos-venta`, `comprobantes`, `documentos`, `alicuotas`, `iva-receptor`, `monedas`, `conceptos`, `opcionales` y `tributos`). `arcli parametros cotizacion USD` muestra la cotización oficial. Sin tabla, lista las disponibles.

### Cambiado

- **Modo interactivo:** la factura pregunta primero solo lo requerido y después, en **una sola pregunta**, todos los opcionales: se marcan con espacio y Enter sigue. Sin marcar nada se usan los valores por defecto. La alícuota de IVA (A y B) y la modalidad de transferencia (FCE) pasan a ser opcionales: antes se preguntaban siempre, aunque casi siempre quedaban en 21% y SCA. Las opciones avanzadas ya no son un menú que se recorre de a una.

## [1.5.0] - 2026-10-04

Esta versión suma el PDF del comprobante con el QR de ARCA, para mandarle al cliente. El PDF lo genera un plugin que se descarga solo si lo usás, así que ARCLI no pesa más para quien no quiere PDFs. No se rompe ningún comando, flag ni JSON existente: todo lo nuevo es opcional, y el JSON suma la clave `pdf` solo cuando se intenta generar el PDF.

### Agregado

- **PDF del comprobante con el QR de ARCA**, para mandarle al cliente. Ver [PDF de comprobantes](docs/pdf.md).
  - `--exportar-pdf` (alias `--pdf`) lo genera después de emitir y `--sin-pdf` no. Sin flag decide la config `pdf`: `preguntar` (por defecto), `siempre` o `nunca`. Con `preguntar`, sin terminal o con `--json` no se genera.
  - Datos que solo van en el PDF, porque ARCA no los guarda: `--descripcion`, `--receptor-nombre` y `--receptor-domicilio`, y en el JSON de `--cargar`, `pdf`, `descripcion`, `receptorNombre` y `receptorDomicilio`.
  - Claves de config nuevas: `pdf`, `pdfCarpeta` (por defecto `~/arcli/comprobantes`), `pdfNavegador` y los datos del emisor: `emisor.razonSocial`, `emisor.domicilio`, `emisor.inicioActividades`, `emisor.iibb`, `emisor.condicionIva` y `emisor.logo`.
  - El archivo se llama `factura-c_0003-00000125.pdf`. Los de testing van a la subcarpeta `testing/` con un pie que dice que no tienen validez fiscal.
  - En JSON, cada resultado suma la clave `pdf` (`{ ruta }` o `{ error }`) **solo si se intentó generar**. Un error del PDF no cambia el código de salida, porque el comprobante ya está emitido.
  - El modo interactivo pregunta si generar el PDF después de emitir, y pide los datos del emisor que falten (ofrece guardarlos).
- **`arcli pdf`** (`estado`, `instalar`, `desinstalar`): el PDF lo genera [`@arcasdk/pdf`](https://www.afipts.com/packages/pdf), que **no viene con ARCLI** porque pesa unos 160 MB (más un navegador de unos 200 MB si no hay Chrome, Chromium o Edge instalado). Se descarga recién cuando alguien quiere PDFs: en una terminal, ARCLI lo ofrece la primera vez; sin terminal nunca se descarga solo.
- `config revisar` avisa si `pdf` es `siempre` y faltan datos del emisor.

## [1.4.0] - 2026-10-02

Esta versión suma dos comandos para ver lo emitido (`ultimos` y `consultar`), facturas con varias alícuotas de IVA y un modo interactivo más completo. Los lotes ahora se validan enteros antes de emitir. No se rompe ningún comando, flag ni JSON existente: `--alicuota` con un solo número funciona igual que antes.

### Agregado

- **Modo interactivo:**
  - **Volver al paso anterior** con "← Volver" en las opciones o `<` en los textos.
  - **Opciones avanzadas** antes de la vista previa: moneda extranjera (incluida la cotización oficial si te pagan en dólares), exento y no gravado, período del servicio y vencimiento del pago.
  - Las notas comunes se pueden asociar **a un período** en lugar de a una factura.
- **Varias alícuotas por comprobante:** repetí `--alicuota TASA:MONTO` con el monto IVA incluido de cada una, por ejemplo `--alicuota general:1210 --alicuota reducida:552.50`. El total se calcula solo y se envía una entrada de IVA por alícuota. En JSON: `alicuotas: [{tasa, monto}]`.
- **Alias de alícuotas:** `general` (21), `reducida` (10.5), `incrementada` (27) y `cero` (0). Se aceptan igual que el número en `--alicuota`, `alicuotaIva` y `config alicuota`.
- `arcli ultimos <tipo>`: lista los últimos comprobantes emitidos en ARCA (`--cantidad` de 1 a 50, por defecto 10).
- `arcli consultar <tipo> <numero>`: muestra el detalle de un comprobante emitido, con CAE, vencimiento, importes y receptor.
- Los dos tienen `--json` y `--pv`. Antes esto solo se podía ver desde el modo interactivo.

### Cambiado

- **Lotes (`--cargar` con un array):**
  - Se validan **todos** los comprobantes antes de emitir el primero. Si alguno es inválido, no se emite ninguno y el error `BATCH_VALIDATION_ERROR` los lista a todos con su índice.
  - Antes, las reglas de negocio se validaban mientras se emitía: si el #3 era inválido, el #1 y el #2 ya estaban emitidos y sus resultados no se mostraban.
  - Si la emisión se corta a mitad (red, ARCA), se muestran los comprobantes ya procesados y después el error `BATCH_EMISSION_ERROR`, con el ítem que falló y los que quedaron sin procesar.

### Corregido

- El comando equivalente del modo interactivo no incluía la moneda extranjera (`--moneda`, `--cm`, `--misma-moneda`).
- **La salida `--json` traía códigos de color ANSI cuando se redirigía** (`arcli ... --json | jq` fallaba con `parse error`). Ahora solo hay colores si la salida es una terminal real. `FORCE_COLOR=1` los fuerza y `NO_COLOR` los apaga.
- En el modo interactivo, el logo ahora tiene 3 líneas en blanco abajo, igual que arriba. Antes la barra de estado quedaba pegada.

## [1.3.0] - 2026-10-02

Esta versión suma el modo interactivo para quien factura de vez en cuando y renueva la salida de la terminal: bordes según el tipo de panel, paneles que se ajustan a ventanas angostas y varios bugs de color corregidos. No se rompe ningún comando, flag ni JSON existente. El único cambio de comportamiento es que `arcli` sin argumentos, en una terminal interactiva, abre el asistente en lugar de la ayuda.

### Agregado

- `ARCLI_ASCII=1` dibuja los paneles con ASCII puro, para terminales que no muestran caracteres de caja.
- **Modo interactivo.** `arcli` sin argumentos en una terminal interactiva abre un asistente paso a paso (también `arcli interactivo`):
  - Emitir facturas A, B o C, comunes o FCE.
  - Notas de crédito y débito eligiendo la factura de una lista de las últimas emitidas, consultadas a ARCA.
  - Ver los últimos comprobantes y revisar la configuración.
  - Antes de emitir muestra la vista previa y el comando equivalente. En producción pide una segunda confirmación.
  - Usa las mismas validaciones y la misma emisión que los comandos con flags. Ver [Modo interactivo](docs/modo-interactivo.md).

### Cambiado

- **Bordes según el tipo de panel**, para reconocerlo antes de leerlo:
  - Comprobantes: la línea antes del estado ahora es de puntos y llega al borde (`├┄┄┤`).
  - Errores del CLI y de ARCA: `╭─╮`, con una franja gruesa `┃` a la izquierda.
  - Observaciones y avisos del régimen FCE: la misma forma, con la franja a trazos `╏`. Sugerencias: franja fina `┆`.
  - Configuración y régimen FCE: ficha `┌─┐` con el título a la izquierda.
  - Revisión de configuración: `╓─╖` con el veredicto en el pie (`╟──╢`).
  - Últimos comprobantes (modo interactivo): solo reglas `══` arriba y abajo, sin costados.
  - Avisos simples ("No se emitió nada"): solo las esquinas `┌ ┐ └ ┘`.
  - Banner de TESTING: `┌╌┐`. Aviso de nueva versión: `╭─╮`. JSON y respuestas crudas: `┌┈┐`.
  - Encabezado del modo interactivo: una barra de estado de una línea (`━━ MODO INTERACTIVO ━━ testing · PV 3 ━━`).
  - Títulos de `arcli ejemplos`: una línea de sección (`── FACTURA C ──`) en lugar de una caja.
  - "Esto equivale a:" del modo interactivo: solo `▎` a la izquierda, sin borde derecho, para que el comando se copie limpio.
  - `arcli storybook bordes` muestra cada estilo con el panel donde se usa.
- Las etiquetas de las tablas, los pies de los paneles y el "CLI" del logo usan el color por defecto de la terminal en lugar de blanco fijo, que casi no se leía en terminales con fondo claro.
- Los títulos de los paneles de JSON, respuesta bruta y eventos pasan de celeste a gris, para que no compitan con los paneles informativos.
- Los errores muestran **Detalles** en cian y **Sugerencia** en amarillo, como dice la paleta. Antes estaban al revés. El panel "Sugerencias" de la respuesta también pasa a amarillo.
- `arcli` sin argumentos en una terminal interactiva abre el asistente en lugar de la ayuda. Sin terminal (pipes, CI, agentes) o con `--json` sigue mostrando la ayuda. `arcli ayuda` y `arcli --ayuda` no cambian.

### Corregido

- Los títulos de los paneles ignoraban el color pedido desde la primera versión. Ahora el comprobante sale verde si fue aprobado, amarillo si quedó observado y rojo si fue rechazado; los errores, en rojo.
- El texto atenuado dejaba el atenuado prendido y apagaba lo que se imprimía después: el comando del "Esto equivale a:" y el comienzo del panel siguiente hasta el título.
- En terminales angostas los paneles medían al menos 68 columnas y se rompían. Ahora se ajustan al ancho de la ventana: las filas etiqueta/valor parten el valor debajo de su columna y, si no hay lugar, apilan etiqueta y valor. El logo se reemplaza por el nombre si no entra.
- El README decía que alcanzaba con Node.js 20. El mínimo es Node.js 22.22.1, como pide `engines`.

### Dependencias

- `boxen` 8 → 9, `zod` 4.4 → 4.6 y `@inquirer/select` 5.2.2 → 5.2.5. No cambia la salida de la terminal.
- Herramientas de desarrollo: `vitest` y `@vitest/coverage-v8` 4 → 5 (ahora requieren `vite` como dependencia explícita), `eslint`, `typescript-eslint`, `prettier`, `lint-staged` y `tsx`.
- Se mantienen `typescript` 6, porque `typescript-eslint` todavía no soporta TypeScript 7, y `@types/node` 22, para no usar APIs que no existen en Node 22, la versión mínima soportada.

## [1.2.0] - 2026-10-02

Esta versión revisa el payload que ARCLI envía a ARCA contra el manual de WSFEv1 y corrige los casos en que ARCA rechazaba el comprobante. Además completa el soporte de Factura de Crédito Electrónica (FCE) y suma alícuotas, importes exentos y no gravados, y período asociado.

### ⚠️ Puede afectar comandos o scripts existentes

Ninguno de estos cambios quita flags. Todos convierten en un error local, con el motivo en castellano, algo que antes llegaba a ARCA y ARCA rechazaba:

- **Moneda extranjera sin cotización:** `--moneda USD` sin `--cotizacion-moneda` da error. Antes se enviaba cotización `1`. En pesos, una cotización distinta de `1` también da error.
- **IVA receptor según la letra:** `fa` con `--ir-cf`, o `fb` con `--ir-ri`, da error y sugiere la letra correcta. Se usa la tabla de `FEParamGetCondicionIvaReceptor`.
- **Consumidor final desde $10.000.000:** `--consumidor-final` da error desde ese monto (RG 5700/2025). Hay que identificar al receptor con `--dni`, `--cuit` o `--cuil`.
- **Fecha del comprobante:** `--fecha` fuera de la ventana de ARCA da error. La ventana es ±5 días en productos, ±10 en servicios y de −5 a +1 en FCE. En productos y FCE, una fecha futura tiene que caer en el mes actual.
- **FCE:** las facturas FCE sin CBU, y las NC/ND FCE sin `--afecha`, dan error.
- **Flags de FCE fuera de FCE:** `--cbu`, `--alias`, `--transferencia` y `--anulacion` dan error en comprobantes que no son FCE.
- **Salida JSON:** la salida de facturación suma el campo `avisos` (siempre presente, vacío si no hay avisos).

### Agregado

- `--misma-moneda` para comprobantes en moneda extranjera que se cobran en esa moneda. Consulta la cotización oficial a ARCA y envía `CanMisMonExt = S`. Clave JSON: `mismaMoneda`.
- `--vencimiento <fecha>` (alias `--vto`) para separar el vencimiento de pago del período de servicio. Clave JSON: `vencimientoPago`.
- Soporte completo de FCE:
  - Facturas: `--cbu`, `--alias` y `--transferencia sca|adc`.
  - NC/ND: `--anulacion` y `--afecha`. El CUIT del asociado se toma del emisor.
  - Claves de config `cbu` y `aliasCbu`, aplicadas solo a facturas FCE.
  - Claves JSON `cbu`, `aliasCbu`, `transferencia`, `anulacion` y `comprobanteAsociado.fecha`.
- `--afecha` también disponible, opcional, en notas comunes.
- `--alicuota 0|2.5|5|10.5|21|27` para letras A y B, y la clave de config `alicuota` para fijarla por defecto. Clave JSON: `alicuotaIva`.
- `--exento <monto>` y `--nogravado <monto>`: reparten el total en importe exento (`ImpOpEx`) y no gravado (`ImpTotConc`). Claves JSON: `importeExento` e `importeNoGravado`.
- `--periodo-desde` / `--periodo-hasta` (alias `--pd` / `--ph`): período asociado en notas comunes, como alternativa a `--ac`. Clave JSON: `periodoAsociado`.
- Comando `arcli fce-obligado <cuit>`: consulta en ARCA (`wsfecred`) si un receptor está obligado a recibir FCE y desde qué monto.
- Clave de config `verificarFce` (opt-in): hace esa consulta en cada factura con CUIT y avisa si corresponde FCE en lugar de factura común, o al revés. No frena la emisión.
- La vista previa muestra CBU, transferencia, anulación, fecha y período asociado, alícuota, importe no gravado y avisos.
- Los errores de valores no soportados listan los valores válidos.

### Corregido

- Dólar se enviaba como `USD`; ahora se envía `DOL`, el código de ARCA.
- La factura A a un receptor que no era responsable inscripto salía sin IVA discriminado. Ahora A y B siempre discriminan IVA.
- Las facturas FCE de productos no enviaban `FchVtoPago`, y las NC/ND FCE lo enviaban cuando no correspondía.
- Un servicio facturado después de su fin enviaba un vencimiento de pago anterior a la fecha del comprobante. Ahora nunca es anterior.
- La fecha por defecto del comprobante se calculaba en UTC: después de las 21 hs en Argentina salía con el día siguiente.
- `arcli ejemplos` usaba fechas fijas que quedaban fuera de la ventana de ARCA. Ahora son relativas a hoy e incluyen los datos de FCE.
- Con `config cotizacion` configurada, las facturas en pesos ya no toman esa cotización.

### Dependencias

- `@arcasdk/core` 2.0.0 → 2.0.2. La 2.0.0 validaba el total sin sumar exento ni no gravado ([ralcorta/arcasdk#190](https://github.com/ralcorta/arcasdk/issues/190)). La 2.0.2 además expone `wsfecred` y tipa `PeriodoAsoc`.

### Documentación

- Secciones nuevas en reglas de validación: moneda y cotización, IVA receptor por letra, vencimiento de pago, fecha del comprobante, crédito electrónico (FCE) y régimen FCE del receptor.
- La guía de certificados explica cómo autorizar `wsfecred`.
- Se actualizaron la referencia del CLI, entrada y salida, configuración, patrones de uso (con uno de FCE), troubleshooting, glosario, checklist de testing y `llms.txt`.

## [1.1.0] - 2026-08-24

Primera versión publicada en npm.

- Facturas, notas de crédito y notas de débito A, B y C, comunes y de crédito electrónica, por shortcut (`fc`, `nca`…) o por familia y letra (`factura c`…).
- Configuración persistente (`arcli config`), revisión del entorno (`arcli config revisar`) y `testing` como entorno por defecto.
- Vista previa antes de emitir, carga desde JSON (`--cargar`, también por lotes) y salida humana, `--json` o `--bruto`.
- `arcli ejemplos` con comandos listos para copiar.
- `llms.txt`: referencia condensada para que un agente de IA con acceso a terminal ejecute el CLI.
- Publicación con npm Trusted Publishers (OIDC).

[Sin publicar]: https://github.com/LcsGrz/arcli/compare/v2.3.0...HEAD
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
