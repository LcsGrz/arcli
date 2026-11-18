/**
 * Arma el Markdown de `docs/comprobantes/`. En GitHub se lee como tablas; el sitio (`site/scripts/sync-docs.mjs`) toma
 * los comentarios `<!-- arcli: ... -->` y dibuja cada opción como tarjeta y la familia arriba del título.
 */
import {
  type OptionGroup,
  type OptionKey,
  optionRows,
  OPTIONS,
  RUN,
  VOUCHER_PAGES,
  type VoucherPage,
} from './comprobantes';

const HEADER =
  '<!-- Generado por `yarn docs:comprobantes` desde scripts/docs/comprobantes.ts: se edita allá, no acá. -->';

/** Un `|` dentro de una celda rompe la tabla: va escapado. */
const cell = (text: string) => text.replace(/\|/g, '\\|');
const code = (text: string) => (text ? `\`${cell(text)}\`` : '');

function optionBlock(key: OptionKey, page: VoucherPage): string {
  const option = OPTIONS[key] as OptionGroup;
  const rows = optionRows(key, page.letter);
  const lines = [`### ${option.name}`, ''];

  if (option.text) lines.push(option.text, '');
  lines.push('| Largo | Corto | Qué es |', '| --- | --- | --- |');
  for (const [short, long, what] of rows) lines.push(`| ${code(long)} | ${code(short)} | ${cell(what)} |`);
  lines.push('', `Ej.: \`${option.ej}\``);

  return lines.join('\n');
}

function section(
  title: string,
  kind: 'opt' | 'req' | 'run',
  lead: string,
  keys: readonly OptionKey[],
  page: VoucherPage,
) {
  return [
    `## ${title}`,
    '',
    lead,
    '',
    `<!-- arcli: opciones=${kind} -->`,
    '',
    keys.map((key) => optionBlock(key, page)).join('\n\n'),
  ].join('\n');
}

export function renderVoucherPage(page: VoucherPage, order: number): string {
  const parts = [
    HEADER,
    '',
    '[← Comprobantes](README.md)',
    '',
    `# ${page.title}`,
    '',
    `<!-- arcli: familia="${page.familia}" icono="${page.icon}" orden="${order}" -->`,
    '',
    page.intro,
    '',
    `\`arcli ${page.atajo}\` | \`${page.familiaComando}\``,
    '',
    '## Ejemplo',
    '',
    '```bash',
    page.ej,
    '```',
    '',
    'Sin `--emitir` muestra la vista previa y pregunta antes de emitir. También se emite desde el [asistente](../modo-interactivo.md), sin recordar flags.',
    '',
    section(
      'Obligatorio',
      'req',
      'Sin esto no se puede emitir. Lo que guardaste en la config no hace falta repetirlo.',
      page.req,
      page,
    ),
    '',
    section('Opcional', 'opt', 'Más datos del comprobante, o cambiar lo que viene de la config.', page.opt, page),
    '',
    section(
      'Al ejecutar',
      'run',
      'No cambian el comprobante: cómo corre ARCLI esta vez. Son los mismos en todos los comprobantes.',
      RUN,
      page,
    ),
  ];

  if (page.tips.length > 0) parts.push('', '## Para tener en cuenta', '', ...page.tips.map((tip) => `- ${tip}`));

  parts.push(
    '',
    '## No aplica',
    '',
    `Estos flags no van en este comprobante: ${page.na.map((flag) => `\`${flag}\``).join(', ')}.`,
    '',
    'Todas las reglas, en [reglas de validación](../validation-rules.md); todos los flags, en la [referencia del CLI](../cli-reference.md).',
    '',
  );

  return parts.join('\n');
}

const link = (title: string) => {
  const page = VOUCHER_PAGES.find((candidate) => candidate.title === title);

  if (!page) throw new Error(`No hay página de comprobante "${title}".`);

  return `[${title}](${page.file})`;
};
const either = (...titles: string[]) => titles.map(link).join(' \\| ');

/** Las filas de la tabla de todos los comprobantes: el tipo y, en cada letra, el atajo con link a su página. */
const TABLE_ROWS: readonly (readonly [string, readonly string[]])[] = [
  ['Factura', ['Factura A', 'Factura B', 'Factura C', 'Factura E']],
  ['Nota de crédito', ['Nota de crédito A', 'Nota de crédito B', 'Nota de crédito C', 'Nota de crédito E']],
  ['Nota de débito', ['Nota de débito A', 'Nota de débito B', 'Nota de débito C', 'Nota de débito E']],
  ['Recibo', ['Recibo A', 'Recibo B', 'Recibo C', '']],
  ['FCE', ['FCE A', 'FCE B', 'FCE C', '']],
  ['Nota de crédito FCE', ['Nota de crédito FCE A', 'Nota de crédito FCE B', 'Nota de crédito FCE C', '']],
  ['Nota de débito FCE', ['Nota de débito FCE A', 'Nota de débito FCE B', 'Nota de débito FCE C', '']],
];

function allVouchersTable(): string[] {
  const cellFor = (title: string) => {
    if (!title) return '–';
    const page = VOUCHER_PAGES.find((candidate) => candidate.title === title);

    if (!page) throw new Error(`No hay página de comprobante "${title}".`);

    return `[\`${page.atajo}\`](${page.file})`;
  };

  return [
    '<!-- arcli: atajos -->',
    '',
    '| Comprobante | A | B | C | E |',
    '| --- | --- | --- | --- | --- |',
    ...TABLE_ROWS.map(([name, titles]) => `| ${name} | ${titles.map(cellFor).join(' | ')} |`),
  ];
}

