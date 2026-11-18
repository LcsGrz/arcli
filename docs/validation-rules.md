[← Documentación](README.md)

# Reglas de validación

Resumen rápido:

- primero ARCLI valida flags, tipos y combinaciones
- después aplica reglas de negocio del comprobante
- por último pueden aparecer restricciones o errores propios de ARCA

La idea de esta guía es separar esas tres capas para que sea más fácil entender dónde se rompió el flujo.

## De dónde sale cada regla

Muchas reglas de negocio copian un control de ARCA para cortar antes de llamar al servicio. Si ARCA afloja ese control y ARCLI no se entera, ARCLI bloquea algo que ARCA acepta. Por eso cada regla dice de dónde sale:

- **Propia:** formato, combinación de flags o decisión de ARCLI. ARCA no la define y no hay que revisarla cuando sale un manual nuevo.
- **ARCA `código`:** copiada de un control de ARCA, con su código de error. Los `10xxx` son del manual del desarrollador de WSFEv1 (facturas, notas y recibos A, B y C, y FCE) y los de cuatro dígitos (`1xxx`, `2xxx`), del de WSFEX (la `E`).
- **Consulta:** ARCLI no copia la regla, le pregunta a ARCA antes de la vista previa (ver [Arquitectura](architecture.md#decisiones-de-diseño)).
- **Sin confirmar:** ARCLI la aplica como si fuera de ARCA, pero el manual no tiene un código que la respalde y `yarn test:arca` no la prueba.

Cuando ARCA testing acepta lo que ARCLI bloquea, la regla figura como propia y dice "ARCA testing lo acepta": queda para decidir si se afloja.

| Servicio | Manual con el que se revisaron los códigos                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSFEv1   | [RG 4291, Proyecto FE v4.7](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf), revisión del 1/9/2026         |
| WSFEX    | [Factura de exportación v3.1.0](https://www.afip.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf), del 18/8/2025 |
| WSFECred | Ninguna regla copiada: ARCLI solo lo consulta (régimen FCE del receptor y estado del asociado de una anulación)                                   |

En el código, cada regla copiada lleva un comentario con el código y el manual (`WSFEv1 v4.7` o `WSFEX v3.1.0`): cuando sale un manual nuevo, `grep -rn "WSFEv1 v4.7" src` lista lo que hay que revisar. `yarn test:arca` manda a ARCA testing el caso límite de cada regla copiada sin pasar por la validación de ARCLI y comprueba que ARCA lo rechaza con ese código (ver [Desarrollo](development.md#contra-arca-testing)).

## 1. Validaciones del CLI

Todas las de esta sección son **propias**: formato de los datos y combinaciones de flags.

### Flags mutuamente excluyentes

- `--testing` y `--produccion`
- `--emitir` y `--previsualizar`
- `--concepto` y cualquiera de `--cs`, `--cp`, `--csp`
- `--iva-receptor`, `--ir` y cualquier `--ir-*`
- `--ac` y `--at`
- `--misma-moneda` y `--cotizacion-moneda` / `--cm`
- `--condicion-venta` / `--cv` y `--sin-condicion-venta`
- `--exportar-pdf` y `--sin-pdf`
- en el JSON de `--cargar`, `"emitir": true` y `"previsualizar": true` a la vez
- combinaciones múltiples de identidad del receptor:
  - `--cuit`
  - `--cuil`
  - `--dni`
  - `--consumidor-final`
  - `--cfinal`

### Tipos y formatos

- `--monto` debe ser un número positivo
- `--dia` (deprecado: usá `--vencimiento` o `--vto`) debe ser un entero entre `1` y `31`. Fija solo el vencimiento: este mes si el día todavía no pasó y si no, el siguiente; si ese mes no tiene ese día (`--dia 31` en abril), da error. No se combina con `--vencimiento`/`--vto`
- `--punto-venta`, `--pv`, `--at`, `--apv`, `--ar` deben ser enteros positivos, escritos solo con dígitos (`3a` da error)
- `--cuit`, `--cuil`, `--acuit` y `--dni` aceptan guiones, puntos y espacios (`20-33333333-4`, `20 33333333 4`), pero nada más. Lo mismo el CUIT de `arcli padron`, `arcli fce-obligado`, `config establecer cuit` y `comprobanteAsociado.cuit` en el JSON
- `--at` se valida igual que `--ac`: una NC A no puede asociar una factura B. Si en el JSON vienen `tipo` y `atajo`, tienen que coincidir
- `--cotizacion-moneda` y `--cm` deben ser números positivos
- Todo CUIT o CUIL debe tener 11 dígitos y un dígito verificador válido: un número mal tipeado da error antes de llegar a ARCA
- `--dni` debe tener 7 u 8 dígitos
- `--condicion-venta` / `--cv` (y `condicionVenta` en el JSON o la config) acepta hasta 100 caracteres
- En el JSON de `--cargar`, una clave desconocida o un tipo incorrecto (`"puntoVenta": "3"`) es error: ver [claves desconocidas y tipos](input-output.md#claves-desconocidas-y-tipos)

### Fechas aceptadas

ARCLI interpreta las fechas en formato argentino (día primero), con mes y año opcionales:

- `D` o `DD`
- `D-MM` o `D/MM`
- `D-MM-YY` o `D/MM/YY`
- `D-MM-YYYY` o `D/MM/YYYY`

Reglas de interpretación:

- "hoy" es siempre el día en Argentina, aunque el equipo esté en otra zona horaria (por ejemplo un servidor en UTC después de las 21 h)
- si omitís el año, ARCLI usa el de la fecha más cercana a hoy: el 5/1/2027, `1/12` es el 1/12/2026; el 28/12/2026, `10/1` es el 10/1/2027. Cuenta solo un año donde esa fecha existe: el 1/9/2028, `29/2` es el 29/2/2028. Para una fecha a más de seis meses, escribí el año
- si omitís mes y año, ARCLI usa el mes y año actuales
- un año de 2 dígitos se interpreta como `20YY`
- no se pueden mezclar separadores dentro de la misma fecha (por ejemplo, `5-3/26` no es válido)

Formatos como `YYYY-MM-DD` no son válidos.

Si el formato no coincide, ARCLI corta antes de armar el payload.

### Emisión en producción

ARCLI no tiene una regla aparte para producción: emite si `--emitir` lo pide o, sin `--emitir` ni `--previsualizar`, si lo pide `"emitir"` del JSON de `--cargar` o `config.emitir`. Con `entorno produccion` y `emitir true` en la config, un comando sin flags emite en producción sin preguntar. Si nada pide emitir, en una terminal se muestra la vista previa y se pregunta; con `--json` o sin terminal no se emite. Detalle en [Emisión en producción](cli-reference.md#emisión-en-producción).

## 2. Reglas de negocio

### Punto de venta

- Puede venir por flags o por config.
- Si falta en ambos lugares, el flujo falla antes de emitir. Propia.

### Concepto y fechas de servicio

#### `productos`

- no usa `--servicio-desde` ni `--servicio-hasta` (ARCA 10049: el manual solo dice que son obligatorias en servicios, pero ARCA testing las rechaza en productos con ese código)
- no usa `--vencimiento` ni `--dia`, salvo en facturas FCE (ARCA 10049, como las fechas de servicio; en FCE, 10163 y 10175)

#### `servicios` y `productos-servicios`

- si informás una fecha de servicio, tenés que informar ambas (ARCA 10031 y 10033)
- la fecha de inicio no puede ser posterior a la de fin (ARCA 10032)

#### Vencimiento de pago (`FchVtoPago`)

| Comprobante                                                | ¿Se envía? | Default sin `--vencimiento`                                     | Mínimo                                 |
| ---------------------------------------------------------- | ---------- | --------------------------------------------------------------- | -------------------------------------- |
| Servicios / productos y servicios                          | sí         | el fin del servicio, o la fecha del comprobante si es posterior | fecha del comprobante (10036)          |
| Factura FCE (`fcea`, `fceb`, `fcec`), incluso de productos | sí (10163) | la fecha del comprobante o hoy, la que sea posterior            | la fecha del comprobante o hoy (10164) |
| NC/ND FCE                                                  | no (10175) | —                                                               | `--vencimiento` da error               |
| Productos (no FCE)                                         | no         | —                                                               | `--vencimiento` da error               |

Los códigos de la tabla son de ARCA (el "no" de productos sin FCE, 10049); los defaults son propios.

`--vencimiento` permite separar el vencimiento del período facturado. Por ejemplo, un servicio de febrero facturado el 18/03 que vence el 10/04. `--dia` (deprecado) sigue las mismas reglas que `--vencimiento`.

### Fecha del comprobante

ARCA solo acepta una `CbteFch` cercana a la fecha de envío (ARCA 10016 para el rango y 10152 para el mes). ARCLI lo valida antes de llamar al servicio:

| Comprobante                       | Desde         | Hasta         | Fecha futura               |
| --------------------------------- | ------------- | ------------- | -------------------------- |
| Productos                         | hoy − 5 días  | hoy + 5 días  | solo dentro del mes actual |
| Servicios / productos y servicios | hoy − 10 días | hoy + 10 días | sin restricción de mes     |
| FCE (facturas y notas)            | hoy − 5 días  | hoy + 1 día   | solo dentro del mes actual |

ARCA además exige que la fecha no sea anterior a la del último comprobante emitido para ese tipo y punto de venta. Esa regla no se valida localmente, porque depende de lo ya emitido.

### Identidad del receptor

#### Consumidor final

Si usás consumidor final:

- el documento debe ser `0` (ARCA 10015)
- el IVA receptor debe ser `consumidor-final`: con `--consumidor-final` (o `tipoDocumento: "consumidor-final"` en el JSON) ARCLI ya lo asume y no hace falta `--ir-cf`, aunque la config tenga otro `ivaReceptor`. Un IVA explícito distinto (`--ir-rm` con `--cfinal`) es error. Propia: ARCA testing aprueba una factura B a consumidor final con IVA receptor exento
- el total en pesos tiene que ser menor a `$ 10.000.000`. Desde ese monto hay que identificarlo con `--dni`, `--cuit` o `--cuil` ([RG 5700/2025](https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5700.pdf)). En moneda extranjera se compara `monto × cotización`. ARCA 10015, que nombra el monto "según RG 4444": el valor lo fija la RG vigente, no el manual

#### CUIT, CUIL y DNI

- si el tipo de documento no es `consumidor-final`, ARCLI exige `numeroDocumento` (ARCA 10015)

### IVA receptor

ARCLI exige una única fuente de IVA receptor:

- `--iva-receptor <tipo>`
- `--ir <tipo>`
- un solo `--ir-*`
- `--consumidor-final`, que implica `consumidor-final`
- o un default configurado

Eso es propio. Además, la condición tiene que ser válida para la letra del comprobante. ARCLI aplica la misma tabla que devuelve ARCA en `FEParamGetCondicionIvaReceptor` (ARCA 10243); `yarn test:arca` la compara con la que devuelve ARCA testing. Una diferencia conocida: la tabla de ARCA marca consumidor final solo para `C`, pero ARCA aprueba la factura `B` a consumidor final:

| Letra | IVA receptor admitido                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A`   | `responsable-inscripto`, `responsable-monotributo`, `monotributista-social`, `monotributo-trabajador-independiente-promovido`                       |
| `B`   | `sujeto-exento`, `consumidor-final`, `sujeto-no-categorizado`, `proveedor-del-exterior`, `cliente-del-exterior`, `iva-liberado`, `iva-no-alcanzado` |
| `C`   | todas                                                                                                                                               |

Si la combinación no es válida, el error sugiere la letra que corresponde. Ejemplo: `fb` con `--ir-ri` sugiere usar letra `A`.

### Comprobantes asociados

Aplica a:

- `nota-credito`
- `nota-debito`
- `nota-credito-electronica`
- `nota-debito-electronica`

No aplica a:

- `factura`
- `factura-credito-electronica`
- `recibo` (`ra`, `rb`, `rc`)

Para notas, ARCLI acepta un comprobante asociado **o** un período asociado (`PeriodoAsoc`), pero no ambos (ARCA 10197: el manual dice "o", y ARCA testing rechaza los dos juntos con ese código).

Período asociado (`--periodo-desde` y `--periodo-hasta`):

- solo en notas comunes: en facturas (ARCA 10198) y en notas FCE (ARCA 10196) da error
- requiere las dos fechas (ARCA 10199 y 10203)
- desde ≤ hasta (ARCA 10207), y ambas posteriores al 01/01/2006 (ARCA 10206)
- hasta ≤ fecha de la nota (ARCA 10208)

Comprobante asociado (si no se usa el período), que necesita:

- `--ac` o `--at` (ARCA 10057)
- `--apv` o `--asociado-punto-venta` (ARCA 10058)
- `--ar` (ARCA 10059)
- `--acuit`, salvo en NC/ND FCE, donde se puede omitir y toma el CUIT emisor. Propia en las notas comunes (ARCA lo acepta sin CUIT); en FCE, ARCA 10151 y 10155

Con período asociado no hace falta ninguno de estos flags, `--acuit` incluido.

Además:

- en NC/ND A, B y C el asociado es una factura, un recibo u otra nota de la misma letra (NC o ND) (ARCA 10040). Ej.: una NC C sobre una ND C, `--ac ndc`, o una NC A sobre un Recibo A, `--ac ra`
- en NC/ND FCE el asociado depende de `--anulacion`: sin anulación, solo la factura FCE (ARCA 10156, 10157); con anulación, la NC asocia la factura o una ND FCE y la ND solo una NC FCE (ARCA 10183, y 10186, 10187 y 10193 para A, B y C). Otro asociado es error, con la sugerencia de sumar o sacar `--anulacion` si con eso vale
- con `--anulacion`, ARCA exige que el comprador haya rechazado antes el asociado en el Registro de FCE (ARCA 10154). Consulta: ARCLI consulta su estado en `wsfecred` (`consultarHistorialEstadosComprobante`) antes de la vista previa y, si no está rechazado o la consulta falla, lo avisa en `avisos` sin frenar. Solo se consulta un asociado del propio emisor
- la letra debe coincidir (ARCA 10040)
- la categoría electrónica debe coincidir (ARCA 10040 y 10157)
- `--afecha` es opcional y no puede ser posterior a la fecha de la nota (ARCA 10159, que el manual pone solo en FCE: en las notas comunes está sin confirmar). En NC/ND FCE ARCA la exige (ARCA 10158): sin `--afecha`, ARCLI la toma del asociado en ARCA antes de la vista previa; si ARCA no lo tiene o no responde, es error
- si el asociado es del propio emisor, tiene que existir en ARCA. Antes de la vista previa, ARCLI consulta el asociado en ARCA (`FECompConsultar`), una vez por nota y se reusa al emitir; si ARCA no lo tiene y su punto de venta es uno de los de web service del emisor (`FEParamGetPtosVenta`; si esa lista viene vacía, como en testing, cuenta si ARCA tiene comprobantes de ese tipo en ese punto de venta), es `INPUT_VALIDATION_ERROR`, como en las notas `E`: es casi seguro un número mal escrito (propia: ARCA testing llega a aprobar una nota asociada a un comprobante que no existe). Si el punto de venta no es de web service (Comprobantes en línea, controlador fiscal, otro sistema), `FECompConsultar` no ve ese comprobante y ARCA lo acepta (10041 solo controla los de un punto de venta electrónico; 10211 y 10212 prevén los de controlador fiscal o FactuWeb): la nota sigue con un aviso, sin controlar el tope de la NC, y recuerda `--afecha` (10211 la exige para controlador fiscal y FactuWeb); en NC/ND FCE sin `--afecha` es error, porque la fecha no se puede tomar de ARCA. Si la consulta de puntos de venta falla, también aviso. El asociado de otro CUIT no se puede consultar y lo decide ARCA al emitir. Si ARCA no responde, la nota sigue con un aviso. Consulta; en un punto de venta de web service, más estricta que ARCA a propósito: en las notas comunes el manual lo pone como observación (10041), no como rechazo; en FCE sí rechaza (ARCA 10160)
- una nota de crédito no puede superar el total del asociado (factura, recibo o nota de débito) cuando van en la misma moneda; sobre otra nota de crédito no hay tope, como en la `E`. Se controla con la misma consulta y es un `INPUT_VALIDATION_ERROR` con la sugerencia del `--monto` que la anula entera. Propia: el manual pone el tope como observación (10237) y ARCA aprueba la nota

### Crédito electrónico (FCE)

ARCLI arma `Opcionales` (los "Adicionales por R.G.") según el comprobante. Todos los códigos de la tabla son de ARCA (10215 cubre los valores de la transferencia):

| Comprobante                          | `Opcionales`                                                 | Reglas                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factura FCE (`fcea`, `fceb`, `fcec`) | `2101` CBU, `2102` alias (si se informa), `27` transferencia | El CBU es obligatorio (10168) y tiene 22 dígitos (10165) con sus dos dígitos verificadores (regla propia de ARCLI, ver abajo). El alias tiene de 6 a 20 caracteres (10166). La transferencia es `SCA` o `ADC`, por defecto `SCA` (10216). `--anulacion` da error (10171). |
| NC/ND FCE (`ncea`…`ndec`)            | `22` anulación: `S` con `--anulacion`, si no `N`             | Obligatorio (10173). `--cbu`, `--alias` y `--transferencia` dan error (10172). Sin `--afecha`, la fecha del asociado sale de ARCA (10158). El asociado tiene que ser del CUIT emisor (10155), así que `--acuit` se puede omitir.                                          |
| Resto                                | ninguno                                                      | `--cbu`, `--alias`, `--transferencia` y `--anulacion` dan error (10169).                                                                                                                                                                                                  |

### Régimen FCE del receptor

Consulta, sin regla copiada. Con `config.verificarFce` en `true`, ARCLI consulta `wsfecred` (`consultarMontoObligadoRecepcion`) antes de la vista previa. La consulta corre en facturas comunes y FCE con `--cuit` del receptor, usando la fecha del comprobante. Los avisos posibles son:

| Comprobante            | Receptor                             | Aviso                               |
| ---------------------- | ------------------------------------ | ----------------------------------- |
| `fa`, `fb`, `fc`       | obligado y monto (en pesos) ≥ mínimo | Corresponde `fcea`, `fceb` o `fcec` |
| `fcea`, `fceb`, `fcec` | no obligado                          | Corresponde `fa`, `fb` o `fc`       |
| `fcea`, `fceb`, `fcec` | obligado, pero monto < mínimo        | Corresponde `fa`, `fb` o `fc`       |

Los avisos aparecen en la salida de texto (panel "Avisos") y en el campo `avisos` del JSON. No frenan la emisión. Si la consulta falla, por ejemplo porque el certificado no tiene autorizado `wsfecred`, el motivo también llega como aviso.

El CBU se valida igual en `--cbu`, la clave `cbu` del JSON de `--cargar`, `config establecer cbu` (y la config ya guardada) y el modo interactivo. Además del largo, ARCLI controla los dos dígitos verificadores, una regla propia y no de ARCA, para frenar un CBU mal escrito antes de ir a ARCA. El CBU tiene dos bloques: banco y sucursal (los primeros 8 dígitos; los 7 primeros con pesos 7 1 3 9 7 1 3) y cuenta (los últimos 14; los 13 primeros con pesos 3 9 7 1 3 9 7 1 3 9 7 1 3). El último dígito de cada bloque es `(10 − suma % 10) % 10`. Si no coincide, es un `INPUT_VALIDATION_ERROR` que dice qué bloque está mal. No se controla que el código de banco exista.

`config.cbu` y `config.aliasCbu` solo se aplican a facturas FCE. ARCA además exige que el CBU esté registrado a nombre del emisor (10174), cosa que no se puede validar localmente.

### Moneda y cotización

`--moneda` acepta el código ISO o el de ARCA de cualquier moneda de la tabla de ARCA (`arcli parametros monedas`) que tenga ISO: `ARS` → `PES`, `USD` → `DOL`, `EUR` → `060`, `UYU` → `011`… Un código que no está en la tabla se envía tal cual.

| Caso                                | `MonCotiz`          | `CanMisMonExt` | Regla                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pesos                               | `1`                 | no se envía    | Una cotización distinta de `1` da error (ARCA 10039). `--misma-moneda` da error (ARCA 10241).                                                                                                                                                                                                                   |
| Moneda extranjera, pago en pesos    | `--cm` o la oficial | `N`            | Sin `--cm`, ARCLI usa la oficial de ARCA y lo avisa (consulta). `--cm 1` da error. ARCA la acepta entre el 2% y el 400% de la oficial (ARCA 10119): `--cm 1` es propia, ARCLI no compara contra la oficial.                                                                                                     |
| Moneda extranjera, `--misma-moneda` | la oficial de ARCA  | `S`            | ARCLI la consulta antes de la vista previa porque ARCA exige el valor exacto (ARCA 10038; ARCA testing tolera hasta 1 de diferencia y rechaza con 10240). La fecha del comprobante tiene que ser la de hoy (propia): la cotización de un día pasado no se puede consultar y la de uno futuro todavía no existe. |

La clave `cotizacion` de la config (deprecada) se usa como default en moneda extranjera sin `--misma-moneda` ni `--cm`, con un aviso; si vale `1` o no está, se usa la oficial de ARCA.

### Factura de exportación (E)

WSFEX tiene su propio contrato: las reglas de concepto, fecha de servicio, IVA receptor, IVA y comprobante asociado no corren para `E`, y tampoco se usan `concepto`, `ivaReceptor`, `alicuota`, `cbu` ni `aliasCbu` de la config. Los códigos de estas tablas son de WSFEX v3.1.0.

| Regla               | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requeridos          | `--cliente` (ARCA 1650), `--domicilio-cliente` (1660) y `--pais-destino` (1560), salvo en las notas con asociado, que los heredan. `--monto` > 0 es propio: ARCA acepta `Imp_total` en 0 (1610), pero una `E` en cero no tiene uso. Se validan antes de ir a ARCA. La actividad no es obligatoria: ver Actividad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| País de destino     | Código (`203`) o nombre (`Brasil`), contra la tabla de WSFEX. Argentina (`200`) da error: para el mercado local van `arcli factura a` o `arcli factura b`. La tabla es consulta; Argentina es propia: ARCA testing aprueba una `E` con destino `200`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CUIT del país       | `--cuit-pais` tiene que existir en la tabla de CUIT de países y ser del país de destino. Sin el flag se busca por país, prefiriendo la fila de persona jurídica; si la tabla no trae el país, `Cuit_pais_cliente` no se manda y alcanza con `--id-impositivo` (ARCA pide uno de los dos, 1580): sin ninguno es error. La tabla nombra cada país con el tipo de entidad (`BRASIL - Persona Jurídica`), así que el sufijo, los acentos y las mayúsculas no cuentan, y cuando las dos tablas lo nombran distinto (`CHINA` y `CHINA REP.POPULAR`) solo se valida que el CUIT exista. Consulta de la tabla (ARCA 1570 y 1580)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Ítems               | `--item` con 3 a 5 partes separadas por `\|`: cantidad y precio mayores a 0, descripción obligatoria. La unidad es un código de ARCA o el nombre de la tabla de unidades, sin mayúsculas y con singular o plural (`unidad` o `unidades`); una unidad desconocida es error. Las unidades 0, 97 (seña o anticipo) y 99 (bonificación) van sin cantidad ni precio (ARCA 1775), así que con cantidad y precio son error. El código hasta 50 caracteres (ARCA 1760) y la descripción hasta 4000 (ARCA 1770). Formato propio; unidad contra la tabla (ARCA 1790)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Suma de ítems       | Se redondea cada renglón a 2 decimales y la suma tiene que coincidir con `--monto`. Se valida antes de WSAA. ARCA 1610 en el manual; el código decía que WSFEX no lo compara                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--tipo-expo`       | `1` bienes, `2` servicios (por defecto) o `4` otros (ARCA 1540)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Actividad           | Opcional, de `--actividad` o de `exportacion.actividad`; no hay default. Sin ninguna, el `Cmp` va sin el bloque `Actividades`: ARCA no lo exige y la 2100 solo rechaza el bloque vacío (ARCA testing aprobó una `E` sin él). Si se informa, es un entero positivo y se compara con la tabla de actividades de WSFEX (`FEXGetPARAM_Actividades`), que no es la del padrón: si el código no está, es error de validación con las actividades que empiezan igual, porque ARCA lo rechaza (error 2105). Consulta de la tabla                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bloques vacíos      | En la factura, `Cmps_asoc` y `Opcionales` no se envían: ARCA rechaza el bloque vacío (error 1820 el de `Cmps_asoc`; en la factura, además, 1755)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--incoterm`        | Código de la tabla, sin importar mayúsculas (consulta). Obligatorio en la factura de bienes (ARCA 1640; en servicios, otros y las notas es opcional). Si no pasás `--incoterms-desc`, la descripción sale de la tabla; `--incoterms-desc` va solo con incoterm (ARCA 1641) y hasta 20 caracteres (ARCA 1642)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--idioma`          | Código de la tabla; por defecto `1` (español). Consulta (ARCA 1630)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Permisos            | `--permiso` requiere `--permiso-existente` y `--permiso-existente` sin permisos es error. Se deduplican y solo aplican a `--tipo-expo 1`: en `2` (servicios) y `4` (otros) ARCA exige `Permiso_existente` vacío (error 1550), así que ARCLI manda el campo en `""` y rechaza los permisos. Sin permisos el campo `Permisos` no se envía: ARCA lo rechaza (error 1720) cuando `Permiso_existente` es `N`. Que `--permiso` pida `--permiso-existente` es propio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Permiso en ARCA     | Antes de la vista previa, cada permiso se consulta en ARCA (`FEXCheck_Permiso`) con el país de destino. Si ARCA contesta `NO`, `INPUT_VALIDATION_ERROR` y no se emite: ARCA lo rechazaría. Si la consulta falla, sigue con un aviso. En testing ARCA contesta `OK` a cualquier permiso. Consulta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Numeración          | WSFEX numera por punto de venta y tipo: sin `--numero` sale del último de ese tipo más uno (`FEXGetLast_CMP`), y sin `--id-solicitud`, del último de WSFEX más uno (consulta). `--numero`, `--id-solicitud` y `--punto-venta` son enteros positivos. Topes, también para lo que pasás a mano: `--numero` hasta 99.999.999 (ARCA 1520), `--punto-venta` y `--apv` hasta 99.998 (ARCA 1510) y `--id-solicitud` hasta 15 dígitos (tabla de campos, `Id` N15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Largo de los textos | Hasta lo que acepta ARCA, contando caracteres: `--cliente` 200 (ARCA 1651), `--domicilio-cliente` 300 (ARCA 1661), `--observaciones` 1000 y `--obs-comerciales` 4000 (ARCA 1665), `--descripcion` 4000 (ARCA 1770), `--incoterms-desc` 20 (ARCA 1642), y `--forma-pago` e `--id-impositivo` 50 (tabla de campos, sin código de control). Más largo es error antes de ir a ARCA, también en `--cargar` y en el modo interactivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Fecha               | La del comprobante, en la factura y en las notas, va de 5 días antes a 5 días después de hoy y, en servicios, no después del fin de mes (ARCA 1500; testing aprueba +1 y rechaza +6 y −6). Con fecha futura, la cotización es la de hoy o, en servicios y con `--misma-moneda`, la del día hábil anterior a hoy (2053 e historial 3.0.0), y la vista previa avisa que las siguientes de ese punto de venta y tipo van a tener que llevar esa fecha o una posterior (ARCA 1535). `--fecha-pago` por defecto es la del comprobante, no puede ser anterior a ella (ARCA 1674) y va solo en servicios y otros: en bienes ARCA la rechaza (error 1673), así que no se manda y sale un aviso. La fecha de pago, ARCA 1672 y 1673; en bienes, observado en testing (el manual solo la prohíbe en las notas)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Moneda              | Por defecto `DOL` (dólares); `--moneda` acepta `ARS`/`PES` y el resto de la tabla de monedas de WSFEX (`DOL`, `PES`, `060`…). La cotización que falta sale de `FEXGetPARAM_MON_CON_COTIZACION`, la cotización de aduana de WSFEX, pedida en `yyyymmdd` (`Fecha_CTZ`). En bienes y otros se pide con la fecha del comprobante —por defecto hoy—; ARCA publica la del día una vez por día: hasta entonces se usa la última publicada y la vista previa avisa de qué día es. En la factura de servicios, y en cualquier factura con `--misma-moneda`, ARCA exige la del día hábil anterior a la fecha del comprobante (2053; con `--misma-moneda`, el historial 3.0.0 del manual), así que se pide la del día anterior y WSFEX devuelve la última publicada hasta ese día: un lunes o después de un feriado, la del último día hábil, con un aviso. Las notas heredan la cotización del asociado (2053). Para fijar otra, `--cotizacion-moneda`, que tiene que ser mayor a 0 (ARCA 1600): hay monedas que valen menos de un peso, como el guaraní (`029`). En la factura de servicios y con `--misma-moneda` no hay otra: `--cotizacion-moneda` tiene que ser exactamente la que exige ARCA (2053 en servicios; 1604 y el historial 3.0.0 con `--misma-moneda`), así que ARCLI la compara con la de ARCA y, si no coincide, es error con la que corresponde; si ARCA no informa la moneda, no se compara. En pesos la cotización es 1, `--misma-moneda` no aplica y `CanMisMonExt` no se manda (ARCA 1605). Consulta de la tabla de cotizaciones |
| Defaults de config  | Propio. Aplican `puntoVenta` y `exportacion.actividad`. `moneda` y `cotizacion` no: la exportación va en `DOL` salvo `--moneda`, con la cotización de aduana de ARCA salvo `--cotizacion-moneda`. Los de concepto, IVA, CBU y padrón tampoco                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Notas de crédito y débito de exportación (E)

`nce` y `nde` siguen las reglas de la factura `E`, con estas diferencias. Todo se valida antes de emitir; lo que depende del asociado, después de consultarlo en ARCA (`FEXGetCMP`).

| Regla             | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asociado          | `--ar` obligatorio en las notas de servicios (ARCA 2047); en bienes y otros es opcional (ARCA testing aprobó una NC de bienes sin asociado) y sin él la nota no hereda nada: los datos del cliente van por flag. Con `--ac`, `--at`, `--apv` o `--acuit` sin `--ar` es error (propia). `--ac` (`fe`, `nde`, `nce`) o `--at` (`19`, `20`, `21`); por defecto una factura `E`. Si van los dos, tienen que coincidir                                                                                                                      |
| CUIT del asociado | Siempre el emisor: `--acuit` con otro CUIT es error (ARCA lo rechaza con el 2031)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Existencia        | El asociado tiene que existir en ARCA y estar aprobado. Consulta (`FEXGetCMP`; ARCA 1749 y 2048)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Datos que hereda  | Propio. Cliente, domicilio, ID impositivo, destino, CUIT del país, tipo de exportación, moneda, cotización (si la moneda es la misma), idioma, incoterm, forma de pago y actividad                                                                                                                                                                                                                                                                                                                                                     |
| Fecha             | No puede ser anterior a la del asociado. ARCA 2052 en servicios; en bienes y otros, sin confirmar                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Monto de la NC    | No puede superar el total del asociado cuando van en la misma moneda. Propia: el manual de WSFEX no tiene ese control y ARCA testing aprueba la NC                                                                                                                                                                                                                                                                                                                                                                                     |
| Servicios (`2`)   | En una nota de servicios: mismo tipo de exportación (2049), destino (2050), moneda o pesos (2051) y cotización (2053) que el asociado. La ND solo ajusta una factura (2041, 2042); la NC no ajusta otra NC (2045), ni una ND que no ajusta una factura (2055). Los controles 2040 a 2055 miran el tipo de la **nota**: una nota de bienes (`1`) u otros (`4`) ajusta cualquier factura, ND o NC `E`, también de servicios, con otro destino, moneda o cotización (ARCA testing aprobó una NC de tipo 4 sobre una factura de servicios) |
| No van            | `--fecha-pago` (1673), `--misma-moneda` (1605, que ARCA testing no aplica: aprueba la nota con `CanMisMonExt` en `S`) y `--permiso-existente`. `Permiso_existente` va vacío (1550); en bienes, `--permiso` es opcional y va sin él y `Cmps_asoc` lleva un solo asociado (1754)                                                                                                                                                                                                                                                         |

### IVA automático

ARCLI calcula IVA automáticamente en todos los comprobantes letra `A` y `B`, sea cual sea el IVA receptor. Los letra `C` no informan IVA.

El total se reparte así (ARCA 10048; en letra `C`, 10043, 10044, 10047 y 10071):

```
ImpTotal = ImpTotConc (--nogravado) + ImpOpEx (--exento) + ImpNeto + ImpIVA
```

- `ImpNeto` e `ImpIVA` salen del resto del total con la alícuota de `--alicuota`, o la de `config.alicuota`, o `21`. Se redondean a 2 decimales. `config.alicuota` no se aplica a letra `C`.
- `--exento` + `--nogravado` no pueden superar el total (ARCA 10045: el neto no puede ser negativo). Si lo igualan, no hay neto gravado ni array `Iva`.
- Con neto mayor a cero siempre se envía el array `Iva`, también al 0% (10070).
- En letra `C`, `--alicuota`, `--exento` y `--nogravado` dan error, porque ARCA exige que esos importes sean cero.

Los ids son los de `FEParamGetTiposIva`; `yarn test:arca` los compara con los de ARCA testing.

| Alias          | Número | Id ARCA |
| -------------- | ------ | ------- |
| `cero`         | `0`    | `3`     |
| —              | `2.5`  | `9`     |
| —              | `5`    | `8`     |
| `reducida`     | `10.5` | `4`     |
| `general`      | `21`   | `5`     |
| `incrementada` | `27`   | `6`     |

`--alicuota` acepta el alias o el número, con coma o punto decimal y un `%` final (`reducida`, `10,5`, `10.5`, `10.5%`).

#### Varias alícuotas en un comprobante

Repetí `--alicuota TASA:MONTO`, con el importe de cada alícuota **IVA incluido**, igual que `--monto`:

```bash
arcli fa --cs --cuit 30709965812 --ir-ri --alicuota general:1210 --alicuota reducida:552,50
```

- Cada monto se parte en neto e IVA según su tasa, y se envía una entrada de `Iva` por alícuota. La suma de los netos es `ImpNeto` (10061).
- `--monto` pasa a ser opcional. Sin él, el total es la suma de las alícuotas más `--exento` y `--nogravado`. Si lo pasás, tiene que coincidir exactamente con esa suma.
- Si la misma alícuota aparece dos veces, se suman sus montos (ARCA 10022: el id no se repite).
- No se puede mezclar `--alicuota TASA` con `--alicuota TASA:MONTO`, ni repetir `--alicuota TASA` sin monto.
- En JSON: `"alicuotas": [{ "tasa": "general", "monto": 1210 }, { "tasa": "10.5", "monto": 552.5 }]`.

### Recibo A, B y C

Cada recibo usa las mismas validaciones y el mismo armado que la factura de su letra, sin comprobante asociado y sin FCE (las mismas fuentes que la factura):

| Recibo | Atajo | Tipo ARCA | Como la     | Receptor e IVA                                                                      |
| ------ | ----- | --------- | ----------- | ----------------------------------------------------------------------------------- |
| A      | `ra`  | 4         | Factura `A` | Solo con CUIT y sin consumidor final; discrimina IVA (`--alicuota`, por defecto 21) |
| B      | `rb`  | 9         | Factura `B` | Consumidor final, DNI, CUIL o CUIT, sin responsable inscripto; el IVA va incluido   |
| C      | `rc`  | 15        | Factura `C` | Cualquier receptor; sin IVA                                                         |

Cada uno puede ser el asociado de una nota de crédito o débito de su letra (`--ac ra`, `--ac rb`, `--ac rc`, o `--at 4`, `9` o `15`). ARCA es quien acepta o rechaza el tipo según el punto de venta y la condición del emisor: el A y el B los emite un responsable inscripto, y el C un monotributista o exento.

## 3. Restricciones y errores de ARCA

Hay rechazos que ARCLI no puede anticipar: errores transitorios de WSAA (`coe.alreadyAuthenticated`, `Transacción Activa`), receptor igual al emisor, observaciones de padrón y fechas anteriores al último comprobante emitido. Ver [Troubleshooting](troubleshooting.md#arca) y [Limitaciones](limitations.md).
