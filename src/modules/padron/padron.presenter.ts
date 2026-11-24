import { formatArcaPeriodAsArgentinePeriod } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { DEPRECATED_CUIT_NUMBER } from '../../lib/json/deprecations';
import { sheetPanel } from '../../ui/components';
import { renderKeyValueRows, resolveKeyValueLabelWidth, uiSymbol } from '../../ui/primitives';
import { ivaConditionCode, ivaConditionLabel } from '../billing/arca-codes';

import type { Taxpayer } from './padron';

export interface PadronReport {
  readonly environment: 'produccion' | 'testing';
  readonly taxpayer: Taxpayer;
}

/** Una fila sin valor no se muestra (renderKeyValueRows). */
type Row = readonly [string, string | undefined];

/** Lo que se busca en el padron (nombre, domicilio, IVA) va aunque ARCA no lo informe, y lo dice. */
const NOT_IN_PADRON = 'ARCA no lo informa';

const PERSON_TYPE_LABELS: Record<NonNullable<Taxpayer['personType']>, string> = {
  fisica: 'Persona física',
  juridica: 'Persona jurídica',
};

/** La primera es la principal (`orden` 1 en ARCA); el resto va en el JSON. */
function formatMainActivity(taxpayer: Taxpayer): string {
  const [main, ...others] = taxpayer.activities;
  const more = others.length === 0 ? '' : ` (y ${others.length} más)`;

  return `${main?.description || `Actividad ${main?.id}`}${more}`;
}

/** `E · VENTAS DE COSAS MUEBLES`: la letra separada del tipo de actividad, si se pudo leer. */
function formatMonotributoCategory(taxpayer: Taxpayer, description: string): string {
  const letter = taxpayer.monotributoCategoryLetter;

  if (!letter) return description;

  const activity = description.trim().slice(letter.length).trim();

  return activity ? `${letter} ${uiSymbol('separator')} ${activity}` : letter;
}

/** Filas de la categoria; solo para monotributistas. */
function monotributoRows(taxpayer: Taxpayer): Row[] {
  if (!taxpayer.monotributoCategory) return [];

  const since = taxpayer.monotributoCategorySince;

  return [
    ['Categoría monotributo', formatMonotributoCategory(taxpayer, taxpayer.monotributoCategory)],
    ['Categoría vigente desde', since ? formatArcaPeriodAsArgentinePeriod(since) : undefined],
  ];
}

export function serializePadron(report: PadronReport) {
  const { taxpayer } = report;

  return {
    actividades: taxpayer.activities.map((activity) => ({ descripcion: activity.description, id: activity.id })),
    avisos: taxpayer.notices,
    deprecado: [DEPRECATED_CUIT_NUMBER],
    categoriaMonotributo: taxpayer.monotributoCategory,
    categoriaMonotributoLetra: taxpayer.monotributoCategoryLetter,
    categoriaMonotributoDesde: taxpayer.monotributoCategorySince,
    condicionIva: taxpayer.ivaCondition,
    cuit: taxpayer.cuit,
    domicilio: taxpayer.address,
    entorno: report.environment,
    estadoClave: taxpayer.keyStatus,
    impuestos: taxpayer.taxes.map((tax) => ({ activo: tax.active, descripcion: tax.description, id: tax.id })),
    nombre: taxpayer.name,
    tipoPersona: taxpayer.personType,
  };
}

export function formatPadronAsText(report: PadronReport): string {
  const { taxpayer } = report;
  const activeTaxes = taxpayer.taxes.filter((tax) => tax.active).map((tax) => tax.description);
  const rows: Row[] = [
    ['CUIT', formatCuit(taxpayer.cuit)],
    ['Nombre', taxpayer.name || NOT_IN_PADRON],
    ['Tipo', taxpayer.personType ? PERSON_TYPE_LABELS[taxpayer.personType] : undefined],
    ['Estado', taxpayer.keyStatus || NOT_IN_PADRON],
    ['Domicilio fiscal', taxpayer.address || NOT_IN_PADRON],
    [
      'Condición frente al IVA',
      taxpayer.ivaCondition ? ivaConditionLabel(ivaConditionCode(taxpayer.ivaCondition)) : NOT_IN_PADRON,
    ],
    ...monotributoRows(taxpayer),
    ...(activeTaxes.length > 0 ? [['Impuestos', activeTaxes.join(', ')] as const] : []),
    ...(taxpayer.activities.length > 0 ? [['Actividad principal', formatMainActivity(taxpayer)] as const] : []),
    ...taxpayer.notices.map((notice) => ['Aviso de ARCA', notice] as const),
  ];
  const footer = taxpayer.ivaCondition
    ? `Con \`--cuit ${taxpayer.cuit}\`, ARCLI completa solo el IVA receptor.`
    : 'El padrón no informa la condición IVA: indicala con `--ir` al facturar.';

  return sheetPanel(
    'Padrón de ARCA',
    renderKeyValueRows(rows, { labelWidth: resolveKeyValueLabelWidth('standard', rows) }),
    { footer },
  );
}
