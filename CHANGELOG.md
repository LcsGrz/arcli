[← Volver al README](README.md)

# Changelog

Todos los cambios relevantes de ARCLI se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/). Como el contrato del CLI es público (comandos, flags, claves de config y JSON), cada entrada aclara qué cambia para quien ya lo usa.

## [Sin publicar]

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

[Sin publicar]: https://github.com/LcsGrz/arcli/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/LcsGrz/arcli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/LcsGrz/arcli/releases/tag/v1.1.0
