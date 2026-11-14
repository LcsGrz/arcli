/**
 * Version en que aparecio cada opcion del modo interactivo. Mientras arcli este a menos de dos versiones menores de
 * esa, la opcion se marca "(nuevo)" y la marca se apaga sola. Lo que todavia no se publico lleva la proxima version.
 */
export const NEW_OPTION_SINCE = {
  'acceso-directo': '2.4.0',
  autocompletado: '2.2.0',
  certificados: '2.3.0',
  'factura-e': '2.2.0',
  'notas-e': '2.5.0',
  recibo: '2.3.0',
  'repetir-e': '2.5.0',
} as const satisfies Record<string, `${number}.${number}.${number}`>;

export type NewOption = keyof typeof NEW_OPTION_SINCE;

/** Las opciones de Configuracion que tienen marca: el menu principal la marca mientras haya alguna nueva. */
export const CONFIG_MENU_NEW_OPTIONS: readonly NewOption[] = ['certificados', 'autocompletado', 'acceso-directo'];

const NEW_FOR_MINOR_VERSIONS = 2;

// Versiones menores desde 0.0: con un cambio de mayor, todo lo anterior queda lejos.
function minorIndex(version: string): number {
  const [major = 0, minor = 0] = version.split('.').map(Number);

  return major * 1000 + minor;
}

export function isNewOption(option: NewOption, currentVersion: string): boolean {
  return minorIndex(currentVersion) - minorIndex(NEW_OPTION_SINCE[option]) < NEW_FOR_MINOR_VERSIONS;
}

/** Un menu que se mira poco, como Configuracion, lleva la marca mientras tenga alguna opcion nueva adentro. */
export function hasNewOption(options: readonly NewOption[], currentVersion: string): boolean {
  return options.some((option) => isNewOption(option, currentVersion));
}
