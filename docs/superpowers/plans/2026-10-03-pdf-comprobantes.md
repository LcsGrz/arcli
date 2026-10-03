# PDF de comprobantes: plan de implementación

> **Para agentes:** los pasos usan checkboxes (`- [ ]`). Marcalos a medida que avanzás.

**Objetivo:** Después de emitir un comprobante, generar el PDF con el QR de ARCA, que es lo que se le manda al cliente. Por config se elige si se genera siempre, nunca o si se pregunta, y en qué carpeta se guarda.

**Arquitectura:** El render lo hace `@arcasdk/pdf`, pero **no es dependencia de arcli**. Es un plugin que se descarga recién cuando alguien quiere PDFs, en una carpeta propia de arcli. Así la instalación de arcli sigue liviana. El mapeo de un comprobante emitido a los datos del PDF es puro y vive en `src/modules/pdf/`. Descargar el plugin, cargarlo y renderizar quedan aislados en `src/services/pdf/`.

**Tecnología:** TypeScript, Commander, Zod, Vitest y `@arcasdk/pdf` (cargado en tiempo de ejecución).

**Versión:** 1.5.0 (minor). Todo lo que se agrega es nuevo: claves de config, flags, comando y un campo opcional en el JSON. No cambia nada existente.

---

## Decisiones

### Por qué un plugin y no una dependencia

`@arcasdk/pdf` 0.2.1 renderiza HTML con Puppeteer, que al instalarse descarga un Chromium de unos 150 MB. Si fuera dependencia, cada `npm i -g arcli` y cada `npx arcli` pagaría ese peso aunque nunca genere un PDF. Hay otras opciones descartadas:

- `optionalDependencies`: npm las instala igual por defecto.
- Paquete aparte instalado global (`arcli-pdf`): un CLI global no resuelve de forma confiable otro paquete global, y además se rompe con `npx`.
- Dibujar el PDF a mano con una librería liviana: perdemos la plantilla del SDK, que es justamente lo que el usuario quiere usar.

Otros datos del paquete:

- Usa CommonJS, así que se carga con `createRequire` sin problemas de ESM.
- Su licencia es ISC según `package.json` y MIT según el README. Las dos son permisivas, y como no lo redistribuimos dentro de arcli, no hay conflicto.

### Plugin

- **Dónde se instala:** `<carpeta de config>/plugins/pdf/`, junto a `tickets/` (ver `arcli config ruta`).
- **Versión:** fija, `PDF_PLUGIN_VERSION = '0.2.1'`. La subimos nosotros cuando la probamos. Si la versión instalada no coincide, se trata como "no instalado" y se ofrece actualizar.
- **Cómo se instala:** `npm install @arcasdk/pdf@<versión> --prefix <dir> --omit=dev --ignore-scripts --no-audit --no-fund`. npm viene con Node.
  - `--ignore-scripts` siempre: npm 12 ya bloquea los scripts de instalación por defecto, así que Puppeteer **no** descarga Chromium solo. Mejor que el comportamiento sea igual en todas las versiones de npm y que el navegador lo resolvamos nosotros.
- **Navegador:** el SDK no permite elegir el ejecutable, pero Puppeteer lee `PUPPETEER_EXECUTABLE_PATH`. Lo resolvemos así, en orden:
  1. Config `pdfNavegador` (ruta a Chrome, Chromium o Edge), si está.
  2. Un Chrome, Chromium o Edge instalado en el sistema, buscado en las rutas conocidas de macOS, Linux y Windows. Así no se descarga nada más.
  3. Si no hay ninguno, se descarga `chrome-headless-shell` con el CLI de Puppeteer, con `PUPPETEER_CACHE_DIR=<dir>/browsers`, y se apunta `PUPPETEER_EXECUTABLE_PATH` a ese binario. Hay que apuntarlo explícitamente porque `headless: true` busca el Chrome completo y no lo encuentra.
