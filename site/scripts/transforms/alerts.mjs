/** Avisos de GitHub (`> [!TIP]`) a los de Starlight (`:::tip`): en GitHub se ven bien y en el sitio, con color. */
const ALERT_KINDS = { CAUTION: 'danger', IMPORTANT: 'note', NOTE: 'note', TIP: 'tip', WARNING: 'caution' };

/** Convierte cada bloque `> [!TIPO]` en `:::tipo ... :::`, fuera de los bloques de codigo. */
export function githubAlertsToAsides(text) {
  const lines = text.split('\n');
  const out = [];
  let inCode = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.startsWith('```')) inCode = !inCode;

    const alert = !inCode && line.match(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);

    if (!alert) {
      out.push(line);
      continue;
    }

    const body = [];

    while (index + 1 < lines.length && lines[index + 1].startsWith('>')) {
      body.push(lines[++index].replace(/^> ?/, ''));
    }

    // "**La forma más fácil:** texto" pasa a ser el titulo del aviso, como en la maqueta.
    const titled = body[0]?.match(/^\*\*([^*]+?)[:.]?\*\*[:.]?\s+(.*)$/);

    if (titled) {
      out.push(`:::${ALERT_KINDS[alert[1]]}[${titled[1]}]`);
      body[0] = titled[2].charAt(0).toUpperCase() + titled[2].slice(1);
    } else {
      out.push(`:::${ALERT_KINDS[alert[1]]}`);
    }

    out.push(...body);

    out.push(':::');
  }

  return out.join('\n');
}
