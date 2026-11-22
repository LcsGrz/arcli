import { describe, expect, it } from 'vitest';

import { arcliConfigSchema } from '../config.schemas';

const OFF = { brutoPorDefecto: false, emitirPorDefecto: false, jsonPorDefecto: false };

// Sin config, nada se emite solo, la salida es la humana y no muestra las respuestas crudas de ARCA (TEST-21).
describe('arcliConfigSchema: defaults de output', () => {
  it('sin `output` los tres quedan en false', () => {
    expect(arcliConfigSchema.parse({}).output).toEqual(OFF);
  });

  it('con `output` vacío los tres quedan en false', () => {
    expect(arcliConfigSchema.parse({ output: {} }).output).toEqual(OFF);
  });

  it('respeta los que vienen definidos y completa los demás en false', () => {
    expect(arcliConfigSchema.parse({ output: { jsonPorDefecto: true } }).output).toEqual({
      ...OFF,
      jsonPorDefecto: true,
    });
  });
});
