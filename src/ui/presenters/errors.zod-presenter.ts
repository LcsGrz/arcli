import { ZodError } from 'zod';

import { errorPanel } from '../components/errorPanel';
import { renderJson } from '../primitives/renderJson';
import { bold } from '../primitives/text';

const ZOD_PATH_LABELS: Record<string, string> = {
  associatedVoucher: 'comprobante asociado',
  billingDate: 'fecha del comprobante',
  concept: 'concepto',
  currencyCode: 'moneda',
  documentNumber: 'numero de documento',
  documentType: 'tipo de documento',
  dueDay: 'dia de vencimiento',
  exchangeRate: 'cotizacion',
  ivaCondition: 'IVA receptor',
  pointOfSale: 'punto de venta',
  serviceEndDate: 'servicio hasta',
  serviceStartDate: 'servicio desde',
  totalAmount: 'monto',
};

const ZOD_PUBLIC_PATHS: Record<string, string[]> = {
  associatedVoucher: ['comprobanteAsociado'],
  billingDate: ['fechaComprobante'],
  concept: ['concepto'],
  currencyCode: ['codigoMoneda'],
  documentNumber: ['numeroDocumento'],
  documentType: ['tipoDocumento'],
  dueDay: ['dia'],
  exchangeRate: ['cotizacionMoneda'],
  ivaCondition: ['ivaReceptor'],
  pointOfSale: ['puntoVenta'],
  serviceEndDate: ['servicioHasta'],
  serviceStartDate: ['servicioDesde'],
  totalAmount: ['montoTotal'],
};

function formatZodIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'Entrada';
  }

  return path.map((segment) => String(segment)).join('.');
}

function humanizeZodIssue(issue: ZodError['issues'][number]): string {
  const pathKey = formatZodIssuePath(issue.path);
  const label = ZOD_PATH_LABELS[pathKey] ?? pathKey;

  if (issue.code === 'invalid_type' && issue.input === undefined) {
    return `Falta ${label}.`;
  }

  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    if (pathKey === 'totalAmount') {
      return 'El monto debe ser mayor a 0.';
    }

    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} debe ser mayor a ${issue.minimum}.`;
  }

  if (issue.code === 'invalid_value') {
    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} tiene un valor no soportado.`;
  }

  if (issue.code === 'invalid_type') {
    return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} tiene un formato invalido.`;
  }

  return issue.message;
}

function formatPublicIssuePath(path: PropertyKey[]): string[] {
  const pathKey = formatZodIssuePath(path);

  return ZOD_PUBLIC_PATHS[pathKey] ?? path.map((segment) => String(segment));
}

export function formatZodError(error: ZodError, useJson: boolean): string {
  if (useJson) {
    return renderJson({
      codigo: 'INPUT_VALIDATION_ERROR',
      detalles: error.issues.map((issue) => ({
        mensaje: humanizeZodIssue(issue),
        ruta: formatPublicIssuePath(issue.path),
      })),
      error: 'Hay parametros invalidos o incompletos en la entrada.',
    });
  }

  const detailLines = error.issues.map((issue) => {
    const pathKey = formatZodIssuePath(issue.path);
    const label = ZOD_PATH_LABELS[pathKey] ?? pathKey;

    return `${bold(`${label}:`)} ${humanizeZodIssue(issue)}`;
  });

  return errorPanel(
    'Error de entrada',
    'Hay parametros invalidos o incompletos en la entrada.',
    detailLines,
    'Revise los parametros del comando con `ayuda` e intente nuevamente.',
  );
}
