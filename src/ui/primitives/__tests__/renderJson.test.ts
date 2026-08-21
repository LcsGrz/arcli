import { describe, expect, it } from 'vitest';

import { highlightJsonValues, renderJson } from '../renderJson';

describe('renderJson', () => {
  it('serializes objects as pretty JSON', () => {
    const output = renderJson({ cae: '123', ok: true });

    expect(output).toContain('"cae": "123"');
    expect(output).toContain('"ok": true');
  });

  it('keeps keys untouched when highlighting JSON values', () => {
    const output = highlightJsonValues('{"cae":"123","ok":true}');

    expect(output).toContain('"cae":');
    expect(output).toContain('"123"');
    expect(output).toContain('true');
  });
});
