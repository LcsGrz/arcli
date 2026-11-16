# Documentación de ARCLI

[← README](../README.md)

También en el [sitio de documentación](https://lcsgrz.github.io/arcli/), con buscador.

## Empezar

1. [Instalación y primeros pasos](../README.md#instalación): instalar y configurar.
2. [Certificado de testing](certificado-testing.md): para probar sin validez fiscal ([guía completa](certificado-testing-completa.md)).
3. [Certificado de producción](certificado-produccion.md): para facturar de verdad, con el punto de venta para web service ([guía completa](certificado-produccion-completa.md)).
4. [Cambiar de entorno](entornos.md): testing y producción, y el checklist antes de la primera factura real.
5. [Cómo funciona](mental-model.md): del dato al CAE, y qué pasa si un dato está en dos lugares.

## Formas de uso

- [Asistente](formas-de-uso/asistente.md): `arcli` sin nada más, paso a paso ([guía completa del modo interactivo](modo-interactivo.md)).
- [Comandos](formas-de-uso/comandos.md): todo en una línea, para facturar seguido o automatizar.
- [Con IA](formas-de-uso/con-ia.md): se lo pedís a tu asistente de IA ([guía completa](automatizar-con-ia.md)).

## Comprobantes

- [¿Qué comprobante me toca?](comprobantes/README.md): una página por comprobante, con un ejemplo y todas sus opciones.
- Recetas por perfil: [monotributo](comprobantes-monotributo.md) y [responsable inscripto](comprobantes-responsable-inscripto.md).
- [Notas de crédito y débito](notas-credito-debito.md)
- [Factura de Crédito Electrónica (FCE)](fce.md)
- [Exportación: Factura E y sus notas](exportacion.md)

## Más

- [Consultas sin emitir](consultas.md): últimos comprobantes, estado de ARCA, tablas, padrón.
- [PDF de comprobantes](pdf-en-corto.md): cómo se activa y dónde queda ([guía completa](pdf.md): leyendas, datos opcionales y la E).
- [Lotes, JSON y automatización](lotes-y-json.md)

## Referencia

- [Comandos y flags](comandos.md): todos los comandos, en una página ([referencia completa del CLI](cli-reference.md)).
- [Configuración](configuration.md): claves, ubicación del archivo y variables de entorno.
- [Entrada y salida](input-output.md): JSON de entrada, JSON de salida y formato de errores.
- [Reglas de validación](validation-rules.md): qué valida ARCLI y qué rechaza ARCA.
- [Glosario](glossary.md): CAE, WSAA, punto de venta y demás términos.
- [Limitaciones](limitations.md): qué no hace y por qué.
- [llms.txt](../llms.txt): referencia condensada para agentes de IA con acceso a terminal.

## Ayuda

- [Troubleshooting](troubleshooting.md): errores frecuentes, causa y solución.
- [CHANGELOG](../CHANGELOG.md): novedades de cada versión.

## Para contribuir

- [Guía de desarrollo](development.md): entorno local, scripts, tests, CI y releases.
- [Arquitectura](architecture.md): capas, flujo de una emisión y cómo extender el CLI.
- [Design system](design-system.md): paneles, colores, símbolos, formatos y textos de la terminal.
- [CONTRIBUTING](../CONTRIBUTING.md): flujo de trabajo y reglas del contrato público.
- [SECURITY](../SECURITY.md).
