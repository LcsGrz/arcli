[← Documentación](README.md)

# Cómo funciona

Con el asistente, con un comando o desde tu IA, el comprobante pasa por los mismos pasos. Nada llega a ARCA sin que lo veas antes.

## Del dato al CAE

<!-- arcli: pasos -->

### 1. Juntás los datos

Lo que escribís, un JSON con `--cargar` o tu config. Lo que no pasás sale de la config o de un valor por defecto.

### 2. ARCLI los revisa

Formatos, combinaciones y las reglas de ARCA que se pueden chequear antes. Si algo falta o no va, te dice qué y cómo arreglarlo, sin llamar a ARCA.

<!-- arcli: muestra=error -->

```text
Error
Falta el monto. Usá -m 15000.
```

### 3. Te muestra la vista previa

El comprobante tal como se va a pedir. Puede consultar a ARCA para completarlo (el padrón del receptor o la cotización), pero no emite.

<!-- arcli: muestra=vista -->

```text
Factura C · vista previa
Importe total    $ 15.000
Receptor         Consumidor final
```

### 4. Emite en ARCA

Solo si confirmás o pasaste `--emitir`. La decisión es de ARCA: aprueba con un CAE, aprueba con observaciones o rechaza. Con `--previsualizar` no emite nunca; con `--json` o sin terminal, tampoco sin `--emitir`.

### 5. Recibís el resultado y el PDF

El CAE en pantalla o en JSON, y el [PDF](pdf.md) con el QR si lo pediste. Si el PDF falla, el comprobante ya está emitido: no lo vuelvas a emitir.

## Si un dato está en dos lugares

Gana el más cercano a lo que escribiste en ese momento.

| Orden | De dónde sale                 | Ejemplo           |
| ----- | ----------------------------- | ----------------- |
| 1     | Un flag en el comando         | `--pv 4`          |
| 2     | Un JSON con `--cargar`        | `"puntoVenta": 4` |
| 3     | Tu config                     | `puntoVenta 3`    |
| 4     | El valor por defecto de ARCLI | Entorno `testing` |

Con `--pv 4` y la config en 3, va el 4. Sin el flag, el 3.

## Tres formas, el mismo camino

Las tres arman la misma entrada y pasan por las mismas validaciones.

<!-- arcli: formas -->

| Si querés                      | Escribís                    | Forma                                   |
| ------------------------------ | --------------------------- | --------------------------------------- |
| Que me guíe paso a paso        | `arcli`                     | [Asistente](formas-de-uso/asistente.md) |
| En una línea o desde un script | `arcli fc -m 15000 --cs`    | [Comandos](formas-de-uso/comandos.md)   |
| Con mi asistente preferido     | "Facturale $ 15.000 a Juan" | [Con IA](formas-de-uso/con-ia.md)       |

## Qué te devuelve

| Salida                       | Para qué                                             | ¿Puede cambiar?              |
| ---------------------------- | ---------------------------------------------------- | ---------------------------- |
| En la terminal (por defecto) | Leer: paneles con la vista previa y el resultado     | Sí, entre versiones          |
| `--json`                     | Scripts e IAs                                        | No sin aviso: es el contrato |
| `--bruto`                    | Revisar un problema: suma la respuesta cruda de ARCA | Depende de ARCA              |

El detalle de cada formato, en [entrada y salida](input-output.md#diferencias-entre-modos).

> [!WARNING]
> **ARCLI no reemplaza a ARCA.** Ordena el camino y revisa lo que puede antes, pero la última palabra es de ARCA: un comprobante bien armado igual puede salir observado o rechazado. Qué hacer en cada caso, en [problemas frecuentes](troubleshooting.md).

¿Un término que no conocés, como CAE o punto de venta? Están en el [glosario](glossary.md).
