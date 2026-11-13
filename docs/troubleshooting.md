[← Documentación](README.md)

# Troubleshooting

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

- **Síntoma:** `command not found: arcli` o "arcli no se reconoce como un comando interno o externo".
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

- **Severidad:** media
- **Síntoma:** `arcli certificado importar` corta con `El certificado no corresponde a la clave del último pedido` (`CERTIFICATE_KEY_MISMATCH`). No se toca la config.
- **Causa:** el `.crt` se creó en ARCA con otro CSR: uno de un pedido anterior que descartaste con `--reemplazar`, uno armado en otra computadora o uno hecho con `openssl`.
- **Solución:** en ARCA, creá el certificado con el CSR del último `arcli certificado generar` (está en `certificados/<CUIT>/<entorno>.nueva.csr`, junto a la config) y volvé a importar. Si el certificado es de un par que armaste con `openssl`, configuralo con `arcli config establecer cert.<entorno>` y `key.<entorno>`.
- **Documentación relacionada:** [Comando `arcli certificado`](cli-reference.md#comando-arcli-certificado)

### Al importar: otros rechazos del certificado

- **Severidad:** media
- **Síntoma:** `arcli certificado generar` o `importar` corta sin tocar la config. El código del JSON dice cuál es:
  - `CERTIFICATE_REQUEST_PENDING` (`generar`): ya hay un pedido de ese entorno sin importar.
  - `CERTIFICATE_INVALID`: el archivo no tiene un certificado X.509.
  - `CERTIFICATE_CUIT_MISMATCH`: el certificado es de otro CUIT que el de la config.
  - `CERTIFICATE_EXPIRED`: el `.crt` que querés cargar ya venció.
  - `CERTIFICATE_ENVIRONMENT_UNKNOWN`: arcli no reconoce al emisor como una autoridad de ARCA, así que no sabe de qué entorno es.
  - `CERTIFICATE_REPLACE_CONFIRMATION`: ya había otro certificado y, sin terminal o con `--json`, no se puede preguntar.
- **Solución:** importá el certificado del pedido pendiente o descartalo con `--reemplazar`; usá el `.crt` tal como lo bajaste de ARCA, sin abrirlo ni guardarlo con otro programa; bajalo con la clave fiscal del CUIT configurado; si está vencido, generá uno nuevo; si es de ARCA, indicá el entorno con `--testing` o `--produccion`; para reemplazar sin preguntar, sumá `--reemplazar`.
- **Documentación relacionada:** [Comando `arcli certificado`](cli-reference.md#comando-arcli-certificado), [códigos de error](input-output.md#códigos-de-error)

### Certificado por vencer o vencido

- **Severidad:** alta (crítico si ya venció)
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

- **Severidad:** común
- **Síntoma:** `INPUT_VALIDATION_ERROR` o mensaje como `Falta el dato: monto.`
- **Causa:** falta un dato obligatorio en flags o JSON.
- **Solución:** revisar `ayuda` del comando puntual y completar los campos faltantes.

```bash
arcli fc ayuda
```

- **Documentación relacionada:** [Reglas de validación](validation-rules.md)

### Clave desconocida o tipo incorrecto en el JSON de `--cargar`

- **Severidad:** común
- **Síntoma:** `INPUT_VALIDATION_ERROR` (o `BATCH_VALIDATION_ERROR` en un lote) con `La clave "montototal" no existe` o `"puntoVenta" tiene que ser un número y llegó el texto "3"`.
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
- **Solución:** reemplazar `--consumidor-final` por `--dni`, `--cuit` o `--cuil`, manteniendo `--ir-cf`.
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

### NC/ND FCE sin fecha del asociado

- **Severidad:** frecuente
- **Síntoma:** `La nota de crédito electrónica ... requiere la fecha del comprobante asociado.`
- **Causa:** en NC/ND FCE, ARCA exige la fecha de la factura asociada (10158).
- **Solución:** agregar `--afecha <fecha>` con la fecha de la factura FCE original.
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

- **Severidad:** frecuente la primera vez
- **Síntoma:** error `WSFE_SERVICE_NOT_AUTHORIZED` ("El certificado no está autorizado para facturar (servicio wsfe). No se emitió nada.") al facturar o con `ultimos` y `consultar`.
- **Causa:** sacaste e importaste el certificado, pero falta autorizarlo a facturar en ARCA.
- **Solución:** en testing, WSASS → "Crear autorización a servicio" con el mismo nombre del certificado y el servicio `wsfe`; en producción, el Administrador de Relaciones de Clave Fiscal. No se emitió nada: después de autorizarlo, reintentá igual.
- **Documentación relacionada:** [Autorizar el servicio web](obtencion-certificados.md#3-autorizar-el-servicio-web)

### `wsfecred` no autorizado

- **Severidad:** frecuente si usás `fce-obligado` o `verificarFce`
- **Síntoma:** `El certificado no está autorizado para el servicio wsfecred ...` (ARCA responde `coe.notAuthorized`).
- **Causa:** el certificado solo tiene autorizado `wsfe`. La consulta del régimen FCE usa otro servicio.
- **Solución:** crear la autorización para `wsfecred` igual que la de `wsfe`, en WSASS (testing) o en el Administrador de Relaciones (producción). Si no la necesitás, desactivá el chequeo con `arcli config eliminar verificarFce`.
- **Documentación relacionada:** [Autorizar el servicio web](obtencion-certificados.md#3-autorizar-el-servicio-web)

### `ws_sr_constancia_inscripcion` no autorizado

- **Severidad:** frecuente si usás `arcli padron` o facturás con `--cuit` sin `--ir`
- **Síntoma:** `arcli padron` falla con `El certificado no está autorizado para el servicio ws_sr_constancia_inscripcion ...`. Al facturar no corta: aparece el aviso `No se pudo consultar el padrón de ARCA` y se usa el `ivaReceptor` de la config.
- **Causa:** el certificado solo tiene autorizado `wsfe`. El padrón usa otro servicio.
- **Solución:** crear la autorización para `ws_sr_constancia_inscripcion` igual que la de `wsfe`. Si no la necesitás, desactivá la consulta con `arcli config establecer consultarPadron false`.
- **Documentación relacionada:** [IVA receptor desde el padrón](cli-reference.md#iva-receptor-desde-el-padrón)

## ARCA

### `dh key too small` en producción

- **Severidad:** media
- **Síntoma:** en una versión anterior de arcli, los comandos de producción fallan con `dh key too small` o `ERR_SSL_DH_KEY_TOO_SMALL`, con certificado, clave y punto de venta correctos. En testing andan.
- **Causa:** WSFE y WSFEX de producción prefieren un intercambio DHE con una clave de 1024 bits, y OpenSSL la rechaza con `SECLEVEL=2`, el nivel de Debian 13 y otras distros.
- **Solución:** actualizar arcli. Si no podés, corré el CLI con `node --tls-cipher-list='DEFAULT:!DHE' "$(which arcli)"` más los argumentos de siempre.
- **Documentación relacionada:** [Arquitectura](architecture.md)

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
- **Solución:** esperar unos segundos y reintentar antes de modificar el comprobante. Si apareció al emitir, sale como `EMISSION_UNCERTAIN`: verificá primero con `arcli ultimos` (ver abajo).
- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Limitaciones actuales](limitations.md)

### No se pudo confirmar la emisión (`EMISSION_UNCERTAIN`)

- **Severidad:** crítico
- **Síntoma:** "No se pudo confirmar la emisión: …" al emitir.
- **Causa:** falló la llamada que emite en ARCA (red, timeout, transacción activa). ARCA pudo haber autorizado el comprobante y perderse la respuesta. Si el error es del login en WSAA (certificado no autorizado; uno vencido corta antes con `CERTIFICATE_EXPIRED`) o del pedido del último número, no sale este error sino el original: ahí no se emitió nada y alcanza con corregir y reintentar.
- **Solución:** **no reintentes todavía**. Corré el `arcli ultimos <tipo> --pv <n>` que muestra la sugerencia: si el comprobante figura, ya está emitido y no hay que repetirlo; si no figura, reintentá. En la factura E (`fe`), reintentá con el mismo `--numero` e `--id-solicitud` que muestra la sugerencia: ARCA no autoriza dos veces el mismo número.
- **Documentación relacionada:** [Entrada y salida](input-output.md#emisión-sin-confirmar)

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

### ARCA rechaza por punto de venta

- **Severidad:** común en producción
- **Síntoma:** el comprobante sale `rechazado` con el error `10005` ("El punto de venta informado debe estar dado de alta y ser del tipo RECE"), y la sugerencia habla de un punto de venta para web service. `arcli estado --produccion` dice que el punto de venta no está habilitado para web service.
- **Causa:** el punto de venta configurado no es de web service. Pasa con los de Comprobantes en línea ("Factura en línea"), Facturador o talonarios manuales. Desde el 1/11/2026, por la RG 5893/2026, ARCA da de alta de oficio un punto de venta "Factura en línea - Monotributo" a los monotributistas que no tienen uno electrónico: ese tampoco sirve para arcli.
- **Solución:** `arcli parametros puntos-venta --produccion` lista los habilitados para web service. Si el tuyo no está, creá uno nuevo con sistema de web services en "Administración de puntos de venta y domicilios" y guardalo con `arcli config establecer puntoVenta <numero>`.
- **Documentación relacionada:** [Punto de venta para web service](obtencion-certificados.md#punto-de-venta-para-web-service)

### Rechazos de ARCA por código

Cuando ARCA rechaza o deja una observación con alguno de estos códigos, `sugerencias` del JSON (y el panel de la salida humana) dice qué pasó y qué hacer. Los que arcli valida antes de enviar (por ejemplo, la ventana de fechas o el IVA receptor por letra) casi nunca llegan a ARCA, pero si llegan, el texto es el mismo.

| Código          | Qué pasó                                                                                                                                                          | Qué hacer                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `10005`/`11002` | El punto de venta no está habilitado para web service                                                                                                             | Ver [ARCA rechaza por punto de venta](#arca-rechaza-por-punto-de-venta)                                         |
| `10016`         | El número o la fecha no es el próximo a autorizar: otro comprobante del mismo tipo y punto de venta se emitió en el medio, o la fecha es anterior a la del último | Mirá el último con `arcli ultimos` y reintentá; si emitís varios, de a uno (ver [Limitaciones](limitations.md)) |
| `10152`         | La fecha del comprobante está fuera del rango que acepta ARCA                                                                                                     | Ver [Fecha del comprobante fuera de rango](#fecha-del-comprobante-fuera-de-rango)                               |
| `10243`         | El IVA receptor no es válido para la letra                                                                                                                        | Ver [El comprobante no admite el IVA receptor](#el-comprobante-no-admite-el-iva-receptor)                       |
| `10174`         | El CBU de la factura FCE no está registrado a nombre del emisor                                                                                                   | Usá un CBU propio registrado en ARCA (`--cbu` o la clave `cbu`)                                                 |
| `10119`         | La cotización está fuera del rango que acepta ARCA: entre el 2% y el 400% de la oficial                                                                           | Revisá `--cotizacion-moneda` contra `arcli parametros cotizacion <moneda>`                                      |
| `10038`         | Con `--misma-moneda`, la cotización enviada ya no es la oficial exacta                                                                                            | Volvé a emitir: arcli consulta la oficial en ese momento                                                        |
| `10017`/`10217` | Observación sobre la condición del receptor; el comprobante puede estar aprobado                                                                                  | Ver [Observaciones de padrón](#observaciones-de-padrón)                                                         |

También se reconocen por el mensaje, sin código: receptor igual al emisor, `Transacción Activa`, CUIT receptor inexistente y detalle de IVA obligatorio. Si ARCA rechaza con otro código, `sugerencias` pide revisar `errores` y `observaciones`.

- **Documentación relacionada:** [Reglas de validación](validation-rules.md), [Entrada y salida](input-output.md)

### Factura E: falta el número del comprobante

- **Severidad:** siempre, en cada `E`
- **Síntoma:** ``Falta el número del comprobante. Usá `--numero`: arcli todavía no puede consultar en WSFEX el último emitido.``
- **Causa:** WSFEX numera por punto de venta y tipo de comprobante, y el último se consulta con `FEXGetLast_CMP`, que lleva el punto de venta y el tipo **dentro** del bloque `Auth`. `@arcasdk/core` arma ese bloque pisándolo entero, así que la consulta no funciona (ARCA contesta 1606 o 1000). Hasta que se arregle en el SDK, el número lo indicás vos.
- **Solución:** pasá `--numero` con el siguiente al último `E` que emitiste en ese punto de venta (`1` si es el primero). Si no es el correcto, ARCA rechaza el comprobante y no se emite nada.
- **Documentación relacionada:** [Referencia del CLI](cli-reference.md#factura-de-exportación-e-wsfex)

### Factura E: falta la actividad o no está en la tabla de WSFEX

- **Severidad:** frecuente la primera vez que se emite una `E`
- **Síntoma:** `Falta la actividad de exportación.` o `La actividad 620900 no está en la tabla de actividades de WSFEX y ARCA la rechaza (error 2105).`
- **Causa:** la `E` informa siempre una actividad (ARCA rechaza `Actividades` vacío con el error 2100) y solo acepta los códigos de su propia tabla (`FEXGetPARAM_Actividades`), que **no es la del padrón y es más chica**: por ejemplo, `620900` (servicios de informática N.C.P.) no está; para informática están `620100` (consultores en informática y suministros de programas) y `620300` (consultores en tecnología de la información).
- **Solución:** elegí la que corresponda a tu actividad declarada (el error lista las que empiezan igual) y guardala con `arcli config establecer exportacion.actividad <codigo>`, o pasala con `--actividad`.
- **Documentación relacionada:** [Reglas de validación](validation-rules.md#factura-de-exportación-e), [Configuración](configuration.md)

### Factura E: el certificado no está autorizado a `wsfex`

- **Severidad:** frecuente la primera vez
- **Síntoma:** error `WSFEX_SERVICE_NOT_AUTHORIZED` ("El certificado no está autorizado para el servicio wsfex"), incluso con `--previsualizar`.
- **Causa:** la vista previa ya consulta las tablas de WSFEX, y el certificado no tiene la relación con el servicio `wsfex`.
- **Solución:** autorizá el certificado a `wsfex` igual que a `wsfe` (WSASS en testing, Administrador de Relaciones en producción), o configurá uno propio con `exportacion.cert.*` y `exportacion.key.*`.
- **Documentación relacionada:** [Configuración](configuration.md#certificados-de-exportación-wsfex), [Obtención de certificados](obtencion-certificados.md)

### Factura E: la cotización no es la del día

- **Severidad:** normal (pasa casi siempre con la fecha de hoy)
- **Síntoma:** aviso `ARCA no publicó la cotización de DOL del <fecha>: se usa la del <fecha anterior>`.
- **Causa:** la `E` usa la cotización de aduana de WSFEX (`FEXGetPARAM_MON_CON_COTIZACION`), que ARCA publica una vez por día. Mientras no sale la de hoy, se usa la última publicada.
- **Solución:** no hace falta hacer nada. Para fijar otra cotización, pasá `--cotizacion-moneda <valor>` (o `--cm`).
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
- **Solución:** **no vuelvas a cargar los comprobantes que ya se procesaron**, porque se duplicarían. Si el JSON trae `sinConfirmar`, el que falló puede haberse emitido igual: verificalo con `arcli ultimos` y sumalo solo si no figura. Si no lo trae, falló antes de emitir (login, último número) y ya está en "Sin procesar" (`sinProcesar`). Armá un lote con los de `sinProcesar` (y el sin confirmar, si no figura) y reintentá. Si el que falló fue por "Transacción Activa", esperá unos segundos.
- **Documentación relacionada:** [Entrada y salida](input-output.md#validación-y-errores-del-lote)

## Terminal

### Los bordes de los paneles se ven como `?` o cuadraditos

- **Severidad:** ocasional (terminales viejas, por ejemplo el `cmd` clásico de Windows, o fuentes sin caracteres de caja)
- **Síntoma:** los bordes de los paneles muestran `?`, `�` o cuadrados en lugar de líneas.
- **Causa:** la terminal o la fuente no tiene los caracteres de caja Unicode que usa ARCLI (`╒`, `┃`, `╏`, `╓`, `╌`, `┈`, `━`, `▎`…).
- **Solución:** usar una terminal moderna (Windows Terminal, iTerm2, la de VS Code) o activar los bordes y símbolos ASCII con `ARCLI_ASCII=1`. También cambia los símbolos del modo interactivo (`✔`, `❯`, `↑↓`); las tildes y la `ñ` se mantienen.

```bash
ARCLI_ASCII=1 arcli fc -m 1000 --cs --cfinal
```

- **Documentación relacionada:** [Variables de entorno](configuration.md#variables-de-entorno)

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
