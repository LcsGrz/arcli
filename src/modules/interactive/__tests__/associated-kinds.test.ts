import { describe, expect, it } from 'vitest';

import { associatedKindGroups, groupNewOptions } from '../associated-kinds';

const shortcuts = (kind: 'credito' | 'debito') =>
  Object.fromEntries(
    associatedKindGroups(kind).map((group) => [group.family, group.options.map((option) => option.value.shortcut)]),
  );

describe('associatedKindGroups', () => {
  it('agrupa lo que ajusta una NC por tipo de documento: C, B, A, despues FCE y al final E', () => {
    expect(shortcuts('credito')).toEqual({
      factura: ['fc', 'fb', 'fa', 'fcec', 'fceb', 'fcea', 'fe'],
      'nota-credito': ['ncc', 'ncb', 'nca', 'nce'],
      'nota-debito': ['ndc', 'ndb', 'nda', 'ndec', 'ndeb', 'ndea', 'nde'],
      recibo: ['rc'],
    });
  });

  it('en una ND, la FCE suma la NC FCE y no la ND FCE', () => {
    const groups = shortcuts('debito');

    expect(groups['nota-credito']).toEqual(['ncc', 'ncb', 'nca', 'ncec', 'nceb', 'ncea', 'nce']);
    expect(groups['nota-debito']).toEqual(['ndc', 'ndb', 'nda', 'nde']);
  });

  it('cada familia junta las opciones nuevas que tiene adentro, sin repetir', () => {
    const groups = Object.fromEntries(associatedKindGroups('credito').map((group) => [group.family, group]));

    expect(groupNewOptions(groups.factura!)).toEqual(['notas-e']);
    expect(groupNewOptions(groups['nota-debito']!)).toEqual(['notas-sobre-notas']);
  });
});
