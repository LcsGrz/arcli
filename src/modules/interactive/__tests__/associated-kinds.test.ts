import { describe, expect, it } from 'vitest';

import { associatedKindGroups, groupNewOptions } from '../associated-kinds';

const shortcuts = (kind: 'credito' | 'debito') =>
  Object.fromEntries(
    associatedKindGroups(kind).map((group) => [group.family, group.options.map((option) => option.value.shortcut)]),
  );

describe('associatedKindGroups', () => {
  it('agrupa lo que ajusta una NC por familia, de C a A', () => {
    expect(shortcuts('credito')).toEqual({
      exportacion: ['fe', 'nce', 'nde'],
      factura: ['fc', 'fb', 'fa'],
      fce: ['fcec', 'ndec', 'fceb', 'ndeb', 'fcea', 'ndea'],
      nota: ['ncc', 'ndc', 'ncb', 'ndb', 'nca', 'nda'],
      recibo: ['rc'],
    });
  });

  it('en una ND, la FCE ofrece solo la NC FCE', () => {
    expect(shortcuts('debito').fce).toEqual(['fcec', 'ncec', 'fceb', 'nceb', 'fcea', 'ncea']);
  });

  it('cada familia junta las opciones nuevas que tiene adentro, sin repetir', () => {
    const groups = Object.fromEntries(associatedKindGroups('credito').map((group) => [group.family, group]));

    expect(groupNewOptions(groups.factura!)).toEqual([]);
    expect(groupNewOptions(groups.exportacion!)).toEqual(['notas-e', 'notas-sobre-notas']);
  });
});
