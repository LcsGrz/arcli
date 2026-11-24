/** Los valores de commander, sin tipo. */
export type OptionValues = Record<string, unknown>;

export function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

export function pickNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

/** `true` si se escribió; `undefined` si no, para que decida el archivo. */
export function pickSwitch(value: unknown): true | undefined {
  return value === true ? true : undefined;
}
