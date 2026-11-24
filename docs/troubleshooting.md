[← Documentación](README.md)

# Problemas frecuentes

Errores frecuentes agrupados por categoría: síntoma, causa y solución.

Si usás el asistente (`arcli` sin argumentos): Configuración → Revisar configuración te dice qué falta.

## Instalación

### `npm install -g arcli` falla con `EACCES` (macOS o Linux)

- **Síntoma:** `npm ERR! code EACCES` o `permission denied` al instalar.
- **Causa:** npm quiere escribir en una carpeta del sistema.
- **Solución:** no uses `sudo`. Configurá una carpeta propia para los paquetes globales (`npm config set prefix ~/.npm-global` y sumá `~/.npm-global/bin` al `PATH`) o instalá Node con un gestor de versiones como `nvm`.

### PowerShell dice "la ejecución de scripts está deshabilitada"

- **Síntoma:** al correr `arcli` en PowerShell: `arcli.ps1 no se puede cargar porque la ejecución de scripts está deshabilitada en este sistema`.
- **Solución:** `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y volvé a abrir PowerShell, o usá el "Símbolo del sistema" (`cmd`), o abrí ARCLI con el [acceso directo](cli-reference.md#acceso-directo).

### `arcli` no se reconoce como comando

- **Síntoma:** `command not found: arcli` o "'arcli' no se reconoce como un comando interno o externo".
- **Causa:** la terminal se abrió antes de instalar, o la carpeta de los paquetes globales de npm no está en el `PATH`.
- **Solución:** cerrá y abrí la terminal. Si sigue, `npm prefix -g` te dice la carpeta: sumala al `PATH`.

## Debug rápido

Si algo no cierra, estas son las tres corridas que más ayudan:

```bash
arcli config revisar
arcli fc ayuda
arcli fc -m 1000 --cs --consumidor-final --previsualizar --json --testing
```

Con eso normalmente ves:

- si falta configuración
- si el comando está mal armado
- si el problema viene de la solicitud o de ARCA

Si la salida humana no alcanza para entender qué pasó, agregá `--json`, `--bruto` o ambos al mismo comando.

Formatos: [Entrada y salida](input-output.md).

## Config

### Falta CUIT del emisor

- **Severidad:** frecuente
- **Síntoma:** error de configuración indicando que falta el CUIT.
- **Causa:** no existe `cuit` en la config persistente.
- **Solución:**

```bash
arcli config establecer cuit 20168598204
arcli config revisar
```

- **Documentación relacionada:** [Configuración](configuration.md)

### Falta punto de venta

- **Severidad:** frecuente
- **Síntoma:** el flujo corta antes de emitir con un mensaje sobre punto de venta.
- **Causa:** no llegó `puntoVenta` por flags ni por config.
- **Solución:**

```bash
arcli config establecer puntoVenta 3
```

o bien:

```bash
arcli fc -m 1000 --pv 3 --cs --consumidor-final
```

- **Documentación relacionada:** [Configuración](configuration.md), [Referencia del CLI](cli-reference.md)

### El punto de venta no existe o está bloqueado

- **Síntoma:** ARCA rechaza el comprobante por el punto de venta, o `arcli estado` dice que no existe, está bloqueado o dado de baja.
- **Causa:** el punto de venta tiene que estar dado de alta en ARCA para tu CUIT y para factura electrónica por web service.
- **Solución:** `arcli parametros puntos-venta --produccion` lista los habilitados. Guardá uno con `arcli config establecer puntoVenta <numero>`. En testing ARCA no informa puntos de venta y cualquier número sirve.

### Certificado o clave PEM inválidos

- **Severidad:** crítico
- **Síntoma:** error indicando que la ruta apunta a un archivo con formato PEM inválido.
- **Causa:** el archivo existe, pero el contenido no parece un PEM válido.
- **Solución:** hay dos formas, según cómo cargaste el certificado:
  - **Con `arcli certificado` (recomendada):** volvé a cargar el `.crt` que bajaste de ARCA. Valida el archivo antes de guardarlo.

    ```bash
    arcli certificado importar testing.crt
    ```

  - **Si lo hiciste con openssl:** volvé a guardar las rutas correctas.

    ```bash
    arcli config establecer cert.testing /ruta/al/certificado.crt
    arcli config establecer key.testing /ruta/a/la/clave.key
    ```

- **Documentación relacionada:** [Configuración](configuration.md), [Cómo obtener los certificados de ARCA](obtencion-certificados.md)

### Al importar: el certificado no corresponde a la clave

- **Severidad:** a veces
- **Síntoma:** `arcli certificado importar` corta con `El certificado no corresponde a la clave del último pedido` (`CERTIFICATE_KEY_MISMATCH`). No se toca la config.
- **Causa:** el `.crt` se creó en ARCA con otro CSR: uno de un pedido anterior que descartaste con `--reemplazar`, uno armado en otra computadora o uno hecho con `openssl`.
- **Solución:** en ARCA, creá el certificado con el CSR del último `arcli certificado generar` (está en `certificados/<CUIT>/<entorno>.nueva.csr`, junto a la config) y volvé a importar. Si el certificado es de un par que armaste con `openssl`, configuralo con `arcli config establecer cert.<entorno>` y `key.<entorno>`.
- **Documentación relacionada:** [Comando `arcli certificado`](cli-reference.md#comando-arcli-certificado)

### Al importar: otros rechazos del certificado

- **Severidad:** a veces
- **Síntoma:** `arcli certificado generar` o `importar` corta sin tocar la config. El código del JSON dice cuál es:
  - `CERTIFICATE_REQUEST_PENDING` (`generar`): ya hay un pedido de ese entorno sin importar.
  - `CERTIFICATE_INVALID`: el archivo no tiene un certificado X.509.
  - `CERTIFICATE_CUIT_MISMATCH`: el certificado es de otro CUIT que el de la config.
  - `CERTIFICATE_EXPIRED`: el `.crt` que querés cargar ya venció.
  - `CERTIFICATE_ENVIRONMENT_UNKNOWN`: ARCLI no reconoce al emisor como una autoridad de ARCA, así que no sabe de qué entorno es.
  - `CERTIFICATE_REPLACE_CONFIRMATION`: ya había otro certificado y, sin terminal o con `--json`, no se puede preguntar.
- **Solución:** importá el certificado del pedido pendiente o descartalo con `--reemplazar`; usá el `.crt` tal como lo bajaste de ARCA, sin abrirlo ni guardarlo con otro programa; bajalo con la clave fiscal del CUIT configurado; si está vencido, generá uno nuevo; si es de ARCA, indicá el entorno con `--testing` o `--produccion`; para reemplazar sin preguntar, sumá `--reemplazar`.
- **Documentación relacionada:** [Comando `arcli certificado`](cli-reference.md#comando-arcli-certificado), [códigos de error](input-output.md#códigos-de-error)

### Certificado por vencer o vencido

- **Severidad:** crítico, si ya venció (antes es un aviso)
- **Síntoma:** a menos de 30 días de vencer cualquiera de los certificados configurados (también el de producción si trabajás en testing), cada comando que va a ARCA empieza con el aviso `El certificado de <entorno> vence el dd/mm/aaaa (en N días)` (en stderr; en el modo interactivo, un recuadro debajo de la barra). Si ya venció el del entorno que usás, el comando corta con `Certificado vencido` (`CERTIFICATE_EXPIRED` en el JSON, con `detalles.entorno` y `detalles.vencimiento`) sin llegar a ARCA.
- **Causa:** los certificados de ARCA vencen (por defecto, a los 2 años). Vencido, WSAA rechaza el login, así que no se puede emitir ni consultar en ese entorno.
- **Solución:** renovalo con `arcli certificado generar` (o en el modo interactivo: Configuración → Certificados de ARCA). Arma una clave y un pedido nuevos sin tocar los actuales, así que seguís facturando hasta cargar el certificado nuevo. Subí el CSR en ARCA, bajá el `.crt` y cargalo; si usás un alias nuevo, autorizá de nuevo los servicios web:

```bash
arcli certificado generar --produccion
arcli certificado importar produccion.crt
arcli config revisar
```

Si lo renovaste a mano, también sirve `arcli config establecer cert.produccion /ruta/al/certificado-nuevo.crt`.

- **Documentación relacionada:** [Cómo obtener los certificados de ARCA](obtencion-certificados.md), [Formato de errores](input-output.md#certificado-vencido)

### `config.json` con JSON inválido

- **Severidad:** crítico
- **Síntoma:** cualquier comando falla con `Error de configuración` ("El archivo de configuración tiene JSON inválido y no se puede leer."), con la ruta del archivo en `Ruta` (`detalles.ruta` con `--json`).
- **Causa:** el `config.json` quedó mal escrito, casi siempre por una edición a mano (una coma de más, comillas sin cerrar) o un archivo vacío.
- **Solución:** corregir el JSON a mano en esa ruta, o renombrar el archivo y volver a cargar los datos. ARCLI no lo borra ni lo pisa: lo que tenía sigue ahí para recuperarlo.

```bash
mv "<ruta>" "<ruta>.bak"
arcli config establecer cuit 20168598204
```

Después, el certificado. Si lo tenés con `arcli certificado` (recomendado), está en `certificados/<CUIT>/`, junto al `config.json`: volvé a cargarlo con `arcli certificado importar <ruta>/testing.crt`. Si lo hiciste con openssl, cargá las rutas a mano:

```bash
arcli config establecer cert.testing /ruta/al/certificado.crt
arcli config establecer key.testing /ruta/a/la/clave.key
```

O abrí `arcli` y elegí "Configuración" para la configuración guiada.

- **Documentación relacionada:** [Configuración](configuration.md)

## Validación

### Falta un dato obligatorio

- **Severidad:** frecuente
- **Síntoma:** `INPUT_VALIDATION_ERROR` o mensaje como `Falta el dato: monto.`
- **Causa:** falta un dato obligatorio en flags o JSON.
- **Solución:** revisar `ayuda` del comando puntual y completar los campos faltantes.

```bash
arcli fc ayuda
```

- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### Clave desconocida o tipo incorrecto en el JSON de `--cargar`

- **Severidad:** frecuente
- **Síntoma:** `INPUT_VALIDATION_ERROR` (o `BATCH_VALIDATION_ERROR` en un lote) con `La clave "montototal" no existe: ¿quisiste decir "montoTotal"?` o `"puntoVenta" tiene que ser un número y llegó el texto "3".`
- **Causa:** el JSON trae una clave que ARCLI no conoce (un typo o el nombre de un flag, como `vencimiento` en vez de `vencimientoPago`) o un valor con otro tipo (un número entre comillas, `"true"` en vez de `true`, `null`).
- **Solución:** usá la clave que sugiere el mensaje y escribí los números sin comillas. La lista completa está en [entrada y salida](input-output.md#campos-soportados).

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

### Falta la cotización en moneda extranjera

- **Severidad:** frecuente
- **Síntoma:** `Falta la cotización de USD.`
- **Causa:** se pasó `--moneda USD` con `--cm 1`. Sin `--cm`, ARCLI usa la cotización oficial de ARCA.
- **Solución:** pasar `--cm <cotización>` con la acordada, sacar `--cm` para usar la oficial, o `--misma-moneda` si te pagan en dólares.
- **Documentación relacionada:** [Moneda y cotización](validation-rules.md#moneda-y-cotización)

### El comprobante no admite el IVA receptor

- **Severidad:** frecuente
- **Síntoma:** `La factura B no admite IVA receptor "responsable-inscripto". Usá un comprobante letra A.`
- **Causa:** ARCA solo acepta ciertas condiciones IVA para cada letra. Por ejemplo, la `A` es para responsables inscriptos y monotributistas, y la `B` para el resto.
- **Solución:** usar la letra que sugiere el error, o corregir el IVA receptor.
- **Documentación relacionada:** [IVA receptor](validation-rules.md#iva-receptor)

### Consumidor final sin identificar desde $ 10.000.000

- **Severidad:** ocasional
- **Síntoma:** `... de $ 10.000.000 o más requiere identificar al consumidor final.`
- **Causa:** la RG 5700/2025 obliga a identificar al consumidor final desde ese monto.
- **Solución:** reemplazar `--consumidor-final` por `--dni`, `--cuit` o `--cuil`, manteniendo `--ir-cf`. En el modo interactivo no hace falta: desde ese monto el asistente pide el documento.
- **Documentación relacionada:** [Consumidor final](validation-rules.md#consumidor-final)

### Fecha del comprobante fuera de rango

- **Severidad:** ocasional
- **Síntoma:** `La fecha ... está fuera de rango ...` o `... es futura y cae en otro mes.`
- **Causa:** ARCA solo acepta fechas cercanas a hoy: ±5 días en productos, ±10 en servicios y de −5 a +1 en FCE.
- **Solución:** usar una fecha dentro de la ventana, o no pasar `--fecha` para usar la de hoy.
- **Documentación relacionada:** [Fecha del comprobante](validation-rules.md#fecha-del-comprobante)

### Vencimiento de pago anterior a la fecha

- **Severidad:** ocasional
- **Síntoma:** `El vencimiento de pago (...) no puede ser anterior al ...`
- **Causa:** `FchVtoPago` tiene que ser igual o posterior a la fecha del comprobante. En FCE, también a la de hoy.
- **Solución:** pasar un `--vencimiento` posterior.
- **Documentación relacionada:** [Vencimiento de pago](validation-rules.md#vencimiento-de-pago-fchvtopago)

### Factura FCE sin CBU

- **Severidad:** frecuente
- **Síntoma:** `La factura de crédito electrónica ... requiere el CBU del emisor.`
- **Causa:** ARCA exige el CBU del emisor en toda factura FCE (10168).
- **Solución:** pasar `--cbu <22 dígitos>` o configurarlo una vez con `arcli config establecer cbu <22 dígitos>`.
- **Documentación relacionada:** [Crédito electrónico (FCE)](validation-rules.md#crédito-electrónico-fce)

### CBU con el dígito verificador mal

- **Severidad:** ocasional
- **Síntoma:** `El CBU no es válido: no coincide el dígito verificador del bloque de banco y sucursal (los primeros 8 dígitos).` (o `del bloque de la cuenta (los últimos 14 dígitos)`).
- **Causa:** algún dígito del CBU está mal escrito o cambiado de lugar. ARCLI controla los dos dígitos verificadores antes de ir a ARCA.
- **Solución:** copiá el CBU de nuevo desde el home banking o la constancia del banco. El mensaje dice en qué bloque está el error.
- **Si está en la config:** cualquier comando frena con `El CBU guardado en la config no es válido: …` y el bloque que falla. Cambialo con `arcli config establecer cbu <CBU>`, que corre aunque la config tenga el CBU mal.
- **Documentación relacionada:** [Crédito electrónico (FCE)](validation-rules.md#crédito-electrónico-fce)

### NC/ND: ARCA no tiene el asociado

- **Severidad:** ocasional
- **Síntoma:** `ARCA no tiene la factura B 00003-00099999.` En NC/ND FCE sin `--afecha`: `ARCA no tiene la factura de crédito electrónica ..., así que no se puede tomar su fecha.`
- **Causa:** antes de la vista previa, arcli consulta en ARCA el asociado propio de la nota (A, B, C, FCE y `E`) y no existe en un punto de venta de web service tuyo. En NC/ND FCE, además, ARCA exige la fecha del asociado (10158) y sin `--afecha` arcli la toma de esa consulta. Hasta la 2.5.0, una nota A, B o C con un asociado inexistente se emitía: ARCA testing llega a aprobarla.
- **Solución:** revisar `--ac`, `--apv` y `--ar`: tienen que apuntar a un comprobante tuyo ya emitido (`arcli ultimos <atajo>` lista los últimos). En la `E`, si ARCA no respondió o contestó con un error o sin los datos, la nota frena. En A, B, C y FCE, si ARCA no respondió o contestó con un error, sale el aviso `No se pudo verificar en ARCA …` (o `No se pudo consultar … y el punto de venta … no es de web service`, si es de otro sistema) y la nota se puede emitir igual, pero una nota FCE sin `--afecha` frena: reintentar o pasar la fecha con `--afecha`.
- **Asociado de Comprobantes en línea o de un controlador fiscal (A, B, C y FCE):** si el punto de venta del asociado no es de web service, ARCA no lo tiene para consultar pero lo acepta como asociado. La nota no frena: sale el aviso `No se encontró la factura … en ARCA y el punto de venta … no es de web service`, sin controlar el tope de la NC. Pasá su fecha con `--afecha` (ARCA la exige para controlador fiscal y FactuWeb, error 10211; en NC/ND FCE ARCLI la pide siempre). En el modo interactivo, ingresá el número a mano: el asistente pregunta los datos que no puede copiar. En la 2.5.1 esto frenaba con `ARCA no tiene …`.
- **Documentación relacionada:** [Comprobantes asociados](validation-rules.md#comprobantes-asociados)

### La nota de crédito supera el total de la factura

- **Severidad:** ocasional
- **Síntoma:** `La nota de crédito por $ 150.000 no puede superar el total de la factura C 00003-00000045, de $ 120.000.`
- **Causa:** antes de la vista previa, arcli consulta el asociado en ARCA y la NC es mayor que su total (en la misma moneda). Pasa igual en A, B, C, FCE y `E`. No se emite nada.
- **Solución:** bajar `--monto` (la sugerencia trae el `--monto` para anularla entera) o revisar `--ar` y `--apv`, por si apuntan a otra factura.
- **Documentación relacionada:** [Crédito electrónico (FCE)](validation-rules.md#crédito-electrónico-fce)

### La suma de las alícuotas no coincide con el total

- **Severidad:** ocasional
- **Síntoma:** `La suma de las alícuotas (...) no coincide con lo gravado del monto total (...)`.
- **Causa:** con varias `--alicuota TASA:MONTO`, cada monto lleva el IVA incluido, y la suma más `--exento` y `--nogravado` tiene que dar `--monto`.
- **Solución:** sacar `--monto` (el total se calcula solo) o corregir los montos.
- **Documentación relacionada:** [Varias alícuotas](validation-rules.md#varias-alícuotas-en-un-comprobante)

### Exento o no gravado mayor al total

- **Severidad:** ocasional
- **Síntoma:** `El importe exento más el no gravado no puede superar el monto total.`
- **Causa:** `--monto` es el total del comprobante, y `--exento` y `--nogravado` son partes de ese total.
- **Solución:** pasar en `--monto` el total, incluidos exento y no gravado.
- **Documentación relacionada:** [IVA automático](validation-rules.md#iva-automático)

### `wsfe` no autorizado

- **Severidad:** frecuente, la primera vez
- **Síntoma:** error `WSFE_SERVICE_NOT_AUTHORIZED` ("El certificado no está autorizado para facturar (servicio wsfe).") al facturar o con `ultimos`, `consultar` y `parametros`. Con `estado` es `ARCA_UNAVAILABLE` con el mismo texto.
- **Causa:** sacaste e importaste el certificado, pero falta autorizarlo a facturar en ARCA.
- **Solución:** en testing, WSASS → "Crear autorización a servicio" con el mismo nombre del certificado y el servicio `wsfe`; en producción, el Administrador de Relaciones de Clave Fiscal. Con un solo comprobante no se emitió nada: después de autorizarlo, reintentá igual. En un lote, mirá [El lote se interrumpió a mitad](#el-lote-se-interrumpió-a-mitad).
- **Documentación relacionada:** [Autorizar el servicio web](certificado-testing-completa.md#3-autorizar-el-servicio-web)

### `wsfecred` no autorizado

- **Severidad:** frecuente, si usás `fce-obligado`, `verificarFce` o notas FCE con `--anulacion`
- **Síntoma:** `El certificado no está autorizado para el servicio wsfecred ...` (ARCA responde `coe.notAuthorized`). En una nota FCE con `--anulacion` sale como aviso en la vista previa y la nota se puede emitir igual.
- **Causa:** el certificado solo tiene autorizado `wsfe`. La consulta del régimen FCE y la del Registro de FCE usan otro servicio.
- **Solución:** crear la autorización para `wsfecred` igual que la de `wsfe`, en WSASS (testing) o en el Administrador de Relaciones (producción). Si no la necesitás, desactivá el chequeo con `arcli config eliminar verificarFce`.
- **Documentación relacionada:** [Autorizar el servicio web](certificado-testing-completa.md#3-autorizar-el-servicio-web)

### `ws_sr_constancia_inscripcion` no autorizado

- **Severidad:** frecuente, si usás `arcli padron` o facturás con `--cuit` sin `--ir`
- **Síntoma:** `arcli padron` falla con `El certificado no está autorizado para el servicio ws_sr_constancia_inscripcion ...`. Al facturar no corta: aparece el aviso `No se pudo consultar el padrón de ARCA` y se usa el `ivaReceptor` de la config.
- **Causa:** el certificado solo tiene autorizado `wsfe`. El padrón usa otro servicio.
- **Solución:** crear la autorización para `ws_sr_constancia_inscripcion` igual que la de `wsfe`. Si no la necesitás, desactivá la consulta con `arcli config establecer consultarPadron false`.
- **Documentación relacionada:** [IVA receptor desde el padrón](cli-reference.md#iva-receptor-desde-el-padrón)

## ARCA

### `dh key too small` en producción

- **Severidad:** a veces
- **Síntoma:** en una versión anterior de ARCLI, los comandos de producción fallan con `dh key too small` o `ERR_SSL_DH_KEY_TOO_SMALL`, con certificado, clave y punto de venta correctos. En testing andan.
- **Causa:** WSFE y WSFEX de producción prefieren un intercambio DHE con una clave de 1024 bits, y OpenSSL la rechaza con `SECLEVEL=2`, el nivel de Debian 13 y otras distros.
- **Solución:** actualizar ARCLI. Si no podés, corré el CLI con `node --tls-cipher-list='DEFAULT:!DHE' "$(which arcli)"` más los argumentos de siempre.
- **Documentación relacionada:** [Arquitectura](architecture.md)

### `coe.alreadyAuthenticated`

- **Severidad:** frecuente
- **Síntoma:** error WSAA con `coe.alreadyAuthenticated`.
- **Causa:** ya existe un ticket válido para ese servicio.
- **Solución:** esperar un par de minutos y reintentar sin cambiar la solicitud.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Limitaciones actuales](limitations.md)

### `Transacción Activa`

- **Severidad:** frecuente
- **Síntoma:** error ARCA con referencia a transacción activa.
- **Causa:** ARCA informa una operación transitoria en curso.
- **Solución:** esperar unos segundos y reintentar antes de modificar el comprobante. Si apareció al emitir, sale como `EMISSION_UNCERTAIN`: verificá primero con `arcli ultimos` (ver abajo).
- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Limitaciones actuales](limitations.md)

### No se pudo confirmar la emisión (`EMISSION_UNCERTAIN`)

- **Severidad:** crítico
- **Síntoma:** "No se pudo confirmar la emisión: …" al emitir.
- **Causa:** falló la llamada que emite en ARCA (red, timeout, transacción activa) o de lo que contestó no se puede saber si se emitió: una respuesta ilegible o vacía, un resultado aprobado sin CAE, o un error interno (500 o 501) sin CAE; el mensaje dice qué contestó. ARCA pudo haber autorizado el comprobante y perderse la respuesta. Si el error es del login en WSAA (certificado no autorizado; uno vencido corta antes con `CERTIFICATE_EXPIRED`) o del pedido del último número, no sale este error sino el original: ahí no se emitió nada y alcanza con corregir y reintentar.
- **Solución:** **no reintentes todavía**. Corré el `arcli ultimos <tipo> --pv <n> --<entorno>` que muestra la sugerencia, con el entorno incluido (sin él, se consulta el de la config): si el comprobante figura, ya está emitido y no hay que repetirlo; si no figura, reintentá. En la `E` (`fe`, `nce`, `nde`) la sugerencia verifica con `arcli consultar <tipo> <número> --pv <n> --<entorno>`; si no figura, reintentá con el mismo `--numero` e `--id-solicitud` que muestra la sugerencia: ARCA no autoriza dos veces el mismo número.
- **Documentación relacionada:** [Entrada y salida](input-output.md#emisión-sin-confirmar)

### No se pudo consultar un comprobante (`ARCA_VOUCHER_QUERY_ERROR`)

- **Severidad:** ocasional
- **Síntoma:** `ARCA devolvió un error al consultar el comprobante 00003-00000099 y no se sabe si existe: …` (o `una respuesta inesperada`) con `ultimos` o `consultar`, con el asociado de una nota `E` o en el asistente. En la `E` solo sale `una respuesta inesperada`: un error de ARCA es `ARCA_EXPORT_ERROR`. En una nota A, B, C o FCE sale como aviso, sin ese código: `No se pudo verificar en ARCA …`.
- **Causa:** ARCA contestó la consulta con un error que no es el 602 (el que dice que no existe; en la `E`, el 1020) o con una respuesta inesperada, sin los datos del comprobante (en la `E`, número, tipo de exportación o moneda). Hasta la 2.6.0, `consultar` daba `VOUCHER_NOT_FOUND` y `ultimos` mostraba una lista vacía o incompleta.
- **Solución:** leer el mensaje de ARCA: si es pasajero, volver a consultar en unos minutos; si no, corregir lo que dice. Si se repite, no insistir. Si estabas verificando una emisión sin confirmar, **no la reintentes** hasta ver si el comprobante existe: se puede duplicar. En una nota A, B, C o FCE, si el punto de venta del asociado no es de web service, el aviso lo dice y la nota sigue: pasá su fecha con `--afecha`.
- **Documentación relacionada:** [Entrada y salida](input-output.md#códigos-de-error)

### El receptor coincide con el emisor

- **Severidad:** ocasional
- **Síntoma:** `El receptor no puede ser el mismo CUIT que emite (...): ARCA lo rechaza (error 10069).` Si llega a ARCA, el error es `Campo DocNro no puede ser igual al del emisor.`
- **Causa:** se está usando el mismo CUIT como emisor y receptor, casi siempre por copiar el CUIT de la config en `--cuit`.
- **Solución:** poné el CUIT de tu cliente. En testing, uno de los CUITs de prueba.
- **Documentación relacionada:** [Identidad del receptor](validation-rules.md#identidad-del-receptor)

### El comprobante excede el tope de tu categoría de Monotributo

- **Severidad:** ocasional, solo monotributistas y no es un rechazo
- **Síntoma:** el comprobante sale aprobado u observado con la observación `10236` ("El monto del comprobante emitido, excede el límite establecido para su categoría de Monotributo") o `10235` ("excede el límite establecido para la categoría máxima de Monotributo"). Con CAEA son la `817` y la `816`.
- **Causa:** ARCA compara el importe del comprobante con el tope de tu categoría (o de la máxima). No es un rechazo: el comprobante está emitido.
- **Solución:** con la `10236`, tenelo en cuenta para la próxima recategorización. Con la `10235`, ARCA avisa que quedarías excluido del Monotributo y que tendrías que darte de alta en el régimen general: consultalo con tu contador. Los topes de cada categoría están en `arcli monotributo`.
- **Documentación relacionada:** [Rechazos de ARCA por código](#rechazos-de-arca-por-código)

### Observaciones de padrón

- **Severidad:** frecuente
- **Síntoma:** el comprobante aprueba, pero devuelve observaciones como `10217` o `10017`.
- **Causa:** la condición del receptor en el padrón de ARCA:
  - `10217`: el receptor de una factura A está activo como monotributista. ARCA la aprueba con la leyenda "El crédito fiscal discriminado en el presente comprobante solo podrá ser computado a efectos del Procedimiento permanente de transición al Régimen General". En testing sale también con CUITs que no son monotributistas.
  - `10017`: el CUIT del receptor de una factura A no figura activo en el padrón de ARCA.
- **Solución:** no son rechazos: si el comprobante salió `observado`, está emitido. Revisá el receptor con `arcli padron <cuit>` y si le corresponde la letra.
- **Documentación relacionada:** [Limitaciones actuales](limitations.md)

### El receptor no está en los padrones de ARCA

- **Severidad:** frecuente, en testing
- **Síntoma:** el comprobante sale `rechazado` con la observación "… DocNro 20201797064 no se encuentra registrado en los padrones de AFIP …" (código `10015`) y `errores` vacío.
- **Causa:** ARCA no encuentra el documento del receptor. En testing, el padrón de facturación es otro que el de `arcli padron`, y muchos CUITs que este encuentra no están.
- **Solución:** revisar `--cuit`, `--cuil` o `--dni` (o el documento del JSON de `--cargar`). En testing, usar un CUIT de prueba, como `20333333334`, o emitir a consumidor final. No se emitió nada.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### ARCA rechaza por punto de venta

- **Severidad:** frecuente, en producción
- **Síntoma:** el comprobante sale `rechazado` con el error `10005` ("El punto de venta informado debe estar dado de alta y ser del tipo RECE"), y la sugerencia habla de un punto de venta para web service. `arcli estado --produccion` dice que el punto de venta no está habilitado para web service.
- **Causa:** el punto de venta configurado no es de web service. Pasa con los de Comprobantes en línea ("Factura en línea"), Facturador o talonarios manuales. Desde el 1/11/2026, por la RG 5893/2026, ARCA da de alta de oficio un punto de venta "Factura en línea - Monotributo" a los monotributistas que no tienen uno electrónico: ese tampoco sirve para ARCLI.
- **Solución:** `arcli parametros puntos-venta --produccion` lista los habilitados para web service. Si el tuyo no está, creá uno nuevo con sistema de web services en "Administración de puntos de venta y domicilios" y guardalo con `arcli config establecer puntoVenta <numero>`.
- **Documentación relacionada:** [Punto de venta para web service](certificado-produccion-completa.md#punto-de-venta-para-web-service)

### ARCA rechaza la nota FCE de anulación

- **Severidad:** frecuente, en notas FCE con `--anulacion`
- **Síntoma:** la NC o ND FCE con `--anulacion` sale `rechazada` con el error `10154` ("Comprobante electronico autorizado, NO rechazado por el Comprador"). Antes, la vista previa ya avisa que el comprador no rechazó el asociado en el Registro de FCE.
- **Causa:** una nota de anulación solo vale si el comprador rechazó antes el comprobante asociado en el Registro de Facturas de Crédito Electrónica. Si lo recibió y no lo rechazó, o ya lo aceptó, ARCA rechaza la nota. Una nota sobre otra nota FCE siempre es de anulación, así que la nota asociada también tiene que estar rechazada.
- **Solución:** pedile al comprador que rechace el comprobante en el Registro de FCE (en el servicio "Sistema de Cuentas Corrientes de Facturas de Crédito Electrónica MiPyMEs" de ARCA) y volvé a emitir. Si la nota no es una anulación (por ejemplo, un ajuste de precio sobre una factura aceptada), emitila sin `--anulacion`. Un rechazo no emite nada.
- **Documentación relacionada:** [Factura de Crédito Electrónica](fce.md)

### Rechazos de ARCA por código

Cuando ARCA rechaza o deja una observación con alguno de estos códigos, `sugerencias` del JSON (y el panel de la salida humana) dice qué pasó y qué hacer. Los que ARCLI valida antes de enviar (por ejemplo, la ventana de fechas o el IVA receptor por letra) casi nunca llegan a ARCA, pero si llegan, el texto es el mismo.

| Código          | Qué pasó                                                                                                                                                                       | Qué hacer                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `10005`/`11002` | El punto de venta no está habilitado para web service                                                                                                                          | Ver [ARCA rechaza por punto de venta](#arca-rechaza-por-punto-de-venta)                                                                                                                                  |
| `10016`         | El número no es el próximo a autorizar (otro comprobante del mismo tipo y punto de venta se emitió en el medio), o la fecha está fuera del rango o es anterior a la del último | Mirá el último con `arcli ultimos` y reintentá; si emitís varios, de a uno (ver [Limitaciones](limitations.md)). La fecha: [Fecha del comprobante fuera de rango](#fecha-del-comprobante-fuera-de-rango) |
| `10152`         | En productos o FCE, la fecha es futura y cae en otro mes                                                                                                                       | Ver [Fecha del comprobante fuera de rango](#fecha-del-comprobante-fuera-de-rango)                                                                                                                        |
| `10243`         | El IVA receptor no es válido para la letra                                                                                                                                     | Ver [El comprobante no admite el IVA receptor](#el-comprobante-no-admite-el-iva-receptor)                                                                                                                |
| `10154`         | La nota FCE de anulación necesita que el comprador haya rechazado antes el asociado, y no lo rechazó                                                                           | Ver [ARCA rechaza la nota FCE de anulación](#arca-rechaza-la-nota-fce-de-anulación)                                                                                                                      |
| `10174`         | El CBU de la factura FCE no está registrado a nombre del emisor                                                                                                                | Usá un CBU propio registrado en ARCA (`--cbu` o la clave `cbu`)                                                                                                                                          |
| `10119`         | La cotización está fuera del rango que acepta ARCA: entre el 2 % y el 500 % de la oficial                                                                                      | Revisá `--cotizacion-moneda` contra `arcli parametros cotizacion <moneda>`                                                                                                                               |
| `10038`         | Con `--misma-moneda`, la cotización enviada ya no es la oficial exacta                                                                                                         | Volvé a emitir: ARCLI consulta la oficial en ese momento                                                                                                                                                 |
| `10017`         | El CUIT del receptor de una A no figura activo en el padrón; el comprobante puede estar aprobado                                                                               | Ver [Observaciones de padrón](#observaciones-de-padrón)                                                                                                                                                  |
| `10217`         | El receptor de una A es monotributista: el crédito fiscal solo se computa por el Procedimiento permanente de transición. El comprobante está aprobado                          | Ver [Observaciones de padrón](#observaciones-de-padrón)                                                                                                                                                  |
| `10069`         | El receptor es el mismo CUIT que emite                                                                                                                                         | Ver [El receptor coincide con el emisor](#el-receptor-coincide-con-el-emisor)                                                                                                                            |
| `10236`/`817`   | El importe del comprobante excede el límite de tu categoría de Monotributo. El comprobante está emitido                                                                        | Ver [El comprobante excede el tope de tu categoría de Monotributo](#el-comprobante-excede-el-tope-de-tu-categoría-de-monotributo)                                                                        |
| `10235`/`816`   | El importe del comprobante excede el límite de la categoría máxima del Monotributo. El comprobante está emitido                                                                | Ver [El comprobante excede el tope de tu categoría de Monotributo](#el-comprobante-excede-el-tope-de-tu-categoría-de-monotributo)                                                                        |

También se reconocen por el mensaje, sin código: receptor igual al emisor (si llega sin el `10069`), `Transacción Activa`, receptor que no está en los padrones (ver [El receptor no está en los padrones de ARCA](#el-receptor-no-está-en-los-padrones-de-arca)), CUIT receptor inexistente y detalle de IVA obligatorio. Si ARCA rechaza con otro código, `sugerencias` pide revisar `errores` y `observaciones`.

- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Entrada y salida](input-output.md)

### Factura E: el número no es el que sigue

- **Severidad:** ocasional, solo si pasás `--numero` a mano
- **Síntoma:** ARCA rechaza la `E` con un error de correlatividad del número.
- **Causa:** WSFEX numera por punto de venta y tipo de comprobante, y el número tiene que ser el siguiente al último autorizado.
- **Solución:** sacá `--numero`: ARCLI consulta el último en ARCA (`FEXGetLast_CMP`) y usa el siguiente. Para ver los últimos, `arcli ultimos fe` (o `nde`, `nce`). Un rechazo no emite nada.
- **Documentación relacionada:** [Referencia del CLI](cli-reference.md#factura-de-exportación-e-wsfex)

### Factura E: la fecha está fuera de rango o es anterior a la de la última

- **Severidad:** ocasional, con `--fecha`
- **Síntoma:** `La fecha del comprobante (...) está fuera de lo que acepta ARCA: del ... al ... (error 1500).`, o ARCA rechaza con el error 1535 una `E` con fecha anterior a la de la última del mismo punto de venta y tipo.
- **Causa:** la `E` y sus notas aceptan de 5 días antes a 5 días después de hoy y, en servicios, no después del fin de mes (error 1500). Además, ARCA controla la secuencia con la fecha: después de una `E` con fecha futura, las siguientes de ese punto de venta y tipo tienen que llevar esa fecha o una posterior (error 1535). La vista previa lo avisa.
- **Solución:** usá una fecha dentro de la ventana; si ya emitiste una con fecha futura, emití las siguientes con esa fecha o una posterior, o esperá a ese día.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e)

### Factura E: la actividad no está en la tabla de WSFEX

- **Severidad:** frecuente, la primera vez que se emite una `E` con actividad
- **Síntoma:** `La actividad 620900 no está en la tabla de actividades de WSFEX y ARCA la rechaza (error 2105).`
- **Causa:** la actividad es opcional (sin `--actividad` ni `exportacion.actividad`, la `E` va sin ella), pero si la informás, ARCA solo acepta los códigos de su propia tabla (`FEXGetPARAM_Actividades`), que **no es la del padrón y es más chica**: por ejemplo, `620900` (servicios de informática N.C.P.) no está; para informática están `620100` (consultores en informática y suministros de programas) y `620300` (consultores en tecnología de la información).
- **Solución:** elegí la que corresponda a tu actividad declarada (el error lista las que empiezan igual) y guardala con `arcli config establecer exportacion.actividad <codigo>`, o pasala con `--actividad`.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e), [Configuración](configuration.md)

### Factura E: el certificado no está autorizado a `wsfex`

- **Severidad:** frecuente, la primera vez
- **Síntoma:** error `WSFEX_SERVICE_NOT_AUTHORIZED` ("El certificado no está autorizado para el servicio wsfex"), incluso con `--previsualizar`, y con `ultimos` y `consultar` de `fe`, `nce` y `nde`.
- **Causa:** la vista previa ya consulta las tablas de WSFEX, y el certificado no tiene la relación con el servicio `wsfex`.
- **Solución:** autorizá el certificado a `wsfex` igual que a `wsfe` (WSASS en testing, Administrador de Relaciones en producción), o configurá uno propio con `exportacion.cert.*` y `exportacion.key.*`.
- **Documentación relacionada:** [Configuración](configuration.md#certificados-de-exportación-wsfex), [Obtención de certificados](obtencion-certificados.md)

### Factura E: la cotización no es la del día

- **Severidad:** frecuente, casi siempre con la fecha de hoy
- **Síntoma:** aviso `ARCA no publicó la cotización de DOL del <fecha>: se usa la del <fecha anterior>`.
- **Causa:** la `E` usa la cotización de aduana de WSFEX (`FEXGetPARAM_MON_CON_COTIZACION`), que ARCA publica una vez por día. Mientras no sale la de hoy, se usa la última publicada.
- **Solución:** no hace falta hacer nada. Para fijar otra cotización, pasá `--cotizacion-moneda <valor>` (o `--cm`).
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e)

### Factura E: ARCA no reconoce el permiso de embarque

- **Severidad:** ocasional, en exportaciones de bienes
- **Síntoma:** `ARCA dice que el permiso de embarque <permiso> no es válido para el destino <país>: rechazaría el comprobante.` (`INPUT_VALIDATION_ERROR`, con los permisos en `detalles.permisos`), incluso con `--previsualizar`.
- **Causa:** antes de la vista previa, ARCLI consulta cada `--permiso` en ARCA (`FEXCheck_Permiso`) con el país de destino, y ARCA contestó que esa destinación no existe en la Aduana o es de otro destino. No se emitió nada.
- **Solución:** revisá el número del permiso (16 caracteres, como figura en la destinación de la Aduana) y que `--pais-destino` sea el de la mercadería.
- **Si en cambio sale el aviso** `No se pudo verificar el permiso de embarque…`, ARCA no respondió la consulta: el comprobante se puede emitir igual, pero revisá el permiso, porque si es incorrecto ARCA lo rechaza al emitir. En testing ARCA contesta `OK` a cualquier permiso, así que la verificación solo sirve en producción.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e), [Entrada y salida](input-output.md)

### Factura E de servicios: la cotización es la del día anterior

- **Severidad:** frecuente, en servicios (`--tipo-expo 2`, el default) y con `--misma-moneda`
- **Síntoma:** la vista previa trae la cotización del día anterior a la fecha del comprobante, o un aviso `En servicios ARCA exige la cotización de DOL del día hábil anterior…` con la del último día hábil. Con una versión anterior a la 2.5.2, ARCA rechazaba la `E` de servicios con el error 2053 ("Cotizacion informada no valida. (FechaCot utilizada: …)").
- **Causa:** en servicios ARCA exige la cotización del día hábil anterior a la fecha de emisión (error 2053), y con `--misma-moneda` también.
- **Solución:** no hace falta hacer nada: ARCLI ya pide esa. Con `--cotizacion-moneda` en servicios (o con `--misma-moneda`), tiene que ser exactamente esa cotización: si no coincide, ARCLI frena antes con `INPUT_VALIDATION_ERROR` y la que corresponde. Sacá `--cotizacion-moneda`.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e)

## Batch

### El lote tiene comprobantes inválidos

- **Severidad:** frecuente
- **Síntoma:** `BATCH_VALIDATION_ERROR` con la lista de ítems inválidos (`#2: Falta el dato: monto.`…). No se emitió ninguno.
- **Causa:** ARCLI valida todo el lote antes de emitir el primero, incluidas las consultas al padrón (IVA receptor desde `--cuit`) y a la cotización oficial.
- **Solución:** corregir esos ítems en el JSON y volver a correr el lote completo. Si el motivo es una consulta a ARCA que no respondió, reintentá en unos minutos.
- **Documentación relacionada:** [Entrada y salida](input-output.md#validación-y-errores-del-lote)

### El lote se interrumpió a mitad

- **Severidad:** crítico
- **Síntoma:** se ven los resultados de algunos comprobantes (con su PDF, si corresponde) y después `BATCH_EMISSION_ERROR` ("El lote se interrumpió en el comprobante #3…").
- **Causa:** la emisión falló a mitad del lote (red, ARCA, transacción activa).
- **Solución:** **no vuelvas a cargar los que ya se emitieron** (los procesados con CAE; un rechazado no se emitió), porque se duplicarían. Si el JSON trae `sinConfirmar`, el que falló puede haberse emitido igual: verificalo con el comando que trae el mensaje (`arcli ultimos <tipo> --pv <n> --<entorno>`) y sumalo solo si no figura. Si no lo trae, no se emitió y está en "Sin procesar" (`sinProcesar`). Armá un lote con los de `sinProcesar` (y el sin confirmar, si no figura) y reintentá. Si el que falló fue por "Transacción Activa", esperá unos segundos.
- **Documentación relacionada:** [Entrada y salida](input-output.md#validación-y-errores-del-lote)

## Terminal

### Los bordes de los paneles se ven como `?` o cuadraditos

- **Severidad:** ocasional, en terminales viejas (como el `cmd` clásico de Windows) o fuentes sin caracteres de caja
- **Síntoma:** los bordes de los paneles muestran `?`, `�` o cuadrados en lugar de líneas.
- **Causa:** la terminal o la fuente no tiene los caracteres de caja Unicode que usa ARCLI (`╒`, `┃`, `╏`, `╓`, `╌`, `┈`, `━`, `▎`…).
- **Solución:** usar una terminal moderna (Windows Terminal, iTerm2, la de VS Code) o activar los bordes y símbolos ASCII con `ARCLI_ASCII=1`. También cambia los símbolos del modo interactivo (`✔`, `❯`, `↑↓`); las tildes y la `ñ` se mantienen.

```bash
ARCLI_ASCII=1 arcli fc -m 1000 --cs --cfinal
```

- **Documentación relacionada:** [Variables de entorno](configuration.md#variables-de-entorno)

### No se pudo escribir toda la salida (`OUTPUT_WRITE_ERROR`)

- **Severidad:** ocasional, crítico al emitir
- **Síntoma:** "No se pudo escribir toda la salida: no queda espacio en el disco." (o un código del sistema, como `EIO`), y el comando sale con `1`, o con `2` si hubo un rechazo. Si lo que falló es stderr, "No se pudieron escribir todos los avisos y errores: …". Con `--json` y stdout roto, `OUTPUT_WRITE_ERROR`, o el error que el comando ya daba con esto en su `sugerencia`. Si solo entró una parte, la salida puede quedar cortada sin ningún aviso.
- **Causa:** la salida va a un archivo en un disco lleno, o la terminal o el archivo dejaron de aceptar escrituras.
- **Solución:** el comando terminó igual lo que hacía (el asistente, en cambio, para: no emite nada más ni genera el PDF si falta preguntar sus datos, y el aviso dice de cuál no se generó; no se puede generar después): si emitió, el aviso dice los números con CAE y el comando para verlos (`arcli ultimos <tipo> --pv <n> --cantidad <n> --<entorno>`). **No los vuelvas a emitir.** Liberá espacio y buscalos con ese comando. Si no hay aviso, o hay también un `EMISSION_UNCERTAIN` o un lote cortado con uno sin confirmar, no se sabe: verificá con `arcli ultimos` antes de reintentar.
- **Documentación relacionada:** [Entrada y salida](input-output.md#formato-de-errores)

## Acceso directo

### No se encontró el escritorio o la carpeta no existe

- **Síntoma:** "No se encontró el escritorio en …" o "La carpeta … no existe".
- **Causa:** el sistema no informa un escritorio (pasa en servidores o en Linux sin entorno gráfico) o la ruta que indicaste no existe. ARCLI no crea carpetas.
- **Solución:** indicá una carpeta que exista.

```bash
arcli acceso-directo ~/Documentos
```

### Ya existe y no lo creó ARCLI

- **Síntoma:** "… ya existe y no lo creó ARCLI".
- **Causa:** en macOS y Linux ARCLI solo reemplaza el `ARCLI.app` o `ARCLI.desktop` que creó él. En Windows reemplaza `ARCLI.lnk` sin preguntar.
- **Solución:** borrá ese archivo o creá el acceso directo en otra carpeta.

### `DESKTOP_SHORTCUT_ERROR`

- **Síntoma:** "No se pudo crear el acceso directo en …" (solo en Windows).
- **Causa:** el acceso directo `.lnk` lo crea PowerShell. Falla si no tenés permiso de escritura en la carpeta o si PowerShell está bloqueado.
- **Solución:** probá en una carpeta tuya, por ejemplo `arcli acceso-directo %USERPROFILE%\Documents`, o pedile a quien administra la máquina que habilite PowerShell.

### En Linux el escritorio dice que el lanzador no es confiable

- **Síntoma:** al hacer doble clic en `ARCLI.desktop` aparece "lanzador no confiable" o se abre como texto.
- **Causa:** ARCLI lo marca como confiable con `gio`. Si `gio` no está o el escritorio no lo respeta, queda sin marcar.
- **Solución:** clic derecho sobre el ícono y "Permitir ejecutar".

### El ícono dejó de abrir ARCLI

- **Síntoma:** la ventana dice "ARCLI terminó con un error" o se cierra enseguida.
- **Causa:** el acceso directo guarda las rutas de Node y de ARCLI del momento en que se creó. Si después moviste o reinstalaste Node (por ejemplo, con otra versión) o desinstalaste ARCLI, esas rutas ya no existen.
- **Solución:** volvé a crearlo con `arcli acceso-directo`. Reemplaza al anterior.
- **Documentación relacionada:** [Acceso directo](cli-reference.md#acceso-directo)

### El ícono dice "No se encontró ARCLI instalado"

- **Síntoma:** al abrir el ícono aparece "No se encontró ARCLI instalado".
- **Causa:** no hay un `arcli` instalado que el acceso directo pueda abrir. Pasa si lo creaste desde el código fuente (`yarn dev acceso-directo`) sin tener ARCLI instalado, o si cambiaste de versión de Node (por ejemplo con nvm) y ARCLI quedó instalado en la anterior.
- **Solución:** instalalo con `npm install -g arcli` y volvé a abrir el ícono. No hace falta recrear el acceso directo.
- **Documentación relacionada:** [Acceso directo](cli-reference.md#acceso-directo)

## PDF

Un error del PDF no deshace la emisión: el comprobante ya tiene CAE. **No lo vuelvas a emitir para obtener el PDF**, porque quedaría duplicado en ARCA. Arreglá la causa para los próximos. Regenerar el PDF de un comprobante ya emitido todavía no está disponible. Ver [PDF de comprobantes](pdf.md#qué-no-hace-todavía).

### `PDF_PLUGIN_MISSING`

- **Síntoma:** "Para generar PDFs falta instalar el plugin de PDF".
- **Causa:** el plugin no se descarga solo con `--json` o sin terminal. También aparece si una versión nueva de ARCLI usa otra versión del plugin.
- **Solución:** `arcli pdf instalar`. Para ver qué hay instalado: `arcli pdf`.

### `PDF_PLUGIN_INSTALL_ERROR`

- **Síntoma:** `arcli pdf instalar` falla y muestra las últimas líneas de npm, o se corta con "no terminó en 5 minutos" (15 para el navegador).
- **Causa:** sin internet, un proxy corporativo o un registro de npm privado. Si el proxy no responde, la instalación se corta por tiempo en lugar de quedar colgada.
- **Solución:** revisá `npm config get proxy` y `npm config get registry` y volvé a correr `arcli pdf instalar`. Si lo que falla es la descarga del navegador y ya tenés Chrome, Chromium o Edge, indicá su ruta:

```bash
arcli config establecer pdfNavegador "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### `PDF_ISSUER_INCOMPLETE`

- **Síntoma:** "Faltan datos del emisor para el PDF".
- **Causa:** ARCA no guarda el nombre, el domicilio ni el inicio de actividades del emisor, y el PDF los necesita.
- **Solución:** completalos una vez con los comandos que muestra el error:

```bash
arcli config establecer emisor.razonSocial "Tu Nombre o Empresa"
arcli config establecer emisor.domicilio "Calle 123, Ciudad"
arcli config establecer emisor.inicioActividades 1/03/2020
```

### `PDF_GENERATION_ERROR`

- **Síntoma:** "No se pudo generar el PDF".
- **Causa habitual:** el navegador no arranca. Pasa en servidores sin entorno gráfico o con un Chrome muy viejo.
- **Solución:** probá con otro navegador (`arcli config establecer pdfNavegador <ruta>`) o borrá esa config para que ARCLI use el que descargó el plugin.
