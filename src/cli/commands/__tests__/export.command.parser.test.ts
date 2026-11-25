import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.kinds';
import { registerExportOptions } from '../export.command.options';
import { parseExportCommandPlan } from '../export.command.parser';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
});

const BASE = {
  cliente: 'ACME LLC',
  domicilioCliente: '123 Main St',
  montoTotal: 1500,
  numero: 1,
  paisDestino: 212,
};

function planFromFile(content: Record<string, unknown>, defaultEmit = false, args: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-export-cli-'));
  const path = join(directory, 'factura-e.json');

  directories.push(directory);
  writeFileSync(path, JSON.stringify({ ...BASE, ...content }));

  const command = new Command();

  registerExportOptions(command, EXPORT_VOUCHER_KIND);
  command.parse(['node', 'test', '--cargar', path, ...args], { from: 'node' });

  const plan = parseExportCommandPlan(command, { defaultEmit });

  return { emit: plan.input.emit, modeSource: plan.modeSource, pdf: plan.input.pdf };
}

describe('parseExportCommandPlan: emitir o previsualizar desde --cargar', () => {
  it('"previsualizar": false no emite: decide la config, como en A, B y C', () => {
    expect(planFromFile({ previsualizar: false })).toMatchObject({ emit: false, modeSource: 'default' });
    expect(planFromFile({ previsualizar: false }, true)).toMatchObject({ emit: true, modeSource: 'default' });
  });

  it('"previsualizar": true no emite y "emitir": true emite', () => {
    expect(planFromFile({ previsualizar: true }, true)).toMatchObject({ emit: false, modeSource: 'file' });
    expect(planFromFile({ emitir: true })).toMatchObject({ emit: true, modeSource: 'file' });
  });

  it('"emitir" y "previsualizar" en true a la vez es un error', () => {
    expect(() => planFromFile({ emitir: true, previsualizar: true })).toThrow(/no ambos en true/);
  });
});

describe('parseExportCommandPlan: que no se emita sin querer (TEST-15)', () => {
  it('sin flags, sin "emitir" y sin config no emite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-export-cli-'));
    const path = join(directory, 'factura-e.json');

    directories.push(directory);
    writeFileSync(path, JSON.stringify(BASE));

    const command = new Command();

    registerExportOptions(command, EXPORT_VOUCHER_KIND);
    command.parse(['node', 'test', '--cargar', path], { from: 'node' });

    expect(parseExportCommandPlan(command, {})).toMatchObject({ input: { emit: false }, modeSource: 'default' });
  });

  it('"emitir": false en el archivo le gana a emitir true en la config', () => {
    expect(planFromFile({ emitir: false }, true)).toMatchObject({ emit: false, modeSource: 'file' });
  });

  it('--previsualizar le gana a "emitir": true del archivo', () => {
    expect(planFromFile({ emitir: true }, true, ['--previsualizar'])).toMatchObject({
      emit: false,
      modeSource: 'flags',
    });
  });

  it('--emitir y --previsualizar a la vez es un error', () => {
    expect(() => planFromFile({}, false, ['--emitir', '--previsualizar'])).toThrow(/no los dos/);
  });
});

describe('parseExportCommandPlan: avisos de --cargar', () => {
  const ITEM = { cantidad: 1, codigo: '001', descripcion: 'Servicio', precioUnitario: 1500, unidad: 'unidad' };

  function warningsFromFile(content: Record<string, unknown>, args: string[] = []) {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-export-cli-'));
    const path = join(directory, 'factura-e.json');

    directories.push(directory);
    writeFileSync(path, JSON.stringify({ ...BASE, ...content }));

    const command = new Command();

    registerExportOptions(command, EXPORT_VOUCHER_KIND);
    command.parse(['node', 'test', '--cargar', path, ...args], { from: 'node' });

    return parseExportCommandPlan(command, {}).warnings;
  }

  it('"descripcion" con "items" en el JSON nombra las claves, no los flags', () => {
    expect(warningsFromFile({ descripcion: 'Consultoria', items: [ITEM] })).toEqual([
      'La clave "descripcion" del JSON de `--cargar` se usa solo cuando no hay "items": el detalle del comprobante sale de los ítems.',
    ]);
  });

  it('con --descripcion y --item el aviso es el de los flags', () => {
    expect(
      warningsFromFile({}, ['--descripcion', 'Consultoria', '--item', 'Servicio|1|1500']).filter((warning) =>
        warning.includes('--descripcion'),
      ),
    ).toEqual(['`--descripcion` se usa solo cuando no hay `--item`: el detalle del comprobante sale de los items.']);
  });

  it('sin ítems no avisa', () => {
    expect(warningsFromFile({ descripcion: 'Consultoria' })).toEqual([]);
  });
});

describe('parseExportCommandPlan: PDF', () => {
  it('toma "pdf" del archivo si no hay flags, y los flags le ganan', () => {
    expect(planFromFile({ pdf: true }).pdf).toBe(true);
    expect(planFromFile({ pdf: true }, false, ['--sin-pdf']).pdf).toBe(false);
  });

  it('--exportar-pdf y --sin-pdf a la vez es un error', () => {
    expect(() => planFromFile({}, false, ['--exportar-pdf', '--sin-pdf'])).toThrow(/no ambos a la vez/);
  });
});

describe('parseExportCommandPlan: fechas relativas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function datesFromFile(content: Record<string, unknown>, args: string[] = []) {
    const directory = mkdtempSync(join(tmpdir(), 'arcli-export-cli-'));
    const path = join(directory, 'factura-e.json');

    directories.push(directory);
    writeFileSync(path, JSON.stringify({ ...BASE, ...content }));

    const command = new Command();

    registerExportOptions(command, EXPORT_VOUCHER_KIND);
    command.parse(['node', 'test', '--cargar', path, ...args], { from: 'node' });

    const { input } = parseExportCommandPlan(command, {});

    return { paymentDate: input.paymentDate, voucherDate: input.voucherDate };
  }

  it('resuelve --fecha y --fecha-pago, y las claves del JSON', () => {
    expect(datesFromFile({}, ['--fecha', 'ayer', '--fecha-pago', '+1'])).toEqual({
      paymentDate: '01/04/2026',
      voucherDate: '30/03/2026',
    });
    expect(datesFromFile({ fechaComprobante: 'hoy', fechaPago: '+30' })).toEqual({
      paymentDate: '30/04/2026',
      voucherDate: '31/03/2026',
    });
  });

  it('en la E no hay palabras de mes', () => {
    expect(() => datesFromFile({}, ['--fecha-pago', 'mes-pasado'])).toThrow(/valen solo en desde y hasta/);
  });
});
