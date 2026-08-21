import type { Command } from 'commander';

import type { VoucherFamily, VoucherShortcut } from '../modules/billing/billing.types';
import { getVoucherKindByShortcut } from '../modules/billing/voucher-kind-map';
import { renderLogo } from '../ui';

const FAMILY_LABELS: Record<VoucherFamily, string> = {
  factura: 'Factura',
  'factura-credito-electronica': 'Factura de credito electronica',
  'nota-credito': 'Nota de credito',
  'nota-credito-electronica': 'Nota de credito electronica',
  'nota-debito': 'Nota de debito',
  'nota-debito-electronica': 'Nota de debito electronica',
};

const FAMILY_SHORTCUTS: Record<VoucherFamily, readonly [VoucherShortcut, VoucherShortcut, VoucherShortcut]> = {
  factura: ['fa', 'fb', 'fc'],
  'factura-credito-electronica': ['fcea', 'fceb', 'fcec'],
  'nota-credito': ['nca', 'ncb', 'ncc'],
  'nota-credito-electronica': ['ncea', 'nceb', 'ncec'],
  'nota-debito': ['nda', 'ndb', 'ndc'],
  'nota-debito-electronica': ['ndea', 'ndeb', 'ndec'],
};

const AVAILABLE_GENERAL_OPTIONS = [
  '  - --monto <number> | todas | importe total del comprobante',
  '  - --punto-venta <number> | --pv <number> | todas | punto de venta emisor',
  '  - --fecha <fecha> | todas | fecha del comprobante; si falta usa hoy',
  '  - --concepto <tipo> | -c | todas | productos, servicios o productos-servicios',
  '  - --cs | --cp | --csp | todas | atajos para concepto',
  '  - --moneda <codigo> | --mda <codigo> | todas | codigo de moneda, por ejemplo ARS o USD',
  '  - --cotizacion-moneda <number> | --cm <number> | todas | cotizacion de la moneda elegida',
  '  - --cargar <path> | todas | cargar un comprobante o lote desde JSON',
].join('\n');

const AVAILABLE_IDENTITY_OPTIONS = [
  '  - --cuit <number> | todas | CUIT del receptor',
  '  - --cuil <number> | todas | CUIL del receptor',
  '  - --dni <number> | todas | DNI del receptor',
  '  - --consumidor-final | --cfinal | todas | consumidor final con documento 0',
  '  - --iva-receptor <tipo> | --ir <tipo> | todas | condicion IVA del receptor',
  '  - --ir-* | todas | atajos para IVA receptor, por ejemplo --ir-cf o --ir-ri',
].join('\n');

const AVAILABLE_SERVICE_OPTIONS = [
  '  - -d, --dia <1-31> | servicios o productos-servicios | dia de vencimiento o referencia de servicio',
  '  - --servicio-desde <fecha> | --sd <fecha> | servicios o productos-servicios | inicio del servicio',
  '  - --servicio-hasta <fecha> | --sh <fecha> | servicios o productos-servicios | fin del servicio',
].join('\n');

const AVAILABLE_ASSOCIATED_OPTIONS = [
  '  - --ac <shortcut> | notas | shortcut del comprobante asociado',
  '  - --at <number> | notas | tipo ARCA del comprobante asociado',
  '  - --asociado-punto-venta <number> | --apv <number> | notas | punto de venta del asociado',
  '  - --ar <number> | notas | numero del comprobante asociado',
  '  - --acuit <number> | notas | CUIT del comprobante asociado',
].join('\n');

const AVAILABLE_EXECUTION_OPTIONS = [
  '  - --previsualizar | todas | muestra el payload antes de hablar con ARCA',
  '  - --emitir | todas | emite realmente el comprobante',
  '  - --testing | todas | fuerza entorno testing en esta corrida',
  '  - --produccion | todas | fuerza entorno produccion en esta corrida',
  '  - --confirmar-produccion | solo con --produccion --emitir | confirma emision real en produccion',
  '  - --json | todas | salida estructurada para scripts',
  '  - --bruto | todas | agrega respuesta cruda de ARCA cuando exista',
].join('\n');

