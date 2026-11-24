import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { InputValidationError } from '../../lib/errors/app-error';
import { assertRules } from '../../lib/rules/rules';

import { parseBillingDateInput } from './billing.dates';
import { ASSOCIATED_NOT_AFTER_NOTE_RULE } from './billing.rules';
import type { BillingCommandInput } from './billing.schemas';
import type { VoucherFamily, VoucherKindDefinition } from './billing.types';
import { getVoucherKindByArcaType, getVoucherKindByFamilyAndLetter, isNote, isReceipt } from './voucher-kind-map';
import { formatVoucherLabel, formatVoucherSubject, formatVoucherWithArticle } from './voucher-names';
import type { VoucherRequestAssociated } from './voucher-request';

interface ResolveAssociatedVoucherOptions {
  readonly billingDate: string;
  readonly emitterCuit: number;
  readonly input: BillingCommandInput;
  readonly requireVoucherKind: (shortcut: string) => VoucherKindDefinition;
  /** Hoy en Argentina (yyyymmdd). */
  readonly today: string;
  readonly voucherKind: VoucherKindDefinition;
}

export function resolveAssociatedVouchers(
  options: ResolveAssociatedVoucherOptions,
): VoucherRequestAssociated[] | undefined {
  const { billingDate, emitterCuit, input, requireVoucherKind, today, voucherKind } = options;

  if (!isNote(voucherKind)) {
    if (input.associatedVoucher) {
      throw new InputValidationError(`${formatVoucherSubject(voucherKind)} no usa comprobante asociado.`);
    }

    return undefined;
  }

  // Con periodo asociado la nota no lleva CbtesAsoc; lo valida resolveAssociatedPeriod.
  if (input.associatedPeriod && !input.associatedVoucher) {
    return undefined;
  }

  // Periodo y algun dato del comprobante (aunque sea solo `--apv` o `--acuit`): se mezclaron las dos formas, y pedir
  // el comprobante completo confundiria.
  if (input.associatedPeriod) {
    throw new InputValidationError(
      'Usá un comprobante asociado (`--ac`/`--at`) o un período asociado (`--periodo-desde`/`--periodo-hasta`), pero no ambos.',
    );
  }

  const associatedVoucher = input.associatedVoucher;
  // Sin `--acuit` el asociado es del propio emisor. ARCA solo exige el CUIT en las notas FCE (10151, WSFEv1 v4.7), donde
  // ademas tiene que ser el del emisor (10155); en A, B y C es opcional (p. 31).
  const associatedCuit = associatedVoucher?.cuit ?? String(emitterCuit);
  const associatedVoucherType =
    associatedVoucher?.tipo ?? resolveAssociatedVoucherType(associatedVoucher?.shortcut, requireVoucherKind);
  const associatedVoucherKind = resolveAssociatedVoucherKind(associatedVoucher, requireVoucherKind);

  if (!associatedVoucher?.numero || !associatedVoucher.puntoVenta || !associatedVoucherType) {
    const missing = [
      ...(associatedVoucherType ? [] : [{ flag: '`--ac <tipo>`', label: 'el tipo' }]),
      ...(associatedVoucher?.puntoVenta ? [] : [{ flag: '`--apv <número>`', label: 'el punto de venta' }]),
      ...(associatedVoucher?.numero ? [] : [{ flag: '`--ar <número>`', label: 'el número' }]),
    ];

    // Con alguno de los tres, decir que falta el comprobante entero confundiria.
    if (missing.length < 3) {
      const labels = missing.map(({ label }) => label).join(' y ');
      const flags = missing.map(({ flag }) => flag).join(' y ');

      throw new InputValidationError(
        `${missing.length === 1 ? 'Falta' : 'Faltan'} ${labels} del comprobante asociado de ${formatVoucherWithArticle(voucherKind)}. Usá ${flags}${voucherKind.isElectronicCredit ? '' : ', o un período con `--periodo-desde` y `--periodo-hasta` en vez del comprobante'}.`,
      );
    }

    throw new InputValidationError(
      `${formatVoucherSubject(voucherKind)} requiere comprobante asociado. Usá \`--ac\` o \`--at\`, junto con \`--apv\` o \`--asociado-punto-venta\` y \`--ar\`${voucherKind.isElectronicCredit ? '' : ' (y `--acuit` si es de otro CUIT), o un período con `--periodo-desde` y `--periodo-hasta`'}.`,
    );
  }

  if (associatedVoucherKind) {
    validateAssociatedVoucherKind(associatedVoucherKind, voucherKind, input.cancellation);
  }

  if (voucherKind.isElectronicCredit && associatedCuit !== String(emitterCuit)) {
    throw new InputValidationError(
      `En ${formatVoucherWithArticle(voucherKind)} el comprobante asociado tiene que ser del CUIT emisor (${emitterCuit}). Sacá \`--acuit\` o usá ese CUIT.`,
    );
  }

  // En una nota FCE sin `--afecha` la fecha sale de ARCA (checkAssociatedInArca, antes de la vista previa).
  const associatedDate = resolveAssociatedVoucherDate(input, billingDate, voucherKind, today);

  return [
    {
      ...(associatedDate ? { CbteFch: associatedDate } : {}),
      Cuit: associatedCuit,
      Nro: associatedVoucher.numero,
      PtoVta: associatedVoucher.puntoVenta,
      Tipo: associatedVoucherType,
    },
  ];
}

