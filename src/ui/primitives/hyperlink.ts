import { pathToFileURL } from 'node:url';

import { shortenPath } from '../../lib/paths/mask-path';

import { type OutputTarget, shouldUseColor } from './text';

const ESC = '\u001B';
const OSC8_CLOSE = `${ESC}]8;;${ESC}\\`;

/**
 * URLs de los links que armo arcli en esta ejecucion. El stream de la terminal saca cualquier secuencia OSC de los
 * textos de afuera (un texto de ARCA podria mostrar "arca.gob.ar" y llevar a otro lado); solo deja pasar estas.
 */
const trustedUrls = new Set<string>();

// Terminales que muestran OSC 8 como link. Las demas suelen ignorarlo, pero algunas viejas imprimen basura.
const HYPERLINK_TERMINALS = new Set(['ghostty', 'Hyper', 'iTerm.app', 'Tabby', 'vscode', 'WezTerm']);

/** `FORCE_HYPERLINK=0|1` decide; si no, una terminal conocida y con colores (TTY, sin `NO_COLOR`). */
export function supportsHyperlinks(target?: OutputTarget): boolean {
  const forced = process.env.FORCE_HYPERLINK;

  if (forced !== undefined && forced !== '') {
    return forced !== '0' && forced.toLowerCase() !== 'false';
  }

  if (!shouldUseColor(target)) {
    return false;
  }

  const { KITTY_WINDOW_ID, TERM_PROGRAM, VTE_VERSION, WT_SESSION } = process.env;

  return (
    Boolean(WT_SESSION || KITTY_WINDOW_ID) ||
    (TERM_PROGRAM !== undefined && HYPERLINK_TERMINALS.has(TERM_PROGRAM)) ||
    Number(VTE_VERSION) >= 5000
  );
}

/** El texto como link a `url` si la terminal los soporta; si no, el texto solo. */
export function hyperlink(text: string, url: string, target?: OutputTarget): string {
  if (!supportsHyperlinks(target)) {
    return text;
  }

  trustedUrls.add(url);

  return `${ESC}]8;;${url}${ESC}\\${text}${OSC8_CLOSE}`;
}

/** Link a un archivo o carpeta local: con un clic se abre en el editor o el explorador. */
export function fileHyperlink(text: string, path: string, target?: OutputTarget): string {
  return hyperlink(text, pathToFileURL(path).href, target);
}

/** Una ruta para mostrar (por defecto, desde la carpeta `arcli`) que se abre con un clic. */
export function pathLink(path: string, text = shortenPath(path), target?: OutputTarget): string {
  return fileHyperlink(text, path, target);
}

/** Lo usa el stream de la terminal: solo pasan los links que armo `hyperlink` y los cierres. */
export function isTrustedHyperlink(sequence: string): boolean {
  // eslint-disable-next-line no-control-regex
  const match = /^\u001B\]8;[^;]*;(.*?)(?:\u0007|\u001B\\)$/.exec(sequence);

  return match !== null && (match[1] === '' || trustedUrls.has(match[1]));
}
