import { afterEach, describe, expect, it } from 'vitest';

import { stripAnsi } from '../../primitives/text';
import { statusBar } from '../statusBar';

describe('statusBar', () => {
  const original = process.stdout.columns;

  afterEach(() => {
    process.stdout.columns = original;
  });

  const render = (columns: number): string[] => {
    process.stdout.columns = columns;

    return stripAnsi(
      statusBar([{ text: '20-33333333-4' }, { text: 'PV 3' }], [{ text: 'ARCA FUNCIONANDO' }, { text: 'TESTING' }]),
    ).split('\n');
  };

  it('is one line when both sides fit', () => {
    const lines = render(92);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(92);
  });

  it('uses one line per side in a narrow terminal, without hiding the environment', () => {
    const lines = render(40);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
    expect(lines[1]).toContain('TESTING');
  });
});
