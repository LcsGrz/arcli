# Documentación de arcli

[← README](../README.md)

También en el [sitio de documentación](https://lcsgrz.github.io/arcli/), con buscador.

## Empezar

1. [Instalación y primeros pasos](../README.md#instalación): instalar y configurar.
2. [Certificado de testing](certificado-testing.md): para probar sin validez fiscal.
3. [Certificado de producción](certificado-produccion.md): para facturar de verdad, con el punto de venta para web service.
4. [Cambiar de entorno](entornos.md): testing y producción, y el checklist antes de la primera factura real.
5. [Modo interactivo](modo-interactivo.md): el asistente que se abre con `arcli`, sin recordar flags.
6. [Modelo mental](mental-model.md): cómo fluye un comando, de la entrada a ARCA.

## Comprobantes

- [Monotributo: Factura C, notas y Recibo C](comprobantes-monotributo.md)
- [Responsable inscripto: Facturas A y B](comprobantes-responsable-inscripto.md)
- [Notas de crédito y débito](notas-credito-debito.md)
- [Factura de Crédito Electrónica (FCE)](fce.md)
- [Exportación: Factura E y sus notas](exportacion.md)

## Más

- [Consultas sin emitir](consultas.md): últimos comprobantes, estado de ARCA, tablas, padrón.
- [PDF de comprobantes](pdf.md): plugin, datos del emisor, carpeta y nombre de los archivos.
- [Lotes, JSON y automatización](lotes-y-json.md)
- [Automatizar con IA](automatizar-con-ia.md): `llms.txt`, reglas para agentes y códigos de salida.

## Referencia

- [Referencia del CLI](cli-reference.md): comandos y flags.
- [Configuración](configuration.md): claves, ubicación del archivo y variables de entorno.
- [Entrada y salida](input-output.md): JSON de entrada, JSON de salida y formato de errores.
- [Reglas de validación](validation-rules.md): qué valida arcli y qué rechaza ARCA.
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
