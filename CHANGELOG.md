[← Volver al README](README.md)

# Changelog

Todos los cambios relevantes de ARCLI se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/). Como el contrato del CLI es público (comandos, flags, claves de config y JSON), cada entrada aclara qué cambia para quien ya lo usa.

## [Sin publicar]

### Agregado

- **Consumidor final con datos en el modo interactivo:** la primera pregunta ofrece **Consumidor final** (ya no "Consumidor final (sin identificar)"). Si el total en pesos llega a $ 10.000.000 (RG 5700/2025, monto × cotización), el asistente avisa que ARCA pide los datos del consumidor final y pregunta su documento (DNI, CUIT o CUIL) y el número, con la condición IVA consumidor final. Si la moneda o la cotización se eligen en los opcionales, o es la oficial de ARCA, lo pregunta después de los opcionales, antes de la vista previa. Por debajo de ese monto, **Datos del consumidor final** está entre los opcionales de las facturas, recibos y notas de período B y C. Vale también en recibos, notas y "Repetir". "Volver" va pregunta por pregunta: del número al tipo de documento y de ahí al monto. Si lo respondiste como obligatorio y después bajás el monto, queda entre los opcionales, marcado y con lo escrito; si cambiás de receptor (en "Repetir", de comprobante) y seguís, lo escrito se descarta. El comando equivalente lleva `--dni N --ir-cf` (o `--cuit`, `--cuil`), como con flags; sin identificar sigue con `--consumidor-final`. Antes, a consumidor final desde ese monto la vista previa frenaba con un error y había que volver a empezar con DNI. Los flags y el `--json` no cambian.
- **Fechas relativas en los flags y en `--cargar`:** todo flag de fecha (`--fecha`, `--vto`/`--vencimiento`, `--sd`/`--sh`, `--afecha`, `--pd`/`--ph`, `--fecha-pago` de la `E` y `--fecha` de `fce-obligado`) acepta `hoy`, `ayer`, `+N` y `-N` (N días desde hoy, hasta 999). En desde y hasta (`--sd`/`--sh`, `--pd`/`--ph`) también `mes-actual` y `mes-pasado`: en desde dan el día 1 del mes y en hasta, el último día, como "Este mes" y "El mes pasado" del modo interactivo. Las mismas palabras valen en las claves de fecha del JSON de `--cargar`, sin distinguir mayúsculas. Sirve para un abono mensual por cron: `arcli fc -m 50.000 --cs --cfinal --sd mes-pasado --sh mes-pasado --vto +10 --emitir`. "Hoy" es la fecha argentina, las validaciones de fechas se aplican sobre la fecha resuelta y la vista previa y el `--json` la muestran, nunca la palabra. Las fechas escritas a mano y el `--json` no cambian.
- **`arcli monotributo`: categorías, topes y cuotas del monotributo.** Muestra las 11 categorías (A a K) con el tope de ingresos anuales y la cuota mensual de servicios y de ventas, con tu categoría marcada si el CUIT de la config es monotributista (la lee una vez del padrón). `--categoria E` muestra una categoría completa: límites anuales (ingresos, superficie, energía, alquileres, precio unitario máximo), la cuota con su desglose (impuesto integrado, SIPA y obra social) y la categoría siguiente. `--completa` muestra todas las columnas en dos bloques, y `--json` la tabla con `vigenteDesde`, `fuente`, `consultadaEl`, `tuCategoria`, `categorias` y `avisos` (ver [Entrada y salida](docs/input-output.md#categorías-del-monotributo-monotributo)). La tabla sale de la página pública de ARCA, sin certificado, y se guarda en la carpeta de config: se lee la primera vez y después con `--actualizar`. Sin conexión, o si la página cambió, se usa la guardada o la que viene con ARCLI, con un aviso; también avisa si ya pasó febrero o agosto y la tabla puede estar vieja. En el modo interactivo está en Consultas, **Categorías del monotributo**, con ver una categoría, ver todas las columnas (con ←/→) y actualizar desde ARCA.
- **Clave `monotributo.tope`:** tu tope de ingresos anuales, si querés pisar el de la categoría (`arcli config establecer monotributo.tope 30.000.000`). Por ahora `arcli monotributo` lo muestra debajo de la tabla; en `arcli config --json` sale como `monotributo: { tope }` solo si está configurada.
- **Recibo A y Recibo B:** `arcli ra` (o `arcli recibo a`, tipo ARCA 4) y `arcli rb` (o `arcli recibo b`, tipo ARCA 9), para documentar un cobro como responsable inscripto. Cada uno se arma como la factura de su letra: el A va a un CUIT y discrimina IVA, y el B lleva el IVA incluido. Las notas A y B los asocian con `--ac ra` y `--ac rb` (o `--at 4` y `--at 9`), como las C al Recibo C. Salen en `ultimos`, `consultar`, el PDF (`RECIBO A`, `RECIBO B`) y el `--json` (`atajo` `ra`/`rb`, `tipoArca` 4/9). En el modo interactivo, "Emitir recibo" pregunta cuál (C, B o A) y "Repetir" los ofrece junto al C. `arcli recibo c` y `arcli rc` no cambian.
- **Notas sobre otras notas en A, B y C:** una nota de crédito o débito puede ajustar otra nota de la misma letra, como permite ARCA (regla 10040): `arcli ncc --ac ndc …`, `arcli nda --ac nca …`. Antes era un error de validación. Una nota de crédito sobre una de débito tiene como tope el total de esa nota; sobre otra nota de crédito no hay tope, como en la `E`. El Recibo C sigue siendo asociado válido de las notas C.
- **Notas FCE sobre otras notas FCE, con `--anulacion`:** con anulación, la nota de crédito FCE puede ajustar la factura o una nota de débito FCE, y la nota de débito FCE solo una nota de crédito FCE. Sin anulación, el asociado sigue siendo solo la factura FCE. ARCLI lo valida antes de ir a ARCA, con la sugerencia de sumar o sacar `--anulacion`.
- **Notas FCE de anulación: aviso si el comprador no rechazó el asociado.** Una NC o ND FCE con `--anulacion` necesita que el comprador haya rechazado antes el comprobante asociado en el Registro de FCE; si no, ARCA la rechaza con el error `10154`. Ahora la vista previa consulta su estado en `wsfecred` y lo avisa en `avisos` (con flags y en el modo interactivo), sin frenar la emisión. Si la consulta falla, por ejemplo porque el certificado no tiene autorizado `wsfecred`, también sale como aviso. Y si ARCA rechaza con `10154`, `sugerencias` explica qué hacer. No cambia ninguna clave del `--json`.
- **Notas sobre una factura de otro sistema en el modo interactivo:** en una nota de crédito o débito, **Ingresar el número a mano…** con una factura que ARCA no tiene y de un punto de venta que no es de web service (Comprobantes en línea, controlador fiscal) ya no frena: el asistente pregunta lo que no puede copiar (fecha de la factura, receptor, concepto, monto, IVA del receptor, alícuota y moneda) y sigue, con el mismo aviso que con flags. El comando equivalente lleva `--apv`, `--ar` y `--afecha`. Con un punto de venta de web service sigue avisando que no existe.
- **Notas en el selector del modo interactivo:** en las notas de crédito y débito, "¿Sobre qué comprobante?" se elige en dos pasos: primero el tipo de documento (facturas, notas de crédito, notas de débito o recibos) y después el comprobante, de C a A, los FCE y el de exportación `E` (en recibos, el C, B o A), así la lista no se alarga. Suma las notas de cada letra que se pueden ajustar y las notas de exportación `E`. La pregunta "¿La nota va sobre la factura E o sobre otra nota E?" ya no está: se elige en ese selector. En FCE, la anulación se completa sola cuando el asociado la define, y solo se pregunta en una nota de crédito sobre la factura.

- **Fecha del comprobante en el asistente de la `E`:** la factura `E`, sus notas y "Repetir" una `E` suman el opcional **Fecha del comprobante** (por defecto hoy), como en A, B y C. Valida lo mismo que `--fecha`: hasta 5 días antes o después de hoy y, en servicios, no después del fin de mes (error `1500`); en una nota, no puede ser anterior al comprobante que ajusta. La fecha de pago de la factura (servicios u otros) se pregunta ahora después de los opcionales y, como `--fecha-pago`, no puede ser anterior a la del comprobante elegida (antes no podía ser anterior a hoy). La cotización de aduana es la de esa fecha (en servicios o cobrada en dólares, la del día hábil anterior) y el comando equivalente lleva `--fecha`. Antes el asistente usaba siempre la de hoy.
- **Permisos de embarque verificados antes de emitir la `E`:** en una factura o nota `E` de bienes (`--tipo-expo 1`) con `--permiso`, ARCLI consulta cada permiso en ARCA (`FEXCheck_Permiso`) con el país de destino antes de la vista previa. Si ARCA dice que no es válido, frena con `INPUT_VALIDATION_ERROR` (los permisos en `detalles.permisos`) en lugar de enterarse por el rechazo al emitir; si la consulta falla, sigue con un aviso. La vista previa muestra el resultado al lado de cada permiso y el JSON suma `exportacion.verificacionPermisos` (`[]` sin permisos); el resto del JSON no cambia. En testing ARCA contesta `OK` a cualquier permiso.
- **Observaciones de tope del Monotributo explicadas:** cuando ARCA aprueba un comprobante con la observación `10236` (`817` con CAEA: el importe excede el límite de tu categoría) o `10235` (`816`: excede el de la categoría máxima), `sugerencias` aclara que no es un rechazo y que el comprobante está emitido, qué significa para la próxima recategorización o la exclusión del Monotributo, y que los topes están en `arcli monotributo`. No cambia ninguna clave del `--json`.
- **Notas en pesos sobre una factura en otra moneda, en el modo interactivo:** al elegir una factura en dólares (u otra moneda extranjera), el asistente pregunta si la nota va en esa moneda o en pesos, por ejemplo una nota de débito por diferencia de cambio. En pesos no ofrece anular el total ni controla el tope de la nota de crédito. Con flags ya se podía.
- **`arcli consultar` muestra lo que faltaba de A, B, C, FCE y recibos:** el comprobante asociado de una nota (con su CUIT y fecha) o su período asociado, el período de servicio, el vencimiento del pago, si se cobra en la misma moneda extranjera, la condición IVA del receptor, cada alícuota de IVA y cada tributo, los datos de FCE (CBU, alias, transferencia y anulación) y las observaciones de ARCA. Antes ARCLI no los recibía. También en `ultimos --json` y en el historial del modo interactivo. En `--json` son campos nuevos: `comprobantesAsociados`, `periodoAsociado`, `servicioDesde`, `servicioHasta`, `vencimientoPago`, `mismaMoneda`, `condicionIvaReceptor`, `alicuotasIva`, `tributos`, `opcionales` y `observaciones` (`[]` o `null` si ARCA no los informa, ver [Entrada y salida](docs/input-output.md#comprobantes-emitidos-ultimos-y-consultar)). Los campos que ya estaban no cambian.
- **Categoría completa del monotributo en `arcli padron`:** además de la descripción de ARCA, muestra la letra (`A` a `K`) aparte y desde qué mes rige (`09/2013`). En `--json` hay dos campos nuevos: `categoriaMonotributoLetra` (`"E"`) y `categoriaMonotributoDesde` (`"201309"`, formato ARCA `yyyymm`), en `null` si no es monotributista o ARCA no los informa. `categoriaMonotributo` no cambia. También en "Datos de un CUIT" del modo interactivo.

### Cambiado

- **Preguntas del modo interactivo:** no cambia ningún comando, flag ni `--json`.
  - **El monto dice en qué moneda.** Con una moneda extranjera en `config.moneda`, "Emitir factura" y "Emitir recibo" preguntaban "Monto total:" aunque el monto fuera en esa moneda. Ahora la pregunta la nombra: "Monto total en USD:". Lo mismo en las notas ("Monto de la nota de crédito en USD:", con la moneda de la factura o, en una de período, la de la config). Si después elegís otra moneda en los opcionales, el asistente avisa ("Cambiaste la moneda a EUR: escribí el monto en EUR.") y vuelve a pedir el monto en la moneda nueva, antes de la vista previa: el número escrito ya no vale en otra moneda. En la `E` el precio de los ítems nombra la moneda por su código ISO ("Importe en USD:", antes "(DOL)"), y la nota sobre una factura en dólares ofrece "En USD, como el comprobante" (antes "En DOL").
  - **La `E` siempre pregunta los ítems y el total es su suma.** ARCA exige al menos un ítem, y si no se cargaban, el asistente armaba uno solo con la descripción y el monto, que estaba mal si exportabas, por ejemplo, jugo en litros. Ahora la factura `E` pregunta siempre el primer ítem, con valores por defecto ("Según detalle", cantidad 1 y "unidades", elegida de una lista que se filtra por nombre o código), y del segundo en adelante hasta Enter vacío. Con cantidad 1 la pregunta del precio dice "Importe:", así un servicio se carga con la descripción, Enter, Enter y el importe. Ya no hay pregunta "Monto total" ni "Descripción": el total es la suma de los ítems, y el aviso de que no coincidía con el monto ya no puede pasar. Al terminar muestra el total, para **Confirmar** o **Modificar los ítems** en un editor nuevo: espacio marca un ítem para modificarlo, Backspace para borrarlo (con un punto rojo; otro Backspace lo desmarca), Enter sigue (o aplica lo marcado) y vuelve al total, y "+ Agregar ítem", un botón debajo de la lista, carga uno nuevo. Siempre queda al menos uno. Volver lleva a la pregunta anterior, también entre ítems (de la descripción del ítem 2 al importe del 1), sin perder nada. Si cambiás la moneda, los ítems se conservan y un aviso pide revisar los importes. "Ítems" deja de ser un opcional, y el editor reemplaza "¿Qué hacemos con los ítems ya cargados?": al volver con ítems cargados arranca en él. "Repetir" `E` ya no pregunta "¿Mismo monto?" y las notas `E` ya no preguntan el monto ni el detalle: arrancan en el editor con los ítems de la factura o del comprobante que ajustan (en una nota de crédito, el total no puede superar el de ese comprobante). El comando equivalente lleva `-m` con la suma y, si queda un solo renglón con cantidad 1, "unidades" y sin código, la forma rápida con `--descripcion`; si no, un `--item` por renglón. Con los valores por defecto, la solicitud a ARCA es la misma que antes sin ítems. El CLI no cambia: `--monto` sigue obligatorio y `--item` opcional.
  - **"En pesos" arranca con la cotización escrita.** En un comprobante en moneda extranjera que se cobra en pesos (opcional "Moneda extranjera" y "Repetir"), la cotización arranca escrita con la que tomaría el CLI sin `--cm`, y la pregunta dice cuál es: la de `cotizacion` de la config si aplica a esa moneda (``Cotización de USD (la de tu config, `cotizacion`, es 1.400):``, con el aviso de clave deprecada) o, si no, la oficial de ARCA (`Cotización de USD (la oficial de ARCA es 1.450):`). Si dejás lo que arrancó escrito, va como con flags sin `--cm` y el comando equivalente no lleva `--cm`; si lo cambiás, es la cotización acordada y va con `--cm`. Antes había que escribirla siempre. Si no se puede consultar la oficial, arranca vacía, como antes. La opción "En pesos" aclara que el comprobante va en la moneda extranjera y se cobra en pesos.
  - **La `E` en dólares cobrada en pesos pregunta la cotización.** En la factura `E`, sus notas y "Repetir" de bienes u otros, la cotización estaba escondida entre los opcionales: si no se marcaba, iba la de ARCA sin que se viera. Ahora se pregunta después de la moneda (en las notas, después del comprobante que ajustan), con la misma pregunta que "En pesos": arranca escrita con la que toma el CLI sin `--cm`, la de aduana de ARCA (`Cotización de USD (la oficial de ARCA es 1.174,60):`) o, en las notas, la del asociado (`Cotización de USD (la de la factura E es 1.174,60):`). Sin tocarla, el comando equivalente no lleva `--cm`; si la cambiás, sí. Sin conexión arranca vacía. El opcional **Cotización** de la `E` ya no está. En servicios y si te pagan en dólares no se pregunta, porque ARCA exige la suya (errores 2053 y 1604): ahora se muestra en el lugar de la pregunta, con el motivo (`Cotización: 1.174,60 por USD, la de aduana del día hábil anterior. ARCA no acepta otra en servicios.`). En pesos, nada.
  - **El CBU y la actividad se ofrecen guardar solo si ARCA autoriza el comprobante.** En "Emitir factura" y "Repetir", con un CBU escrito a mano, el asistente preguntaba si guardarlo en la config aunque dejaras la FCE sin emitir o ARCA la rechazara, y en la `E` ofrecía guardar la actividad escrita a mano aunque la dejaras sin emitir. Ahora los dos se ofrecen solo si ARCA autorizó el comprobante (aprobado u observado, con CAE). Las claves `cbu` y `exportacion.actividad` y lo que se guarda no cambian.
  - **"Solo hoy" pasa a "Un solo día".** En el período del servicio de "Repetir", la opción aclara que es la fecha del comprobante: hoy o la que elijas en los opcionales.
  - **La vista previa de la `E` termina en el importe total.** El total iba entre las fechas y los ítems, y el importe de cada ítem quedaba pegado a su descripción, a distinta altura en cada renglón. Ahora van los datos hasta las fechas, una línea en blanco, los ítems con el importe a la derecha y en su columna (también con tildes, caracteres de ancho doble o una descripción larga, que se parte dentro de la suya), otra línea en blanco y el importe total. Las observaciones y los permisos de embarque pasan arriba de las fechas. En una terminal angosta, cada ítem va con la descripción arriba y el importe debajo. Es la misma vista previa que muestran `arcli fe`, `nce` y `nde`; `--json` no cambia.
- **Una moneda que no está en la tabla de ARCA es `INPUT_VALIDATION_ERROR`, no `ARCA_QUOTATION_ERROR`:** `fe --moneda XYZ` (y `nce`/`nde`, o `codigoMoneda` de `--cargar`) salía con `ARCA_QUOTATION_ERROR` porque ARCLI no encontraba su cotización, cuando el problema es la entrada: el código no existe en la tabla de monedas de WSFEX (ARCA lo rechaza con 1590). Ahora la `E` busca la moneda en esa tabla antes de la cotización y frena con `INPUT_VALIDATION_ERROR`, el error de ARCA y una `sugerencia` de revisar `--moneda`, también con `--cotizacion-moneda` (antes llegaba a ARCA). En A, B, C, FCE y recibos pasaba lo mismo: sin `--cm` salía `ARCA_QUOTATION_ERROR`, y con `--cm` llegaba a ARCA, que la rechazaba al emitir (10037). Ahora una moneda que ARCLI no conoce se busca en la tabla de WSFEv1 (`arcli parametros monedas`) y, si no está, es el mismo `INPUT_VALIDATION_ERROR`; si la tabla no se puede consultar, sigue como antes. **Cambia el `codigo` del `--json` para este caso:** un script que esperaba `ARCA_QUOTATION_ERROR` por una moneda inexistente ahora recibe `INPUT_VALIDATION_ERROR`, que es el que corresponde a un dato mal escrito. `ARCA_QUOTATION_ERROR` sigue para una moneda que existe y ARCA no cotiza.
- **`--acuit` es opcional en las notas A, B y C:** sin él, el comprobante asociado es del CUIT emisor de la config, como ya pasaba en las notas FCE. ARCA solo exige el CUIT del asociado en FCE (10151). Pasarlo sigue funcionando igual.
- **Controles de ARCA antes de la vista previa:** ARCLI frena con `INPUT_VALIDATION_ERROR` y una `sugerencia` lo que ARCA igual rechazaba al emitir, con flags, con `--cargar` y en el modo interactivo. No cambia ninguna clave del `--json`:
  - un comprobante A (`fa`, `nca`, `nda`, `ra`) con `--dni` o `--cuil`: la A va a un CUIT (10013);
  - una FCE de cualquier letra con `--dni`, `--cuil` o consumidor final: va a un CUIT (10015). El asistente ya no ofrece otros receptores en FCE;
  - el receptor con el mismo CUIT que emite (10069);
  - una factura o nota B al No Categorizado (`23000000000`) con neto gravado, que lleva la percepción de IVA No Categorizado (10067) y ARCLI no informa tributos;
  - una nota FCE en otra moneda que su asociado (salvo pesos, para una diferencia de cambio, 10181), a otro receptor (10183) o con `--afecha` distinta de la del asociado en ARCA (10160);
  - una cotización (`--cm`, `cotizacionMoneda` del JSON o la clave `cotizacion` de la config) por debajo del 2 % o por encima del 500 % de la oficial (10119). Para compararla, la vista previa consulta la oficial; si la consulta falla, solo avisa.
  - en A, B, C, FCE y recibos, lo que no entra en el campo de ARCA: un importe (`--monto`, `--exento`, `--nogravado`, los de `--alicuotas` o los del JSON) de más de 13 enteros, el punto de venta (`--pv` o el de la config) o el del asociado (`--apv`) mayor a 99.998 (10004 y 10058), y `--ar` mayor a 99.999.999 (10059). El error dice el máximo, como ya hacía la `E`.
- **Ejemplos de FCE B y C a un CUIT:** los de `arcli <atajo> --ayuda` y `arcli ejemplos` usaban consumidor final, que ARCA rechaza en FCE.

- **CBU con dígitos verificadores:** el CBU de una FCE ya no se acepta solo por tener 22 dígitos: ARCLI controla sus dos dígitos verificadores (el del bloque de banco y sucursal y el de la cuenta) en `--cbu`, la clave `cbu` del JSON de `--cargar`, `arcli config establecer cbu` y el modo interactivo. Si alguno no coincide, frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR` y dice qué bloque está mal. Un CBU real siempre los cumple: si uno que usabas ahora da error, tiene un dígito mal escrito. Si el CBU mal está guardado en la config, los comandos frenan con `El CBU guardado en la config no es válido`, el bloque que falla y la sugerencia de cambiarlo con `arcli config establecer cbu <CBU>`, que funciona aunque la config tenga el CBU mal. No cambia ninguna clave del `--json`.
- **Nota de débito FCE con `--anulacion` sobre la factura:** ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR` y la sugerencia de sacar `--anulacion`. Antes llegaba a ARCA, que la rechazaba: con anulación, una nota de débito FCE solo ajusta una nota de crédito FCE.
- **Monedas y cotizaciones en el modo interactivo:** en Consultas, "Cotización de una moneda" pasa a ser **Monedas y cotizaciones**, la tabla de monedas de ARCA donde Enter muestra la cotización oficial de la que elegís, con su nombre (`Euro (060)`); monedas sale de **Tablas de ARCA**, que ya no la repite. Volver a elegir una moneda no consulta ARCA otra vez. `arcli parametros monedas` y `arcli parametros cotizacion` no cambian.
- **Configuración del modo interactivo sin "Dónde está la config":** la ruta sigue en `arcli config ruta`, y la carpeta de certificados, en Ver configuración.
- **Listas que se filtran escribiendo:** `Filtrar:` tiene una línea en blanco arriba y abajo, así no queda pegado a la pregunta ni a la lista.
- **Listas largas del modo interactivo:** si no entran en la pantalla, avisan cuántas opciones quedan arriba y abajo (`↑ 3 más`, `↓ 12 más`). Si entran, no cambian.
- **La `E` acepta fechas de hasta 5 días adelante y frena las de más de 5 días atrás:** la factura y las notas `E` (`fe`, `nde`, `nce`) frenaban toda fecha futura y no ponían límite hacia atrás. Ahora `--fecha` (o `fechaComprobante` de `--cargar`) va de 5 días antes a 5 días después de hoy y, en servicios, no después del fin de mes, como ARCA (error 1500): por ejemplo, facturar el viernes con la fecha del embarque del lunes. Una fecha de más de 5 días atrás, que ARCA rechazaba, ahora frena antes con `INPUT_VALIDATION_ERROR`. Con fecha futura, la cotización de aduana es la de hoy (en servicios y con `--misma-moneda`, la del día hábil anterior a hoy), y la vista previa avisa en `avisos` que las siguientes de ese punto de venta y tipo van a tener que llevar esa fecha o una posterior (ARCA las rechaza con el error 1535). No cambia ninguna clave del `--json`.
- **Notas `E` de bienes u otros sobre un comprobante de servicios:** una `nce` o `nde` de `--tipo-expo 1` o `4` sobre una factura o nota `E` de servicios frenaba con `INPUT_VALIDATION_ERROR` (tipo distinto, otro destino, otra moneda u otra cotización). ARCA solo aplica esos controles (2040 a 2055) cuando la **nota** es de servicios, así que ahora pasa. Una nota de servicios sigue igual. No cambia ninguna clave del `--json`.
- **`--ar` opcional en las notas `E` de bienes y otros:** `nce` y `nde` pedían siempre el comprobante asociado, y ARCA solo lo exige en las notas de servicios (error 2047). Con `--tipo-expo 1` o `4` ahora se pueden emitir sin `--ar` (ni `comprobanteAsociado` en `--cargar`), por ejemplo para un descuento por volumen sobre varias facturas: la nota no hereda nada, así que cliente, domicilio, país de destino y lo demás van por flag, `solicitud` no trae `Cmps_asoc` y `exportacion.comprobanteAsociado` sale `null`, como en la factura. En servicios (el default) sin `--ar` sigue siendo `INPUT_VALIDATION_ERROR`, ahora citando el 2047.
- **La actividad de la `E` es opcional:** sin `--actividad` ni `exportacion.actividad`, la factura y las notas `E` frenaban con "Falta la actividad de exportación", y ARCA no la exige (el error 2100 es solo para el bloque vacío). Ahora van sin el bloque `Actividades`: `solicitud` no lo trae y `exportacion.actividad` sale `[]`. Si la informás, se sigue validando contra la tabla de WSFEX (error 2105). En el modo interactivo la pregunta de la actividad (en la factura `E` y en Repetir) se puede dejar vacía con Enter, y entonces no ofrece guardarla.
- **La `E` frena antes lo que ARCA rechaza:** estos casos llegaban a ARCA y salían rechazados; ahora frenan en la vista previa con `INPUT_VALIDATION_ERROR` y el código de ARCA, con flags, con `--cargar` y en el modo interactivo. Si un script los mandaba, ya fallaba al emitir:
  - factura de bienes (`--tipo-expo 1`) sin `--incoterm` (1640). En el modo interactivo el incoterm de bienes ya no ofrece "Sin incoterm";
  - `--incoterms-desc` sin `--incoterm` (1641) o de más de 20 caracteres (1642);
  - `--fecha-pago` anterior a la fecha del comprobante (1674);
  - `--cotizacion-moneda` en la factura de servicios o con `--misma-moneda` distinta de la que exige ARCA, la de aduana del día hábil anterior (2053 y 1604): ARCLI la compara con la de ARCA y el error dice cuál corresponde. Si coincide, sigue. En el modo interactivo la cotización a mano ya no se ofrece en esos casos;
  - ítems con las unidades 0, 97 (seña o anticipo) o 99 (bonificación), que ARCA pide sin cantidad ni precio (1775). En el modo interactivo no aparecen en la lista de unidades, y Repetir no copia los ítems de una factura que las tenga;
  - punto de venta (`--pv`, `--apv`) mayor a 99.998 (1510), y `--numero` mayor a 99.999.999 (1520) también cuando lo pasás a mano. `--id-solicitud`, en cambio, ahora acepta hasta 15 dígitos, como el campo de ARCA (antes, 99.999.999);
  - textos más largos que los de ARCA: `--cliente` 200 caracteres (1651), `--domicilio-cliente` 300 (1661), `--observaciones` 1000 y `--obs-comerciales` 4000 (1665), `--descripcion` y la descripción de un ítem 4000 (1770), el código de un ítem 50 (1760; ARCA testing no lo aplica, producción puede), y `--forma-pago` e `--id-impositivo` 50.

  No cambia ninguna clave del `--json`.

### Corregido

- **El modo interactivo controla las fechas y los importes al preguntarlos:** algunas respuestas pasaban la pregunta y recién fallaban en la vista previa, que volvía al menú y se perdía todo. Ahora cada pregunta aplica la misma regla que los flags y no deja seguir hasta corregirla:
  - en el período del servicio, "Servicio hasta" no puede ser anterior a "Servicio desde" (10032), y el vencimiento del pago no puede ser anterior a la fecha del comprobante (en una factura FCE, tampoco a hoy, 10164);
  - la parte exenta más la no gravada no puede superar el monto total. En "Repetir" con otro monto, el exento y el no gravado del original ya no se copian tal cual: el opcional **Importe exento o no gravado** arranca marcado y se vuelven a preguntar. Con el mismo monto se copian como antes;
  - en una nota por período, el período no puede empezar antes del 01/01/2006, "Período hasta" no puede ser anterior a "Período desde" ni posterior a la fecha de la nota. Como la fecha de la nota se elige después, en los opcionales, al preguntar el período se acepta hasta la más tardía que ARCA admite para la nota; si termina después de hoy, elegí esa fecha en "Fecha del comprobante" (si no, el asistente vuelve al período con el aviso). "A un período" ya no sugiere un descuento sobre todo el mes. En las notas, la fecha del comprobante tampoco puede ser anterior al asociado, y la fecha de una factura de otro sistema, posterior a la nota;
  - "CUIT del receptor" (y el CUIT o CUIL del consumidor final) no puede ser el CUIT que emite (10069).

  Si después cambiás una respuesta anterior y una regla deja de cumplirse, antes de la vista previa el asistente vuelve a la pregunta que la resuelve, con el aviso. Los mensajes nombran la pregunta: "En el período asociado, "Período desde" no puede ser posterior a "Período hasta"." en lugar de los flags. Con flags y con `--cargar` no cambia nada: los mismos controles, con los mismos textos y el mismo `--json`.

- **El modo interactivo ya no pierde ni cambia lo que respondiste:** en factura, recibo, FCE, notas, "Repetir" y la `E`. Con flags, `--cargar` y `--json` no cambia nada:
  - **Los opcionales ya no se pierden al volver atrás.** Si marcabas opcionales, volvías a un paso anterior (por ejemplo, al monto, o con Esc en la fecha de pago de la `E`) y regresabas, la lista aparecía vacía y lo respondido no se aplicaba, aunque la lista lo mostrara; en la `E` había que cargar de nuevo los ítems uno por uno. Ahora arranca con lo marcado y respondido, y los ítems cargados se pueden usar como están (**Usar los N ítems**) o **Cargar de nuevo**. Si cambiás el monto, los ítems se descartan porque tienen que sumarlo. En "Repetir", si elegís otro comprobante, la alícuota y el exento arrancan con lo copiado del nuevo; en "Repetir" una `E`, los ítems, el idioma, el CUIT del país y la descripción del incoterm. En una nota `E`, si elegís otro comprobante asociado, solo la descripción del incoterm arranca de nuevo.
  - **Un opcional desmarcado de la `E` ya no llega a ARCA.** Si marcabas un opcional, lo respondías, volvías a la lista y lo desmarcabas, igual se aplicaba: por ejemplo, la fecha del comprobante, la cotización o el idioma. Ahora lo desmarcado vuelve a como estaba, como en A, B y C.
  - **Esc en "¿Emitimos…?" vuelve a la última pregunta.** Después de la vista previa, Esc contaba como "no emitir" y volvía al menú: para corregir un dato había que empezar de cero. Ahora vuelve a la última pregunta con todo lo respondido, y si seguís sin cambiar nada llegás a la misma vista previa. **No, dejar sin emitir** sigue terminando sin emitir, y en producción Esc en la segunda confirmación sigue contando como no. En los comandos con flags, Esc en "¿Emitimos…?" sigue siendo no.
  - **El CUIT del país de la `E` arranca escrito al volver.** En la factura `E` y "Repetir" una `E`, si escribías el CUIT del país y volvías desde la pregunta siguiente, aparecía vacío. Ahora arranca con lo que habías escrito, como el resto de las preguntas.
  - **La lista de opcionales muestra lo que va.** "CUIT del país" decía "el de la tabla de ARCA" si ARCA no publica un CUIT para el destino y lo dejaste vacío; ahora dice "sin CUIT (va el ID impositivo)". "Período del servicio", sin fechas de servicio, decía "hoy" aunque hubieras cambiado la fecha del comprobante, que es la que se usa (como el CLI sin `--sd` ni `--sh`); ahora muestra esa fecha.
  - **"Repetir" ya no cambia la moneda de un monto confirmado.** Al repetir una factura en pesos con "¿Mismo monto? Sí", los opcionales ofrecían **Moneda extranjera**, y elegir dólares la emitía por el mismo número en dólares ($ 150.000 pasaba a US$ 150.000). Ahora, con el mismo monto, la moneda queda la del original, en pesos o en otra moneda. Con un monto nuevo en moneda extranjera sigue en esa moneda, como antes; con un monto nuevo en pesos, la moneda se elige en los opcionales, como en "Emitir factura".
  - **"Repetir" de la `E` valida la actividad como la factura `E`.** Si la factura no traía actividad y la escribías, el asistente aceptaba un código que no está en la tabla de WSFEX y recién la vista previa lo rechazaba (error 2105), volviendo al menú. Ahora la pregunta lo frena con el mismo control y el mismo texto que "Emitir factura" `E` y `--actividad`, y si ARCA autoriza la `E`, ofrece guardar la actividad en la config, como en "Emitir factura". La tabla de actividades se consulta solo si hay que preguntar la actividad.
  - **Aviso de `cotizacion` deprecada.** Con una moneda extranjera y `cotizacion` en la config, la vista previa del asistente no avisaba que la clave está deprecada, y si la cotización quedaba fuera de rango la sugerencia hablaba de `--cm`. Ahora muestra el mismo aviso y la misma sugerencia que con flags.
  - **El comando equivalente ya no fija la cotización oficial.** Con una moneda extranjera en `config.moneda` y sin `config.cotizacion`, el comando que muestra el asistente llevaba `--cm` con la cotización oficial de ARCA del día (por ejemplo `--moneda USD --cm 1450`), aunque la vista previa decía que se usaba la oficial: pegado otro día emitía con la cotización vieja. Ahora va sin `--cm`, como lo escribirías con flags, y emite con la oficial del día en que se pega. Lo mismo con `config.cotizacion` (deprecada): el comando no la repite y la toma de la config. Lo que se emite desde el asistente no cambia.
  - **Fechas completas en el comando equivalente.** Una fecha escrita a medias (`25` en el vencimiento, `1/11` en el período del servicio, el período de la nota o la fecha del asociado) iba igual en el comando equivalente (`--vto 25`), y pegado otro mes daba otra fecha. Lo mismo con la fecha de pago de la factura `E` y de "Repetir" una `E` (`--fecha-pago 25`). Ahora van completas (`--vto 25/11/2026`, `--fecha-pago 25/11/2026`), como ya iba la fecha del comprobante de la `E`. Al volver a la pregunta, arranca escrita completa.
- **Una `E` aprobada con observaciones ya no sugiere volver a emitir:** cuando ARCA aprueba una factura o nota `E` con observaciones, el comprobante tiene CAE, pero la salida (y `sugerencias` en `--json`) decía "Revisá observaciones y errores de ARCA antes de volver a emitir.", lo que podía llevar a emitirlo dos veces. Ahora esa sugerencia sale solo cuando ARCA la rechaza, como en A, B y C. No cambia ninguna clave del `--json`.
- **"Volver" en el modo interactivo vuelve a la pregunta anterior, con la respuesta marcada:** en los pasos con dos preguntas, "Volver" desde la segunda saltaba al paso anterior en vez de a la primera (por ejemplo, de "Monto total" a la pregunta previa a "¿Mismo monto?" al repetir, o de "Servicio hasta" a la lista de opcionales). Ahora cada pregunta es un paso y "Volver" lleva a la inmediatamente anterior, en la factura, el recibo, las notas, "Repetir", la `E` y sus opcionales. Además, al volver a una pregunta, lo respondido antes arranca marcado en las listas (moneda de la nota, alícuota, condición IVA, comprobante) y escrito en las de texto (montos, fechas, CUIT, CBU); si cambiás una respuesta, las posteriores que dependían de ella se descartan. No cambia ningún comando, flag ni `--json`.
- **El asistente conserva las respuestas que no dependen de la que cambiás:** al volver y cambiar una respuesta, se olvidaba todo lo respondido después, aunque no tuviera que ver (cambiar la fecha borraba la moneda; cambiar el comprobante, el concepto y el monto). Ahora se descarta solo lo que depende de ella: si cambiás el comprobante, se pregunta de cero a quién va y su condición frente al IVA; si cambiás la moneda, cómo te pagan y la cotización. Lo demás arranca escrito o marcado como lo dejaste. En los opcionales de A, B y C, volver a la lista ya no descarta lo respondido: la lista lo muestra (por ejemplo, la alícuota elegida en lugar de 21%), y si desmarcás un opcional y seguís, lo que habías respondido de él no se aplica. No cambia ningún comando, flag ni `--json`.
- **Comando equivalente de una nota en el modo interactivo sin `--acuit`:** en una nota A, B o C sobre un comprobante propio, el comando que muestra el asistente ya no lleva `--acuit` con tu CUIT, que es lo que toma el CLI sin el flag. En las notas FCE sigue, porque ARCA exige el CUIT del asociado.
- **Tablas de WSFEX vacías en la `E`:** si ARCA devuelve vacía la tabla de incoterms, `--incoterm` (y el de una nota `E` de bienes, que sale del asociado) ya no frena con "El incoterm … no existe": va sin validar, como la actividad con su tabla vacía, y las dos suman un aviso en `avisos`. En el modo interactivo, el incoterm se escribe a mano. No cambia ninguna clave del `--json`.
- **Repetir una A a un DNI en el modo interactivo:** repetir una factura o un recibo A (o una FCE) cuyo receptor era un DNI, un CUIL o consumidor final avisa al elegirlo que ARCA solo lo acepta a un CUIT (10013, 10015) y pide el CUIT, en lugar de llegar a la vista previa y rechazarse ahí.
- **Consumidor final en el modo interactivo:** a consumidor final, el asistente (facturas, recibos, notas y "Repetir") armaba la solicitud a ARCA sin `DocNro`, mientras `--cfinal` y el comando equivalente que muestra mandan `DocNro: 0`, y la vista previa mostraba "Tipo de documento: Consumidor final" y "Número de documento: N/D" en lugar de "Receptor: Consumidor final". Ahora el asistente manda `DocNro: 0` y muestra la misma vista previa que el comando.
- **Consumidor final por defecto con `DocNro: 0`:** sin flag de receptor (`arcli fc -m 100 --cs`) y en `--cargar` con `tipoDocumento: consumidor-final` sin `numeroDocumento`, la solicitud a ARCA salía sin `DocNro` y la vista previa mostraba "Número de documento: N/D". Ahora manda `DocNro: 0` y muestra "Receptor: Consumidor final", igual que con `--cfinal`. En el `--json`, la `solicitud` de esos comprobantes suma `DocNro: 0`, como ya tenía con `--cfinal`; el resto no cambia.
- **`--misma-moneda` con una fecha que no es hoy:** daba error diciendo que solo se podía consultar la cotización vigente. Ahora, con una `--fecha` pasada, ARCLI pide a ARCA la cotización del día hábil anterior a esa fecha, y con una futura usa la vigente, como dice la regla 10038. ARCA testing aprobó un Recibo B en dólares fechado dos días antes.
- **DNI de 6 dígitos:** `--dni` (y el DNI del modo interactivo) aceptaba solo 7 u 8 dígitos; ahora de 6 a 8. ARCA acepta los documentos viejos de menos de un millón.
- **Mensaje de `mismaMoneda` con `cotizacionMoneda` en el JSON de `--cargar`:** el error nombraba los flags `--misma-moneda` y `--cm` aunque los dos datos vinieran del archivo; ahora nombra las claves del JSON.
- **Sugerencias de los rechazos por fecha:** la del `10016` ahora también explica la fecha fuera de rango, que es lo que ARCA rechaza con ese código, y la del `10152` dice lo que es: una fecha futura en otro mes, en productos y FCE. El receptor igual al emisor se reconoce también por el código `10069`.

- **El comando equivalente del modo interactivo se puede pegar con cualquier texto:** iba entre comillas dobles, así que un `!` en el nombre del receptor (`--receptor-nombre "Hola!"`) disparaba el historial de bash y zsh, en fish un backtick dejaba la barra y en PowerShell `$` no quedaba escapado. Ahora los textos van entre comillas simples (`'Hola!'`; la comilla se escribe `'\''`), y en Windows con las de PowerShell (`''` para la comilla). Los argumentos sin espacios ni símbolos siguen sin comillas.
- **"← Volver" se iba de la pantalla en las listas largas del modo interactivo:** se desplazaba con las opciones y quedaba fuera de la vista hasta llegar al final. Ahora queda fijo debajo de la lista, también en las que se filtran escribiendo (monedas y tablas largas de ARCA), que no lo tenían; se llega con la flecha abajo desde la última opción, y Esc sigue volviendo. En una terminal baja, la lista se achica para que entre.
- **Paneles desarmados con emojis, caracteres chinos o una `é` pegada desde macOS:** ARCLI medía el texto por cantidad de caracteres y no por las columnas que ocupa en la terminal, así que con un nombre como `Café 🧾` o `東京` el borde derecho quedaba corrido. Ahora se mide como la terminal, y una palabra larga se corta sin partir un emoji ni separar una letra de su acento. No cambia el `--json`.
- **`TERM=dumb` sin colores:** en terminales que no entienden códigos de escape (Emacs `M-x shell`, algunas consolas de CI) la salida traía códigos de color sueltos. Ahora `TERM=dumb` los apaga, como `NO_COLOR`. `FORCE_COLOR=1` sigue forzándolos y `NO_COLOR` sigue ganando sobre los dos.
- **`29/2` sin año cerca de un bisiesto:** el año se elegía sin mirar si ese 29/02 existía, así que el 1/9/2028 `--fecha 29/2` (o `--vto`, `--sd`, `--sh`) daba "no es válida" en lugar de tomar el 29/02/2028. Ahora solo cuentan los años donde la fecha existe. No cambia ninguna otra fecha.

## [2.5.2] - 2026-11-18

Arreglos de una revisión de la factura `E` y de las notas contra los manuales de ARCA. Lo más importante: se pueden volver a hacer notas sobre facturas de Comprobantes en línea o de un controlador fiscal, y la `E` de servicios en moneda extranjera y la `E` en pesos ya no salen rechazadas en producción. Puede afectar scripts:

- En la `E` en pesos, `solicitud` del `--json` ya no trae `CanMisMonExt`.
- En la `E` a un destino sin CUIT en la tabla de ARCA, con `--id-impositivo` y sin `--cuit-pais`, ya no hay error: `solicitud` no trae `Cuit_pais_cliente` y `exportacion.cuitPaisCliente` es `null`.
- Una nota A, B, C o FCE cuyo asociado no está en ARCA y es de un punto de venta que no es de web service ya no frena: sigue con un aviso en `avisos`.

Fuera de eso, no cambia ningún comando, flag, clave de config ni clave de `--json`.

### Corregido

- **Una nota sobre una factura de Comprobantes en línea o de un controlador fiscal se puede volver a hacer:** desde la 2.5.1, una nota A, B, C o FCE cuyo asociado no estaba en ARCA frenaba con `INPUT_VALIDATION_ERROR`, y la consulta de ARCA (`FECompConsultar`) solo ve lo emitido por web service: quien pasaba de Comprobantes en línea a ARCLI no podía hacer una NC sobre una factura vieja. Ahora frena solo si el punto de venta del asociado es uno de tus puntos de venta de web service (ahí es casi seguro un número mal escrito). Si no lo es, la nota sigue con un aviso en `avisos`, sin controlar el tope de la NC, que recuerda pasar `--afecha` (ARCA la exige para controlador fiscal y FactuWeb, error 10211); en NC/ND FCE sin `--afecha` sigue siendo error, porque la fecha no se puede tomar de ARCA. Si no se pueden consultar los puntos de venta, también es un aviso. En el modo interactivo, al ingresar a mano una factura así, el aviso explica que la nota se hace por período o con flags.
- **La factura `E` en pesos ya no manda `CanMisMonExt`:** ARCLI lo mandaba en `N` en toda factura `E`, y con `--moneda ARS` (o `PES`) ARCA pide que ese campo no se informe (error 1605). Testing lo acepta, pero en producción la `E` en pesos saldría rechazada. Ahora no se manda, así que `solicitud` del `--json` de una `E` en pesos deja de traer `CanMisMonExt`; `exportacion.mismaMoneda` sigue en `false`. En moneda extranjera no cambia nada.
- **La `E` de servicios en moneda extranjera ya no sale rechazada por la cotización (error 2053):** sin `--cotizacion-moneda`, ARCLI pedía la cotización de aduana del día del comprobante, y en servicios ARCA exige la del día hábil anterior. Una `E` de servicios con fecha pasada salía rechazada siempre, y una de hoy, en cuanto ARCA publicaba la del día. Ahora en servicios (`--tipo-expo 2`, el default) se usa la del día hábil anterior a la fecha del comprobante: un lunes o después de un feriado, la del último día hábil, con un aviso. Con `--misma-moneda` también, en cualquier tipo, como pide el manual de ARCA. Bienes, otros y las notas `E` (que heredan la cotización del asociado) no cambian.
- **`--cuit-pais` ya no es obligatorio en la `E` cuando ARCA no publica el CUIT del destino:** 155 de los 303 destinos no tienen CUIT en la tabla de ARCA (Irlanda, Alemania, Emiratos, Panamá, Hong Kong, Rusia, las zonas francas y el AAE de Tierra del Fuego, entre otros), y la única salida era pasar el CUIT de otro país. ARCA pide el CUIT del país **o** el ID impositivo del cliente (error 1580), así que ahora alcanza con `--id-impositivo` (o `idImpositivo` de `--cargar`): `Cuit_pais_cliente` no se manda, `solicitud` del `--json` no lo trae y `exportacion.cuitPaisCliente` sale `null`. Sin ninguno de los dos, `INPUT_VALIDATION_ERROR` pide uno. En el modo interactivo el CUIT del país se puede dejar vacío y entonces se pide el ID impositivo. Cuando la tabla trae el CUIT, todo sigue igual.
- **La `E` acepta cotizaciones menores a 1:** `--cotizacion-moneda` (o `cotizacionMoneda` de `--cargar`, o la cotización del modo interactivo) tenía que ser mayor a 1, y hay monedas que valen menos de un peso, como el guaraní (`029`) o el peso colombiano (`032`). Además, toda nota `E` sobre una factura en esas monedas fallaba, porque hereda su cotización. Ahora alcanza con que sea mayor a 0, como pide ARCA (error 1600). En A, B y C no había esa regla: solo se rechaza la cotización 1 en moneda extranjera.

## [2.5.1] - 2026-11-18

Arreglos de un chequeo de la 2.5.0 contra ARCA testing. Lo más importante: la factura `E` de bienes se puede volver a emitir (ARCA la rechazaba con el error 1673). Puede afectar scripts:

- Una nota A, B, C o FCE cuyo asociado propio no existe en ARCA ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR`. Las notas de débito también consultan el asociado antes de la vista previa.
- `arcli padron --json` trae cada actividad una sola vez.
- En la `E` de bienes, `solicitud` del `--json` ya no trae `Fecha_pago`, porque no se manda a ARCA; `--fecha-pago` se acepta y se ignora con un aviso.

Fuera de `Fecha_pago` en la `solicitud` de la `E` de bienes, no cambia ningún comando, flag, clave de config ni clave de `--json`.

### Corregido

- **La factura `E` de bienes se puede emitir:** ARCLI mandaba siempre la fecha de pago y ARCA rechazaba la `E` de bienes (`--tipo-expo 1`) con el error 1673. Ahora la fecha de pago va solo en servicios y otros (`--tipo-expo 2` y `4`), como pide ARCA. En bienes, `--fecha-pago` (o `fechaPago` de `--cargar`) se sigue aceptando pero no se usa y sale un aviso en `avisos`; `solicitud` del `--json` deja de traer `Fecha_pago`, porque ya no se manda. El modo interactivo no pregunta la fecha de pago en bienes. Las notas `E` no cambian.
- **Una nota A, B, C o FCE con un asociado propio que no existe ya no se emite:** antes de la vista previa ARCLI consultaba el asociado, veía que no estaba y seguía, y ARCA testing llegó a aprobar una NC asociada a una factura inexistente. Ahora frena con `INPUT_VALIDATION_ERROR` ("ARCA no tiene la factura B 00003-00099999.", con la sugerencia de revisar `--ar`, `--apv` y `--ac`), como en las notas `E`. También en las notas de débito, que antes no se consultaban. El asociado de otro CUIT no se puede consultar y sigue decidiéndolo ARCA; si ARCA no responde, la nota sigue con un aviso.
- **`arcli padron --json` repetía actividades:** ARCA informa las mismas en el régimen general y en el monotributo, y `actividades` las traía dos veces (también el "y N más" de la salida humana). Ahora van sin repetir, en el mismo orden. Las claves no cambian.
- **La sugerencia de la observación `10217` decía otra cosa:** hablaba de "la condición del receptor (padrón)", igual que la `10017`. Ahora cada una explica la suya: la `10217` es la del crédito fiscal de una factura A a un monotributista ("Procedimiento permanente de transición al Régimen General") y la `10017`, la de un receptor que no figura activo en el padrón.
- **Receptor que no está en los padrones de ARCA:** el rechazo "DocNro … no se encuentra registrado en los padrones" llega en `observaciones` con `errores` vacío y solo traía la sugerencia genérica. Ahora `sugerencias` dice que se revise el documento del receptor y que en testing muchos CUITs no están en el padrón de facturación.
- **Errores de `arcli config establecer` que no decían qué clave fallaba:** `config establecer emisor.condicionIva Inscripto` respondía "Entrada tiene un valor no soportado" y sugería `arcli ayuda`. Ahora el mensaje nombra la clave, el valor recibido y los valores válidos (`` `emisor.condicionIva` no acepta "Inscripto". Valores válidos: … ``), y la sugerencia lleva a `arcli config establecer --ayuda` y `arcli config`. Igual en `entorno`, `concepto`, `ivaReceptor`, `pdf`, `moneda`, las claves de sí/no, los números y los textos vacíos, y una clave que no existe lo dice. En `--json` cambian solo `error` y `sugerencia`: `codigo` sigue siendo `INPUT_VALIDATION_ERROR` y `detalles` trae lo mismo que antes.
- **Los avisos de `--cargar` nombraban flags:** con `descripcion`, `condicionVenta`, `receptorNombre` o `receptorDomicilio` en el JSON y sin PDF, el aviso hablaba de `--descripcion`, `--receptor-nombre`… aunque los datos vinieron del archivo. Ahora nombra las claves del JSON (`Las claves "descripcion" y "receptorNombre" del JSON de \`--cargar\` solo se usan en el PDF…`), y solo las que vinieron. Igual con `"dia"`(deprecada), con`"descripcion"`junto a`"items"`en la`E`y con`"comprobanteAsociado.fecha"`en las notas`E`. Solo cambia el texto de `avisos`.
- **Ejemplos de la `E` con número fijo:** `ejemplos/factura-exportacion-e.json` traía `"numero": 3` y los ejemplos de `fe`, `nce` y `nde` de la documentación, `--numero` o `"numero"`: copiados tal cual, ARCA los rechazaba por correlatividad. Desde la 2.5.0 el número es opcional, así que los ejemplos ya no lo traen y ARCLI toma el siguiente.

## [2.5.0] - 2026-11-17

Completa lo que trajo la 2: las notas de crédito y débito de la factura de exportación `E`, el modo interactivo al nivel del CLI (consultas, opcionales, repetir la `E`, el PDF al confirmar) y el sitio de documentación en [arcli.com.ar](https://arcli.com.ar). Puede afectar scripts:

- Una nota de crédito A, B, C o FCE mayor que su factura ahora frena antes de ir a ARCA con `INPUT_VALIDATION_ERROR`.
- `--afecha` en las notas FCE y `--numero` en `fe`, `nde` y `nce` dejan de ser obligatorios: sin ellos, ARCLI los toma de ARCA.
- `arcli config --json` trae `filasPorLista` y, mientras dure la deprecación, también `comprobantesPorLista` y `deprecado`.
- En `arcli certificado generar --json`, `guia` apunta a arcli.com.ar.

No cambian los nombres de comandos, flags ni claves existentes, ni las claves del `--json` y de `--cargar`, ni los `codigo` de error. Hay deprecaciones para la 3.0.0: ver "Deprecado".

### Agregado

- **Clave de config `filasPorLista`** (1 a 50, por defecto 15): reemplaza a `comprobantesPorLista`, que ya no cuenta solo comprobantes sino también las filas de las tablas de ARCA y la lista de monedas del modo interactivo. Hace lo mismo: cuántas filas muestran `arcli ultimos` (sin `--cantidad`) y las listas del modo interactivo. `arcli config establecer filasPorLista 25`.
- **Consultas en el modo interactivo:** "Consultar comprobantes" pasa a ser **Consultas**, con todo lo que el CLI consulta: **Mis comprobantes** (lo de antes), **Datos de un CUIT** (`arcli padron`), **Si un cliente recibe FCE** (`arcli fce-obligado`, con la fecha de hoy), **Cotización de una moneda** y **Tablas de ARCA** (las nueve de `arcli parametros`). Después del padrón, **Emitir una factura a este CUIT** arranca la factura con el CUIT, el nombre, el domicilio y la condición IVA ya cargados. Las tablas largas y la lista de monedas se filtran escribiendo (`eur`, `060` o `usd`) y se desplazan con las flechas; las filas por página son las de `filasPorLista`. Un error de ARCA vuelve a Consultas en lugar de al menú. Configuración suma **Dónde está la config** (`arcli config ruta`).
- **Encabezado y ayuda en `arcli parametros <tabla>`:** el listado tiene una fila de encabezado (`CÓDIGO`, la descripción y, en `iva-receptor` y `puntos-venta`, una tercera columna) y al pie para qué sirve el código en ARCLI. Es salida humana: el `--json` no cambia.
- **Repetir una factura E en el modo interactivo:** "Repetir un comprobante anterior" ahora ofrece la factura de exportación `E`. Copia de la factura que devuelve ARCA el cliente, el destino, la moneda, el incoterm, los ítems, la forma de pago, el idioma y la actividad; sale con fecha de hoy y la cotización del día, y pregunta el monto, los permisos de embarque y la fecha de pago. Si algún ítem tiene bonificación o no suman el total, avisa y sale un renglón con el monto total.
- **Alias del CBU y guardar el CBU escrito a mano:** si en una FCE del modo interactivo el CBU se escribe porque no está en la config, también pide el alias cuando falta `aliasCbu` (Enter lo omite, como sin `--alias`), y al final ofrece guardar los dos (`cbu` y `aliasCbu`), como ya pasaba con la actividad de la `E`.
- **La E completa en el modo interactivo:** la factura `E` y sus notas terminan con "¿Agregamos algún opcional?", como A, B y C: ítems (descripción, cantidad, precio y unidad, uno por uno), idioma, observaciones y observaciones comerciales, descripción del incoterm y cotización a mano. La factura también deja elegir el CUIT del país y, si ARCA no publica uno para el destino, lo pide (se escribe o se busca el país por nombre): antes el asistente no tenía salida. Las notas `E` ahora pueden ajustar otra nota `E`, no solo la factura. El comando equivalente incluye los flags nuevos (`--item`, `--idioma`, `--cuit-pais`, `--observaciones`, `--obs-comerciales`, `--incoterms-desc`, `--cm` y `--ac`). Sin marcar nada, todo sigue igual.
- **Más opciones en el modo interactivo:** el paso de opcionales suma la **fecha del comprobante** (`--fecha`), en facturas, recibos, notas y al repetir, con la misma ventana de días que el CLI según el concepto: sirve, por ejemplo, para facturar con fecha de fin de mes. El receptor se puede identificar por **CUIL** (en B y C), y la moneda extranjera ofrece **euros y el resto de las monedas de ARCA**, con la cotización acordada o la oficial. Las notas de crédito y débito tienen ahora sus opcionales: fechas de servicio y vencimiento (`--sd`, `--sh`, `--vto`), exento y no gravado en las parciales, y moneda en las de período. El comando equivalente incluye todos esos flags.
- **La E en "Consultar comprobantes" del modo interactivo:** la lista de tipos ahora incluye la factura de exportación `E` y sus notas de crédito y débito (`fe`, `nce`, `nde`), con los últimos emitidos, **Cargar más…**, **Ingresar el número a mano…** y el mismo detalle que `arcli consultar fe`. Antes solo estaban los 19 tipos de A, B y C.
- **Permisos de embarque en el modo interactivo:** la factura `E` de bienes pregunta los permisos de embarque ya existentes (opcional, separados por coma), igual que `--permiso` con `--permiso-existente`. Las notas `E` sobre una factura de bienes también los preguntan.
- **`ultimos` y `consultar` con la E:** `arcli ultimos fe` (también `nde` y `nce`) lista los últimos comprobantes de exportación y `arcli consultar fe <numero>` muestra uno, con cliente, destino, moneda, total y comprobante asociado. El JSON de la E tiene sus propias claves (`cliente`, `destino`, `moneda`, `total`, `comprobanteAsociado`), porque no tiene receptor con documento ni IVA.
- **`ARCLI_CONFIG_DIR`:** una variable de entorno para usar otra carpeta de config, con su `config.json`, tickets, plugins y certificados. Sirve para tener una config aparte sin tocar la de siempre. Sin la variable, todo sigue igual.
- **Notas de crédito y débito de exportación E:** `arcli nce` y `arcli nde` (también `arcli nota-credito e` y `arcli nota-debito e`) ajustan una Factura de exportación `E` ya emitida. Alcanza con el monto, el asociado (`--ar`, y `--apv` si es de otro punto de venta) y `--numero`: el cliente, el destino, la moneda, la cotización y la actividad salen de la factura, que ARCLI consulta en ARCA. En las de bienes, los permisos de embarque son opcionales y van con `--permiso`, sin `--permiso-existente`. Antes de emitir valida lo que ARCA va a controlar contra el asociado: que exista, que la nota no sea anterior, que una nota de crédito no lo supere y, en servicios, el mismo destino, moneda y cotización. En `--cargar`, `comprobanteAsociado`; en el `--json`, `exportacion.comprobanteAsociado` (`null` en la factura). También en el modo interactivo, al elegir la factura de exportación como comprobante original de una nota. No cambia nada de la factura `E` ni de A, B y C.

### Cambiado

- **El PDF se elige al confirmar la emisión:** cuando ARCLI pregunta "¿Emitimos…?" antes de emitir (sin `--emitir`, en una terminal), en el CLI y en el modo interactivo, las opciones son siempre **Sí, emitir ahora**, **Sí, emitir y generar el PDF** y **No, dejar sin emitir**, diga lo que diga la config `pdf`, y lo elegido decide. Con `pdf preguntar` (el valor por defecto) ya no hay una segunda pregunta, "¿Generamos el PDF del comprobante?", después de emitir. Con `pdf siempre` se puede emitir sin PDF (el cursor arranca en la opción con PDF), y con `pdf nunca` aparece la opción para generarlo esa vez. Con `--exportar-pdf` o `--sin-pdf` el PDF ya está decidido y la pregunta solo ofrece emitir o no. Al emitir sin confirmar (`--emitir`, `emitir true`, `--json` o sin terminal) todo sigue igual: decide la config. Vale para todos los comprobantes, también la `E`, sus notas y el Recibo C.
- **Una nota de crédito mayor que su factura ya no se emite:** en una NC A, B, C o FCE, ARCLI consulta en ARCA el comprobante asociado antes de la vista previa y, si la nota supera su total (en la misma moneda), frena con un error de validación (`INPUT_VALIDATION_ERROR`) que sugiere el `--monto` para anularla entera. Antes la mandaba igual y decidía ARCA. Es el mismo control que ya tenían las notas `E` y el modo interactivo, y ahora los tres dicen lo mismo: `La nota de crédito por $ 150.000 no puede superar el total de la factura C 00003-00000045, de $ 120.000.` La consulta es una por nota y se reusa al emitir. En un lote, el error sale con su índice antes de preguntar si se emite. Solo se consulta un asociado tuyo; con `--acuit` de otro CUIT no se controla, y si ARCA no responde la nota sigue con un aviso.
- **`--afecha` deja de ser obligatoria en las notas FCE:** en `ncea`…`ndec`, sin `--afecha`, ARCLI toma la fecha del asociado de ARCA, como en las notas `E`, y la vista previa ya la muestra. Si la pasás, se sigue usando la tuya. Si ARCA no tiene el asociado o no responde, frena y sugiere pasar `--afecha`.
- **`--numero` deja de ser obligatorio en `fe`, `nde` y `nce`:** sin el flag, ARCLI consulta en ARCA el último número de ese tipo en el punto de venta y usa el siguiente, también en la vista previa. `--numero` (o `numero` en `--cargar`) sigue andando para fijarlo a mano. El modo interactivo ya no lo pregunta. Si una emisión de la E queda sin confirmar (`EMISSION_UNCERTAIN`), la sugerencia ahora también manda a verificarla con `arcli consultar`.
- **Mismos botones al emitir en el modo interactivo y en el CLI:** el asistente pregunta "¿Emitimos…?" con **Sí, emitir ahora** y **No, dejar sin emitir**, como los comandos con flags (antes, "Emitir ahora" y "Cancelar"). En producción sigue pidiendo una segunda confirmación, ahora con **Sí, emitir en producción** y **No, dejar sin emitir**. El CLI con flags sigue preguntando una sola vez.
- **El modo interactivo pide el punto de venta al empezar si la config no tiene uno:** factura, recibo, factura `E`, notas, repetir y consultar lo preguntan antes del primer paso, en lugar de completar todo y frenar al final con un error que hablaba de flags del CLI. El comando equivalente lo lleva con `--pv`. Con un punto de venta en la config, no cambia nada.
- **Listas del modo interactivo sin el atajo del comando:** al elegir el comprobante (al emitir, en las notas y en Consultas) dice "Factura C" en lugar de "Factura C (fc)". El comando se sigue mostrando al final, en el comando equivalente.
- **Los links del CLI llevan al sitio de documentación:** las guías que nombran los mensajes (certificado, punto de venta para web service, problemas frecuentes y novedades) abren su página en [arcli.com.ar](https://arcli.com.ar) en lugar del archivo en GitHub. El aviso de un certificado de producción por vencer lleva a cómo renovarlo. `arcli --ayuda` suma `Documentación: https://arcli.com.ar`, y el modo interactivo lo muestra al empezar la configuración guiada y al salir. En `arcli certificado generar --json`, el campo `guia` trae la URL nueva; los campos no cambian.

### Deprecado

- **`comprobantesPorLista`**, ahora `filasPorLista`; se saca en la 3.0.0. Hasta entonces se sigue leyendo del archivo de config (si están las dos, gana `filasPorLista`), `arcli config establecer comprobantesPorLista N` avisa y guarda `filasPorLista` (y saca la vieja), y `arcli config --json` trae las dos con el mismo valor, más `deprecado`.

### Arreglado

- **Datos vacíos del receptor en el PDF:** a un consumidor final sin identificar, el PDF muestra `Documento: -` en lugar de `Documento: - -`, y sin domicilio, `Domicilio: -`. Lo mismo con el nombre de un receptor identificado que no lo tiene cargado. Vale para A, B, C y el Recibo C.
- **El comando equivalente del modo interactivo saca el mismo PDF:** con un CUIT, ahora lleva el nombre y el domicilio que trajo el padrón (`--receptor-nombre` y `--receptor-domicilio`). Como siempre lleva `--ir`, el CLI no consultaba el padrón y el comando pegado generaba el PDF sin esos datos.
- **El modo interactivo usa los defaults de la config, como el CLI:** la factura y el recibo arrancan en la moneda de la config (`moneda`) en lugar de siempre en pesos; con una extranjera, sin tocar nada, va con la cotización oficial de ARCA (o la guardada en `cotizacion`), igual que sin `--moneda`. Las notas de crédito y débito proponen el IVA receptor de la config (`ivaReceptor`), la alícuota (`alicuota`) cuando no sale de la factura y, en las de período, el concepto (`concepto`) y la moneda. Al repetir un comprobante se sigue usando la moneda del original.
- **Configuración guiada en el entorno activo:** pide el certificado y la clave del entorno en que se va a emitir (`entorno`, o `arcli interactivo --produccion`/`--testing`), no siempre los de testing. Con `entorno produccion`, el asistente proponía la guiada al abrir pero nunca completaba lo que faltaba. El chequeo al abrir también respeta `--produccion`/`--testing`.
- **Repetir un comprobante en moneda extranjera:** en el modo interactivo, repetir una factura o un recibo en dólares, euros u otra moneda ahora sale en la moneda del original y solo pregunta la cotización (la acordada o la oficial de ARCA). Antes arrancaba en pesos: si se desmarcaba "Moneda extranjera", el monto en dólares se emitía como si fueran pesos, y uno en euros no se podía repetir. Si ARCA no tiene la cotización oficial, no se emite.
- **El modo interactivo avisa lo mismo que los comandos con flags:** en moneda extranjera, que usa la cotización oficial de ARCA. Antes ese aviso solo salía con flags. La preparación de la emisión ahora es una sola para los dos.

### Documentación

- **Docs por tema:** una página por comprobante ([¿qué comprobante me toca?](docs/comprobantes/README.md)), con un ejemplo y sus opciones en Obligatorio, Opcional y Al ejecutar, cada flag con su largo, su corto y sus valores; las notas de crédito y débito por separado. Formas de uso ([asistente](docs/formas-de-uso/asistente.md), [comandos](docs/formas-de-uso/comandos.md) y [con IA](docs/formas-de-uso/con-ia.md)), el certificado de [testing](docs/certificado-testing.md) y de [producción](docs/certificado-produccion.md) en pasos cortos con las capturas plegadas, [cómo funciona](docs/mental-model.md), un índice de [comandos](docs/comandos.md) y el [PDF](docs/pdf-en-corto.md) en corto, cada uno con link a su guía completa. Suman [cambiar de entorno](docs/entornos.md), [consultas](docs/consultas.md), [notas](docs/notas-credito-debito.md), [FCE](docs/fce.md), [exportación](docs/exportacion.md) y [lotes y JSON](docs/lotes-y-json.md). Los links viejos siguen andando: `obtencion-certificados.md` y `usage-patterns.md` quedan como índice. El sitio publica además `llms-full.txt`, con toda la documentación en un archivo para asistentes de IA.
- **Certificados:** la guía para obtenerlos, el README y la resolución de problemas muestran las dos formas de cargar el certificado: `arcli certificado generar` e `importar` (la recomendada, con la que ya no hay que configurar nada) o, si la clave se hizo con openssl, las rutas a mano con `arcli config establecer`.
- **Sitio de documentación:** [arcli.com.ar](https://arcli.com.ar), con menú por tarea (Empezar, Formas de uso, Comprobantes, Más, Referencia, Ayuda), buscador, problemas frecuentes que se filtran mientras escribís, tema claro u oscuro según el sistema y buena lectura en el celular. Tiene las mismas guías que `docs/` y se actualiza con cada versión. Cada página tiene su descripción para los buscadores y para la vista previa al compartir el link, y el ícono de ARCLI se ve también en la pantalla de inicio del celular. Cuenta las visitas con Cloudflare Web Analytics, que no usa cookies ni sigue a nadie entre sitios.
- **Instalar o actualizar con IA:** el README trae un prompt corto, listo para copiar en un asistente de IA (Claude, ChatGPT, Gemini, Copilot…), que revisa Node, instala o actualiza ARCLI, lo verifica y crea el acceso directo la primera vez. Si el asistente no puede ejecutar comandos, te guía paso a paso.

## [2.4.0] - 2026-11-08

Trae el acceso directo con doble clic, una salida en terminal más prolija y pareja, y arreglos para quien empieza sin saber de terminal. Puede afectar scripts:

- En la vista previa, `estado` del `--json` pasa de `"observado"` a `"previsualizacion"`.
- `fe --cargar` con `"previsualizar": false` ya no emite por sí solo (como A, B y C).
- `--moneda USD` sin `--cm` ya no da error: usa la cotización oficial de ARCA.
- Cambian textos de `error`, `sugerencia` y `avisos` (opciones entre backticks, tildes), no sus claves ni los códigos.
- El certificado sin autorizar a facturar sale como `WSFE_SERVICE_NOT_AUTHORIZED` en lugar de `UNEXPECTED_ERROR`.

Hay deprecaciones para la 3.0.0: ver "Deprecado".

### Cambiado

- **`estado` de la vista previa en el `--json`:** pasa de `"observado"` a `"previsualizacion"`, en A, B, C y la `E`. Antes parecía que ARCA había observado algo, pero no se emitió nada. `previsualizacion: true` sigue igual. Un script que compara `estado === "aprobado"` no cambia; uno que trate cualquier otro valor como observado tiene que sumar el nuevo.
- **Cotización oficial por defecto en moneda extranjera:** `arcli fc --moneda USD` sin `--cm` ni `--misma-moneda` usa la cotización oficial de ARCA y lo avisa en "Avisos" (y en `avisos` del JSON). Antes daba error "Falta la cotización". `--cm` sigue pisándola y `--cm 1` sigue siendo error.
- **Un solo formato para los importes:** la salida en terminal muestra los pesos como `$ 1.500` o `$ 1.500,50`, con el espacio que usa el PDF y sin `,00` si no hay centavos. Antes convivían `1.500$`, `$1.500` y `$ 1.500,00`. En moneda extranjera todos los comprobantes muestran el código ISO en lugar del `$` (`1.500,50 USD`), y el error de `fe` cuando los ítems no suman `--monto` deja de usar punto decimal (`1.500,50` en lugar de `1500.50`). Los textos de errores y avisos toman el mismo formato, también en el `--json`. El PDF no cambia y los importes del `--json` siguen siendo números.
- **Los datos se muestran igual en todos lados:** CUIT con guiones (`20-33333333-4`) y DNI con puntos (`12.345.678`) en los paneles; comprobantes como `00001-00001234`, también el asociado y la factura `E`; cotización con dos decimales o más (`1.250,50`, `1.250,123456`) y porcentajes con coma (`10,5%`); fechas `dd/mm/aaaa`; `N/D` para lo que ARCA no informa y `sin configurar` para la config. El vencimiento del certificado se calcula siempre en hora de Argentina. El `--json` no cambia, salvo el texto de los avisos que nombran la cotización.
- **Textos más parejos:** tildes y voseo en toda la salida (`¿A quién le facturás?`, `22 dígitos`, `Usá`), comandos siempre entre backticks y el mismo texto en los errores que se repiten. El dato faltante sale como `Falta el dato: monto.`. Fechas inválidas dicen qué formatos sirven. "Monto" al pedir y en errores, "importe" al mostrar; "comprobante" donde también puede ser un recibo. Mientras se emite, el progreso dice `Emitiendo la factura B en ARCA...`. En la ayuda, `--previsualizar` ya no dice que muestra algo "antes de emitir" (no emite), los alias nombran su flag y los ejemplos dicen `COMPLETA` en lugar de `FULL`. El modo interactivo de config muestra etiquetas (`Responsable inscripto`, `21%`) en lugar de valores crudos; lo que se guarda no cambia. Son textos: pueden cambiar `error`, `sugerencia` y `avisos` en el `--json`, no sus claves ni los códigos de error.
- **La pregunta antes de emitir dice el entorno:** con flags ahora es `¿Emitimos la factura B en PRODUCCIÓN?`, igual que en el modo interactivo, y si respondés que no avisa `No se emitió nada.`. La doble confirmación en producción sigue siendo solo del modo interactivo.
- **La letra del comprobante siempre va en mayúscula y las frases concuerdan:** `La factura B no admite…`, `El recibo C no lleva…`, `Últimas facturas B`, `No hay recibos C emitidos`. Antes salían `La factura b`, `La recibo c` y `Últimas Factura B`. Son textos: también cambian dentro de `error` en el `--json`, pero la clave `comprobante` y los códigos de error no. Los atajos siguen en minúscula (`fb`, `rc`).
- **Vista previa más corta:** los importes en cero que nadie cargó (IVA, tributos, exento, no gravado) no se muestran, y la cotización solo en moneda extranjera. A consumidor final sin identificar, una sola fila `Receptor` en lugar de tres. Lo que tiene valor se sigue mostrando, venga de una flag, de la config o de un default. `consultar` tampoco muestra `Importe IVA` en cero. El `--json` y `--bruto` siguen trayendo todo.
- **Rechazos de ARCA legibles:** los paneles de errores y eventos muestran una lista (`1. 502: mensaje`) en lugar de JSON crudo. El panel de resultado ya no lista `Observaciones`, `Eventos` ni `Errores` en cero.
- **Errores de uso en panel:** un comando u opción desconocida se muestra en el mismo panel que el resto de los errores, con la sugerencia de ayuda. Comandos, opciones y argumentos van entre backticks (`` opción desconocida `--montoo` ``), también en `error` con `--json`. El panel ya no repite la palabra `Error`. El mensaje de CUIT, certificado o clave faltante no repite `arcli config revisar`, que queda en la sugerencia del panel (cambia el texto de `error` y `detalle` en el `--json`, no las claves ni los códigos).
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

- **`WSFE_SERVICE_NOT_AUTHORIZED`:** el certificado sin autorizar a facturar, el error más común la primera vez, ahora dice qué hacer en ARCA en lugar de salir como error inesperado con el texto de WSAA.
- **Opciones nuevas marcadas en el modo interactivo:** lo que se sumó en las últimas versiones lleva `(nuevo)` al final (Emitir recibo, Recibo C en las notas, y Certificados de ARCA y Acceso directo en Configuración, que también lo lleva). La marca se va sola dos versiones menores después. Ver [modo interactivo](docs/modo-interactivo.md#menú-principal).
- **`arcli acceso-directo [ruta]`:** crea un ícono para abrir ARCLI con doble clic en macOS, Windows y Linux, en el escritorio o en la carpeta que indiques. También está en el modo interactivo, en Configuración. Creado desde el código fuente (`yarn dev`), abre el `arcli` instalado y lo informa en `usaArcliInstalado`. Si no encuentra un `arcli` instalado, el ícono lo dice y muestra cómo instalarlo, en lugar de "command not found".
- **Más datos en el JSON de las emisiones:** `entorno` y `puntoVenta` en todos los comprobantes, y `numero` en la factura E, también en la vista previa.
- **Sugerencias para los rechazos de ARCA más comunes:** cuando ARCA rechaza o deja una observación con un código conocido (`10016`, `10152`, `10243`, `10174`, `10119`, `10038`, `10017`/`10217`, además del punto de venta `10005`/`11002`), `sugerencias` dice qué pasó, qué hacer y el link a la guía. Antes solo se reconocían unos pocos mensajes, y los códigos que venían en las observaciones no se miraban. La tabla completa está en [Troubleshooting](docs/troubleshooting.md#rechazos-de-arca-por-código). La forma del JSON no cambia.
- **Comando para actualizar según el gestor:** el aviso de versión nueva, la ayuda y "Cerrar para actualizar" del modo interactivo muestran el comando del gestor con que instalaste ARCLI (`npm install -g`, `pnpm add -g`, `yarn global add` o `bun add -g`), deducido de la carpeta donde está instalado. Si no lo reconoce, sigue siendo el de npm. El plugin de PDF se sigue instalando con npm.
- **`config revisar` revisa el plugin de PDF:** un chequeo "Plugin de PDF" en la sección PDF dice si está instalado, si es la versión que usa ARCLI y si encontró un navegador, como `arcli pdf estado`. Con `pdf=siempre` avisa si falta; con `preguntar` (por defecto) solo lo revisa si está instalado, así `ok` no pasa a `false` para quien no genera PDFs; con `nunca` no lo revisa.
- **Todas las monedas de ARCA con su código ISO:** `--moneda`, `codigoMoneda` del JSON y la clave `moneda` de la config aceptan el código ISO o el de ARCA, indistinto: `ARS` o `PES`, `USD` o `DOL`, `UYU` o `011`, `CLP` o `033`, `GBP` o `021`, y así con todas las de la tabla de ARCA que tienen ISO. Antes solo se traducían `ARS`, `USD`, `EUR` y `BRL`, y otro ISO se mandaba tal cual y ARCA lo rechazaba. La vista previa y `consultar` muestran el nombre con el ISO (`Pesos uruguayos (UYU)`), el PDF de la `E` muestra el ISO de cualquier moneda y el autocompletado de `--moneda` ofrece todos los ISO. Un código que no está en la tabla se sigue mandando tal cual.

### Corregido

- **`EMISSION_UNCERTAIN` sugiere verificar en el entorno en que se emitió:** antes `arcli ultimos` consultaba el de la config, y emitido con `--produccion` con la config en testing, el comprobante "no figuraba" y reintentar lo duplicaba. También el aviso del lote, que ahora trae el comando completo.
- **`--cargar`:** en la `E`, `"pdf"` del archivo se ignoraba, `--exportar-pdf` con `--sin-pdf` no era error y un monto con más de 2 decimales se redondeaba sin avisar. En las notas, un flag del asociado (por ejemplo, solo `--acuit`) descartaba todo `comprobanteAsociado` del archivo; ahora se combinan. `importeExento` e `importeNoGravado` en `0` cuentan como ausentes.
- **La cotización deprecada de la config** ya no se aplica a otra moneda extranjera (la de USD no vale para EUR).
- **Modo interactivo:** la configuración guiada ya no dice "Ya podés emitir" con el certificado pendiente; "Cerrar para actualizar" dice dónde pegar el comando y espera, para leerlo al abrir ARCLI con el acceso directo; las rutas aceptan un archivo arrastrado; la barra se actualiza al volver de Configuración; pide el certificado del entorno activo y no siempre el de testing; sin punto de venta, dice dónde cargarlo. El comando equivalente ya no repite `--ir consumidor-final` después de `--consumidor-final`, que lo implica.
- **Mensajes que confundían:** `--moneda USD --cm 1` decía "Falta la cotización" y ahora explica que 1 es la cotización del peso. Una nota con período (`--periodo-desde`/`--periodo-hasta`) y parte de un comprobante asociado (`--apv`, `--acuit`) pedía el comprobante completo y ahora dice que se usa uno o el otro.
- **`arcli fe --cargar` con `"previsualizar": false` emitía sin preguntar:** en A, B y C eso no emite y decide la config (en una terminal pregunta); ahora la `E` hace lo mismo. Para emitir desde el archivo, `"emitir": true`. `"emitir"` y `"previsualizar"` en `true` a la vez son un error, como en el resto.
- **Modo interactivo:** la barra con la razón social y las respuestas ya respondidas pasan por el mismo filtro que el resto de la salida, así un dato externo no puede meter secuencias de terminal.
- **Colores de los errores:** dependían de stdout aunque los errores se escriben en stderr. `arcli ... 2> errores.log` guardaba códigos de color en el archivo, y con `arcli ... | jq` el error salía sin color en la terminal. Ahora dependen de stderr. También vale para los avisos de nueva versión y de certificado.
- **`ARCLI_ASCII=1` cubre toda la salida:** también cambia los símbolos (`✓`, `•`, `·`, `…`, `→`) y lo que dibuja el modo interactivo (`✔`, `❯`, `↑↓`, `⏎`, `←`, `┈`, el spinner). Antes solo cambiaba los bordes. Las tildes y la `ñ` se mantienen.
- **Entorno con tilde:** los títulos de `parametros` y `ultimos` dicen `PRODUCCIÓN` en lugar de `PRODUCCION`, y `estado`, `config`, `config revisar` y los errores de comprobante o CUIT no encontrado dicen `producción`. El `--json` conserva `entorno: "produccion"`; solo cambia el texto de `error` y `detalle`.
- **`arcli config` muestra el CUIT con guiones:** `20-33333333-4`, igual que el resto de los comandos. `config --json` no cambia.
- **Textos:** tildes que faltaban en `sí`, `automático`, `Cuándo generar el PDF`, `puntos críticos` y `Estás utilizando el entorno de TESTING`. La ayuda de `--moneda` dice `etc.` en lugar de `…`. Tildes y voseo en mensajes que habían quedado sin corregir (fecha fuera de rango, instalación del plugin de PDF, emisión sin confirmar, `coe.alreadyAuthenticated`). Los códigos de error y la forma del JSON no cambian.
- **`dh key too small` en producción:** en sistemas con OpenSSL en `SECLEVEL=2`, como Debian 13, las llamadas a WSFE y WSFEX de producción fallaban con ese error aunque el certificado, la clave y el punto de venta fueran correctos. Ahora ARCLI no ofrece DHE en producción, sin aflojar el resto de la seguridad de la conexión. Testing no cambia. Ya no hace falta el wrapper con `--tls-cipher-list`.
- **PDF de la factura E en el modo interactivo:** si faltan datos del emisor, los pide y ofrece guardarlos, como en el resto de los comprobantes. Antes el PDF no se generaba.
- **Emisión incierta en la factura E:** si falla la llamada que emite una `fe` (red, timeout), sale como `EMISSION_UNCERTAIN`, igual que A, B y C, en lugar de un error inesperado que invitaba a reintentar. `detalles` trae `numero` e `idSolicitud`, y la sugerencia es reintentar con esos mismos valores: ARCA no autoriza dos comprobantes con el mismo número, así que no se duplica.
- **Ayuda de `arcli fe`:** `--numero` decía "por defecto el siguiente de ARCA", pero es obligatorio. Ahora la ayuda lo dice.
- **Certificado vencido:** la sugerencia de `CERTIFICATE_EXPIRED` manda a renovarlo con `arcli certificado generar` e `importar`, en lugar de cargar las rutas a mano con `arcli config establecer`.

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
- **Autocompletado con Tab** para bash, zsh y fish. Se instala con `arcli completado instalar`, que agrega una línea al archivo de inicio del shell (`~/.zshrc`, `~/.bashrc`…), y se saca con `arcli completado desinstalar`; también desde el modo interactivo, en Configuración → Autocompletado. Completa comandos y atajos, flags, valores (`--iva-receptor`, `--concepto`, `--alicuota`, `--moneda`, `--transferencia`, `--ac`), claves de config y sus valores, tablas de `parametros` y letras de las familias; donde va una ruta, archivos. No hay que reinstalarlo al actualizar ARCLI. Ver [Autocompletado](docs/cli-reference.md#autocompletado).

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
- **Punto de venta para web service:** si ARCA rechaza el comprobante porque el punto de venta no es de web service (error `10005`), la `sugerencia` lo dice y apunta a la [guía para crear uno](docs/obtencion-certificados.md#punto-de-venta-para-web-service). `arcli estado` avisa lo mismo cuando el punto de venta configurado no está entre los habilitados. Desde el 1/11/2026 ARCA da de alta de oficio puntos de venta "Factura en línea" a monotributistas (RG 5893/2026), y esos no sirven para ARCLI.

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

[Sin publicar]: https://github.com/LcsGrz/arcli/compare/v2.5.2...HEAD
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
