[← Documentación](README.md)

# Glosario

Términos de facturación electrónica argentina que aparecen en la documentación de arcli. Pensado para alguien que nunca facturó por ARCA/AFIP y necesita una referencia rápida sin salir de los docs.

## Organismo y servicios

### Testing y producción

Testing (homologación) es el ambiente de prueba de ARCA: podés emitir sin que cuente, y los comprobantes no tienen validez fiscal. Producción es el real: lo que emitís ahí vale y no se borra. arcli arranca en testing.

### ARCA / AFIP

ARCA (Agencia de Recaudación y Control Aduanero) es el organismo que sucedió a AFIP como autoridad fiscal argentina. arcli habla con los web services de ARCA para autorizar comprobantes; en la documentación y en el código, "ARCA" y "AFIP" se usan como sinónimos del mismo organismo.

### WSAA

Web Service de Autenticación y Autorización. Es el servicio de ARCA que entrega un [TA](#ta) a partir del certificado y clave configurados. Todo comprobante necesita un TA válido antes de poder emitirse.

### TA

Ticket de Acceso. Credencial temporal que devuelve WSAA y que habilita a operar contra los servicios de facturación de ARCA por un tiempo limitado. Si arcli pide uno nuevo mientras el anterior sigue vigente, ARCA responde `coe.alreadyAuthenticated` (ver [Troubleshooting](troubleshooting.md)).

### Padrón

Base de datos de ARCA con la situación fiscal de cada CUIT. Un comprobante puede aprobarse pero igual traer una observación de padrón (por ejemplo `10217` o `10017`) según la condición del receptor, sin que eso implique un error del CLI.

### wsfe / wsfex / wsfecred / ws_sr_constancia_inscripcion

Servicios web de ARCA que usa arcli: `wsfe` emite las facturas, notas y recibos A, B y C; `wsfex`, la factura de exportación E; `wsfecred` consulta el régimen FCE del receptor; `ws_sr_constancia_inscripcion` es el padrón (`arcli padron` y el IVA receptor desde el padrón). Cada uno se autoriza aparte en ARCA. Ver [Qué servicios autorizar](certificado-testing.md#qué-servicios-autorizar).

### CSR y alias

El CSR (pedido de firma de certificado) es el archivo que subís a ARCA para que te devuelva el certificado; `arcli certificado generar` lo arma junto con la clave privada. El alias es el nombre con el que el certificado aparece en ARCA (por defecto `arcli`).

## Identidad y comprobante

### CUIT / CUIL / DNI

Formas de identificar al receptor de un comprobante:

- **CUIT**: Clave Única de Identificación Tributaria, 11 dígitos. Identifica personas jurídicas o autónomos.
- **CUIL**: Clave Única de Identificación Laboral, 11 dígitos. Identifica trabajadores en relación de dependencia.
- **DNI**: Documento Nacional de Identidad, 7 u 8 dígitos. Se usa cuando el receptor no tiene CUIT/CUIL a mano.

### Consumidor final

Categoría de receptor sin documento identificable. arcli la representa con documento `0` e IVA receptor `consumidor-final`: `--consumidor-final` alcanza para las dos cosas.

### Condición IVA (IVA receptor)

La situación del receptor frente al IVA: `responsable-inscripto`, `responsable-monotributo`, `consumidor-final`, `sujeto-exento`, etc. Define, entre otras cosas, qué letra corresponde (A, B o C) (ver [Reglas de validación](validation-rules.md#iva-automático)).

### Punto de venta

Número que identifica la "caja" o punto de emisión dentro de ARCA para un mismo CUIT emisor. Se configura una vez y se reutiliza en cada comprobante.

### Concepto

Qué se está facturando: `productos`, `servicios` o `productos-servicios`. Determina si hace falta informar fechas de servicio (`--servicio-desde`, `--servicio-hasta`, `--vencimiento`).

### Período del servicio, vencimiento y período asociado

- **Período del servicio** (`--servicio-desde`/`--servicio-hasta`, `FchServDesde`/`FchServHasta`): qué período cubre una factura de servicios. Por ejemplo, el abono de octubre.
- **Vencimiento** (`--vencimiento`/`--vto`, `FchVtoPago`): hasta cuándo se puede pagar. `--dia` está deprecado.
- **Período asociado** (`--periodo-desde`/`--periodo-hasta`, `PeriodoAsoc`): solo en notas. Qué facturas ajusta la nota cuando no es una puntual, por ejemplo un descuento sobre todo lo facturado en octubre.

Ejemplos en [Las fechas de un comprobante](cli-reference.md#las-fechas-de-un-comprobante).

### Comprobante asociado / `CbtesAsoc`

El comprobante original que una nota de crédito o débito ajusta o anula. `CbtesAsoc` es el nombre del campo tal cual lo espera ARCA dentro del payload; en arcli se arma con `--ac`/`--at`, `--apv`, `--ar` y `--acuit`. En notas comunes, la alternativa es el período asociado (`PeriodoAsoc`), que se arma con `--periodo-desde` y `--periodo-hasta`.

### `DocTipo` / `DocNro`

Campos del payload de ARCA para la identidad del receptor: `DocTipo` indica el tipo de documento (CUIT, CUIL, DNI o consumidor final) y `DocNro` el número. Por ejemplo, consumidor final se envía como `DocTipo 99` y `DocNro 0`.

### `CbteTipo` / tipo ARCA

Código numérico con el que ARCA identifica cada tipo de comprobante (Factura A, Nota de crédito B, etc). En arcli aparece como `tipoArca` en la salida `--json` y es lo que distingue, por ejemplo, una factura común de su versión de crédito electrónica aunque compartan la misma letra.

### Factura de crédito electrónica (FCE)

Variante electrónica de factura pensada para el régimen de facturación de crédito PyME. Usa la misma estructura que una factura común, con un tipo ARCA distinto y datos de cobro adicionales: CBU del emisor, modalidad de transferencia (`SCA` o `ADC`) y vencimiento de pago. Sus notas de crédito y débito llevan el código de anulación y la fecha de la factura asociada. Ver [Crédito electrónico (FCE)](validation-rules.md#crédito-electrónico-fce).

### Recibo C

Comprobante tipo ARCA `15` (`arcli rc`) para documentar un cobro. Se arma como una Factura C: sin IVA discriminado y sin comprobante asociado. Ver [Recibo C](validation-rules.md#recibo-c).

### Factura de exportación E

Factura para clientes del exterior (`arcli fe`), que va por `wsfex` en vez de `wsfe`: no lleva concepto, IVA ni documento del receptor, y sí cliente, país de destino, ítems e incoterm. Sus notas de crédito y débito son `arcli nce` y `arcli nde`. Ver [Factura de exportación (E)](validation-rules.md#factura-de-exportación-e).

## Números y respuesta

### CAE

Código de Autorización Electrónico. El número que ARCA devuelve al aprobar un comprobante; sin CAE, el comprobante no es válido fiscalmente. Viene acompañado de `caeVencimiento`, la fecha límite para entregar ese comprobante.

### Alícuota

El porcentaje de IVA aplicado. arcli calcula el IVA automáticamente en las letras `A` y `B`, con `21%` por defecto; se cambia con `--alicuota` o `config.alicuota` (ver [IVA automático](validation-rules.md#iva-automático)).

### Estado vs. resultado

- `resultado` es el valor crudo que devuelve ARCA (por ejemplo `A` de aprobado o `R` de rechazado).
- `estado` es la normalización que hace arcli (`aprobado`, `observado`, `rechazado`), distinguiendo si hubo observaciones aunque ARCA haya aprobado.

Ver el detalle completo en [Entrada y salida](input-output.md#estado-vs-resultado).
