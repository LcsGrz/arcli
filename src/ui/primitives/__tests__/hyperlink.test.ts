import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { fileHyperlink, hyperlink, supportsHyperlinks } from '../hyperlink';
import { stripAnsi } from '../text';

const ENV_KEYS = ['FORCE_HYPERLINK', 'NO_COLOR', 'TERM_PROGRAM', 'WT_SESSION', 'KITTY_WINDOW_ID', 'VTE_VERSION'];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe('hyperlink', () => {
  it('is plain text when the terminal does not support links', () => {
    process.env.FORCE_HYPERLINK = '0';

    expect(supportsHyperlinks()).toBe(false);
    expect(hyperlink('guía', 'https://example.com')).toBe('guía');
  });

  it('is an OSC 8 link that takes no columns', () => {
    process.env.FORCE_HYPERLINK = '1';

    const link = hyperlink('guía', 'https://example.com');

    expect(link).toBe('\u001B]8;;https://example.com\u001B\\guía\u001B]8;;\u001B\\');
    expect(stripAnsi(`[${link}]`)).toBe('[guía]');
  });

  it('links local files with a file URL', () => {
    process.env.FORCE_HYPERLINK = '1';

    expect(fileHyperlink('cert', '/tmp/arcli/cert.crt')).toContain(pathToFileURL('/tmp/arcli/cert.crt').href);
  });

  it('only turns on by itself in known terminals with color', () => {
    delete process.env.FORCE_HYPERLINK;
    process.env.NO_COLOR = '1';
    process.env.TERM_PROGRAM = 'vscode';

    expect(supportsHyperlinks()).toBe(false);
  });
});
