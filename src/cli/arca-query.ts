import type { Arca } from '@arcasdk/core';
import type { Command } from 'commander';

import { ArcaClientFactory } from '../services/arca/arca-client.factory';
import type { ResolvedArcaRuntime } from '../services/arca/arca-context.resolver';
import type { ArcaExportGateway } from '../services/arca/arca-export.gateway';
import { writeTerminalJson, writeTerminalOutput } from '../ui';

import { resolveArcaRuntime } from './arca-runtime';
import { getGlobalOptions } from './global-options';
import { withSpinner } from './spinner';

/**
 * Lo comun de los comandos que consultan ARCA (`parametros`, `estado`, `ultimos`, `consultar`, `padron`,
 * `fce-obligado`): runtime y cliente, spinner mientras se consulta y salida en texto o JSON. Cada comando valida
 * lo suyo entre `createArcaQuery` y `withQuerySpinner`, asi un error de entrada no muestra el spinner.
 */
export interface ArcaQuery<Gateway> {
  readonly gateway: Gateway;
  readonly runtime: ResolvedArcaRuntime;
}

/** Resuelve el runtime (con el aviso de certificados) y arma el gateway sobre un cliente de ARCA. */
export function createArcaQuery<Gateway>(command: Command, createGateway: (arca: Arca) => Gateway): ArcaQuery<Gateway> {
  const runtime = resolveArcaRuntime(getGlobalOptions(command));

  return { gateway: createGateway(new ArcaClientFactory().create(runtime)), runtime };
}

/** Lo mismo para WSFEX: el gateway de exportacion, con su propio certificado si esta configurado. */
export function createExportQuery(command: Command): ArcaQuery<ArcaExportGateway> {
  const runtime = resolveArcaRuntime(getGlobalOptions(command));

  return { gateway: new ArcaClientFactory().createExportGateway(runtime), runtime };
}

/** Spinner en stderr mientras corre la consulta; con `--json` no hay. Se detiene tambien si la consulta falla. */
export function withQuerySpinner<T>(
  runtime: Pick<ResolvedArcaRuntime, 'outputJson'>,
  run: () => Promise<T>,
  text = 'Consultando ARCA...',
): Promise<T> {
  return withSpinner(runtime.outputJson ? null : text, run);
}

/** Imprime el resultado en JSON o en texto; solo se arma el formato que se imprime. */
export function writeQueryOutput(
  runtime: Pick<ResolvedArcaRuntime, 'outputJson'>,
  output: { readonly json: () => string; readonly text: () => string },
): void {
  if (runtime.outputJson) {
    writeTerminalJson(output.json());

    return;
  }

  writeTerminalOutput(output.text());
}
