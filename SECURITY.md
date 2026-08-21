[← Volver al README](README.md)

# Seguridad

Si encontraste un problema de seguridad, por ahora no lo publiques en un issue abierto.

## Que no subir nunca

- certificados `.crt`
- claves `.key`
- tokens WSAA
- configuraciones con rutas o datos sensibles de produccion

## Reporte responsable

Mientras el proyecto no tenga un canal dedicado, la recomendacion es reportar el problema por un canal privado antes de abrir un issue publico.

## Alcance inicial

Las prioridades de seguridad actuales son:

- no exponer secretos en el repo
- no imprimir rutas o datos sensibles innecesarios
- mantener `testing` como default seguro
- requerir confirmaciones para emisiones reales en produccion

## Superficie de riesgo

Estos son los puntos más sensibles hoy:

- certificados y claves privadas usadas para autenticación
- tickets WSAA y cualquier dato derivado de autenticación
- emisión real de comprobantes en ARCA

En la práctica, eso significa:

- no guardar secretos dentro del repo
- no exponer rutas o materiales sensibles en logs o capturas
- evitar pruebas en `produccion` salvo que sea realmente necesario
- revisar con cuidado cualquier cambio que toque autenticación o emisión

## Buenas prácticas

- usar `testing` siempre que sea posible
- evitar compartir outputs que puedan incluir rutas, respuestas crudas o datos sensibles
- revisar dos veces el comando antes de emitir en `produccion`