/**
 * El tipo del asociado, por atajo (--ac) o por codigo ARCA (--at), para validar letra y familia igual en los dos
 * casos. Un codigo fuera del alcance de ARCLI no se valida aca: lo resuelve ARCA.
 */
function resolveAssociatedVoucherKind(
  associatedVoucher: BillingCommandInput['associatedVoucher'],
  requireVoucherKind: (shortcut: string) => VoucherKindDefinition,
): VoucherKindDefinition | undefined {
  const byShortcut = associatedVoucher?.shortcut ? requireVoucherKind(associatedVoucher.shortcut) : undefined;
  const byType = associatedVoucher?.tipo ? (getVoucherKindByArcaType(associatedVoucher.tipo) ?? undefined) : undefined;

  if (byShortcut && associatedVoucher?.tipo && byShortcut.arcaType !== associatedVoucher.tipo) {
    throw new InputValidationError(
      `El atajo "${associatedVoucher.shortcut}" es el tipo ${byShortcut.arcaType}, no el ${associatedVoucher.tipo}. Usá uno solo para el comprobante asociado.`,
    );
  }

  return byShortcut ?? byType;
}

function resolveAssociatedVoucherDate(
  input: BillingCommandInput,
  billingDate: string,
  voucherKind: VoucherKindDefinition,
  today: string,
): string | undefined {
  const rawDate = input.associatedVoucher?.fecha;

  if (!rawDate) {
    return undefined;
  }

  // La misma regla que el asistente al preguntar la fecha del asociado o la de la nota.
  assertRules(
    [ASSOCIATED_NOT_AFTER_NOTE_RULE],
    { ...input, billingDate: formatArcaDateAsArgentineDate(billingDate) },
    { today, voucherKind },
  );

  return parseBillingDateInput(rawDate, today);
}

function resolveAssociatedVoucherType(
  shortcut: string | undefined,
  requireVoucherKind: (shortcut: string) => VoucherKindDefinition,
): number | undefined {
  if (!shortcut) {
    return undefined;
  }

  return requireVoucherKind(shortcut).arcaType;
}

/** NC y ND A, B y C asocian facturas, recibos y otras notas de la misma letra (regla 10040, WSFEv1 v4.7). */
const COMMON_NOTE_ASSOCIABLE_FAMILIES: readonly VoucherFamily[] = ['factura', 'nota-credito', 'nota-debito', 'recibo'];

