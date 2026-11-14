[← Documentación](README.md)

# Modo interactivo

`arcli` sin argumentos abre un asistente que pregunta paso a paso qué querés emitir. Está pensado para quien factura de vez en cuando y no quiere recordar flags. Usa las mismas validaciones y la misma vista previa que el resto del CLI, y antes de emitir muestra el **comando equivalente**, así podés copiarlo y la próxima vez hacerlo directo.

```bash
arcli               # en una terminal interactiva abre el asistente
arcli interactivo   # lo mismo, explícito
```

## Cuándo se abre y cuándo no

| Situación                                              | Qué pasa                                                |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `arcli` en una terminal (stdin y stdout son TTY)       | Se abre el asistente                                    |
| `arcli interactivo`                                    | Se abre el asistente; sin terminal interactiva da error |
| `arcli` sin terminal (pipe, CI, agente) o con `--json` | Muestra la ayuda                                        |
| Cualquier comando con flags (`arcli fc -m 1000 …`)     | Sin cambios: el asistente nunca se mete en esos flujos  |

El modo interactivo no agrega comandos de emisión ni cambia flags, claves de config ni el JSON. Es una capa encima del CLI.

## Menú principal

1. **Emitir factura**
2. **Emitir recibo**
3. **Repetir un comprobante anterior**
4. **Emitir nota de crédito**
5. **Emitir nota de débito**
6. **Consultar comprobantes**
7. **Estado de ARCA**
8. **Configuración**
9. **Salir**

