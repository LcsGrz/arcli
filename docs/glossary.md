[← Volver al README](../README.md)

# Glosario

Términos de facturación electrónica argentina que aparecen en la documentación de ARCLI. Pensado para alguien que nunca facturó por ARCA/AFIP y necesita una referencia rápida sin salir de los docs.

## Organismo y servicios

### ARCA / AFIP

ARCA (Agencia de Recaudación y Control Aduanero) es el organismo que sucedió a AFIP como autoridad fiscal argentina. ARCLI habla con los web services de ARCA para autorizar comprobantes; en la documentación y en el código, "ARCA" y "AFIP" se usan como sinónimos del mismo organismo.

### WSAA

Web Service de Autenticación y Autorización. Es el servicio de ARCA que entrega un [TA](#ta) a partir del certificado y clave configurados. Todo comprobante necesita un TA válido antes de poder emitirse.

### TA

Ticket de Acceso. Credencial temporal que devuelve WSAA y que habilita a operar contra los servicios de facturación de ARCA por un tiempo limitado. Si ARCLI pide uno nuevo mientras el anterior sigue vigente, ARCA responde `coe.alreadyAuthenticated` (ver [Troubleshooting](troubleshooting.md)).

### Padrón

Base de datos de ARCA con la situación fiscal de cada CUIT. Un comprobante puede aprobarse pero igual traer una observación de padrón (por ejemplo `10217` o `10017`) según la condición del receptor, sin que eso implique un error del CLI.

## Identidad y comprobante

### CUIT / CUIL / DNI

Formas de identificar al receptor de un comprobante:

- **CUIT**: Clave Única de Identificación Tributaria, 11 dígitos. Identifica personas jurídicas o autónomos.
- **CUIL**: Clave Única de Identificación Laboral, 11 dígitos. Identifica trabajadores en relación de dependencia.
- **DNI**: Documento Nacional de Identidad, 7 u 8 dígitos. Se usa cuando el receptor no tiene CUIT/CUIL a mano.

### Consumidor final

Categoría de receptor sin documento identificable. ARCLI la representa con documento `0` y exige IVA receptor `consumidor-final`.

### Condición IVA (IVA receptor)

La situación del receptor frente al IVA: `responsable-inscripto`, `monotributo`, `consumidor-final`, `sujeto-exento`, etc. Define, entre otras cosas, si ARCLI calcula IVA automáticamente (ver [Reglas de validación](validation-rules.md#iva-automático)).

### Punto de venta

Número que identifica la "caja" o punto de emisión dentro de ARCA para un mismo CUIT emisor. Se configura una vez y se reutiliza en cada comprobante.

### Concepto

Qué se está facturando: `productos`, `servicios` o `productos-servicios`. Determina si hace falta informar fechas de servicio (`--dia`, `--servicio-desde`, `--servicio-hasta`).

### Comprobante asociado / `CbtesAsoc`

El comprobante original que una nota de crédito o débito ajusta o anula. `CbtesAsoc` es el nombre del campo tal cual lo espera ARCA dentro del payload; en ARCLI se arma con `--ac`/`--at`, `--apv`, `--ar` y `--acuit`.

### `DocTipo` / `DocNro`

Campos del payload de ARCA para la identidad del receptor: `DocTipo` indica el tipo de documento (CUIT, CUIL, DNI o consumidor final) y `DocNro` el número. Por ejemplo, consumidor final se envía como `DocTipo 99` y `DocNro 0`.

### `CbteTipo` / tipo ARCA

Código numérico con el que ARCA identifica cada tipo de comprobante (Factura A, Nota de crédito B, etc). En ARCLI aparece como `tipoArca` en la salida `--json` y es lo que distingue, por ejemplo, una factura común de su versión de crédito electrónica aunque compartan la misma letra.

### Factura de crédito electrónica (FCE)

Variante electrónica de factura pensada para el régimen de facturación de crédito PyME. Usa la misma estructura que una factura común pero con un tipo ARCA distinto.

## Números y respuesta

### CAE

Código de Autorización Electrónico. El número que ARCA devuelve al aprobar un comprobante; sin CAE, el comprobante no es válido fiscalmente. Viene acompañado de `caeVencimiento`, la fecha límite para entregar ese comprobante.

### Alícuota

El porcentaje de IVA aplicado. ARCLI hoy usa una alícuota fija del `21%` en los casos donde calcula IVA automáticamente (ver [Limitaciones actuales](limitations.md)).

### Estado vs. resultado

- `resultado` es el valor crudo que devuelve ARCA (por ejemplo `A` de aprobado o `R` de rechazado).
- `estado` es la normalización que hace ARCLI (`aprobado`, `observado`, `rechazado`), distinguiendo si hubo observaciones aunque ARCA haya aprobado.

Ver el detalle completo en [Entrada y salida](input-output.md#estado-vs-resultado).
