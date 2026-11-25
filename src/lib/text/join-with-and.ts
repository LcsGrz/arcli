/** `a, b y c`; con uno solo, ese. */
export function joinWithAnd(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? '');
}