- **Tamaño:** las dependencias pesan 158 MB (incluye 54 MB que el SDK no usa: `jspdf`, `html2pdf.js` y `core-js`). Si hay que descargar el navegador, se suman 201 MB. Todo queda dentro de `<dir>`, así que `arcli pdf desinstalar` lo borra entero.
- **Cómo se carga:** `createRequire(join(dir, 'package.json'))('@arcasdk/pdf')`, con `PUPPETEER_EXECUTABLE_PATH` definido antes de `generate()`.
- **Cuándo se descarga:**
  - **En una terminal interactiva** (modo interactivo, o un flag con `pdf=preguntar` o `siempre`): si falta el plugin, se pregunta _"Para generar PDFs hay que descargar un componente (~160 MB, o ~360 MB si no tenés Chrome). ¿Instalarlo ahora?"_.
  - **Con `--json` o sin terminal:** **nunca** se descarga solo. Se informa el error `PDF_PLUGIN_MISSING` con la sugerencia `arcli pdf instalar`.

### Cuándo se genera el PDF

| Situación                                     | `nunca` | `preguntar` (por defecto) | `siempre` |
| --------------------------------------------- | ------- | ------------------------- | --------- |
| `--exportar-pdf` / `--pdf`                    | genera  | genera                    | genera    |
| `--sin-pdf`                                   | no      | no                        | no        |
| Sin flag, terminal interactiva                | no      | pregunta                  | genera    |
| Sin flag, `--json` o sin terminal             | no      | no                        | genera    |
| Vista previa, sin `--emitir`, o **rechazado** | no      | no                        | no        |

- No hay PDF sin CAE: en vista previa y en rechazados no se genera nunca.
- Un comprobante observado tiene CAE, así que sí lleva PDF.
- `--exportar-pdf` y `--sin-pdf` juntos dan error de validación.
- En el modo interactivo es una pregunta más después de emitir. Se omite si la config es `siempre` o `nunca`.

### Si el PDF falla

**El comprobante ya está emitido**, así que un error en el PDF **no puede tapar el CAE ni cambiar el código de salida**. El resultado del comprobante se muestra igual, seguido de un aviso con el error y una sugerencia para regenerarlo: `arcli pdf generar fc 125 ...`. En JSON va como `pdf.error`.

### Carpeta y nombre del archivo

- **Carpeta:** config `pdfCarpeta`. Por defecto es `~/arcli/comprobantes`, absoluta, para que no dependa de dónde se ejecuta el comando. Se crea si no existe.
- **Testing:** se guarda en `<pdfCarpeta>/testing/` y lleva el pie _"COMPROBANTE DE PRUEBA - SIN VALIDEZ FISCAL"_, para que no se mezcle con los reales.
- **Nombre:** `<tipo>-<letra>_<PV 4 dígitos>-<número 8 dígitos>.pdf`, por ejemplo:
  - `factura-c_0003-00000125.pdf`
  - `nota-credito-a_0003-00000007.pdf`
  - `factura-credito-electronica-a_0003-00000002.pdf`
- El tipo usa la misma familia que los comandos.
- Si el archivo ya existe se sobrescribe, porque es el mismo comprobante.

### Datos que ARCA no tiene

ARCA solo guarda números. Para el PDF hacen falta datos extra.

**Del emisor, por config:**

| Clave                      | Obligatoria | Nota                                                                                   |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `emisor.razonSocial`       | sí          |                                                                                        |
| `emisor.domicilio`         | sí          | Domicilio comercial                                                                    |
| `emisor.inicioActividades` | sí          | Fecha, con el mismo formato que `--fecha`                                              |
| `emisor.iibb`              | no          | Si falta, sale "Exento"                                                                |
| `emisor.condicionIva`      | no          | Por defecto sale de la letra: A/B → Responsable Inscripto, C → Responsable Monotributo |
| `emisor.logo`              | no          | Ruta a un PNG o JPG; se pasa como data URL                                             |

Si falta alguna obligatoria se informa `PDF_ISSUER_INCOMPLETE`, con la lista de comandos `arcli config establecer emisor.* ...`. En el modo interactivo se preguntan una vez y se ofrece guardarlas.

**Del comprobante, por flags opcionales que solo se usan en el PDF:**