/**
 * Lo que puede asociar una nota segun su familia y si es de anulacion. Una nota FCE sin anulacion solo asocia la
 * factura FCE (10156, 10157); con anulacion, la NC asocia la factura o una ND FCE y la ND solo una NC FCE (10183,
 * WSFEv1 v4.7). La 10186, la 10187 y la 10193 (A, B y C) dicen lo mismo en su segunda oracion, pero la primera habla
 * de asociar "un comprobante de credito": el texto es ambiguo y la fuente es la 10183. En A, B y C la anulacion no
 * cambia nada.
 */
export function listAssociableFamilies(noteFamily: VoucherFamily, cancellation: boolean): readonly VoucherFamily[] {
  switch (noteFamily) {
    case 'nota-credito':
    case 'nota-debito':
      return COMMON_NOTE_ASSOCIABLE_FAMILIES;
    case 'nota-credito-electronica':
      return cancellation
        ? ['factura-credito-electronica', 'nota-debito-electronica']
        : ['factura-credito-electronica'];
    case 'nota-debito-electronica':
      return cancellation ? ['nota-credito-electronica'] : ['factura-credito-electronica'];
    case 'factura':
    case 'factura-credito-electronica':
    case 'recibo':
      return [];
  }
}

/**
 * En una nota FCE, la anulacion que exige su asociado: `true` o `false` si solo una de las dos lo permite, o
 * `undefined` si valen las dos (una NC FCE sobre la factura) o si la nota no es FCE.
 */
export function resolveRequiredCancellation(
  noteFamily: VoucherFamily,
  associatedFamily: VoucherFamily,
): boolean | undefined {
  const allowed = [false, true].filter((cancellation) =>
    listAssociableFamilies(noteFamily, cancellation).includes(associatedFamily),
  );

  return allowed.length === 1 ? allowed[0] : undefined;
}

/** `una factura de crédito electrónica A o una nota de débito electrónica A`. */
function describeAssociableFamilies(
  families: readonly VoucherFamily[],
  letter: VoucherKindDefinition['letter'],
): string {
  return families
    .flatMap((family) => {
      const kind = getVoucherKindByFamilyAndLetter(family, letter);

      return kind ? [`${isReceipt(kind) ? 'un' : 'una'} ${formatVoucherLabel(kind)}`] : [];
    })
    .join(' o ');
}

function validateAssociatedVoucherKind(
  associatedVoucherKind: VoucherKindDefinition,
  voucherKind: VoucherKindDefinition,
  cancellation: boolean,
): void {
  if (associatedVoucherKind.isElectronicCredit !== voucherKind.isElectronicCredit) {
    throw new InputValidationError(
      `El comprobante asociado debe pertenecer a la misma categoría electrónica que ${formatVoucherWithArticle(voucherKind)}.`,
    );
  }

  if (associatedVoucherKind.letter !== voucherKind.letter) {
    throw new InputValidationError(
      `El comprobante asociado debe usar la misma letra que ${formatVoucherWithArticle(voucherKind)}.`,
    );
  }

  const families = listAssociableFamilies(voucherKind.family, cancellation);

  if (families.includes(associatedVoucherKind.family)) {
    return;
  }

  const withOther = listAssociableFamilies(voucherKind.family, !cancellation).includes(associatedVoucherKind.family);
  const flag = voucherKind.isElectronicCredit ? ` ${cancellation ? 'con' : 'sin'} \`--anulacion\`` : '';

  throw new InputValidationError(
    `${formatVoucherSubject(voucherKind)}${flag} solo puede asociar ${describeAssociableFamilies(families, voucherKind.letter)}, no ${formatVoucherWithArticle(associatedVoucherKind)}.`,
    undefined,
    withOther
      ? `${cancellation ? 'Sacá' : 'Sumá'} \`--anulacion\` para asociar ${formatVoucherWithArticle(associatedVoucherKind)}.`
      : undefined,
  );
}
