import { ESLint, Linter } from 'eslint';
import eslintTS from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { dataDirectoryRule } from '../data-directory-rule.mjs';

function messageIds(code, options = {}) {
  return new Linter()
    .verify(code, {
      languageOptions: { parser: eslintTS.parser },
      plugins: { arcli: { rules: { 'data-directory': dataDirectoryRule } } },
      rules: { 'arcli/data-directory': ['error', options] },
    })
    .map(({ messageId }) => messageId);
}

describe('la regla arcli/data-directory', () => {
  it.each([
    ['new ConfigService({ cwd })', 'configService'],
    ['import { ConfigService as C } from "./config.service"; new C({ cwd })', 'configService'],
    ['import * as m from "./config.service"; new m.ConfigService({ cwd })', 'configService'],
    ['class Otro extends ConfigService {}', 'configService'],
    ['import Conf from "conf"; new Conf()', 'conf'],
    ['import Conf from "conf"; new Conf({ configName: "x" })', 'conf'],
    ['import Conf from "conf"; new Conf({ ...options })', 'conf'],
    ['import Otro from "conf"; new Otro({ projectName: "arcli" })', 'conf'],
    ['import Conf from "conf"; new Conf({ cwd, projectName: "arcli" })', 'conf'],
    ['import Conf from "conf"; new Conf({ cwd, ...options })', 'conf'],
    ['import Conf from "conf"; new Conf({ ...options, cwd })', 'conf'],
    ['import Conf from "conf"; new Conf({ cwd, [clave]: "arcli" })', 'conf'],
    ['import Conf from "conf"; new Conf({ cwd: undefined })', 'conf'],
    ['import Conf from "conf"; export { Conf }', 'reexport'],
    ['import Conf from "conf"; export default Conf', 'reexport'],
    ['import envPaths from "env-paths"; export { envPaths as carpetas }', 'reexport'],
    ['import envPaths from "env-paths"; export default envPaths', 'reexport'],
    ['import { ConfigService as C } from "./config.service"; export { C }', 'reexport'],
    ['import { ConfigService } from "./config.service"; export default ConfigService', 'reexport'],
    ['process.env[`ARCLI_CONFIG_DIR`]', 'variable'],
    ['import Conf from "conf"; class Otro extends Conf {}', 'confExtends'],
    ['import Conf from "conf"; const Otro = class extends Conf {}', 'confExtends'],
    ['export { default } from "conf"', 'reexport'],
    ['export { default as envPaths } from "env-paths"', 'reexport'],
    ['export { ConfigService as C } from "./config.service"', 'reexport'],
    ['export * from "conf"', 'reexport'],
    ['export * from "./modules/config/config.service"', 'reexport'],
    ['import { default as Conf } from "conf"', 'confImport'],
    ['await import("conf")', 'confImport'],
    ['import envPaths from "env-paths"', 'envPaths'],
    ['await import("env-paths")', 'envPaths'],
    ['process.env.ARCLI_CONFIG_DIR', 'variable'],
    ['process.env["ARCLI_CONFIG_DIR"]', 'variable'],
    ['const { ARCLI_CONFIG_DIR: carpeta } = process.env', 'variable'],
  ])('rechaza %s', (code, messageId) => {
    expect(messageIds(code)).toContain(messageId);
  });

  it.each([
    'import Conf from "conf"; new Conf({ cwd })',
    'import Conf from "conf"; new Conf({ configName: "x", cwd: options.cwd })',
    'import Conf from "conf"; export const store = new Conf({ cwd })',
    'export class ConfigService {}',
    'export type { Options } from "conf"',
    'export { type ConfigService } from "./config.service"',
    'export { deprecatedConfigKeyWarning } from "./config.service"',
    'import type { Options } from "conf"; let x: Options',
    'import type { ConfigService } from "./config.service"; let x: ConfigService',
    'new OtroServicio()',
  ])('acepta %s', (code) => {
    expect(messageIds(code)).toEqual([]);
  });

  it('cada excepción habilita solo lo suyo', () => {
    expect(messageIds('new ConfigService({ cwd })', { opensConfig: true })).toEqual([]);
    expect(messageIds('process.env.ARCLI_CONFIG_DIR', { opensConfig: true })).toEqual(['variable']);
    expect(messageIds('import e from "env-paths"; process.env.ARCLI_CONFIG_DIR', { resolvesDirectory: true })).toEqual(
      [],
    );
    expect(messageIds('new ConfigService({ cwd })', { resolvesDirectory: true })).toEqual(['configService']);
  });
});

describe('dónde aplica', () => {
  const eslint = new ESLint();
  const ruleFor = async (file) => (await eslint.calculateConfigForFile(file)).rules['arcli/data-directory'];

  it.each([
    'src/modules/config/config.service.ts',
    'src/services/files/conf-config-store.ts',
    'src/services/files/monotributo-file-store.ts',
    'src/modules/update-check/update-check.service.ts',
    'src/services/pdf/pdf-plugin.ts',
    'src/lib/links.ts',
    'src/ui/index.ts',
    'src/cli/index.ts',
    'scripts/demo/pdf-sample.mts',
    'scripts/monotributo/actualizar-tabla.ts',
  ])('en error y sin excepciones en %s', async (file) => {
    expect(await ruleFor(file)).toEqual([2]);
  });

  it('con una excepción en cada archivo que le toca, y no en los tests', async () => {
    expect(await ruleFor('src/cli/config-service.ts')).toEqual([2, { opensConfig: true }]);
    expect(await ruleFor('src/cli/data-directory.ts')).toEqual([2, { resolvesDirectory: true }]);
    expect(await ruleFor('src/cli/__tests__/data-directory.test.ts')).toBeUndefined();
  });
});
