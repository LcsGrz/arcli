import { ZodError } from 'zod';

import { AppError } from '../../lib/errors/app-error';
import { errorPanel } from '../components/errorPanel';
import { renderJson } from '../primitives/renderJson';
import { bold } from '../primitives/text';

import { formatZodError } from './errors.zod-presenter';

function formatErrorTitle(code: string): string {
  switch (code) {
    case 'CONFIGURATION_ERROR':
      return 'Error de configuracion';
    case 'INPUT_VALIDATION_ERROR':
      return 'Error de entrada';
    default:
      return 'Error';
  }
}

function formatErrorHint(error: AppError): string | null {
  switch (error.code) {
    case 'CONFIGURATION_ERROR':
      return 'Revise la configuracion con `arcli config` o corra `arcli config revisar`.';
    case 'INPUT_VALIDATION_ERROR':
      return 'Revise los parametros del comando con `ayuda` e intente nuevamente.';
    default:
      return null;
  }
}

function detectTransientError(message: string): {
  readonly sugerencia: string;
  readonly title: string;
} | null {
  if (message.includes('coe.alreadyAuthenticated')) {
    return {
      sugerencia:
        'WSAA informo que ya existe un TA valido para este servicio. Espere unos segundos y vuelva a intentar sin cambiar el payload.',
      title: 'Error transitorio WSAA',
    };
  }

  if (message.includes('Transacción Activa')) {
    return {
      sugerencia:
        'ARCA devolvio una transaccion activa. Espere unos segundos y reintente la emision antes de modificar datos del comprobante.',
      title: 'Error transitorio ARCA',
    };
  }

  return null;
}

function formatErrorDetails(details: Record<string, unknown> | undefined): string[] {
  if (!details) {
    return [];
  }

  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const label = key === 'path' ? 'Ruta' : key;

      return `${bold(`${label}:`)} ${String(value)}`;
    });
}

function formatErrorDetailsAsJson(details: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!details) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key === 'path' ? 'ruta' : key, value]),
  );
}

export function formatCliError(error: unknown, useJson: boolean): string {
  if (error instanceof ZodError) {
    return formatZodError(error, useJson);
  }

  if (error instanceof AppError) {
    if (useJson) {
      return renderJson({
        codigo: error.code,
        detalles: formatErrorDetailsAsJson(error.details),
        error: error.message,
      });
    }

    const details = formatErrorDetails(error.details);
    const hint = formatErrorHint(error);
    return errorPanel(formatErrorTitle(error.code), error.message, details, hint ?? undefined);
  }

  const message = error instanceof Error ? error.message : 'Ocurrio un error inesperado.';
  const transientError = detectTransientError(message);

  if (useJson) {
    return renderJson({
      codigo: transientError ? 'TRANSIENT_ERROR' : 'UNEXPECTED_ERROR',
      detalles: null,
      error: message,
      sugerencia: transientError?.sugerencia ?? null,
    });
  }

  return errorPanel(
    transientError?.title ?? 'Error inesperado',
    message,
    [],
    transientError?.sugerencia ?? 'Si el problema persiste, revise la configuracion o reintente con mas contexto.',
  );
}
