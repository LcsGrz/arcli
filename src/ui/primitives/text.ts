import { UI_THEME, type UiColorToken } from '../theme/theme';

const BOLD = '\u001B[1m';
// Cierres puntuales (no un reset total) para no cortar un color ambiental en
// el que este texto quede anidado, por ejemplo un titulo dentro del borde
// coloreado que dibuja boxen.
const BOLD_OFF = '\u001B[22m';
const COLOR_OFF = '\u001B[39m';

export type OutputTarget = 'stderr' | 'stdout';
export type UiTextColor = UiColorToken | string;

export function shouldUseColor(target: OutputTarget = 'stdout'): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  const stream = target === 'stderr' ? process.stderr : process.stdout;

  return stream.isTTY !== false;
}

export function supportsColor(target: OutputTarget = 'stdout'): boolean {
  return shouldUseColor(target);
}

export function resolveTextColor(color: UiTextColor): string {
  return UI_THEME.colors[color as UiColorToken] ?? color;
}

// Envuelve cada linea por separado (en vez de todo el bloque de una vez) para
// que, si el contenido tiene varias lineas, el estilo no quede "abierto" en
// el salto de linea. Un panel que dibuja un borde entre cada linea de
// contenido insertaria ese borde dentro de un estilo todavia sin cerrar.
function wrapLines(value: string, open: string, close: string): string {
  return value
    .split('\n')
    .map((line) => `${open}${line}${close}`)
    .join('\n');
}

export function colorize(value: string, color: UiTextColor, target: OutputTarget = 'stdout'): string {
  if (!shouldUseColor(target)) {
    return value;
  }

  return wrapLines(value, resolveTextColor(color), COLOR_OFF);
}

export function bold(value: string, target: OutputTarget = 'stdout'): string {
  if (!shouldUseColor(target)) {
    return value;
  }

  return wrapLines(value, BOLD, BOLD_OFF);
}

export function badge(label: string, color: UiTextColor): string {
  return bold(colorize(`${UI_THEME.badgeBrackets[0]}${label}${UI_THEME.badgeBrackets[1]}`, color));
}

export function toneText(value: string, color: UiTextColor): string {
  return bold(colorize(value, color));
}

export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

export function flattenVisibleLines(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.split('\n'));
}

export function wrapPlainText(value: string, width: number): string[] {
  if (width <= 0) {
    return [value];
  }

  return value.split('\n').flatMap((line) => {
    if (line.length <= width) {
      return [line];
    }

    const words = line.split(/\s+/);
    const wrapped: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (stripAnsi(candidate).length <= width) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) {
        wrapped.push(currentLine);
      }

      if (stripAnsi(word).length <= width) {
        currentLine = word;
        continue;
      }

      let remaining = word;

      while (stripAnsi(remaining).length > width) {
        wrapped.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }

      currentLine = remaining;
    }

    if (currentLine) {
      wrapped.push(currentLine);
    }

    return wrapped.length > 0 ? wrapped : [''];
  });
}

export function wrapIndentedPlainText(value: string, width: number): string[] {
  if (width <= 0) {
    return [value];
  }

  return value.split('\n').flatMap((line) => {
    if (stripAnsi(line).length <= width) {
      return [line];
    }

    const indent = line.match(/^\s*/)?.[0] ?? '';
    const content = line.slice(indent.length).trimStart();
    const continuationIndent = indent;
    const availableWidth = Math.max(1, width - stripAnsi(continuationIndent).length);

    if (!content) {
      return [line];
    }

    const words = content.split(/\s+/);
    const wrapped: string[] = [];
    let currentLine = indent;

    for (const word of words) {
      const candidate = currentLine.trim().length > 0 ? `${currentLine} ${word}` : `${indent}${word}`;

      if (stripAnsi(candidate).length <= width) {
        currentLine = candidate;
        continue;
      }

      if (currentLine.trim().length > 0) {
        wrapped.push(currentLine);
      }

      if (stripAnsi(word).length <= availableWidth) {
        currentLine = `${continuationIndent}${word}`;
        continue;
      }

      let remaining = word;

      while (stripAnsi(remaining).length > availableWidth) {
        wrapped.push(`${continuationIndent}${remaining.slice(0, availableWidth)}`);
        remaining = remaining.slice(availableWidth);
      }

      currentLine = `${continuationIndent}${remaining}`;
    }

    if (currentLine.trim().length > 0) {
      wrapped.push(currentLine);
    }

    return wrapped.length > 0 ? wrapped : [line];
  });
}

export function maxVisibleWidth(lines: readonly string[]): number {
  return Math.max(...flattenVisibleLines(lines).map((line) => stripAnsi(line).length), 0);
}

export function centerText(value: string, width: number): string {
  const visibleWidth = stripAnsi(value).length;
  const leftPadding = Math.max(0, Math.floor((width - visibleWidth) / 2));

  return `${' '.repeat(leftPadding)}${value}`;
}

export function centerLines(lines: readonly string[], width: number): string[] {
  return flattenVisibleLines(lines).map((line) => centerText(line, width));
}

export function centerLineBlock(lines: readonly string[], width: number): string[] {
  const flattenedLines = flattenVisibleLines(lines);
  const blockWidth = maxVisibleWidth(flattenedLines);
  const leftPadding = Math.max(0, Math.floor((width - blockWidth) / 2));

  return flattenedLines.map((line) => `${' '.repeat(leftPadding)}${line}`);
}