Si hay una versión nueva de ARCLI, el menú suma arriba de todo **Actualizar a la versión X.Y.Z** (ver [Actualizar](#actualizar)).

**Opciones nuevas.** Lo que se sumó en las últimas versiones lleva `(nuevo)` al final, en color: Emitir recibo, Certificados de ARCA y Acceso directo en el escritorio en Configuración, Recibo C y Factura de exportación E al elegir sobre qué comprobante va una nota. Configuración también lo lleva mientras tenga alguna opción nueva adentro. La marca se va sola dos versiones menores después de la que trajo la opción.

Debajo del logo va la versión de ARCLI. Arriba del menú, la barra de estado muestra a la izquierda quién emite (la razón social de `emisor.razonSocial` o, si no está, el CUIT) y el punto de venta, y a la derecha cómo está ARCA y el entorno (`TESTING` en naranja o `PRODUCCIÓN` en celeste):

| Estado                 | Cuándo                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| **ARCA funcionando**   | Los servidores de facturación (app, base de datos y autenticación) responden OK  |
| **ARCA con demoras**   | Responden OK, pero tardaron más de 3 segundos                                    |
| **ARCA con problemas** | Alguno de los servidores no responde OK                                          |
| **ARCA sin respuesta** | Error de red, o ARCA no contestó en 5 segundos                                   |
| **ARCA sin verificar** | Falta completar la configuración o el certificado venció, así que no se consulta |

La consulta es la misma de `arcli estado` sin el punto de venta (no pide autenticación) y se hace al abrir el asistente. **Si falta algo obligatorio** (CUIT, certificado y clave de testing o punto de venta), al abrir el asistente propone hacer la [configuración guiada](#configuración).

**Certificado por vencer.** Si a alguno de los certificados configurados (de testing o de producción, sin importar el entorno activo) le quedan menos de 30 días, debajo de la barra va un recuadro amarillo, con una línea por certificado, la fecha, los días que faltan y el link a la [guía para renovarlo](obtencion-certificados.md). Queda arriba de todo lo que hagas en la sesión. Si alguno ya venció, el recuadro es rojo. Si es el del entorno activo, además la barra dice `certificado vencido` y `ARCA SIN VERIFICAR`, y emitir o consultar muestra el error `Certificado vencido` sin llegar a ARCA. La configuración sigue disponible para cargar el certificado nuevo.

## Actualizar

Al abrir el asistente se consulta npm por una versión nueva (no aparece con `CI` ni `NO_UPDATE_NOTIFIER`). Si hay, **Actualizar a la versión X.Y.Z** es la primera opción del menú, en naranja. Adentro muestra tu versión, la nueva y las novedades de cada versión intermedia (de las 3 más nuevas, sacadas del [CHANGELOG](../CHANGELOG.md)), y el comando para actualizar.

- **Cerrar para actualizar**: copia el comando para actualizar al portapapeles, dice dónde pegarlo (una terminal nueva: Terminal en Mac, PowerShell en Windows) y espera a que confirmes antes de cerrar el asistente, así se lee aunque lo hayas abierto con el acceso directo. El comando es el del gestor con que instalaste ARCLI: `npm install -g arcli@latest`, `pnpm add -g arcli@latest`, `yarn global add arcli@latest` o `bun add -g arcli@latest` (lo deduce de la carpeta donde está instalado; si no lo reconoce, npm). ARCLI no se actualiza solo porque no puede reemplazarse mientras corre. Si no puede copiar (en Linux usa `wl-copy`, `xclip` o `xsel`), muestra el comando para escribirlo.
- **← Volver**: vuelve al menú.

Con el asistente, el aviso de nueva versión no se repite al salir. En los comandos con flags aparece al final.

## Emitir factura

Primero pregunta solo lo **requerido**:

| Paso | Pregunta         | Detalle                                                                                                              |
| ---- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | Comprobante      | Factura A, B o C, comunes o de crédito electrónica (FCE), o la de exportación E ([abajo](#factura-de-exportación-e)) |
| 2    | Receptor         | Consumidor final, CUIT, DNI o CUIL. En la A solo CUIT, porque la A no admite consumidor final                        |
| 3    | IVA del receptor | Solo las condiciones válidas para la letra elegida. Con consumidor final no se pregunta                              |
| 4    | Concepto         | Servicios, productos o ambos. Arranca en `config.concepto` si está configurado                                       |
| 5    | Monto total      | Acepta `150000`, `150.000`, `1500,50` o `1.500,50` (punto para miles, coma para decimales)                           |
| 6    | CBU              | Solo en facturas FCE y si no hay `config.cbu`; después de la confirmación ofrece guardarlo en la config              |

Después, **una sola pregunta con todos los opcionales** (ver abajo). Enter sin marcar nada sigue con los valores por defecto.

Después muestra la vista previa (la misma de `--previsualizar`), el comando equivalente y pregunta si emitir. En **producción** pide una segunda confirmación.

### Factura de exportación (E)

La `E` se elige en el mismo selector, pero tiene su propio asistente porque no lleva receptor argentino, concepto ni IVA. Valida y emite igual que `arcli fe`:

| Paso | Pregunta              | Detalle                                                                                                                               |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Cliente               | Nombre o razón social del cliente del exterior                                                                                        |
| 2    | Domicilio             | Domicilio del cliente                                                                                                                 |
| 3    | País de destino       | Nombre o código de la tabla de WSFEX (`ESTADOS UNIDOS` o `212`). Argentina no se acepta                                               |
| 4    | CUIT del país         | Solo si ARCA no publica un CUIT para el destino: escribís el CUIT o buscás el país por nombre y lo elegís de la lista (`--cuit-pais`) |
| 5    | ID impositivo         | Opcional (Enter para omitirlo)                                                                                                        |
| 6    | Qué exportás          | Servicios (por defecto), bienes u otros                                                                                               |
| 7    | Monto total           | Igual que en la factura común                                                                                                         |
| 8    | Descripción           | Opcional; por defecto "Según detalle"                                                                                                 |
| 9    | Moneda                | Dólares (`DOL`, con la cotización de aduana que publica ARCA) o pesos (`PES`)                                                         |
| 10   | ¿Te pagan en dólares? | Solo en dólares: si sí, ARCA lo registra como cancelación en la misma moneda (`--misma-moneda`)                                       |
| 11   | Incoterm              | Solo en bienes, de la tabla de WSFEX, o sin incoterm                                                                                  |
| 12   | Permisos de embarque  | Solo en bienes, opcional: los ya existentes en ARCA, separados por coma (`--permiso` con `--permiso-existente`)                       |
| 13   | Forma de pago         | Por defecto "Transferencia Internacional"                                                                                             |
| 14   | Fecha de pago         | Opcional; por defecto la del comprobante                                                                                              |
| 15   | Actividad             | Solo si no está `exportacion.actividad`; se valida contra la tabla de WSFEX y después ofrece guardarla en la config                   |
| 16   | Opcionales            | Una sola pregunta, como en A, B y C ([abajo](#opcionales-de-la-e))                                                                    |

Después muestra la vista previa, el comando `arcli fe` equivalente y pregunta si emitir (dos veces en producción). El PDF sigue la misma regla que el resto. Volver desde el primer paso vuelve al selector de comprobantes.

#### Opcionales de la E

La factura y las notas E terminan con **"¿Agregamos algún opcional?"**, que funciona igual que [los de A, B y C](#opcionales): se marca con espacio, Enter sigue y después pregunta solo lo marcado. Se valida igual que con los flags.

| Opción                   | Qué pregunta                                                                                                                                                                             | Cuándo aparece                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Ítems                    | Uno por uno: descripción, cantidad, precio unitario y unidad (de la tabla de WSFEX). Enter en la descripción termina; si la suma no da el monto total, avisa y sigue pidiendo (`--item`) | Siempre. Sin ítems va un renglón con el monto total         |
| Idioma                   | Español, inglés o portugués, de la tabla de WSFEX (`--idioma`)                                                                                                                           | Siempre. Por defecto español; en las notas, el del asociado |
| CUIT del país            | El CUIT o el país por nombre, de la tabla de ARCA; tiene que ser el del destino (`--cuit-pais`)                                                                                          | Factura                                                     |
| Observaciones            | Las observaciones y las observaciones comerciales (`--observaciones` y `--obs-comerciales`)                                                                                              | Siempre                                                     |
| Descripción del incoterm | El texto, con la descripción de la tabla de ARCA como valor por defecto (`--incoterms-desc`)                                                                                             | Si hay incoterm                                             |
| Cotización               | La cotización a mano, en lugar de la de aduana que publica ARCA o la del asociado (`--cm`)                                                                                               | En moneda extranjera. En las notas, salvo en servicios      |

### PDF

Después de emitir, si `config.pdf` es `preguntar` (el valor por defecto), pregunta **"¿Generamos el PDF del comprobante?"**. Con `siempre` lo genera sin preguntar y con `nunca` no pregunta nada. Lo mismo vale para las notas de crédito y débito y para la `E`.

Con `nunca`, la confirmación antes de emitir suma una tercera opción, **Emitir y generar el PDF**: es el `--exportar-pdf` del asistente, solo para ese comprobante. No agrega ninguna pregunta: si elegís "Emitir ahora", todo sigue como siempre.

Si respondés que sí, pregunta cuatro datos opcionales que solo van en el PDF: la descripción, el nombre y el domicilio del receptor, y la condición de venta. Para esta última muestra una lista (Omitir, Contado, Tarjeta de Débito, Tarjeta de Crédito, Cuenta Corriente, Cheque, Transferencia Bancaria, Otros medios de pago electrónico, Otra) con la de la config (`condicionVenta`) marcada, así que Enter la mantiene. "Omitir" también evita que reaparezca el valor configurado; "Otra" pide el texto: Enter deja "Otra", o el texto libre que tenía la config. Si faltan datos del emisor (razón social, domicilio, inicio de actividades), los pregunta una vez y ofrece guardarlos en la config. Si falta el plugin, ofrece instalarlo. Ver [PDF de comprobantes](pdf.md).

El comando equivalente se muestra antes de emitir, así que no incluye los flags del PDF. Siempre lleva el entorno (`--testing` o `--produccion`): si después cambiás el entorno en la config, el comando pegado sigue emitiendo donde lo armaste.

### Opcionales

Antes de la vista previa aparece **"¿Agregamos algún opcional?"**: una lista donde marcás con **espacio** lo que querés cambiar y confirmás con **Enter**. Cada opción muestra el valor que se va a usar si no la marcás. Después pregunta solo lo que marcaste, en orden.

| Opción                      | Qué pregunta                                                                                                                                                                                                                                                                 | Cuándo aparece                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Fecha del comprobante       | La fecha (`--fecha`), por ejemplo para facturar con fecha de fin de mes. Por defecto hoy. Acepta lo mismo que el CLI: hasta 10 días antes o después de hoy en servicios, 5 en productos, y en FCE 5 antes y 1 después; las fechas futuras de productos y FCE, dentro del mes | Siempre                             |
| Alícuota de IVA             | La alícuota. Por defecto `config.alicuota` o 21%                                                                                                                                                                                                                             | A y B                               |
| Moneda extranjera           | Pesos, dólares, euros u otra de la tabla de ARCA (`arcli parametros monedas`). En otra moneda, si te pagan en pesos (ingresás la cotización) o en esa moneda (se usa la cotización oficial de ARCA, `--misma-moneda`)                                                        | Siempre                             |
| Importe exento o no gravado | La parte exenta y la no gravada del monto total                                                                                                                                                                                                                              | A y B                               |
| Período del servicio        | Desde y hasta                                                                                                                                                                                                                                                                | Si el concepto no es solo productos |
| Vencimiento del pago        | La fecha                                                                                                                                                                                                                                                                     | En servicios y en facturas FCE      |
| Modalidad de transferencia  | SCA (por defecto) o ADC                                                                                                                                                                                                                                                      | Facturas FCE                        |

"Volver" en una de esas preguntas vuelve a la lista, con lo marcado y lo ya respondido. "← Volver" en la lista vuelve al monto.

Lo que no se elige usa los valores por defecto, igual que el CLI sin esos flags.

## Emitir recibo

Emite un Recibo C (`rc`), el comprobante de un cobro. Sigue los mismos pasos que una Factura C, sin elegir el comprobante: receptor, IVA del receptor, concepto ("¿Qué estás cobrando?"), monto y opcionales, y después la vista previa con el comando `arcli rc` equivalente. El PDF sale con el título `RECIBO C`.

## Nota de crédito o débito

Se elige desde el menú: **Emitir nota de crédito** (descuento, devolución o anulación) o **Emitir nota de débito** (cargo adicional). Las dos siguen los mismos pasos.

| Paso | Pregunta              | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Comprobante original  | Factura A, B o C, comunes o FCE, Recibo C o la de exportación E ([abajo](#nota-de-crédito-o-débito-e))                                                                                                                                                                                                                                                                                                                                   |
| 2    | Comprobante o período | En notas comunes, se elige si asociarla al comprobante (una factura o un recibo) o a un período (desde y hasta). Con período, se pregunta además el receptor y el concepto. Las notas FCE siempre van sobre una factura                                                                                                                                                                                                                  |
| 3    | Factura               | Lista las últimas 15 facturas de ese tipo emitidas en el punto de venta configurado (la cantidad se cambia con `config.comprobantesPorLista`), consultadas a ARCA, con número, fecha, receptor, total y CAE. Abajo de la lista: **Cargar más…** trae las anteriores, e **Ingresar el número a mano…** pide punto de venta y número (sirve para una factura vieja o de otro punto de venta)                                               |
| 4    | Monto                 | En crédito: anular el total o ingresar un monto parcial (no puede superar el total de la factura). En débito: el monto a sumar                                                                                                                                                                                                                                                                                                           |
| 5    | IVA del receptor      | Solo si la factura no era a consumidor final: ARCA no devuelve la condición IVA, así que se pregunta, filtrada por la letra                                                                                                                                                                                                                                                                                                              |
| 6    | Anulación             | Solo en NC/ND FCE: si la factura fue rechazada por el comprador                                                                                                                                                                                                                                                                                                                                                                          |
| 7    | Opcionales            | La misma selección múltiple de "Emitir factura", con lo que aplica a una nota: fecha del comprobante, período del servicio y vencimiento del pago (estos dos como en la factura; las notas FCE no llevan vencimiento), importe exento o no gravado (A y B, salvo que anule el total, porque ahí se copian de la factura) y moneda (solo en las notas por período: las de una factura van en su moneda). La alícuota tiene su propio paso |

La nota hereda de la factura el concepto, el receptor (tipo y número de documento), la moneda y la alícuota de IVA cuando se puede deducir de los importes. El comprobante asociado se completa solo: tipo, punto de venta (el de la factura, aunque sea otro que el configurado), número, CUIT del emisor y fecha.

### Nota de crédito o débito E

Al elegir **Factura de exportación E** como comprobante original, la nota sigue estos pasos:

| Paso | Pregunta                    | Detalle                                                                                                                                                                                   |
| ---- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Sobre qué va la nota        | La factura E (por defecto, Enter) u otra nota de débito o crédito E (`--ac nde` o `--ac nce`)                                                                                             |
| 2    | Punto de venta del asociado | Por defecto, el configurado                                                                                                                                                               |
| 3    | Número del asociado         | Lo busca en ARCA y muestra a quién y por cuánto fue. Si no existe, o si la nota no puede ajustarlo (en servicios, una nota de débito solo ajusta una factura), avisa y vuelve a preguntar |
| 4    | Monto                       | En la moneda del asociado. En crédito no puede superar su total, salvo que ajuste otra nota de crédito                                                                                    |
| 5    | Detalle                     | Opcional; por defecto "Según detalle"                                                                                                                                                     |
| 6    | Permisos de embarque        | Solo si el asociado es de bienes, opcional: van con `--permiso`, sin `--permiso-existente`                                                                                                |
| 7    | Opcionales                  | Ítems, idioma, observaciones, descripción del incoterm y cotización ([arriba](#opcionales-de-la-e))                                                                                       |

Cliente, destino, moneda, cotización, idioma, incoterm y actividad salen del asociado, y el número de la nota, del último que tiene ARCA. Después muestra la vista previa y el comando equivalente (`arcli nce …` o `arcli nde …`), y pregunta antes de emitir, como la factura E.

## Repetir un comprobante anterior

Para quien factura o cobra lo mismo seguido. Elegís si es una factura, un Recibo C o una factura de exportación `E` ([abajo](#repetir-una-factura-e)) y uno de los últimos 15 emitidos, y se copian el receptor, el concepto, el monto y la alícuota (cuando se puede deducir de los importes). **Las fechas no se copian:** el comprobante sale con fecha de hoy, salvo que elijas otra en los opcionales.

| Paso | Pregunta             | Detalle                                                                                                                                                                                                                                                   |
| ---- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Tipo de comprobante  | Factura A, B o C, comunes o FCE, Recibo C o factura de exportación E                                                                                                                                                                                      |
| 2    | Comprobante          | Uno de los últimos emitidos en el punto de venta configurado. Como en las notas, se pueden cargar más o ingresar el número a mano                                                                                                                         |
| 3    | IVA del receptor     | Solo si no era consumidor final: ARCA no devuelve la condición IVA de la factura                                                                                                                                                                          |
| 4    | Monto                | El mismo o uno nuevo, en la moneda del original                                                                                                                                                                                                           |
| 5    | ¿Cómo te pagan?      | Solo si el original era en moneda extranjera (dólares, euros u otra): el nuevo sale en esa moneda y la cotización se vuelve a cargar. En pesos ingresás la cotización acordada; en la moneda del comprobante se usa la oficial de ARCA (`--misma-moneda`) |
| 6    | Período del servicio | Este mes, el mes pasado, solo hoy u otro. No se pregunta si el concepto es solo productos                                                                                                                                                                 |
| 7    | CBU                  | Solo en FCE sin `config.cbu`; después de la confirmación ofrece guardarlo en la config, como en "Emitir factura"                                                                                                                                          |
| 8    | Opcionales           | La misma selección múltiple de "Emitir factura". Si el original era en moneda extranjera, no ofrece cambiar la moneda: el monto está en esa moneda                                                                                                        |

Después sigue igual que una factura nueva: vista previa, comando equivalente y confirmación.

### Repetir una factura E

Elegís una de las últimas facturas `E` (con **Cargar más…** e **Ingresar el número a mano…**, como en "Consultar comprobantes") y se copian de lo que ARCA devuelve de ella (`FEXGetCMP`): el cliente, su domicilio e ID impositivo, el destino y su CUIT, el tipo de exportación, la moneda y si se cobró en esa moneda, el incoterm y su descripción, los ítems, la forma de pago, el idioma y la actividad. **No se copian** las fechas (sale con la de hoy), la cotización (la de aduana del día, salvo que cargues otra en los opcionales), los permisos de embarque ni las observaciones.

| Paso | Pregunta             | Detalle                                                                                                                                                      |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Comprobante          | Una de las últimas facturas `E` del punto de venta                                                                                                           |
| 2    | Monto                | El mismo o uno nuevo, en la moneda del original. Con otro monto los ítems copiados no suman, así que sale un renglón con el total: los podés cargar de nuevo |
| 3    | ¿Te pagan en…?       | Solo si ARCA no devolvió si se cobró en la misma moneda                                                                                                      |
| 4    | CUIT del país        | Solo si la factura no lo trae y ARCA no publica uno para el destino                                                                                          |
| 5    | Permisos de embarque | Solo en bienes, opcional: son de cada embarque                                                                                                               |
| 6    | Fecha de pago        | Opcional; por defecto la del comprobante                                                                                                                     |
| 7    | Actividad            | Solo si la factura no la trae y no está `exportacion.actividad`                                                                                              |
| 8    | Opcionales           | Los [de la E](#opcionales-de-la-e), con lo copiado ya cargado                                                                                                |

Un solo renglón por el total se repite como descripción (`--descripcion`) y varios, como `--item`. Si algún ítem tiene bonificación, que el asistente no informa, o los ítems no suman el total, avisa y sale un renglón con el monto total. Después muestra la vista previa, el comando `arcli fe` equivalente y pregunta si emitir, como una factura `E` nueva.

## Consultar comprobantes

![Consultar comprobantes: lista, cargar más y detalle de una Factura C](assets/demo/consultar.gif)

Elegís el tipo (cualquiera de los 19 de A, B y C, o la factura de exportación `E` y sus notas de crédito y débito) y aparece la lista de los últimos 15 emitidos en el punto de venta configurado, con el mismo formato que `arcli ultimos`: número, fecha, receptor, total y CAE. En la `E` va el nombre del cliente en lugar del receptor. Igual que al elegir la factura de una nota, abajo están **Cargar más…** e **Ingresar el número a mano…** (punto de venta y número).

Al elegir uno se muestra lo mismo que `arcli consultar`: CAE, vencimiento, importes y receptor. En la `E`, cliente, destino, tipo de exportación, moneda, total y, en las notas, la factura que ajustan. Después vuelve a la lista, con lo que ya estaba cargado, para ver otro. **Esc** o **"← Volver"** sale al menú.

## Configuración

| Opción                          | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ver configuración               | Todos los datos guardados, igual que `arcli config`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Revisar configuración           | Lo mismo que `arcli config revisar`: defaults, credenciales y validación contra ARCA                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Configuración guiada            | Pregunta CUIT, certificado y clave de testing, punto de venta, concepto e IVA del receptor por defecto, y si querés, los datos del emisor para el PDF. Propone lo que ya está guardado. Si no tenés certificado de testing, ofrece sacarlo ahí mismo (como "Certificados de ARCA") y no pide la clave                                                                                                                                                                                                                                                   |
| Modificar configuración         | Lista los datos con las mismas secciones y el mismo orden que `arcli config` (cuenta, certificados, al facturar, FCE, factura de exportación, datos del emisor, PDF y salida), con el valor actual abajo del marcado. No incluye `emitir`, `json` ni `bruto`, que solo cambian el CLI con flags. Elegís uno y lo cambiás; en los de texto, `-` lo borra. Después vuelve a la lista, hasta "← Volver"                                                                                                                                                    |
| Certificados de ARCA            | Una caja por entorno, con el título en su color: alias, vencimiento (con los días que faltan), certificado, clave y si hay un pedido sin importar. "Sacar o renovar un certificado" pide entorno y alias, muestra el CSR y los pasos en ARCA como `arcli certificado generar`; si ya hay un pedido pendiente, ofrece verlo de nuevo o descartarlo. "Cargar el certificado (.crt)" pide la ruta (podés arrastrar el archivo a la terminal), lo valida y lo configura como `arcli certificado importar`; si ya había otro, pregunta antes de reemplazarlo |
| Plugin de PDF                   | Estado del plugin; instalarlo, actualizarlo o desinstalarlo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Autocompletado                  | Si está instalado el autocompletado con Tab; instalarlo o desinstalarlo (como `arcli completado`)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Acceso directo en el escritorio | Crea o actualiza el ícono para abrir ARCLI con doble clic (como `arcli acceso-directo`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Cada respuesta se valida igual que en `arcli config establecer` y se guarda en el momento: si cortás a mitad, lo ya respondido queda guardado. En las rutas del certificado y de la clave podés arrastrar el archivo a la terminal. Si en la guiada dejás el certificado para después, al terminar te dice que falta cargarlo y dónde. Al volver al menú, la barra se actualiza con lo que cambiaste.

## Pasar a producción

1. Configuración → Certificados de ARCA → Sacar o renovar un certificado → Producción, y seguí los pasos en ARCA.
2. En ARCA, autorizá el certificado a facturar (`wsfe`) desde el Administrador de Relaciones de Clave Fiscal.
3. Creá un punto de venta para web service (no sirve el de Factura en línea) y cargalo en Modificar configuración → Punto de venta.
4. Modificar configuración → Entorno → produccion. Desde ahí, lo que emitís tiene validez fiscal, y antes de emitir el asistente pide una segunda confirmación.

Guía completa: [Cómo obtener los certificados](obtencion-certificados.md).

## Estado de ARCA

Muestra lo mismo que `arcli estado` (servidores, tiempo de respuesta y punto de venta) y la cotización oficial del dólar.

## Volver, cancelar y salir

- **Volver al paso anterior:** **Esc**, en las listas y en las preguntas de texto. En las listas también está la opción **"← Volver"**, y en las de texto escribir **`<`** hace lo mismo, por si la terminal no manda Esc. Si volvés desde la primera pregunta, volvés al menú. Al volver se descarta lo que respondiste después, así un cambio de camino (por ejemplo, de CUIT a consumidor final) no deja datos viejos.
- `Ctrl+C` durante una pregunta cancela el flujo actual y vuelve al menú. Nada se emite hasta confirmar en el último paso.
- **Esc** o `Ctrl+C` en el menú principal, o elegir **Salir**, cierra el asistente.

## Qué no hace (todavía)

- Varias alícuotas en un mismo comprobante: se resuelven con el comando equivalente y `--alicuota TASA:MONTO`.
- Facturas por lote: siguen siendo `--cargar` con un JSON.
- Monedas que ARCA publica solo con un código numérico (`002`, dólar libre, y `049`, oro): van con `--moneda` en el CLI.

## Ver también

- [Arquitectura](architecture.md#decisiones-de-diseño): por qué es un asistente y no una pantalla completa.
- [Referencia del CLI](cli-reference.md): los comandos equivalentes.
