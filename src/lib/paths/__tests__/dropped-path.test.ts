import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeDroppedPath } from '../dropped-path';

describe('normalizeDroppedPath', () => {
  it.each([
    ['/Users/ana/Mis\\ archivos/arcli.crt ', '/Users/ana/Mis archivos/arcli.crt'],
    ["'/Users/ana/Mis archivos/arcli.crt'", '/Users/ana/Mis archivos/arcli.crt'],
    ['"/Users/ana/arcli.crt"', '/Users/ana/arcli.crt'],
    ['  /tmp/arcli.crt  ', '/tmp/arcli.crt'],
  ])('cleans %s', (input, expected) => {
    expect(normalizeDroppedPath(input, 'darwin')).toBe(expected);
  });

  it('expands ~', () => {
    expect(normalizeDroppedPath('~/Descargas/arcli.crt', 'darwin')).toBe(join(homedir(), 'Descargas/arcli.crt'));
  });

  it('keeps backslashes as separators on Windows', () => {
    expect(normalizeDroppedPath('C:\\Users\\ana\\arcli.crt', 'win32')).toBe('C:\\Users\\ana\\arcli.crt');
  });
});
