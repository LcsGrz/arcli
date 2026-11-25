/**
 * La carpeta de datos siempre explícita (docs/architecture.md): solo `src/cli/data-directory.ts` conoce la de siempre y
 * lee ARCLI_CONFIG_DIR, la config de producción se abre en `src/cli/config-service.ts` y `conf` nunca elige la carpeta.
 * Es una regla propia y no un selector de `no-restricted-syntax` porque esa está en warn en algunos módulos, y acá no
 * hay excepciones. Sigue los alias de los imports.
 */
const VARIABLE = 'ARCLI_CONFIG_DIR';

const messages = {
  conf: '`new Conf` lleva `cwd` escrito en sus opciones: sin él, `conf` usa la carpeta real de quien lo corre.',
  confImport: 'Importá `conf` con `import Conf from`: así se controla que lleve `cwd`.',
  configService: 'La config se abre con openConfigService o withConfigService, de src/cli/config-service.ts.',
  envPaths: 'La carpeta de siempre la conoce solo src/cli/data-directory.ts: recibila como parámetro.',
  variable: 'ARCLI_CONFIG_DIR la lee solo src/cli/data-directory.ts: recibí la carpeta como parámetro.',
};

function hasExplicitCwd(options) {
  return (
    options?.type === 'ObjectExpression' &&
    options.properties.some(
      ({ computed, key, type, value }) =>
        type === 'Property' &&
        !computed &&
        (key.name ?? key.value) === 'cwd' &&
        !(value.type === 'Identifier' && value.name === 'undefined'),
    )
  );
}

export const dataDirectoryRule = {
  create(context) {
    const { opensConfig = false, resolvesDirectory = false } = context.options[0] ?? {};
    const confNames = new Set();
    const serviceNames = new Set(['ConfigService']);
    const report = (node, messageId) => context.report({ messageId, node });
    const checkVariable = (node, text) => {
      if (!resolvesDirectory && text === VARIABLE) report(node, 'variable');
    };
    const checkClass = (node, callee) => {
      if (!opensConfig && serviceNames.has(callee?.name ?? callee?.property?.name)) report(node, 'configService');
    };

    return {
      ClassDeclaration: (node) => checkClass(node, node.superClass),
      ClassExpression: (node) => checkClass(node, node.superClass),
      Identifier: (node) => checkVariable(node, node.name),
      ImportDeclaration(node) {
        const source = node.source.value;

        if (source === 'env-paths' && !resolvesDirectory) report(node, 'envPaths');

        for (const { imported, importKind, local, type } of node.specifiers) {
          if (source === 'conf' && node.importKind !== 'type' && importKind !== 'type') {
            if (type === 'ImportDefaultSpecifier') confNames.add(local.name);
            else report(node, 'confImport');
          }

          if (imported?.name === 'ConfigService') serviceNames.add(local.name);
        }
      },
      ImportExpression(node) {
        if (node.source.value === 'conf') report(node, 'confImport');
        if (node.source.value === 'env-paths' && !resolvesDirectory) report(node, 'envPaths');
      },
      Literal: (node) => checkVariable(node, node.value),
      NewExpression(node) {
        checkClass(node, node.callee);

        if (confNames.has(node.callee.name) && !hasExplicitCwd(node.arguments[0])) report(node, 'conf');
      },
      TemplateElement: (node) => checkVariable(node, node.value.cooked),
    };
  },
  meta: {
    messages,
    schema: [
      {
        additionalProperties: false,
        properties: { opensConfig: { type: 'boolean' }, resolvesDirectory: { type: 'boolean' } },
        type: 'object',
      },
    ],
    type: 'problem',
  },
};
