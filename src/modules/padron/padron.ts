import { AppError } from '../../lib/errors/app-error';
import type { BillingIvaCondition } from '../billing/billing.schemas';
import { type ArcliEnvironment, formatEnvironmentLabel } from '../config/config.schemas';

/**
 * Impuestos del padron que definen la condicion frente al IVA.
 *
 * @internal Exportado para los tests.
 */
export const PADRON_TAX_IDS = {
  iva: 30,
  ivaExento: 32,
  monotributo: 20,
} as const;

/** Categorias vigentes del monotributo. */
export const MONOTRIBUTO_CATEGORY_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;

export type MonotributoCategoryLetter = (typeof MONOTRIBUTO_CATEGORY_LETTERS)[number];

/**
 * Letra de la categoria a partir de `descripcionCategoria`, que ARCA arma como letra, espacio y tipo de actividad
 * (`E VENTAS DE COSAS MUEBLES`). `idCategoria` no sirve: es un codigo interno (47 para esa E). Si la descripcion no
 * empieza con una letra de A a K sola, devuelve null en lugar de adivinar.
 */
export function parseMonotributoCategoryLetter(description: string | null): MonotributoCategoryLetter | null {
  const first = description?.trim().split(/\s+/)[0]?.toUpperCase();

  return MONOTRIBUTO_CATEGORY_LETTERS.find((letter) => letter === first) ?? null;
}

/** Periodo ARCA (yyyymm, como numero o texto) validado, o null si no lo es. */
export function parseArcaPeriod(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})(\d{2})$/.exec(text);

  if (!match) return null;

  const month = Number(match[2]);

  return month >= 1 && month <= 12 ? text : null;
}

export interface TaxpayerTax {
  readonly active: boolean;
  readonly description: string;
  readonly id: number;
}

export interface TaxpayerActivity {
  readonly description: string;
  readonly id: number;
}

/** Lo que ARCLI usa de la constancia de inscripcion (`ws_sr_constancia_inscripcion`). */
export interface Taxpayer {
  readonly activities: readonly TaxpayerActivity[];
  /** Domicilio fiscal en una linea, o null si el padron no lo informa. */
  readonly address: string | null;
  readonly cuit: number;
  /** Null si con los impuestos del padron no alcanza para saberla. */
  readonly ivaCondition: BillingIvaCondition | null;
  /** ACTIVO, INACTIVO... tal como lo informa ARCA. */
  readonly keyStatus: string | null;
  /** Descripcion de la categoria tal como la informa ARCA: `E VENTAS DE COSAS MUEBLES`. */
  readonly monotributoCategory: string | null;
  /** Letra de la categoria (A a K), sacada de la descripcion; null si no se puede leer. */
  readonly monotributoCategoryLetter: MonotributoCategoryLetter | null;
  /** Periodo ARCA (yyyymm) desde el que rige la categoria, o null si no viene. */
  readonly monotributoCategorySince: string | null;
  /** Razon social, o apellido y nombre de una persona fisica. */
  readonly name: string | null;
  /** Avisos de la constancia (por ejemplo, domicilio fiscal no confirmado). */
  readonly notices: readonly string[];
  readonly personType: 'fisica' | 'juridica' | null;
  readonly taxes: readonly TaxpayerTax[];
}

export interface PadronGateway {
  /** Null si el CUIT no existe en el padron. */
  getTaxpayer(cuit: number): Promise<Taxpayer | null>;
}

/**
 * Condicion IVA a partir de los impuestos activos: monotributo, IVA (responsable inscripto) o IVA exento. Con
 * otros datos (por ejemplo, una persona sin impuestos) no se adivina: devuelve null.
 */
export function deriveIvaCondition(input: {
  readonly monotributo: boolean;
  readonly taxes: readonly TaxpayerTax[];
}): BillingIvaCondition | null {
  const isActive = (id: number) => input.taxes.some((tax) => tax.id === id && tax.active);

  if (input.monotributo || isActive(PADRON_TAX_IDS.monotributo)) {
    return 'responsable-monotributo';
  }

  if (isActive(PADRON_TAX_IDS.iva)) {
    return 'responsable-inscripto';
  }

  if (isActive(PADRON_TAX_IDS.ivaExento)) {
    return 'sujeto-exento';
  }

  return null;
}

/** El CUIT no esta en el padron: lo dicen `arcli padron` y "Datos de un CUIT" del asistente. */
export function taxpayerNotFoundError(cuit: number, environment: ArcliEnvironment): AppError {
  return new AppError(`El CUIT ${cuit} no figura en el padrón de ARCA (${formatEnvironmentLabel(environment)}).`, {
    code: 'TAXPAYER_NOT_FOUND',
    suggestion:
      environment === 'testing'
        ? 'El padrón de testing tiene datos ficticios: probá con 20201797064.'
        : 'Revisá el número.',
  });
}
