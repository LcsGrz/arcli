[← Documentación](README.md)

# Arquitectura

Cómo está organizado el código de ARCLI y dónde tocar para extenderlo. Pensado para contributors; para usar el CLI no hace falta.

Stack: TypeScript estricto (ESM), Node.js, [commander](https://github.com/tj/commander.js), [zod](https://zod.dev), [`@arcasdk/core`](https://github.com/ralcorta/arcasdk) para hablar con ARCA, `conf` para la configuración persistente y `@inquirer` para el modo interactivo.

## Flujo de una emisión

```text
src/cli (commander)
  -> parseo de flags y carga del JSON (--cargar)
  -> src/modules/billing: mezcla flags > JSON > config > defaults, valida, arma la solicitud
  -> src/services/arca: gateway contra ARCA (solo con --emitir)
  -> src/modules/pdf + src/services/pdf: PDF opcional, después de emitir
  -> src/ui: presenters y componentes de terminal (o JSON)
```

La factura de exportación `E` recorre el mismo camino con otro módulo y otro gateway: `src/modules/export` (mezcla, validación de items y armado del `Cmp` de WSFEX) y `src/services/arca/arca-export.gateway.ts` (`wsfex`), porque WSFEX tiene otro contrato que `wsfe`.

El comportamiento visible de cada paso está en el [modelo mental](mental-model.md).

## Capas

| Carpeta                     | Responsabilidad                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cli/`                  | Contrato del programa: registro de comandos (`program.ts`, `commands/`), ayuda en español y flags. Sin lógica de negocio. Los comandos que consultan ARCA (`parametros`, `estado`, `ultimos`, `consultar`, `padron`, `fce-obligado`) arman runtime, spinner y salida con `arca-query.ts`.                                                                          |
| `src/cli/interactive/`      | Modo interactivo: flujos con prompts (`invoice`, `export`, `note`, `repeat`, `history`, `status`, `config`, `certificate`, `pdf`, `update`), la barra con el estado de ARCA, el selector de comprobantes (`invoice-picker`) y los prompts compartidos (`prompts`: Esc para volver, espaciado). Arma la misma entrada que los flags y llama a los mismos servicios. |
| `src/modules/billing/`      | Negocio de comprobantes: esquemas, validaciones, importes e IVA, FCE, comprobantes asociados, lotes, serialización JSON y `BillingService`. Los códigos de ARCA (concepto, documento, condición IVA, alícuota) están en `arca-codes.ts` y las monedas en `currency-codes.ts`: no se escriben números sueltos.                                                      |
| `src/modules/config/`       | Esquema de la config pública, almacenamiento (`conf`), parseo de valores y `config revisar`.                                                                                                                                                                                                                                                                       |
| `src/modules/pdf/`          | Mapeo puro de un comprobante emitido a los datos del PDF: emisor, nombre de archivo, decisión de generar o no, errores.                                                                                                                                                                                                                                            |
| `src/modules/certificates/` | `arcli certificado`: la carpeta `certificados/<CUIT>/` junto a la config, el pedido pendiente (la clave nueva no reemplaza a la activa hasta importar), la validación del `.crt` (emisor de ARCA, CUIT, vencimiento, clave) y su presentación. La clave y el CSR los arma `src/lib/security/certificate-request.ts` (`node:crypto` + `node-forge`, sin `openssl`). |
| `src/modules/export/`       | Factura de exportación `E`: esquemas, validación y armado de items, resolución contra las tablas de WSFEX, respuesta y serialización JSON.                                                                                                                                                                                                                         |
| `src/modules/*`             | `parameters` (`estado`, `parametros`), `vouchers` (`ultimos`, `consultar`), `fce` (`fce-obligado`), `padron` (`padron` y el IVA receptor automático), `examples`, `interactive` (helpers del asistente), `completion` (autocompletado: `completado` y `__completar`), `update-check`, `storybook`.                                                                 |
| `src/services/arca/`        | Adaptadores sobre `@arcasdk/core`: contexto y credenciales, cliente, gateways de facturación, de exportación (`wsfex`), parámetros, historial y régimen FCE.                                                                                                                                                                                                       |
| `src/services/clipboard/`   | Copiar al portapapeles con la herramienta del sistema (`pbcopy`, `clip`, `wl-copy`, `xclip`, `xsel`).                                                                                                                                                                                                                                                              |
| `src/services/pdf/`         | Plugin de PDF: instalación, carga en tiempo de ejecución, búsqueda del navegador y render.                                                                                                                                                                                                                                                                         |
| `src/ui/`                   | Primitivas, componentes y presenters de terminal, tema y stream de salida.                                                                                                                                                                                                                                                                                         |
| `src/lib/`                  | Utilidades puras: fechas argentinas, errores de la app, lectura de JSON, rutas enmascaradas, validación de PEM y certificados.                                                                                                                                                                                                                                     |

Reglas de dependencia:

- La lógica de negocio vive en `modules/`, nunca en `cli/`.
- Solo `services/` conoce `@arcasdk/core`.
- Fuera de `src/ui`, importá la UI desde `src/ui` o sus barrels públicos (`primitives`, `components`, `presenters`). Dentro de `src/ui`, usá imports directos entre archivos para evitar dependencias circulares.

## El plugin de PDF

`@arcasdk/pdf` renderiza con Puppeteer y descarga un navegador, así que **no es dependencia de ARCLI**. Se instala con `npm install --ignore-scripts` en `<carpeta de config>/plugins/pdf` y se carga con `createRequire` (`src/services/pdf/pdf-plugin.ts`). ARCLI fija una versión del plugin; si cambia, `arcli pdf` lo avisa. Comportamiento para usuarios: [PDF de comprobantes](pdf.md).

## Cómo extender

### Agregar un comprobante

Dentro del alcance del proyecto (A, B y C de factura, nota de crédito y débito, sus versiones FCE y Recibo C):

1. Definilo en `src/modules/billing/voucher-kind-map.ts` (`VOUCHER_KIND_MAP`): tipo ARCA, familia, letra y si requiere comprobante asociado.
2. Los comandos se registran solos desde ese mapa (`registerBillingShortcutCommands` y `registerBillingFamilyCommands`).
3. Si cambia una regla de negocio, ajustala en `src/modules/billing/`.
4. Actualizá tests y docs ([cli-reference](cli-reference.md), [validation-rules](validation-rules.md)).

La letra `E` no pasa por `VOUCHER_KIND_MAP`: WSFEX tiene otro contrato (autorización que no lanza, items, país de destino, tablas propias), así que vive en `src/modules/export/` con su propio tipo (`EXPORT_VOUCHER_KIND`) y su gateway. Las notas de crédito y débito de exportación, si se agregan, van ahí.

### Agregar una clave de configuración

1. Sumala a `configPublicKeySchema` y al esquema en `src/modules/config/config.schemas.ts`.
2. Mapeala en `ConfigService` (`config.service.ts`) y validala en `config-value-parser.ts`.
3. Ubicala en una sección y ponele nombre en `config.sections.ts`: de ahí salen el orden de `arcli config` y de "Modificar configuración" (un test exige que cada clave esté en una sola sección). Agregá cómo se muestra su valor en `config.presenter.ts`.
4. Documentala en [configuración](configuration.md) y, si el modo interactivo la expone, en `src/modules/interactive/config-fields.ts`.

### Cambiar el contrato

Comandos, flags, claves de config y JSON son contrato público. Antes de cambiarlos, mirá [CONTRIBUTING](../CONTRIBUTING.md#contrato-del-cli) y actualizá [entrada y salida](input-output.md) y los tests de serialización.

## Decisiones de diseño

- **CLI primero.** El flujo principal se piensa desde la terminal; el modo interactivo es una capa encima y no agrega comandos de emisión.
- **Una sola ruta de validación.** El asistente arma `BillingCommandInput` y pasa por `BillingService`, igual que los flags: mismas validaciones, vista previa y emisión.
- **Wizard, no pantalla completa.** Prompts encadenados con `@inquirer`.
- **`testing` por defecto.** Con la config por defecto, emitir en producción pide `--produccion` y además `--emitir` o confirmar en la terminal. Quien guarda `entorno produccion` y `emitir true` emite sin flags: es a propósito.
- **Todo visible.** Lo que ARCLI envía a ARCA se puede ver en la vista previa, en `--json` o en `--bruto`.
- **Lo escrito gana.** Cada dato se resuelve por nivel: el flag del comando, después el JSON de `--cargar` y por último la config. El primer nivel que dice algo decide; solo es error que un mismo nivel pida dos cosas opuestas (por ejemplo `--emitir --previsualizar`).
- **Formato argentino para montos escritos.** Flags, modo interactivo y config usan `src/lib/numbers/argentine-amount.ts`: punto para miles, coma para decimales. El JSON usa números.
- **Fecha argentina.** "Hoy" sale de `toArgentineCalendarDate` (`src/lib/dates/arca-date.ts`), con la zona `America/Argentina/Buenos_Aires`, sin importar la del equipo. Las cuentas de calendario se hacen en un solo sistema (UTC o local), nunca mezclando.
- **Certificado vencido, antes de ARCA.** `ArcaContextResolver.resolve()` calcula el vencimiento de todos los certificados configurados (`certificateNotices`, con `inspectConfiguredCertificates`; el del entorno activo con el PEM que ya leyó, sin red y una vez por ejecución), porque quien trabaja en testing también tiene que enterarse de que vence el de producción. `certificateExpiry` es solo el del entorno activo. Los comandos los avisan con `resolveArcaRuntime` (`src/cli/arca-runtime.ts`, a stderr) y el modo interactivo en un recuadro bajo la barra. `ArcaClientFactory.create()`, por donde sale todo cliente de ARCA, corta con `CERTIFICATE_EXPIRED` si venció el del entorno activo, antes de pedir el ticket a WSAA; el de otro entorno vencido solo se avisa. `config` no lo avisa por comando: no va a ARCA y `config revisar` ya muestra el vencimiento de los dos entornos.
- **Producción sin DHE.** `servicios1.afip.gov.ar` (WSFE y WSFEX) prefiere DHE con una clave de 1024 bits, que corta con `dh key too small` donde OpenSSL usa `SECLEVEL=2`, como en Debian. `ArcaClientFactory` suma `:!DHE` a `tls.DEFAULT_CIPHERS` al crear un cliente de producción. Ese host pasa a intercambio RSA y pierde forward secrecy; el resto de los hosts negocia ECDHE con y sin el cambio, y se conservan `SECLEVEL` y la validación del certificado. Se descartó `useHttpsAgent` de `@arcasdk/core`: también lo resuelve, pero baja todas las conexiones a `SECLEVEL=1`, acepta DH desde 512 bits, fija TLS 1.2 y habilita la renegociación insegura. `DEFAULT_CIPHERS` es del proceso, así que una sesión que pasa de producción a testing sigue sin DHE; homologación no lo usa. Testing solo no cambia.
- **Links solo de arcli.** `sanitizeTerminalText` saca de la salida toda secuencia de la terminal salvo colores, para que un texto de afuera (una observación de ARCA, un error de npm) no mueva el cursor ni tape el aviso de PRODUCCIÓN. Los links (OSC 8) que arma `hyperlink()`/`pathLink()` (`src/ui/primitives/hyperlink.ts`) pasan porque su URL quedó registrada en esa ejecución; uno que venga en un texto de afuera se saca, así no puede mostrar un texto y llevar a otro lado. Solo se usan en terminales conocidas y con colores, y nunca en `--json`.
- **Opciones globales declaradas por comando.** `--testing`, `--produccion`, `--json` y `--bruto` las parsea el programa (están en cualquier comando), pero cada comando declara solo las que usa con los helpers de `src/cli/global-options.ts`; así sale el aviso de opción que no aplica. Si un comando imprime JSON lo decide siempre `resolveOutputJson` (flag o, si no está, la clave `json` de la config).
- **Errores de uso como el resto.** El programa usa `exitOverride()`: commander tira los errores de uso en vez de cortar el proceso y `reportCliError` (`src/cli/error-output.ts`) los imprime como cualquier error. En JSON salen como `INPUT_VALIDATION_ERROR`; en texto los escribe commander como siempre. Ayuda y versión también pasan por ahí y no son errores.
- **Ante la duda, no duplicar.** Si falla la llamada que emite, no se sabe si ARCA autorizó: `BillingService` lo informa como `EMISSION_UNCERTAIN` con el `arcli ultimos` para verificar, en vez de sugerir reintentar. Por eso `BillingGateway` no usa `createNextVoucher` del SDK sino sus dos pasos: `getNextVoucherNumber` (login en WSAA y último número + 1; si falla no se envió nada y el error sale tal cual) y `createVoucher` (la única llamada que se marca como incierta).
- **`factura <letra>` comparte un comando para A, B, C y E.** La familia registra los flags de facturación y, ocultos, los de la `E` (`registerExportOptions` devuelve los que agregó). Los que se pasaron por línea de comandos y no aplican a la letra elegida se saltean con un aviso (`src/cli/skipped-options.ts`) en lugar de cortar. Los atajos (`fa`, `fe`…) registran solo los suyos y siguen siendo estrictos.
- **WSFEX no lanza.** `FEXAuthorize` devuelve `FEXResultAuth` o `FEXErr` en vez de tirar error: `src/modules/export/export.response.ts` lo normaliza al mismo `estado` de A/B/C, así que un rechazo es un resultado válido con exit code `2` y no un error del comando. WSFEX numera por punto de venta y tipo, pero `@arcasdk/core` mezcla el bloque `Auth` de forma superficial y `FEXGetLast_CMP` lleva el punto de venta y el tipo dentro de `Auth`: hasta que se arregle en el SDK, `--numero` es obligatorio y se valida antes de WSAA. El ID de solicitud sí sale de `FEXGetLast_ID`. Los items se validan contra `--monto` antes de WSAA (`assertExportItemsTotal`): WSFEX no compara `Imp_total` con la suma y el error aparecería lejos de su causa.
