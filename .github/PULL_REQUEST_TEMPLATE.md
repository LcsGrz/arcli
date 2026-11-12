<!-- El PR va contra `dev`, no contra `main` (la que GitHub propone por default): `main` solo recibe releases y hotfixes. -->

## Qué cambia

<!-- Qué cambia para quien usa el CLI. Si es interno (refactor, tests, CI), decilo. -->

## Por qué

<!-- El problema que resuelve. Si hay un issue, alcanza con "Cierra #123"; si no, contalo acá. -->

## Contrato público

<!-- Comandos, flags, claves de config y el JSON de `--json` no cambian en silencio. -->

- [ ] No cambia comandos, flags, claves de config ni el `--json`
- [ ] Cambia el contrato y está avisado en `CHANGELOG.md` (si rompe compatibilidad, explicá por qué hace falta)

## Checklist

- [ ] Tests nuevos o ajustados si cambia el comportamiento
- [ ] Documentación al día según la [tabla de CONTRIBUTING](https://github.com/LcsGrz/arcli/blob/main/CONTRIBUTING.md#documentación)
- [ ] Entrada en "Sin publicar" de `CHANGELOG.md` si le afecta a quien usa el CLI
- [ ] `yarn typecheck`, `yarn lint` y `yarn test` pasan
- [ ] Sin certificados, claves, tickets, CUITs reales ni respuestas de `--bruto` en el código, los tests o las capturas