const CORE_RULES = [
  '  - ARCLI arma datos desde flags, JSON cargado, config y defaults internos.',
  '  - Si no pasa fecha, usa hoy.',
  '  - Use --emitir o --previsualizar, pero no ambos.',
  '  - Use una sola identidad de receptor: --consumidor-final o --cfinal, o bien --cuit, --cuil o --dni.',
  '  - Use --iva-receptor, --ir o un solo flag --ir-*, pero no varios a la vez.',
  '  - Use --concepto o un solo flag entre --cs, --cp y --csp, pero no ambos.',
].join('\n');

function section(title: string, body: string): string {
  return [title, body].join('\n');
}

function compactList(values: readonly string[]): string {
  return values.map((value) => `  - ${value}`).join('\n');
}

function formatFamilyShortcuts(family: VoucherFamily): string {
  const [a, b, c] = FAMILY_SHORTCUTS[family];

  return compactList([`A -> ${a}`, `B -> ${b}`, `C -> ${c}`]);
}

function buildProgramHeader(): string {
  return ['', renderLogo(), ''].join('\n');
}

function createProgramQuickStart(): string {
  return [
    'Uso minimo',
    '  - TL;DR: arcli fc -m 300000 --cs --consumidor-final --ir-cf',
    '  - Ese ejemplo asume que ya resolviste CUIT emisor, credenciales y punto de venta.',
    '  - Si todavía no lo hiciste, empezá por: arcli config revisar',
    '  - Emitir de verdad: arcli fa -m 1 --cs --cuit 20168598204 --ir-ri --emitir --bruto',
  ].join('\n');
}

function createProgramMentalModel(): string {
  return [
    'Como pensar rapido un comando',
    '  - 1. Elegí el comprobante: fc, fa, nca, ndeb, fcec.',
    '  - 2. Definí el monto: --monto.',
    '  - 3. Elegí el concepto: --cs, --cp, --csp o --concepto.',
    '  - 4. Definí la identidad: --cuit, --cuil, --dni o --consumidor-final.',
    '  - 5. Definí el IVA receptor: --ir-*, --ir o --iva-receptor.',
  ].join('\n');
}

function createProgramFamilies(): string {
  return section(
    'Familias y shortcuts',
    [
      '  - factura -> fa, fb, fc',
      '  - nota-credito -> nca, ncb, ncc',
      '  - nota-debito -> nda, ndb, ndc',
      '  - factura-credito-electronica -> fcea, fceb, fcec',
      '  - nota-credito-electronica -> ncea, nceb, ncec',
      '  - nota-debito-electronica -> ndea, ndeb, ndec',
    ].join('\n'),
  );
}

function createProgramCommands(): string {
  return section(
    'Comandos importantes',
    [
      '  - Emitir comprobantes por shortcut: arcli fc ...',
      '  - Emitir por familia y letra: arcli factura c ...',
      '  - Ver y guardar config: arcli config',
      '  - Revisar entorno y credenciales: arcli config revisar',
      '  - Ver ejemplos listos para copiar: arcli ejemplos',
      '  - Ver escenas de UI: arcli storybook',
    ].join('\n'),
  );
}

function createProgramExamples(): string {
  return section(
    'Ejemplos utiles',
    [
      '  - Basico: arcli fc -m 300000 --cs --consumidor-final --ir-cf',
      '  - Con CUIT: arcli fa -m 1 --cs --cuit 20168598204 --ir-ri',
      '  - Nota: arcli nca -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20409509763',
    ].join('\n'),
  );
}

function createProgramSafety(): string {
  return section(
    'Ejecucion y seguridad',
    [
      '  - --previsualizar muestra la solicitud antes de emitir.',
      '  - --emitir habla de verdad con ARCA.',
      '  - --produccion cambia al entorno real.',
      '  - En produccion, la barrera completa es: --produccion --emitir --confirmar-produccion.',
      '  - Para scripts o pipelines, usá --json y evitá automatizar sobre salida humana.',
    ].join('\n'),
  );
}

function createProgramDiscovery(): string {
  return section(
    'Descubrimiento',
    [
      '  - Ayuda general: arcli ayuda',
      '  - Ayuda de un shortcut: arcli fc ayuda',
      '  - Ayuda de una familia: arcli factura ayuda',
      '  - Ayuda de config: arcli config ayuda',
      '  - Ayuda de ejemplos: arcli ejemplos ayuda',
      '  - Ayuda de storybook: arcli storybook ayuda',
    ].join('\n'),
  );
}

