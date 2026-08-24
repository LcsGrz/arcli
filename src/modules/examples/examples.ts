import { badge, bold, renderLogo, renderPanel, toneText } from '../../ui';
import type { VoucherFamily, VoucherKindDefinition } from '../billing/billing.types';
import { VOUCHER_FAMILIES, VOUCHER_KIND_MAP, VOUCHER_SHORTCUTS } from '../billing/voucher-kind-map';

const ISSUER_HINT =
  'Estos ejemplos asumen que ya resolviste cuit emisor, credenciales y, en la version minima, tambien punto de venta por config.';

function resolveAmount(definition: VoucherKindDefinition): number {
  if (definition.letter === 'a') {
    return 1;
  }

  if (definition.letter === 'b') {
    return 15000;
  }

  return 300000;
}

function resolveIdentityLong(definition: VoucherKindDefinition): string[] {
  if (definition.letter === 'a') {
    return ['--cuit 20168598204', '--iva-receptor responsable-inscripto'];
  }

  return ['--consumidor-final', '--iva-receptor consumidor-final'];
}

function resolveIdentityShort(definition: VoucherKindDefinition): string[] {
  if (definition.letter === 'a') {
    return ['--cuit 20168598204', '--ir-ri'];
  }

  return ['--cfinal', '--ir-cf'];
}

function resolveAssociatedShortcut(definition: VoucherKindDefinition): string {
  if (!definition.requiresAssociatedVoucher) {
    return '';
  }

  if (definition.family === 'nota-credito') {
    return `f${definition.letter}`;
  }

  if (definition.family === 'nota-debito') {
    return `f${definition.letter}`;
  }

  if (definition.family === 'nota-credito-electronica') {
    return `fce${definition.letter}`;
  }

  return `fce${definition.letter}`;
}

function buildMinimalLong(definition: VoucherKindDefinition): string {
  const command = [
    `arcli ${definition.family} ${definition.letter}`,
    `--monto ${resolveAmount(definition)}`,
    '--concepto servicios',
  ];
  command.push(...resolveIdentityLong(definition));

  if (definition.requiresAssociatedVoucher) {
    command.push(
      `--ac ${resolveAssociatedShortcut(definition)}`,
      '--asociado-punto-venta 3',
      '--ar 120',
      '--acuit 20409509763',
    );
  }

  command.push('--previsualizar');

  return command.join(' ');
}

function buildMinimalShort(definition: VoucherKindDefinition): string {
  const command = [`arcli ${definition.shortcut}`, `-m ${resolveAmount(definition)}`, '--cs'];
  command.push(...resolveIdentityShort(definition));

  if (definition.requiresAssociatedVoucher) {
    command.push(`--ac ${resolveAssociatedShortcut(definition)}`, '--apv 3', '--ar 120', '--acuit 20409509763');
  }

  command.push('--previsualizar');

  return command.join(' ');
}

function buildFullLong(definition: VoucherKindDefinition): string {
  const command = [
    `arcli ${definition.family} ${definition.letter}`,
    `--monto ${resolveAmount(definition)}`,
    '--concepto servicios',
    '--punto-venta 3',
    '--fecha 31-03-2026',
    '--moneda PES',
    '--cotizacion-moneda 1',
    '--dia 31',
    '--servicio-desde 01-03-2026',
    '--servicio-hasta 31-03-2026',
  ];
  command.push(...resolveIdentityLong(definition));

  if (definition.requiresAssociatedVoucher) {
    command.push(
      `--ac ${resolveAssociatedShortcut(definition)}`,
      '--asociado-punto-venta 3',
      '--ar 120',
      '--acuit 20409509763',
    );
  }

  command.push('--previsualizar');

  return command.join(' ');
}

function buildFullShort(definition: VoucherKindDefinition): string {
  const command = [
    `arcli ${definition.shortcut}`,
    `-m ${resolveAmount(definition)}`,
    '--cs',
    '--pv 3',
    '-f 31-03-2026',
    '--mda PES',
    '--cm 1',
    '-d 31',
    '--sd 01-03-2026',
    '--sh 31-03-2026',
  ];
  command.push(...resolveIdentityShort(definition));

  if (definition.requiresAssociatedVoucher) {
    command.push(`--ac ${resolveAssociatedShortcut(definition)}`, '--apv 3', '--ar 120', '--acuit 20409509763');
  }

  command.push('--previsualizar');

  return command.join(' ');
}

function formatVoucherExample(definition: VoucherKindDefinition): string {
  return [
    renderPanel({
      borderType: 'note',
      content: bold(definition.displayName.toUpperCase()),
      contentAlign: 'left',
      padding: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
      width: 'standard',
    }),
    '',
    `${badge('MINIMA LARGA', 'info')}`,
    `${buildMinimalLong(definition)}`,
    '',
    `${badge('MINIMA CORTA', 'success')}`,
    `${buildMinimalShort(definition)}`,
    '',
    `${badge('FULL LARGA', 'warning')}`,
    `${buildFullLong(definition)}`,
    '',
    `${badge('FULL CORTA', 'debug')}`,
    `${buildFullShort(definition)}`,
  ].join('\n');
}

function renderFamilyExamples(family: VoucherFamily): string {
  return VOUCHER_SHORTCUTS.map((shortcut) => VOUCHER_KIND_MAP[shortcut])
    .filter((definition) => definition.family === family)
    .map(formatVoucherExample)
    .join('\n\n\n');
}

export function renderExamples(): string {
  return [
    renderLogo().trim(),
    '',
    `${badge('MINIMA', 'info')} datos esenciales`,
    `${badge('FULL', 'warning')} mas campos explicitados`,
    `${badge('LARGA', 'success')} comando largo`,
    `${badge('CORTA', 'debug')} shortcut y aliases`,
    '',
    toneText('SEGURIDAD', 'warning'),
    'Todos usan --previsualizar para evitar emisiones reales por error.',
    'Si queres emitir de verdad, reemplaza --previsualizar por --emitir.',
    'Para emitir en produccion necesitas --produccion junto con --emitir.',
    '',
    ISSUER_HINT,
    '',
    ...VOUCHER_FAMILIES.flatMap((family) => [renderFamilyExamples(family), '']),
    '',
  ].join('\n');
}
