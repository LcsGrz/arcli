import { describe, expect, it } from 'vitest';

import { detectPackageManager, formatUpdateCommand } from '../package-manager';

describe('detectPackageManager', () => {
  it.each([
    ['/usr/local/lib/node_modules/arcli/dist/cli/index.js', 'npm'],
    ['C:\\Users\\ana\\AppData\\Roaming\\npm\\node_modules\\arcli\\dist\\cli\\index.js', 'npm'],
    ['/Users/ana/Library/pnpm/global/5/.pnpm/arcli@2.3.0/node_modules/arcli/dist/cli/index.js', 'pnpm'],
    ['/home/ana/.local/share/pnpm/global/5/node_modules/arcli/dist/cli/index.js', 'pnpm'],
    [
      'C:\\Users\\ana\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\arcli@2.3.0\\node_modules\\arcli\\dist\\cli\\index.js',
      'pnpm',
    ],
    ['/Users/ana/.config/yarn/global/node_modules/arcli/dist/cli/index.js', 'yarn'],
    ['C:\\Users\\ana\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\arcli\\dist\\cli\\index.js', 'yarn'],
    ['/Users/ana/.bun/install/global/node_modules/arcli/dist/cli/index.js', 'bun'],
  ] as const)('%s → %s', (scriptPath, expected) => {
    expect(detectPackageManager({ scriptPath })).toBe(expected);
  });

  it('sin marca en la ruta, usa el user agent', () => {
    expect(detectPackageManager({ scriptPath: '/tmp/x/index.js', userAgent: 'pnpm/9.12.0 npm/? node/v22' })).toBe(
      'pnpm',
    );
    expect(detectPackageManager({ userAgent: 'bun/1.1.0 npm/? node/v22' })).toBe('bun');
    expect(detectPackageManager({ userAgent: 'yarn/1.22.22 npm/? node/v22' })).toBe('yarn');
  });

  it('un arcli global de npm corrido desde un script de yarn sigue siendo npm', () => {
    expect(
      detectPackageManager({
        scriptPath: '/Users/ana/.nvm/versions/node/v22.22.1/lib/node_modules/arcli/dist/cli/index.js',
        userAgent: 'yarn/1.22.22 npm/? node/v22',
      }),
    ).toBe('npm');
  });

  it('la ruta gana al user agent', () => {
    expect(
      detectPackageManager({
        scriptPath: '/Users/ana/.bun/install/global/node_modules/arcli/dist/cli/index.js',
        userAgent: 'npm/10.9.0 node/v22',
      }),
    ).toBe('bun');
  });

  it('sin señales, npm', () => {
    expect(detectPackageManager({})).toBe('npm');
    expect(detectPackageManager({ userAgent: 'deno/2.0' })).toBe('npm');
  });
});

describe('formatUpdateCommand', () => {
  it.each([
    ['npm', 'npm install -g arcli@latest'],
    ['pnpm', 'pnpm add -g arcli@latest'],
    ['yarn', 'yarn global add arcli@latest'],
    ['bun', 'bun add -g arcli@latest'],
  ] as const)('%s', (packageManager, command) => {
    expect(formatUpdateCommand(packageManager)).toBe(command);
  });
});
