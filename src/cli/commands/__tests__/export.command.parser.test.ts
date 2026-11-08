import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

function planFromFile(content: Record<string, unknown>, defaultEmit = false) {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-export-cli-'));
  const path = join(directory, 'factura-e.json');

  directories.push(directory);
  writeFileSync(path, JSON.stringify({ ...BASE, ...content }));

  const command = new Command();

  registerExportOptions(command);
  command.parse(['node', 'test', '--cargar', path], { from: 'node' });

  const plan = parseExportCommandPlan(command, { defaultEmit });

  return { emit: plan.input.emit, modeSource: plan.modeSource };
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
