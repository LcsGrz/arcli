/** Saca el `#` (va al frontmatter) y la linea de "Volver al README", que en el sitio sobra. */
export function extractBody(page, raw) {
  const text = raw.replace(/\r\n/g, '\n').replace(/^\[←[^\n]*\n+/m, '');
  const heading = text.match(/^# (.+)\n+/m);

  if (!heading) {
    throw new Error(`${page.src}: falta el título (# ...).`);
  }

  return { body: text.replace(heading[0], '').trim(), title: page.title ?? heading[1].trim() };
}
