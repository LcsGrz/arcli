import { escapeHtml, headingSlug, inlineHtml } from '../lib/markdown.mjs';

/**
 * La severidad es `nivel` o `nivel, aclaración`: el nivel (crítico, frecuente, a veces u ocasional) va en el chip y la
 * aclaración debajo del título.
 */
const SEVERITY_KINDS = { 'a veces': 'media', crítico: 'alta', frecuente: 'frecuente', ocasional: 'baja' };

function severityParts(text, name) {
  const [, raw, note] = text.match(/^([^,]+)(?:,\s*(.+))?$/);
  const level = raw.trim();

  if (!SEVERITY_KINDS[level]) {
    throw new Error(
      `Problemas frecuentes, "${name}": la severidad "${level}" no es crítico, frecuente, a veces ni ocasional (formato: \`nivel, aclaración\`).`,
    );
  }

  return { kind: SEVERITY_KINDS[level], level, note: note && note.charAt(0).toUpperCase() + note.slice(1) };
}

/** Mensajes de otros programas (npm, PowerShell, Windows, Node) que pueden aparecer citados en un síntoma. */
const FOREIGN_OUTPUT = /^(npm|command not found|'arcli'|arcli\.ps1|dh key|ERR_|coe\.)/i;

/**
 * Las salidas de ARCLI citadas en un síntoma: lo que va entre backticks o comillas, empieza con mayúscula (o con "…")
 * y es una frase. Lo que viene de otro programa queda en el texto.
 */
function arcliMessages(text) {
  // `markdownTouches` ya puso ARCLI en negrita: adentro de un mensaje no va.
  const quoted = [...text.matchAll(/`([^`]+)`|"([^"]+)"/g)].map((match) =>
    (match[1] ?? match[2]).replace(/\*\*/g, '').trim(),
  );

  return quoted.filter(
    (message) => /^[A-ZÁÉÍÓÚÑ.…"]/.test(message) && /\s/.test(message) && !FOREIGN_OUTPUT.test(message),
  );
}

/** El texto del síntoma nombra el mensaje que ya muestra el bloque de abajo, en vez de repetirlo. */
function pointToOutput(text, messages) {
  const marked = text.replace(/`([^`]+)`|"([^"]+)"/g, (quote, code, plain) =>
    messages.includes((code ?? plain).replace(/\*\*/g, '').trim()) ? '\u0001' : quote,
  );

  const grouped = marked
    .replace(/\s*\(\u0001\)/g, '')
    .replace(/(?:un )?mensaje como \u0001/g, '\u0001')
    .replace(/\u0001(?:\s*(?:,|o|y)\s*\u0001)+/g, 'los mensajes de abajo');
  // Si nombra dos mensajes por separado, cada uno es una línea del bloque.
  const separate = grouped.split('\u0001').length - 1;
  const ordinals = ['primera', 'segunda', 'tercera'];
  let index = 0;
  const pointed = grouped
    .replace(/(?:el )?aviso \u0001|\u0001/g, (match) => {
      const line = separate > 1 ? `la ${ordinals[index++] ?? 'otra'} línea de abajo` : null;

      if (match.startsWith('el aviso') || match.startsWith('aviso'))
        return line ? `el aviso de ${line}` : 'el aviso de abajo';
      return line ?? 'el mensaje de abajo';
    })
    .replace(/^el /, 'El ');

  return /[.:)!?]$/.test(pointed) ? pointed : `${pointed}.`;
}

/**
 * El cuerpo de un problema en dos columnas: cada `- **Síntoma:**`, `**Causa:**`, `**Solución:**`… es una fila con la
 * etiqueta a la izquierda; lo que sigue a la viñeta (código, sublistas) va en la misma fila. Si el síntoma cita una
 * salida de ARCLI, se muestra como en la terminal; si el síntoma es solo ese mensaje, sin repetirlo en el texto.
 */
function faqRows(body) {
  const lines = body.split('\n');
  const rows = [];
  let more = null;

  for (const line of lines) {
    const label = line.match(/^- \*\*([^*]+?):\*\*\s*(.*)$/);

    if (label && label[1] === 'Documentación relacionada') more = label[2];
    else if (label) rows.push({ content: [label[2]], label: label[1] });
    else if (rows.length > 0 && !more) rows.at(-1).content.push(line);
    else if (!more) return null;
  }

  if (rows.length === 0) return null;

  const html = rows.map(({ content, label }) => {
    let text = content.join('\n').trim();
    let output = '';

    if (label === 'Síntoma') {
      const messages = arcliMessages(text);
      const rest = text
        .replace(/`[^`]+`|"[^"]+"/g, (quote) =>
          messages.includes(quote.slice(1, -1).replace(/\*\*/g, '').trim()) ? '' : quote,
        )
        .replace(/\b(o|y|error|arca|mensaje|como|con|un|el|aviso|al emitir|al facturar)\b/gi, '')
        .replace(/[\s.,;:()…-]/g, '');

      if (messages.length > 0) {
        output = `<pre class="arcli-salida">${messages.map((message) => escapeHtml(message)).join('\n')}</pre>`;
        text = rest === '' ? '' : pointToOutput(text, messages);
      }
    }

    // Sin la etiqueta en negrita, la oración arranca en mayúscula.
    text = text.replace(/^[a-záéíóúñ]/, (letter) => letter.toUpperCase());

    return `<div class="arcli-faq-row"><b>${label}</b><div>\n\n${text}\n\n${output}\n\n</div></div>`;
  });

  return `${html.join('\n')}\n${more ? `\n<div class="arcli-faq-more">\n\nMás en ${more}\n\n</div>\n` : ''}`;
}

/**
 * Problemas frecuentes: cada `### problema` pasa a un desplegable con su severidad al lado, agrupados por tema (`##`),
 * con un buscador arriba (`public/arcli.js`). El desplegable conserva el ancla del titulo, asi los links siguen andando.
 */
export function problems(text) {
  const [head, ...parts] = text.split(/^(?=## )/m);
  const sections = parts.map((part) => {
    const [title, ...items] = part.split(/^(?=### )/m);
    const faqs = items.map((item) => {
      const [line, ...rest] = item.split('\n');
      const name = line.replace(/^### /, '');
      const severity = rest.join('\n').match(/^- \*\*Severidad:\*\* (.+)$/m);
      const body = rest
        .join('\n')
        .replace(/^- \*\*Severidad:\*\* .+\n/m, '')
        .trim();
      const rows = faqRows(body);
      const level = severity && severityParts(severity[1], name);

      return `<details class="arcli-faq" id="${headingSlug(name.replace(/`/g, ''))}">\n<summary><span class="t">${inlineHtml(name)}${level?.note ? `<span class="sub">${inlineHtml(level.note)}.</span>` : ''}</span>${level ? `<span class="sev sev-${level.kind}">${level.level}</span>` : ''}</summary>\n\n${rows ?? body}\n\n</details>\n`;
    });

    return `<section class="arcli-faq-section">\n\n${title.trim()}\n\n${faqs.join('\n')}\n</section>\n`;
  });
  const search =
    '<div class="arcli-faq-search"><input type="search" placeholder="Buscá lo que ves: EACCES, punto de venta, 10005…" aria-label="Buscar un problema"></div>\n<p class="arcli-faq-empty" hidden>No encontramos ese problema. Probá con otra palabra o mirá los errores de ARCA más abajo.</p>\n';

  return `${head.trim()}\n\n${search}\n${sections.join('\n')}`;
}
