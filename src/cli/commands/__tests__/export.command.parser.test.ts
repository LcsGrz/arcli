import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EXPORT_VOUCHER_KIND } from '../../../modules/export/export.types';
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

describe('parseExportCommandPlan: PDF', () => {
  it('toma "pdf" del archivo si no hay flags, y los flags le ganan', () => {
    expect(planFromFile({ pdf: true }).pdf).toBe(true);
    expect(planFromFile({ pdf: true }, false, ['--sin-pdf']).pdf).toBe(false);
  });

  it('--exportar-pdf y --sin-pdf a la vez es un error', () => {
    expect(() => planFromFile({}, false, ['--exportar-pdf', '--sin-pdf'])).toThrow(/no ambos a la vez/);
  });
});