| Flag                         | JSON (`--cargar`)   | Si no se pasa                |
| ---------------------------- | ------------------- | ---------------------------- |
| `--descripcion <texto>`      | `descripcion`       | "Según detalle"              |
| `--receptor-nombre <texto>`  | `receptorNombre`    | Se muestra solo el documento |
| `--receptor-domicilio <txt>` | `receptorDomicilio` | Vacío                        |
| `--exportar-pdf`, `--pdf`    | `pdf: true`         | Según config                 |
| `--sin-pdf`                  | `pdf: false`        | Según config                 |

Reglas de estos flags:

- **Detalle:** se arma un renglón por alícuota con la descripción y el importe, o uno solo si hay una sola alícuota o es letra C.
- **Si no se genera PDF:** cuando se pasan `--descripcion` o `--receptor-*`, se emite igual y se muestra el aviso _"--descripcion y --receptor-nombre solo se usan en el PDF; no se generó ninguno."_. En JSON va en `warnings`.

### Comando `arcli pdf`

```
arcli pdf instalar       descarga el plugin (pide confirmación si hay terminal; --si para scripts)
arcli pdf desinstalar    borra la carpeta del plugin
arcli pdf estado         instalado o no, versión, ruta
arcli pdf generar <tipo> <numero> [--pv N] [--descripcion ...] [--receptor-nombre ...] [--receptor-domicilio ...]
```

`generar` arma el PDF de un comprobante ya emitido con los datos de `consultar` (FECompConsultar). arcli no guarda nada localmente, así que la descripción y los datos del receptor hay que volver a pasarlos.

### Contrato JSON (aditivo)

Cada resultado de emisión suma `pdf` **solo si se intentó generar**:

```json
{ "pdf": { "ruta": "/Users/x/arcli/comprobantes/factura-c_0003-00000125.pdf" } }
{ "pdf": { "error": { "code": "PDF_PLUGIN_MISSING", "message": "...", "suggestion": "arcli pdf instalar" } } }
```

Códigos nuevos: `PDF_PLUGIN_MISSING`, `PDF_PLUGIN_INSTALL_ERROR`, `PDF_ISSUER_INCOMPLETE` y `PDF_GENERATION_ERROR`.

### Fuera de alcance (por ahora)

- Ítems detallados (cantidad × precio unitario). Necesitarían otra forma de cargar montos.
- Completar el emisor y el receptor desde el padrón: depende de `ws_sr_constancia_inscripcion`.
- Duplicado y triplicado, plantilla propia y envío por mail.
- Reusar un solo Chromium en los lotes: el SDK abre uno por PDF. Si molesta, se propone upstream.

---

### Tarea 0: Prueba del SDK (descartable, en el scratchpad)

- [x] Instalar `@arcasdk/pdf@0.2.1` en una carpeta temporal y cargarlo desde ESM con `createRequire`. La instalación tarda unos 13 s y funciona.
- [x] Generar una factura C y una A con dos alícuotas. La plantilla queda bien: letra y código, emisor y receptor, período facturado, IVA por alícuota, importe en letras, QR, CAE y pie de "prueba".
- [x] Confirmar que el QR es una URL de `afip.gob.ar/fe/qr/?p=` con el JSON en base64 (`ver`, `fecha`, `cuit`, `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`, `nroDocRec`, `tipoCodAut`, `codAut`).
- [x] Medir tiempos: el primer PDF tarda 1,7 a 3,6 s y los siguientes 0,2 a 0,7 s. Con el Chrome del sistema (`PUPPETEER_EXECUTABLE_PATH`) también funciona.
- [x] **Hallazgo:** con npm 12, Puppeteer no descarga Chromium (los scripts están bloqueados) y `headless: true` no encuentra `chrome-headless-shell`. Por eso el plan resuelve el navegador explícitamente (ver "Plugin").
- [ ] Probar una NC A con comprobante asociado y una FCE A: se hace dentro de la Tarea 2, con datos reales del mapper.
- **Detalle:** la columna de cantidad muestra "1 unidades". Pasar `unidadMedida: 'unidad'`.

### Tarea 1: Config del PDF y del emisor

**Archivos:** `src/modules/config/config.schemas.ts`, `config.service.ts`, `config-value-parser.ts`, `config.presenter.ts`, `config-doctor.ts` y sus tests.

