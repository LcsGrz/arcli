/** Periodos de servicio para repetir una factura: el mes actual o el anterior, en formato D/MM/YYYY. */
export interface ServicePeriod {
  readonly from: string;
  readonly to: string;
}

function format(value: Date): string {
  return `${value.getDate()}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
}

function monthPeriod(year: number, month: number): ServicePeriod {
  return { from: format(new Date(year, month, 1)), to: format(new Date(year, month + 1, 0)) };
}

export function currentMonthPeriod(today: Date): ServicePeriod {
  return monthPeriod(today.getFullYear(), today.getMonth());
}

export function previousMonthPeriod(today: Date): ServicePeriod {
  return monthPeriod(today.getFullYear(), today.getMonth() - 1);
}
