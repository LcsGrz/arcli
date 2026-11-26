import { describe, expect, it } from 'vitest';

import { nodeLocalFiles } from '../../../services/files/local-files';
import { type BillingCommandInput, billingCommandSchema } from '../../billing/billing.schemas';
import { validateDocumentIdentity } from '../../billing/billing.validation';
import { getVoucherKindByShortcut } from '../../billing/voucher-kind-map';
import { arcliConfigSchema } from '../../config/config.schemas';
import { parseConfigValue } from '../../config/config-value-parser';
import { validateDni, validateOptionalCbuAlias } from '../validators';

/**
 * Caracterización (ARQ8-3): el alias del CBU y el DNI se validan igual en cada punto de entrada (flags y `--cargar`
 * por el esquema de billing, la config guardada, `arcli config set` y el asistente). Si una superficie se separa de las
 * otras, falla acá.
 */

type Outcome = true | string;

const ALIAS_CASES: readonly (readonly [string, boolean])[] = [
  ['abcde', false],
  ['abcdef', true],
  ['a'.repeat(20), true],
  ['a'.repeat(21), false],
  ['mi.alias-cbu', true],
  ['MI.ALIAS.99', true],
  ['con espacio', false],
  ['ñandú.alias', false],
  ['alias_cbu', false],
  ['alias/cbu', false],
];

function aliasThroughBillingSchema(value: string): Outcome {
  const result = billingCommandSchema.shape.cbuAlias.safeParse(value);

  return result.success ? true : (result.error.issues[0]?.message ?? 'sin mensaje');
}

function aliasThroughConfigSchema(value: string): Outcome {
  const result = arcliConfigSchema.shape.aliasCbu.safeParse(value);

  return result.success ? true : (result.error.issues[0]?.message ?? 'sin mensaje');
}

function aliasThroughConfigValue(value: string): Outcome {
  try {
    parseConfigValue('aliasCbu', value, nodeLocalFiles);

    return true;
  } catch (error) {
    return (error as Error).message;
  }
}

const ALIAS_ENTRY_POINTS = [
  ['esquema de billing (flags y --cargar)', aliasThroughBillingSchema],
  ['esquema de la config', aliasThroughConfigSchema],
  ['arcli config set', aliasThroughConfigValue],
  ['asistente', validateOptionalCbuAlias],
] as const;

describe('alias del CBU en cada punto de entrada', () => {
  describe.each(ALIAS_ENTRY_POINTS)('%s', (_name, validate) => {
    it.each(ALIAS_CASES)('%s → válido: %s', (value, valid) => {
      const outcome = validate(value);

      if (valid) {
        expect(outcome).toBe(true);
      } else {
        // Un solo texto en todas las superficies; `arcli config set` nombra además el valor, como con el CBU.
        expect(outcome).toMatch(
          /^El alias( ".*")? no es válido: debe tener entre 6 y 20 letras, números, puntos o guiones\.$/,
        );
      }
    });
  });
});

const DNI_CASES: readonly (readonly [string, boolean])[] = [
  ['12345', false],
  ['123456', true],
  ['1234567', true],
  ['12345678', true],
  ['123456789', false],
];

function dniThroughBilling(value: string): Outcome {
  const input: BillingCommandInput = billingCommandSchema.parse({
    documentNumber: Number(value),
    concept: 'servicios',
    documentType: 'dni',
    ivaCondition: 'consumidor-final',
    shortcut: 'fb',
    totalAmount: 1000,
  });

  try {
    validateDocumentIdentity(input, getVoucherKindByShortcut('fb')!, { today: '20261118' });

    return true;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('DNI en cada punto de entrada', () => {
  describe.each([
    ['flags y --cargar', dniThroughBilling],
    ['asistente', validateDni],
  ] as const)('%s', (_name, validate) => {
    it.each(DNI_CASES)('%s → válido: %s', (value, valid) => {
      const outcome = validate(value);

      if (valid) {
        expect(outcome).toBe(true);
      } else {
        expect(outcome).toMatch(/de 6 a 8 dígitos/);
      }
    });
  });

  it('el asistente acepta el DNI con puntos, como lo escribe la gente', () => {
    expect(validateDni('30.123.456')).toBe(true);
    expect(validateDni('1.234')).not.toBe(true);
  });
});
