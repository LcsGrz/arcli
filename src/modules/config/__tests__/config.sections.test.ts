import { describe, expect, it } from 'vitest';

import { CONFIG_LABELS, CONFIG_SECTIONS } from '../config.sections';
import { configPublicKeySchema } from '../config-key-table';

describe('config.sections', () => {
  it('cada clave publica esta en una sola seccion', () => {
    const keys = CONFIG_SECTIONS.flatMap((section) => section.keys);

    expect([...keys].sort()).toEqual([...configPublicKeySchema.options].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cada clave tiene un nombre', () => {
    for (const key of configPublicKeySchema.options) {
      expect(CONFIG_LABELS[key]).toBeTruthy();
    }
  });
});
