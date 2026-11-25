/**
 * La carpeta de datos siempre explícita (docs/architecture.md): solo `src/cli/data-directory.ts` conoce la de siempre y
 * lee ARCLI_CONFIG_DIR, la config de producción se abre en `src/cli/config-service.ts` y `conf` nunca elige la carpeta.
 * Es una regla propia y no un selector de `no-restricted-syntax` porque esa está en warn en algunos módulos, y acá no
 * hay excepciones. Sigue el nombre de los imports; un alias local o un createRequire no los ve.
 */
const VARIABLE = 'ARCLI_CONFIG_DIR';
const DIRECTORY_PACKAGES = ['conf', 'env-paths'];
const REEXPORTED_SOURCE = /^(conf|env-paths)$|(^|\/)config\.service(\.js)?$/;

const messages = {
  conf: '`new Conf` lleva `cwd` escrito al final de sus opciones y nunca `projectName`: si no, `conf` elige la carpeta real de quien lo corre.',
  confExtends: 'No heredes de `Conf`: quien la abra podría no decir la carpeta.',
  confImport: 'Importá `conf` con `import Conf from`: así se controla que lleve `cwd`.',
  configService: 'La config se abre con openConfigService o withConfigService, de src/cli/config-service.ts.',
  envPaths: 'La carpeta de siempre la conoce solo src/cli/data-directory.ts: recibila como parámetro.',
  reexport: 'No reexportes `conf`, `env-paths` ni `ConfigService`: se escaparían de este control.',
  variable: 'ARCLI_CONFIG_DIR la lee solo src/cli/data-directory.ts: recibí la carpeta como parámetro.',
};

const keyOf = ({ key, type }) => (type === 'Property' ? (key.name ?? key.value) : undefined);

/** `cwd` escrito y sin un spread después, que lo podría pisar; y sin `projectName`, con lo que `conf` elige la carpeta. */
function saysDirectory(options) {
  const properties = options?.type === 'ObjectExpression' ? options.properties : [];
  const cwd = properties.findIndex((property) => keyOf(property) === 'cwd');

  return (
    cwd >= 0 &&
    !properties.some((property) => keyOf(property) === 'projectName') &&
    !properties.slice(cwd).some(({ type }) => type === 'SpreadElement')
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
      if (confNames.has(callee?.name) && node.type !== 'NewExpression') report(node, 'confExtends');
      if (!opensConfig && serviceNames.has(callee?.name ?? callee?.property?.name)) report(node, 'configService');
    };

    return {
      ClassDeclaration: (node) => checkClass(node, node.superClass),
      ClassExpression: (node) => checkClass(node, node.superClass),
      ExportAllDeclaration(node) {
        if (node.exportKind !== 'type' && REEXPORTED_SOURCE.test(node.source.value)) report(node, 'reexport');
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === 'type') return;

        const values = node.specifiers.filter(({ exportKind }) => exportKind !== 'type');

        if (
          (DIRECTORY_PACKAGES.includes(node.source.value) && values.length > 0) ||
          values.some(({ local }) => local.name === 'ConfigService')
        ) {
          report(node, 'reexport');
        }
      },
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

        if (confNames.has(node.callee.name) && !saysDirectory(node.arguments[0])) report(node, 'conf');
      },
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