- [ ] Claves `pdf` (`siempre | preguntar | nunca`), `pdfCarpeta`, `pdfNavegador` y `emisor.*`, con validación Zod.
- [ ] `arcli config` las muestra. `config revisar` avisa si `pdf != nunca` y faltan datos obligatorios del emisor.

### Tarea 2: Módulo puro `src/modules/pdf/`

**Archivos:** `pdf.types.ts` (copia tipada de `InvoiceData`, porque no podemos importar tipos de un plugin que puede no estar), `pdf-data.mapper.ts`, `pdf-file-name.ts`, `pdf-decision.ts` y `__tests__/`.

- [ ] `resolvePdfDecision({ config, flags, isTty, json, result })` devuelve `generar | preguntar | omitir` (la tabla de arriba).
- [ ] `buildPdfFileName(voucherKind, pv, numero)`.
- [ ] `mapToInvoicePdfData(...)` desde un `BillingExecutionResult` y desde un `IssuedVoucher`: renglones por alícuota, descripciones de IVA y de documento, comprobantes asociados, fechas de servicio, moneda y cotización.
- [ ] Validar el emisor, lanzando `PDF_ISSUER_INCOMPLETE` con la lista de lo que falta.

### Tarea 3: Plugin `src/services/pdf/`

**Archivos:** `pdf-plugin.ts` (ubicar, instalar, desinstalar, estado y cargar) y `pdf-renderer.ts` (genera y escribe el archivo).

- [ ] Instalar con `npm` como proceso hijo, mostrando el progreso con el spinner.
- [ ] Cargar con `createRequire` y verificar la versión.
- [ ] Tests con `npm` y el módulo mockeados. El render real queda en un test marcado como de red, que no corre en CI.

### Tarea 4: Emisión con flags

**Archivos:** `billing.command.options.ts`, `billing.command.parser.ts`, `billing.schemas.ts`, `billing.command.shared.ts`, `billing.command.output.ts`, `billing.serialize.ts` y el presenter.

- [ ] Flags y campos JSON nuevos, con el error si vienen `--exportar-pdf` y `--sin-pdf` juntos.
- [ ] Después de `emitBatch`, generar los PDFs de los resultados con CAE. Si falta el plugin y hay terminal, ofrecer instalarlo.
- [ ] Mostrar en el panel una línea `PDF  ~/arcli/comprobantes/factura-c_0003-00000125.pdf`, y en JSON el campo `pdf`.
- [ ] El aviso de los flags que solo sirven para el PDF.

### Tarea 5: Comando `arcli pdf`

**Archivos:** `src/cli/commands/pdf.command.ts` y su registro en `src/cli/index.ts`.

- [ ] `instalar` (con `--si`), `desinstalar`, `estado` y `generar`. `generar` reutiliza `ArcaVoucherHistoryGateway`.

### Tarea 6: Modo interactivo

**Archivos:** `src/cli/interactive/session.ts` y los flujos.

- [ ] Después de emitir, si la decisión es `preguntar`: _"¿Generamos el PDF?"_. Si responde que sí, pregunta la descripción y el nombre y domicilio del receptor (con "← Volver").
- [ ] Si faltan datos del emisor, preguntarlos y ofrecer guardarlos.
- [ ] El comando equivalente incluye `--exportar-pdf` y los flags de PDF.

### Tarea 7: Documentación

- [ ] `docs/configuration.md`: claves nuevas.
- [ ] `docs/cli-reference.md`: flags y `arcli pdf`.
- [ ] `docs/input-output.md`: campo `pdf` y códigos de error.
- [ ] `docs/usage-patterns.md`: ejemplo de factura con PDF.
- [ ] `docs/troubleshooting.md`: proxy o sin internet al instalar, y Chromium.
- [ ] `docs/modo-interactivo.md`, `docs/limitations.md`, `README.md`, `llms.txt`, `arcli ejemplos` y `CHANGELOG.md`.

### Tarea 8: Verificación

- [ ] `yarn typecheck`, `yarn lint`, `yarn test` y `yarn build`.
- [ ] Prueba real en testing: emitir una factura C con `--exportar-pdf`, abrir el PDF y escanear el QR.
- [ ] Verificar que `npm pack --dry-run` no creció.
