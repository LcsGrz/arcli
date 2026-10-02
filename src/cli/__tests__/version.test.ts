import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../version';

describe('CLI_VERSION', () => {
  it('coincide con la version de package.json', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };

    expect(CLI_VERSION).toBe(packageJson.version);
  });
});