function createProgramFrequentErrors(): string {
  return section(
    'Errores frecuentes',
    [
      '  - Identidad duplicada: no uses --cuit y --consumidor-final juntos.',
      '  - Falta IVA receptor: elegí --ir-* o --iva-receptor.',
      '  - Flags incompatibles: no mezcles --emitir y --previsualizar.',
      '  - JSON invalido o incompleto: revisá el archivo pasado a --cargar.',
    ].join('\n'),
  );
}

function createVoucherSummary(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  const whenToUse = definition.requiresAssociatedVoucher
    ? 'Use este shortcut cuando ya sabe el comprobante exacto y necesita informar un asociado compatible.'
    : 'Use este shortcut cuando ya sabe exactamente que comprobante quiere emitir y quiere escribir menos.';

  return section(
    'Resumen',
    [
      `  - Comprobante: ${definition.displayName}`,
      `  - Shortcut: arcli ${shortcut}`,
      `  - Comando largo: arcli ${definition.family} ${definition.letter}`,
      `  - Tipo ARCA: ${definition.arcaType}`,
      `  - Cuando usarlo: ${whenToUse}`,
    ].join('\n'),
  );
}

function createShortcutMinimum(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  const example = definition.requiresAssociatedVoucher
    ? `  - Ejemplo minimo: arcli ${shortcut} -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20409509763`
    : `  - Ejemplo minimo: arcli ${shortcut} -m 300000 --cs --consumidor-final --ir-cf`;

  return section(
    'Para empezar',
    [
      example,
      definition.requiresAssociatedVoucher
        ? '  - Ademas de la estructura base, este comprobante siempre necesita asociado.'
        : '  - Con eso ya tenés una base funcional para previsualizar o emitir.',
    ].join('\n'),
  );
}

function createShortcutExamples(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  const examples = definition.requiresAssociatedVoucher
    ? [
        `  - Previsualizar: arcli ${shortcut} -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20409509763 --previsualizar`,
        `  - Emitir: arcli ${shortcut} -m 1 --cs --cuit 20168598204 --ir-ri --ac fa --apv 3 --ar 6 --acuit 20409509763 --emitir --bruto`,
        `  - JSON: arcli ${shortcut} --cargar ./voucher.json --json`,
      ]
    : [
        `  - Rapido: arcli ${shortcut} -m 15000 --cs --consumidor-final --ir-cf`,
        `  - Emitir: arcli ${shortcut} -m 1 --cs --cuit 20168598204 --ir-ri --emitir --bruto`,
        `  - JSON: arcli ${shortcut} --cargar ./voucher.json --json`,
      ];

  return section('Ejemplos', examples.join('\n'));
}

function createShortcutImportantFlags(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  return section(
    'Flags importantes',
    [
      '  - Estructura base: --monto, --concepto/--cs/--cp/--csp, identidad y IVA receptor.',
      '  - Datos comunes: --pv, --fecha, --moneda, --cm, --cargar.',
      '  - Servicio: --dia, --sd y --sh cuando el concepto usa servicios.',
      definition.requiresAssociatedVoucher
        ? '  - Asociado: --ac o --at, mas --apv, --ar y --acuit.'
        : '  - Asociado: no aplica para este comprobante.',
      '  - Salida y ejecucion: --previsualizar, --emitir, --json, --bruto, --testing, --produccion.',
    ].join('\n'),
  );
}

function createShortcutAvailableFlags(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  return section(
    'Mas parametros disponibles',
    [
      'Generales',
      AVAILABLE_GENERAL_OPTIONS,
      '',
      'Receptor e IVA',
      AVAILABLE_IDENTITY_OPTIONS,
      '',
      'Servicio',
      AVAILABLE_SERVICE_OPTIONS,
      '',
      'Comprobante asociado',
      definition.requiresAssociatedVoucher ? AVAILABLE_ASSOCIATED_OPTIONS : '  - No aplica para este comprobante.',
      '',
      'Ejecucion y salida',
      AVAILABLE_EXECUTION_OPTIONS,
    ].join('\n'),
  );
}

