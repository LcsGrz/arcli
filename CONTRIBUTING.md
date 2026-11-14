[← Volver al README](README.md)

# Contribuir a arcli

Gracias por querer mejorar arcli. Se aceptan bugs, mejoras de uso, documentación y features nuevas. Si ya tenés el cambio hecho, abrí el PR directo y contá en la descripción qué problema resuelve. Si todavía no empezaste algo grande o que cambia el contrato (ver abajo), conviene abrir antes un issue, así no trabajás en algo que después no entra. Si tenés una pregunta, usá [Discussions](https://github.com/LcsGrz/arcli/discussions).

Participar en el proyecto implica respetar el [código de conducta](CODE_OF_CONDUCT.md).

## Empezar

Requiere Node.js 22.22.1 o superior y Yarn. El setup, los scripts y los tests están en la [guía de desarrollo](docs/development.md); el mapa del código, en [Arquitectura](docs/architecture.md).

```bash
git clone https://github.com/LcsGrz/arcli.git
cd arcli
yarn install
yarn dev --ayuda
```

## Contrato del CLI

Los comandos, los flags, las claves de configuración y los formatos JSON son contrato público. No se cambian en silencio: el cambio se discute (en un issue o en el mismo PR) y se actualizan implementación, ayuda, tests y documentación. Si tocás alguno, avisalo en la descripción del PR. Un cambio que rompe compatibilidad puede tener que esperar a una versión mayor.

El alcance de comprobantes es Factura, Nota de Crédito y Nota de Débito A, B y C, sus versiones de Factura de Crédito Electrónica, la Factura de exportación E con sus notas de crédito y débito, y Recibo C. Otros comprobantes quedan fuera salvo decisión explícita.

## Flujo

1. Creá una rama corta y descriptiva desde `dev`, la rama donde se trabaja. `main` es lo publicado en npm y solo recibe releases.
2. Hacé cambios chicos y fáciles de revisar.
3. Agregá o ajustá tests cuando cambie el comportamiento.
4. Actualizá la documentación que corresponda (ver abajo).
5. Abrí el PR contra `dev`: GitHub propone `main` porque es la rama default, así que cambiá la base. La plantilla trae el checklist.

## Convenciones

- TypeScript estricto; la lógica de negocio va en `src/modules/`, no en `src/cli/`.
- Mensajes de error claros y en español.
- `testing` es el entorno por defecto.
- Nada de secretos: no subas certificados, claves, tokens ni configuraciones reales. Ver [SECURITY](SECURITY.md).

## Documentación

Actualizá la documentación que describe lo que cambiaste:

| Si cambia                               | Revisá                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Comandos o flags                        | `README.md`, [referencia del CLI](docs/cli-reference.md), `llms.txt`                  |
| Claves de config o variables de entorno | [configuración](docs/configuration.md)                                                |
| JSON de entrada o salida, errores       | [entrada y salida](docs/input-output.md)                                              |
| Validaciones                            | [reglas de validación](docs/validation-rules.md)                                      |
| Flujos de uso o mensajes de error       | las páginas de [comprobantes](docs/README.md#comprobantes), [troubleshooting](docs/troubleshooting.md) |
| Modo interactivo                        | [modo interactivo](docs/modo-interactivo.md)                                          |
| Salida en terminal (paneles, textos)    | [design system](docs/design-system.md)                                                |
| Módulos, capas o gateways               | [arquitectura](docs/architecture.md)                                                  |
| Servicios de ARCA que hay que autorizar | [certificado de testing](docs/certificado-testing.md#qué-servicios-autorizar)                           |

Un cambio suele caer en varias filas: un comando nuevo con `--json` es también JSON de salida y, si suma errores, mensajes de error.

Los cambios van siempre en `docs/`, nunca en `site/`: el sitio de documentación se genera desde ahí.

Si el cambio le afecta a quien usa el CLI, sumá una entrada en "Sin publicar" de [CHANGELOG.md](CHANGELOG.md).

Un test (`docs-sync.test.ts`) falla si un comando, flag o clave de config falta en sus docs o en `llms.txt`. Con Claude Code, la skill `sincronizar-docs` recorre esta tabla por vos.

## Checklist del PR

- [ ] `yarn typecheck`
- [ ] `yarn lint`
- [ ] `yarn test`
- [ ] `yarn build` y `yarn pack:check` (`yarn open-source:check` corre typecheck, tests con cobertura, build y `pack:check`)
- [ ] Documentación y `CHANGELOG.md` al día
