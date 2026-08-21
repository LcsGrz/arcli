import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseBillingCommandInput,
  parseBillingCommandInputs,
  parseBillingCommandPlan,
  registerBillingOptions,
} from '../billing.command.parser';

const temporaryDirectories: string[] = [];

function createCommand(args: string[]): Command {
  const command = new Command();

  registerBillingOptions(command);
  command.parse(['node', 'test', ...args], { from: 'node' });

  return command;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('billing.command.parser', () => {
  it('defaults to safe dry-run when emit is absent', () => {
    const command = createCommand(['--monto', '1000']);
    const input = parseBillingCommandInput(command, 'fa', {
      defaultConcept: 'servicios',
      defaultCurrencyCode: 'ARS',
      defaultExchangeRate: 1,
      defaultIvaCondition: 'consumidor-final',
    });

    expect(input.dryRun).toBe(true);
    expect(input.emit).toBe(false);
  });

  it('uses configured emit default when the user omits execution flags', () => {
    const command = createCommand(['--monto', '1000']);
    const plan = parseBillingCommandPlan(command, 'fa', {
      defaultConcept: 'servicios',
      defaultCurrencyCode: 'ARS',
      defaultEmit: true,
      defaultExchangeRate: 1,
      defaultIvaCondition: 'consumidor-final',
    });

    expect(plan.modeSource).toBe('default');
    expect(plan.inputs[0]?.emit).toBe(true);
    expect(plan.inputs[0]?.dryRun).toBe(false);
  });

  it('marks file mode when execution flags come from json input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-billing-cli-'));

    temporaryDirectories.push(directory);

    const inputPath = join(directory, 'voucher-emit.json');

    writeFileSync(
      inputPath,
      JSON.stringify({
        concepto: 'servicios',
        emitir: true,
        ivaReceptor: 'consumidor-final',
        montoTotal: 1000,
        numeroDocumento: 0,
        previsualizar: false,
        tipoDocumento: 'consumidor-final',
      }),
      'utf8',
    );

    const command = createCommand(['--cargar', inputPath]);
    const plan = parseBillingCommandPlan(command, 'fa');

    expect(plan.modeSource).toBe('file');
    expect(plan.inputs[0]?.emit).toBe(true);
    expect(plan.inputs[0]?.dryRun).toBe(false);
  });

  it('uses emit when explicitly requested', () => {
    const command = createCommand(['--monto', '1000', '--emitir']);
    const input = parseBillingCommandInput(command, 'fa', {
      defaultConcept: 'servicios',
      defaultCurrencyCode: 'ARS',
      defaultExchangeRate: 1,
      defaultIvaCondition: 'consumidor-final',
    });

    expect(input.emit).toBe(true);
    expect(input.dryRun).toBe(false);
  });

  it('rejects mixing emit and preview at the same time', () => {
    const command = createCommand(['--monto', '1000', '--emitir', '--previsualizar', '--cs', '--ir-cf']);

    expect(() => parseBillingCommandInput(command, 'fa')).toThrow(/Use --emitir o --previsualizar/);
  });

  it('loads base data from a JSON file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-billing-cli-'));

    temporaryDirectories.push(directory);

    const inputPath = join(directory, 'voucher.json');

    writeFileSync(
      inputPath,
      JSON.stringify({
        codigoMoneda: 'USD',
        comprobanteAsociado: {
          atajo: 'fc',
          cuit: '20123456789',
          numero: 10,
          puntoVenta: 3,
        },
        concepto: 'productos',
        cotizacionMoneda: 1200,
        ivaReceptor: 'consumidor-final',
        montoTotal: 9999,
        numeroDocumento: 12345678,
        puntoVenta: 7,
        tipoDocumento: 'dni',
      }),
      'utf8',
    );

    const command = createCommand(['--cargar', inputPath]);
    const input = parseBillingCommandInput(command, 'fb');

    expect(input.concept).toBe('productos');
    expect(input.documentType).toBe('dni');
    expect(input.documentNumber).toBe(12345678);
    expect(input.pointOfSale).toBe(7);
    expect(input.totalAmount).toBe(9999);
    expect(input.currencyCode).toBe('USD');
    expect(input.exchangeRate).toBe(1200);
    expect(input.associatedVoucher?.shortcut).toBe('fc');
  });

  it('loads multiple voucher inputs from a JSON array', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-billing-cli-'));

    temporaryDirectories.push(directory);

    const inputPath = join(directory, 'voucher-array.json');

    writeFileSync(
      inputPath,
      JSON.stringify([
        {
          concepto: 'servicios',
          ivaReceptor: 'consumidor-final',
          montoTotal: 1000,
          numeroDocumento: 0,
          tipoDocumento: 'consumidor-final',
        },
        {
          concepto: 'productos',
          ivaReceptor: 'consumidor-final',
          montoTotal: 2000,
          numeroDocumento: 12345678,
          tipoDocumento: 'dni',
        },
      ]),
      'utf8',
    );

    const command = createCommand(['--cargar', inputPath]);
    const inputs = parseBillingCommandInputs(command, 'fc');

    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.totalAmount).toBe(1000);
    expect(inputs[1]?.totalAmount).toBe(2000);
  });

  it('accepts concept aliases from flags', () => {
    const command = createCommand(['-m', '1000', '--concepto', 'productos-servicios']);
    const input = parseBillingCommandInput(command, 'fa', { defaultIvaCondition: 'consumidor-final' });

    expect(input.concept).toBe('productos-servicios');
  });

  it('uses the configured default concept when the command omits it', () => {
    const command = createCommand(['--monto', '1000']);
    const input = parseBillingCommandInput(command, 'fa', {
      defaultConcept: 'servicios',
      defaultCurrencyCode: 'ARS',
      defaultExchangeRate: 1,
      defaultIvaCondition: 'consumidor-final',
    });

    expect(input.concept).toBe('servicios');
  });

  it('fails when no concept is provided anywhere', () => {
    const command = createCommand(['--monto', '1000']);

    expect(() => parseBillingCommandInput(command, 'fa', { defaultIvaCondition: 'consumidor-final' })).toThrow(
      /Falta el concepto/,
    );
  });

  it('keeps document number undefined when the user does not provide it', () => {
    const command = createCommand(['-m', '1000', '--concepto', 'servicios', '--ir-cf']);
    const input = parseBillingCommandInput(command, 'fa');

    expect(input.documentNumber).toBeUndefined();
  });

  it('accepts renamed aliases for common billing options', () => {
    const command = createCommand([
      '-m',
      '2500',
      '--cs',
      '--cfinal',
      '--ir-cf',
      '--pv',
      '9',
      '--mda',
      'USD',
      '--cm',
      '1234',
      '--sd',
      '01-03-2026',
      '--sh',
      '31-03-2026',
    ]);
    const input = parseBillingCommandInput(command, 'fc');

    expect(input.pointOfSale).toBe(9);
    expect(input.currencyCode).toBe('USD');
    expect(input.exchangeRate).toBe(1234);
    expect(input.serviceStartDate).toBe('01-03-2026');
    expect(input.serviceEndDate).toBe('31-03-2026');
    expect(input.documentType).toBe('consumidor-final');
  });

  it('accepts associated voucher aliases', () => {
    const command = createCommand([
      '--monto',
      '5000',
      '--cs',
      '--cfinal',
      '--ir-cf',
      '--ac',
      'fc',
      '--apv',
      '3',
      '--ar',
      '120',
      '--acuit',
      '20409509763',
    ]);
    const input = parseBillingCommandInput(command, 'ncc');

    expect(input.associatedVoucher).toEqual({
      cuit: '20409509763',
      numero: 120,
      puntoVenta: 3,
      shortcut: 'fc',
      tipo: undefined,
    });
  });
});