function createShortcutFrequentErrors(shortcut: VoucherShortcut): string {
  const definition = getVoucherKindByShortcut(shortcut);

  if (!definition) {
    return '';
  }

  const lines = [
    '  - No mezcle identidades del receptor.',
    '  - No mezcle --emitir y --previsualizar.',
    '  - Si usa --cargar, revise que el JSON tenga claves validas.',
  ];

  if (definition.requiresAssociatedVoucher) {
    lines.push('  - Este comprobante exige asociado; complete --ac, --apv, --ar y --acuit cuando corresponda.');
  }

  return section('Errores frecuentes', lines.join('\n'));
}

function createFamilySummary(family: VoucherFamily): string {
  return section(
    'Resumen',
    [
      `  - Familia: ${FAMILY_LABELS[family]}`,
      `  - Uso: arcli ${family} <a|b|c>`,
      '  - Letras validas: a, b, c',
      '  - Use la familia cuando quiera cambiar solo la letra sin aprender todos los shortcuts.',
      '  - Si ya sabés el comprobante exacto, el shortcut suele ser mas rapido.',
    ].join('\n'),
  );
}

function createFamilyExamples(family: VoucherFamily): string {
  return section(
    'Ejemplos por letra',
    [
      `  - Letra A: arcli ${family} a -m 15000 --cs --cuit 20168598204 --ir-ri`,
      `  - Letra B: arcli ${family} b -m 15000 --cs --consumidor-final --ir-cf`,
      `  - Letra C con JSON: arcli ${family} c --cargar ./voucher.json --json`,
    ].join('\n'),
  );
}

function createFamilySharedFlags(family: VoucherFamily): string {
  return [
    section('Shortcuts relacionados', formatFamilyShortcuts(family)),
    '',
    section(
      'Flags importantes',
      [
        '  - Base comun: --monto, --concepto/--cs/--cp/--csp, identidad e IVA receptor.',
        '  - Datos comunes: --pv, --fecha, --moneda, --cm, --cargar.',
        '  - Servicio: --dia, --sd y --sh cuando el concepto usa servicios.',
        family.includes('nota')
          ? '  - Asociado: esta familia lo exige; usá --ac o --at, mas --apv, --ar y --acuit.'
          : '  - Asociado: no aplica para esta familia.',
        '  - Ejecucion y salida: --previsualizar, --emitir, --json, --bruto, --testing, --produccion.',
      ].join('\n'),
    ),
    '',
    section(
      'Mas parametros disponibles',
      [
        'Generales',
        AVAILABLE_GENERAL_OPTIONS,
        '',
        'Receptor e IVA',
        AVAILABLE_IDENTITY_OPTIONS,
        '',
        'Servicio',
        AVAILABLE_SERVICE_OPTIONS,
        '',
        'Comprobante asociado',
        family.includes('nota') ? AVAILABLE_ASSOCIATED_OPTIONS : '  - No aplica para esta familia.',
        '',
        'Ejecucion y salida',
        AVAILABLE_EXECUTION_OPTIONS,
      ].join('\n'),
    ),
  ].join('\n');
}

function createFamilyFrequentErrors(family: VoucherFamily): string {
  const lines = [
    '  - La letra debe ser a, b o c.',
    '  - No mezcle identidades o conceptos incompatibles.',
    '  - Si carga JSON, la letra del comando y el contenido deben representar el mismo comprobante.',
  ];

  if (family.includes('nota')) {
    lines.push('  - Las notas requieren un asociado compatible; sin eso ARCLI no puede armar el payload final.');
  }

  return section('Errores frecuentes', lines.join('\n'));
}