/** "¿Cuál me toca?": la entrada a los comprobantes. */
export function renderIndex(): string {
  return [
    HEADER,
    '',
    '[← Volver a la documentación](../README.md)',
    '',
    '# ¿Qué comprobante me toca?',
    '',
    'Depende de tu condición frente al IVA y de a quién le facturás. Cada comprobante tiene su página con un ejemplo y todos sus flags.',
    '',
    '| Sos | Le facturás a | Comprobante |',
    '| --- | --- | --- |',
    `| Monotributo | Cualquiera | ${either('Factura C', 'Recibo C')} |`,
    `| Monotributo | Una empresa obligada a FCE | ${link('FCE C')} |`,
    `| Responsable inscripto | Otro responsable inscripto | ${either('Factura A', 'Recibo A')} |`,
    `| Responsable inscripto | Consumidor final, monotributo o exento | ${either('Factura B', 'Recibo B')} |`,
    `| Responsable inscripto | Una empresa obligada a FCE | ${either('FCE A', 'FCE B')} |`,
    `| Cualquiera | Un cliente del exterior | ${link('Factura E')} |`,
    '',
    '## ¿Y para corregir una factura?',
    '',
    `Una **nota de crédito** resta (un descuento, una devolución, una factura mal hecha) y una **nota de débito** suma. Van con la misma letra que la factura: sobre una Factura C, una ${link('Nota de crédito C').replace('[Nota de crédito C]', '[nota de crédito C]')} o una ${link('Nota de débito C').replace('[Nota de débito C]', '[nota de débito C]')}. Cómo funcionan, en [notas de crédito y débito](../notas-credito-debito.md).`,
    '',
    '> [!TIP]',
    '> **¿No sabés tu condición?** Con tu CUIT: `arcli padron <CUIT>`. O en la constancia de inscripción de ARCA.',
    '',
    '## Todos los comprobantes',
    '',
    'Un atajo por comprobante, cada uno con su página: la fila es el tipo y la columna, la letra.',
    '',
    ...allVouchersTable(),
    '',
    'Para entender cada uno: [notas de crédito y débito](../notas-credito-debito.md), [Factura de Crédito Electrónica](../fce.md) y [exportación paso a paso](../exportacion.md).',
    '',
  ].join('\n');
}

/** Cada archivo de `docs/comprobantes/` con su contenido. */
export function renderAll(): Map<string, string> {
  const files = new Map<string, string>([['README.md', renderIndex()]]);

  VOUCHER_PAGES.forEach((page, index) => files.set(page.file, renderVoucherPage(page, index + 1)));

  return files;
}
