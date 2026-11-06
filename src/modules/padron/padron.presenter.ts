import { formatCuit } from '../../lib/identity/format-cuit';
import { DEPRECATED_CUIT_NUMBER } from '../../lib/json/deprecations';
import { keyValuePanel, renderKeyValueRows, resolveKeyValueLabelWidth } from '../../ui';
import { ivaConditionCode, ivaConditionLabel } from '../billing/arca-codes';

import type { Taxpayer } from './padron';

export interface PadronReport {
  readonly environment: 'produccion' | 'testing';
  readonly taxpayer: Taxpayer;
}

const PERSON_TYPE_LABELS: Record<NonNullable<Taxpayer['personType']>, string> = {
  fisica: 'Persona física',
  juridica: 'Persona jurídica',
};

/** La primera es la principal (`orden` 1 en ARCA); el resto va en el JSON. */
function formatMainActivity(taxpayer: Taxpayer): string {
  const [main, ...others] = taxpayer.activities;
  const more = others.length === 0 ? '' : ` (y ${others.length} más)`;

  return `${main?.description ?? 'N/D'}${more}`;
}

export function formatPadronAsJson(report: PadronReport): string {
  const { taxpayer } = report;

  return JSON.stringify(
    {
      actividades: taxpayer.activities.map((activity) => ({ descripcion: activity.description, id: activity.id })),
      avisos: taxpayer.notices,
      deprecado: [DEPRECATED_CUIT_NUMBER],
      categoriaMonotributo: taxpayer.monotributoCategory,
      condicionIva: taxpayer.ivaCondition,
      cuit: taxpayer.cuit,
      domicilio: taxpayer.address,
      entorno: report.environment,
      estadoClave: taxpayer.keyStatus,
      impuestos: taxpayer.taxes.map((tax) => ({ activo: tax.active, descripcion: tax.description, id: tax.id })),
      nombre: taxpayer.name,
      tipoPersona: taxpayer.personType,
    },
    null,
    2,
  );
}

export function formatPadronAsText(report: PadronReport): string {
  const { taxpayer } = report;
  const activeTaxes = taxpayer.taxes.filter((tax) => tax.active).map((tax) => tax.description);
  const rows: Array<readonly [string, string]> = [
    ['CUIT', formatCuit(taxpayer.cuit)],
    ['Nombre', taxpayer.name ?? 'N/D'],
    ['Tipo', taxpayer.personType ? PERSON_TYPE_LABELS[taxpayer.personType] : 'N/D'],
    ['Estado', taxpayer.keyStatus ?? 'N/D'],
    ['Domicilio fiscal', taxpayer.address ?? 'N/D'],
    [
      'Condición frente al IVA',
      taxpayer.ivaCondition ? ivaConditionLabel(ivaConditionCode(taxpayer.ivaCondition)) : 'N/D',
    ],
    ...(taxpayer.monotributoCategory ? [['Categoría monotributo', taxpayer.monotributoCategory] as const] : []),
    ...(activeTaxes.length > 0 ? [['Impuestos', activeTaxes.join(', ')] as const] : []),
    ...(taxpayer.activities.length > 0 ? [['Actividad principal', formatMainActivity(taxpayer)] as const] : []),
    ...taxpayer.notices.map((notice) => ['Aviso de ARCA', notice] as const),
  ];
  const footer = taxpayer.ivaCondition
    ? `Con --cuit ${taxpayer.cuit}, arcli completa solo el IVA receptor.`
    : 'El padrón no informa la condición IVA: indicala con --ir al facturar.';

  return keyValuePanel(
    'Padrón de ARCA',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows, [25, 75]) }),
    footer,
    'standard',
    undefined,
    'sheet',
  );
}
