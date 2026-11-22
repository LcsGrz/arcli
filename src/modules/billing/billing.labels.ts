import { formatArcaDateAsArgentineDate } from '../../lib/dates/arca-date';
import { formatCuit } from '../../lib/identity/format-cuit';
import { formatArgentineAmount, formatArgentineMoney, formatExchangeRate } from '../../lib/numbers/argentine-amount';

import { conceptLabel, documentTypeLabel, ivaConditionLabel } from './arca-codes';
import { findArcaCurrency } from './currency-codes';

/*
 * Sin valor, los formatos devuelven `undefined` y `renderKeyValueRows` no muestra la fila. Una fila que tiene que estar
 * igual pone su propio texto ("sin CAE"); nunca "N/D" (docs/design-system.md, Formatos, "Dato ausente").
 */

/** Lo que dice la fila del CAE cuando ARCA no lo otorgo (rechazado): la fila va igual, es lo que se busca. */
export const MISSING_CAE_TEXT = 'sin CAE';

export function formatDateLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{8}$/.test(value)) {
    return formatArcaDateAsArgentineDate(value);
  }

  return value.replaceAll('-', '/');
}

/** Pesos con `$`; otra moneda, con su codigo: `1.500,50 USD`. Acepta el codigo ISO o el de ARCA. */
export function formatMoneyLabel(value: number, currency?: string): string;
export function formatMoneyLabel(value: number | undefined, currency?: string): string | undefined;
export function formatMoneyLabel(value: number | undefined, currency?: string): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  if (!currency) {
    return formatArgentineMoney(value);
  }

  const known = findArcaCurrency(currency);

  return known?.arca === 'PES'
    ? formatArgentineMoney(value)
    : `${formatArgentineAmount(value)} ${known?.iso ?? currency}`;
}

/** Los mensajes de ARCA (`Code`/`Msg` en A, B y C; `code`/`message` en E) como lista; lo que no tiene esa forma, en JSON. */
export function formatArcaMessages(items: readonly unknown[]): string {
  return items
    .map((item, index) => {
      const { Code, Msg, code, message } = (item ?? {}) as Record<string, unknown>;
      const text = Msg ?? message;
      const prefix = `${index + 1}. `;

      if (typeof text !== 'string') {
        return `${prefix}${JSON.stringify(item)}`;
      }

      const number = Code ?? code;

      return `${prefix}${number === undefined ? '' : `${String(number)}: `}${text}`;
    })
    .join('\n');
}

/** Los contadores de la respuesta de ARCA que tienen algo: en cero no dicen nada, y el estado ya va en el pie. */
export function formatResponseCountRows(response: {
  readonly errors: readonly unknown[];
  readonly events: readonly unknown[];
  readonly observaciones: readonly unknown[];
}): Array<readonly [string, number]> {
  const rows: Array<readonly [string, number]> = [
    ['Observaciones', response.observaciones.length],
    ['Eventos', response.events.length],
    ['Errores', response.errors.length],
  ];

  return rows.filter(([, count]) => count > 0);
}

export function formatConceptLabel(value: number | undefined): string | undefined {
  return conceptLabel(value);
}

export function formatDocumentTypeLabel(value: number | undefined): string | undefined {
  return documentTypeLabel(value);
}

export function formatIvaConditionLabel(value: number): string;
export function formatIvaConditionLabel(value: number | undefined): string | undefined;
export function formatIvaConditionLabel(value: number | undefined): string | undefined {
  return ivaConditionLabel(value);
}

/** "Pesos uruguayos (UYU)"; una moneda que no esta en la tabla sale con su codigo. */
export function formatCurrencyLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const currency = findArcaCurrency(value);

  if (!currency) {
    return value;
  }

  return `${currency.name} (${currency.iso ?? currency.arca})`;
}

export function formatNumericLabel(value: number): string;
export function formatNumericLabel(value: number | undefined): string | undefined;
export function formatNumericLabel(value: number | undefined): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  return new Intl.NumberFormat('es-AR').format(value);
}

export function formatTaxIdLabel(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalizedValue = String(value).replace(/\D/g, '');

  if (!/^\d{11}$/.test(normalizedValue)) {
    return String(value);
  }

  return formatCuit(normalizedValue);
}

export function formatDecimalLabel(value: number | undefined): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  return formatExchangeRate(value);
}

const FCE_OPTIONAL_LABELS: Record<string, string> = {
  '22': 'Anulación',
  '27': 'Transferencia',
  '2101': 'CBU',
  '2102': 'Alias CBU',
};

/** La fila de un opcional de FCE (`Opcionales`): la anulacion como `Sí` o `No`, el resto tal cual. Otro, ninguna. */
export function formatFceOptionalRow(id: string, value: string): readonly [string, string] | undefined {
  const label = FCE_OPTIONAL_LABELS[id];

  if (!label) {
    return undefined;
  }

  return [label, id === '22' ? (value === 'S' ? 'Sí' : 'No') : value];
}
