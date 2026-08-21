[← Volver al README](README.md)

# Contribuir a ARCLI

Gracias por querer mejorar ARCLI.

## Setup rapido

```bash
git clone https://github.com/LcsGrz/arcli.git
cd arcli
yarn install
yarn dev --ayuda
```

## Tipos de contribuciones

- bugs
- mejoras de DX
- documentación
- features nuevas, pero conviene discutirlas antes de implementarlas

## Contrato del CLI

En ARCLI hay una parte del proyecto que no se trata como detalle interno:

- comandos
- flags
- contrato JSON

Eso es contrato público. Si querés cambiarlo, primero hay que discutirlo, actualizar help, tests y documentación, y recién después tocar implementación.

## Antes de abrir cambios

- usar Node `>=20`
- instalar dependencias con `yarn install`
- validar cambios con:

```bash
yarn typecheck
yarn test
```

## Flujo recomendado

1. crear una rama corta y descriptiva
2. hacer cambios pequenos y faciles de revisar
3. actualizar docs si cambia el contrato del CLI
4. agregar o ajustar tests cuando cambie el comportamiento

## Convenciones del proyecto

- TypeScript estricto
- componentes de UI de terminal reutilizables
- mensajes de error humanos
- `testing` como entorno seguro por defecto
- nada de secretos o certificados dentro del repo

## Cuando tocar docs

Actualiza `README.md` y `docs/ui-smoke-checklist.md` si cambian:

- comandos
- flags
- defaults
- contratos JSON
- salida visual importante

Y revisá también, según el cambio:

- `docs/cli-reference.md`
- `docs/input-output.md`
- `docs/usage-patterns.md`

## Checklist rapida para PR

- [ ] `yarn typecheck`
- [ ] `yarn test`
- [ ] `yarn build`
- [ ] `npm pack --dry-run`
- [ ] `README.md` actualizado si corresponde

## Dudas o ideas

Si no estás seguro de cómo encarar un cambio, o querés proponer algo grande, abrí un issue antes de implementarlo.

En ARCLI se valora bastante discutir primero cuando el cambio toca:

- contrato del CLI
- configuración pública
- contratos JSON
- flujos importantes de emisión
