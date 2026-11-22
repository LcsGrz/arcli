import { describe, expect, it } from 'vitest';

import { commandParts, parseRich } from '../rich';

describe('parseRich', () => {
  it('separa la marca, las negritas, los links y el nombre de la IA', () => {
    expect(parseRich('Pegáselo a {ia}: ARCLI lo instala. Ver [la guía](ayuda/x/) y **esto**.')).toEqual([
      { kind: 'text', text: 'Pegáselo a ' },
      { kind: 'ai' },
      { kind: 'text', text: ': ' },
      { kind: 'brand' },
      { kind: 'text', text: ' lo instala. Ver ' },
      { href: 'ayuda/x/', kind: 'link', text: 'la guía' },
      { kind: 'text', text: ' y ' },
      { kind: 'strong', text: 'esto' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('adentro de una negrita, ARCLI no es la marca', () => {
    expect(parseRich('Uso **ARCLI**')).toEqual([
      { kind: 'text', text: 'Uso ' },
      { kind: 'strong', text: 'ARCLI' },
    ]);
  });

  it('sin formato es un solo texto', () => {
    expect(parseRich('arcli fc')).toEqual([{ kind: 'text', text: 'arcli fc' }]);
  });
});

describe('commandParts', () => {
  it('junta las flags seguidas y deja los espacios del lado del texto', () => {
    expect(commandParts('arcli ncc -m 5000 --cs --cfinal --ac fc')).toEqual([
      { flag: false, text: 'arcli ncc ' },
      { flag: true, text: '-m' },
      { flag: false, text: ' 5000 ' },
      { flag: true, text: '--cs --cfinal --ac' },
      { flag: false, text: ' fc' },
    ]);
  });

  it('un comando sin flags es un solo texto', () => {
    expect(commandParts('arcli ultimos fc')).toEqual([{ flag: false, text: 'arcli ultimos fc' }]);
  });
});
