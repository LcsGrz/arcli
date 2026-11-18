[← Volver a la documentación](../README.md)

# Asistente

ARCLI sin nada más abre un asistente que te pregunta paso a paso. Es para quien factura de vez en cuando y no quiere acordarse de flags.

![El asistente emitiendo una Factura C en testing: comprobante, receptor, monto, vista previa y CAE](../assets/demo/interactivo.gif)

## Cómo se abre

Con doble clic en el ícono de ARCLI del escritorio, o escribiendo en la terminal:

```bash
arcli
```

## Qué podés hacer

| Opción del menú           | Para qué                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| Emitir factura            | A, B, C, FCE o E: [¿qué comprobante me toca?](../comprobantes/README.md) |
| Emitir recibo             | [Recibo A, B o C](../comprobantes/README.md)                             |
| Notas de crédito y débito | Elegís la factura de una lista                                           |
| Repetir un comprobante    | Mismo receptor y monto, con fecha de hoy                                 |
| Consultar comprobantes    | Los últimos emitidos y su detalle                                        |
| Configuración             | Guiada, certificados, PDF y acceso directo                               |

## Cómo te movés

| Tecla    | Qué hace                                                         |
| -------- | ---------------------------------------------------------------- |
| ↑ ↓      | Elegir una opción                                                |
| Enter    | Confirmar                                                        |
| Espacio  | Marcar los opcionales                                            |
| Esc      | Volver al paso anterior; si tu terminal no lo manda, escribí `<` |
| Ctrl + C | Cancelar y volver al menú; en el menú, salir                     |

## Antes de emitir

Siempre ves la vista previa y el **comando equivalente**: copialo y la próxima vez lo hacés en una línea. Nada se emite hasta que confirmás, y en producción pide una segunda confirmación.

<details>
<summary>Ver cómo es consultar comprobantes</summary>

![Consultar los últimos comprobantes y el detalle de uno desde el asistente](../assets/demo/consultar.gif)

</details>

Cada pantalla del asistente, paso por paso, en la [guía completa del modo interactivo](../modo-interactivo.md).
