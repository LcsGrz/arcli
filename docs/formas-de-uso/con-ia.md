[← Volver a la documentación](../README.md)

# Con IA

Le pedís la factura a tu asistente de IA en tus palabras. El asistente usa ARCLI, que corre en tu computadora, te muestra la vista previa y emite cuando le confirmás.

<!-- arcli: chat -->

> **Vos:** Facturale $ 150.000 a Juan Pérez, consumidor final, por el desarrollo de octubre. En testing.
>
> **Tu asistente:** Es una Factura C de $ 150.000 a consumidor final, por servicios. ¿La emito?
>
> **Vos:** Sí.
>
> **Tu asistente:** Listo: **Factura C 00003-00000118**, aprobada. CAE 86451064378488.

## Qué necesitás

Un asistente que pueda usar la terminal de tu computadora, como Claude Code, Codex, Gemini CLI o Copilot en VS Code, y ARCLI [instalado y configurado](../instalar.md).

## Cómo pedirlo

La primera vez, decile que lea la guía para asistentes:

```text title="Pedido" frame="terminal" wrap
Usá arcli para emitir una Factura C de $ 15.000 por servicios a consumidor final, en testing. Leé primero https://arcli.com.ar/llms.txt, mostrame la vista previa y esperá que te confirme antes de emitir.
```

## Qué hace el asistente

- Primero arma la vista previa; emite solo cuando confirmás ese comprobante.
- Siempre dice el entorno: testing o producción.
- En producción no emite sin tu confirmación: una factura emitida no se borra.

Códigos de salida y lo que leen los asistentes, en la [guía completa](../automatizar-con-ia.md).