export function createConfigHelp(): string {
  return [
    '',
    section(
      'Para que sirve',
      [
        '  - Guardar defaults del CLI para no repetir flags en cada corrida.',
        '  - Definir rutas de certificados y claves por entorno.',
        '  - Revisar si el entorno esta listo antes de emitir.',
      ].join('\n'),
    ),
    '',
    section(
      'Casos comunes',
      [
        '  - Guardar defaults para no repetir flags como puntoVenta, concepto o IVA receptor.',
        '  - Revisar si testing o produccion tienen credenciales y contexto validos.',
        '  - Debuggear por que un comando pide datos que pensabas tener guardados.',
      ].join('\n'),
    ),
    '',
    section(
      'Comandos mas usados',
      [
        '  - Ver config actual: arcli config',
        '  - Revisar entorno: arcli config revisar',
        '  - Ver ruta del archivo: arcli config ruta',
        '  - Guardar un default: arcli config establecer puntoVenta 3',
        '  - Guardar una credencial: arcli config establecer cert.testing /ruta/cert.crt',
      ].join('\n'),
    ),
    '',
    section(
      'Ejemplos',
      [
        '  - arcli config establecer cuit 20409509763',
        '  - arcli config establecer ivaReceptor consumidor-final',
        '  - arcli config establecer key.produccion /ruta/clave.key',
        '  - arcli config establecer ticketPath /ruta/tickets',
        '  - arcli config eliminar json',
      ].join('\n'),
    ),
    '',
    section(
      'Errores frecuentes',
      [
        '  - Faltan cert.testing o key.testing: corra arcli config revisar.',
        '  - Punto de venta no configurado: guarde puntoVenta o paselo por flag.',
        '  - Emitir por defecto activado sin querer: revise el valor de emitir.',
      ].join('\n'),
    ),
    '',
  ].join('\n');
}

export function createStorybookHelp(): string {
  return [
    '',
    section(
      'Escenas disponibles',
      [
        '  - arcli storybook',
        '  - arcli storybook colores',
        '  - arcli storybook componentes',
        '  - arcli storybook comprobantes',
        '  - arcli storybook configuracion',
        '  - arcli storybook errores',
        '  - arcli storybook json',
      ].join('\n'),
    ),
    '',
    section(
      'Cuando usarlo',
      [
        '  - Revisar la UI del CLI sin pegarle a ARCA.',
        '  - Probar escenas visuales mientras ajusta paneles, colores o contratos JSON.',
      ].join('\n'),
    ),
    '',
  ].join('\n');
}

export function createExamplesHelp(): string {
  return [
    '',
    section(
      'Para que sirve',
      [
        '  - Mostrar ejemplos seguros y listos para copiar de todos los comprobantes soportados.',
        '  - Comparar la forma larga y la forma corta del mismo comando.',
        '  - Ver rapido que cambia entre una variante minima y una full.',
      ].join('\n'),
    ),
    '',
    section(
      'Como leer la salida',
      [
        '  - Minima: datos esenciales del comprobante.',
        '  - Full: mas campos explicitados para el mismo flujo.',
        '  - Larga: comando largo y flags descriptivos.',
        '  - Corta: shortcut y aliases practicos.',
      ].join('\n'),
    ),
    '',
    section(
      'Seguridad',
      [
        '  - Todos los ejemplos usan --previsualizar para evitar emisiones reales por error.',
        '  - Si queres emitir, reemplaza --previsualizar por --emitir.',
        '  - Si ademas usas --produccion, suma --confirmar-produccion.',
      ].join('\n'),
    ),
    '',
  ].join('\n');
}

export function createShortcutHelp(shortcut: VoucherShortcut): string {
  return [
    '',
    createVoucherSummary(shortcut),
    '',
    createShortcutMinimum(shortcut),
    '',
    createShortcutImportantFlags(shortcut),
    '',
    createShortcutExamples(shortcut),
    '',
    createShortcutAvailableFlags(shortcut),
    '',
    section('Reglas clave', CORE_RULES),
    '',
    createShortcutFrequentErrors(shortcut),
    '',
  ].join('\n');
}

export function createFamilyHelp(family: VoucherFamily): string {
  return [
    '',
    createFamilySummary(family),
    '',
    createFamilyExamples(family),
    '',
    createFamilySharedFlags(family),
    '',
    section('Reglas clave', CORE_RULES),
    '',
    createFamilyFrequentErrors(family),
    '',
  ].join('\n');
}

export function createProgramHelp(): string {
  return [
    '',
    createProgramQuickStart(),
    '',
    createProgramMentalModel(),
    '',
    createProgramFamilies(),
    '',
    createProgramCommands(),
    '',
    createProgramExamples(),
    '',
    createProgramSafety(),
    '',
    createProgramDiscovery(),
    '',
    createProgramFrequentErrors(),
    '',
  ].join('\n');
}

export function configureSpanishHelp(command: Command): void {
  command.helpCommand(false);
  command.helpOption('--ayuda', 'mostrar ayuda');
  command.showHelpAfterError('(usa "ayuda" para ver ejemplos y opciones)');
}

export function createProgramHeader(): string {
  return buildProgramHeader();
}
