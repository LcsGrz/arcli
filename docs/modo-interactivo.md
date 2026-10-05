[← Volver al README](../README.md)

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
| `arcli` sin terminal (pipe, CI, agente) o con `--json` | Muestra la ayuda, igual que antes                       |
| Cualquier comando con flags (`arcli fc -m 1000 …`)     | Sin cambios: el asistente nunca se mete en esos flujos  |

El modo interactivo no agrega comandos de emisión ni cambia flags, claves de config ni el JSON. Es una capa encima del CLI.

## Menú principal

1. **Emitir factura**
2. **Nota de crédito o débito sobre una factura**
3. **Ver últimos comprobantes**
4. **Revisar configuración**
5. **Salir**

Arriba del menú se muestran el entorno (`testing` o `produccion`) y el punto de venta configurados. Si falta el CUIT, el punto de venta o el certificado, el asistente lo avisa y propone revisar la configuración.

## Emitir factura

| Paso | Pregunta           | Detalle                                                                                                                             |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Comprobante        | Factura A, B o C, comunes o de crédito electrónica (FCE)                                                                            |
| 2    | Receptor           | Consumidor final, CUIT o DNI. En la A solo CUIT, porque la A no admite consumidor final                                             |
| 3    | IVA del receptor   | Solo las condiciones válidas para la letra elegida. Con consumidor final no se pregunta                                             |
| 4    | Concepto           | Servicios, productos o ambos. Arranca en `config.concepto` si está configurado                                                      |
| 5    | Monto total        | Acepta `150000`, `150.000`, `1500,50` o `1500.50`                                                                                   |
| 6    | Alícuota de IVA    | Solo en A y B. Arranca en `config.alicuota` o en 21%                                                                                |
| 7    | CBU                | Solo en facturas FCE y si no hay `config.cbu`. También pregunta la modalidad de transferencia                                       |
| 8    | Opciones avanzadas | Menú opcional antes de la vista previa: moneda extranjera, exento y no gravado (A y B), período del servicio y vencimiento del pago |

Después muestra la vista previa (la misma de `--previsualizar`), el comando equivalente y pregunta si emitir. En **producción** pide una segunda confirmación.

### PDF

Después de emitir, si `config.pdf` es `preguntar` (el valor por defecto), pregunta **"¿Generamos el PDF del comprobante?"**. Con `siempre` lo genera sin preguntar y con `nunca` no pregunta nada. Lo mismo vale para las notas de crédito y débito.

Si respondés que sí, pregunta tres datos opcionales que solo van en el PDF (Enter para omitirlos): la descripción, el nombre y el domicilio del receptor. Si faltan datos del emisor (razón social, domicilio, inicio de actividades), los pregunta una vez y ofrece guardarlos en la config. Si falta el plugin, ofrece instalarlo. Ver [PDF de comprobantes](pdf.md).

El comando equivalente se muestra antes de emitir, así que no incluye los flags del PDF.

### Opciones avanzadas

Antes de la vista previa aparece **"¿Agregamos algo más?"**. Cada opción se puede elegir y cambiar varias veces, y muestra el valor actual:

| Opción                      | Qué pregunta                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Moneda extranjera           | Pesos o dólares. En dólares, si te pagan en pesos (ingresás la cotización) o en dólares (se usa la cotización oficial de ARCA) |
| Importe exento o no gravado | La parte exenta y la no gravada del monto total. Solo en A y B                                                                 |
| Período del servicio        | Desde y hasta. Solo si el concepto no es solo productos                                                                        |
| Vencimiento del pago        | La fecha. En servicios y en facturas FCE                                                                                       |

Lo que no se elige usa los valores por defecto, igual que el CLI sin esos flags.

## Nota de crédito o débito

| Paso | Pregunta                    | Detalle                                                                                                                                                                                                  |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Crédito o débito            |                                                                                                                                                                                                          |
| 2    | Tipo de la factura original | Factura A, B o C, comunes o FCE                                                                                                                                                                          |
| 3    | Factura                     | Lista las últimas 10 facturas de ese tipo emitidas en el punto de venta configurado, consultadas a ARCA. No hace falta tipear el número                                                                  |
| 4    | Factura o período           | En notas comunes, se elige si asociarla a una factura de la lista o a un período (desde y hasta). Con período, se pregunta además el receptor y el concepto. Las notas FCE siempre van sobre una factura |
| 5    | Monto                       | En crédito: anular el total o ingresar un monto parcial (no puede superar el total de la factura). En débito: el monto a sumar                                                                           |
| 6    | IVA del receptor            | Solo si la factura no era a consumidor final: ARCA no devuelve la condición IVA, así que se pregunta, filtrada por la letra                                                                              |
| 7    | Anulación                   | Solo en NC/ND FCE: si la factura fue rechazada por el comprador                                                                                                                                          |

La nota hereda de la factura el concepto, el receptor (tipo y número de documento), la fecha y la alícuota de IVA cuando se puede deducir de los importes. El comprobante asociado se completa solo: tipo, punto de venta, número, CUIT del emisor y fecha.

## Ver últimos comprobantes

Pregunta el tipo de comprobante y muestra los últimos 10 emitidos en el punto de venta configurado: número, fecha, receptor, total y CAE.

## Revisar configuración

Muestra lo mismo que `arcli config revisar`: defaults, credenciales y validación contra ARCA.

## Volver, cancelar y salir

- **Volver al paso anterior:** en las opciones, **"← Volver"**; en las preguntas de texto, escribí **`<`**. Si volvés desde la primera pregunta, volvés al menú. Al volver se descarta lo que respondiste después, así un cambio de camino (por ejemplo, de CUIT a consumidor final) no deja datos viejos.
- `Ctrl+C` durante una pregunta cancela el flujo actual y vuelve al menú. Nada se emite hasta confirmar en el último paso.
- `Ctrl+C` en el menú principal, o elegir **Salir**, cierra el asistente.

## Qué no hace (todavía)

- Varias alícuotas en un mismo comprobante: se resuelven con el comando equivalente y `--alicuota TASA:MONTO`.
- Facturas por lote: siguen siendo `--cargar` con un JSON.

## Decisiones de diseño

- **Wizard y no pantalla completa.** Prompts encadenados con `@inquirer`, que ya usaba el CLI para confirmar emisiones. No hay una TUI de pantalla completa.
- **Sin lógica de negocio propia.** Arma la misma entrada que los flags (`BillingCommandInput`) y la pasa por `BillingService`, así que las validaciones, la vista previa y la emisión son exactamente las del CLI.
- **El contrato del CLI no cambia.** El único comportamiento nuevo es `arcli` sin argumentos en una terminal interactiva; sin terminal sigue mostrando la ayuda.
