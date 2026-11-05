[← Volver al README](README.md)

# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usá el [reporte privado de GitHub](https://github.com/LcsGrz/arcli/security/advisories/new) (pestaña **Security** → **Report a vulnerability**) y esperá confirmación antes de publicar detalles.

## Qué no subir nunca

Ni a issues, ni a PRs, ni a capturas:

- certificados `.crt` y claves `.key`
- tickets WSAA
- archivos de configuración con rutas o datos de producción
- respuestas crudas de ARCA (`--bruto`) sin revisar

## Qué es sensible en ARCLI

- Certificados y claves privadas: si los configurás a mano, ARCLI guarda solo las rutas, no el contenido. `arcli certificado generar` e `importar` sí guardan la clave privada y el certificado en `certificados/<CUIT>/`, junto a la configuración.
- Tickets WSAA: se guardan en disco junto a la configuración (ver [`ticketPath`](docs/configuration.md#ticket-wsaa-ticketpath)).
- Los archivos que crea ARCLI (tickets de ARCA, claves y certificados de `arcli certificado`, config, PDFs) quedan solo para tu usuario (`0600`/`0700`) en macOS y Linux. En Windows ARCLI no cambia los permisos: los archivos heredan los de la carpeta de tu usuario. Un ticket permite operar en ARCA como tu CUIT durante unas horas.
- La emisión real: con la config por defecto, `testing` es el entorno y nada se emite sin `--emitir` o sin confirmar la pregunta en la terminal. Si guardás `entorno produccion` y `emitir true`, ARCLI emite en producción sin flags ni confirmación (ver [Configuración](docs/configuration.md#advertencias)).

Buenas prácticas: usá `testing` siempre que puedas y revisá el comando antes de emitir en producción.
