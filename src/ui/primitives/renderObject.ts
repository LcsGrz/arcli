import { inspect } from 'node:util';

import { highlightJsonValues, renderJson } from './renderJson';
import { shouldUseColor } from './text';

export function renderObject(value: unknown): string {
  try {
    return highlightJsonValues(renderJson(value));
  } catch {
    return inspect(value, {
      breakLength: 88,
      colors: shouldUseColor(),
      compact: false,
      depth: null,
      numericSeparator: false,
      sorted: false,
    });
  }
}
