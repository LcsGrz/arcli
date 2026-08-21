import { colorize, type OutputTarget } from './text';

export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function highlightJsonValues(content: string, target: OutputTarget = 'stdout'): string {
  return content.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (token) => {
      if (token.startsWith('"') && token.endsWith(':')) {
        return token;
      }

      if (token.startsWith('"')) {
        return colorize(token, 'success', target);
      }

      if (token === 'true' || token === 'false' || token === 'null') {
        return colorize(token, 'warning', target);
      }

      return colorize(token, 'warning', target);
    },
  );
}
