/**
 * Monedas de la tabla de ARCA (`arcli parametros monedas`) con su codigo ISO 4217. Se puede escribir cualquiera de
 * los dos: el ISO es un alias que se traduce al codigo de ARCA antes de enviar. Las que no tienen ISO (`002`, oro)
 * solo se aceptan con el codigo de ARCA, y las que ARCA ya publica con el ISO (`RUB`, `NZD`) no necesitan alias.
 */
export interface ArcaCurrency {
  readonly arca: string;
  readonly iso?: string;
  readonly name: string;
}

export const ARCA_CURRENCIES: readonly ArcaCurrency[] = [
  { arca: 'PES', iso: 'ARS', name: 'Pesos argentinos' },
  { arca: 'DOL', iso: 'USD', name: 'Dólares estadounidenses' },
  { arca: '060', iso: 'EUR', name: 'Euros' },
  { arca: '012', iso: 'BRL', name: 'Reales' },
  { arca: '011', iso: 'UYU', name: 'Pesos uruguayos' },
  { arca: '033', iso: 'CLP', name: 'Pesos chilenos' },
  { arca: '029', iso: 'PYG', name: 'Guaraníes' },
  { arca: '031', iso: 'BOB', name: 'Pesos bolivianos' },
  { arca: '032', iso: 'COP', name: 'Pesos colombianos' },
  { arca: '035', iso: 'PEN', name: 'Soles peruanos' },
  { arca: '010', iso: 'MXN', name: 'Pesos mexicanos' },
  { arca: '021', iso: 'GBP', name: 'Libras esterlinas' },
  { arca: '009', iso: 'CHF', name: 'Francos suizos' },
  { arca: '019', iso: 'JPY', name: 'Yenes' },
  { arca: '064', iso: 'CNY', name: 'Yuanes' },
  { arca: '018', iso: 'CAD', name: 'Dólares canadienses' },
  { arca: '026', iso: 'AUD', name: 'Dólares australianos' },
  { arca: 'NZD', name: 'Dólares neozelandeses' },
  { arca: 'RUB', name: 'Rublos' },
  { arca: '014', iso: 'DKK', name: 'Coronas danesas' },
  { arca: '015', iso: 'NOK', name: 'Coronas noruegas' },
  { arca: '016', iso: 'SEK', name: 'Coronas suecas' },
  { arca: '024', iso: 'CZK', name: 'Coronas checas' },
  { arca: '025', iso: 'RSD', name: 'Dinares serbios' },
  { arca: '040', iso: 'RON', name: 'Leus rumanos' },
  { arca: '056', iso: 'HUF', name: 'Forints' },
  { arca: '061', iso: 'PLN', name: 'Zlotys' },
  { arca: '023', iso: 'VES', name: 'Bolívares venezolanos' },
  { arca: '028', iso: 'ANG', name: 'Florines antillanos' },
  { arca: '042', iso: 'DOP', name: 'Pesos dominicanos' },
  { arca: '043', iso: 'PAB', name: 'Balboas panameños' },
  { arca: '044', iso: 'NIO', name: 'Córdobas nicaragüenses' },
  { arca: '053', iso: 'JMD', name: 'Dólares jamaiquinos' },
  { arca: '055', iso: 'GTQ', name: 'Quetzales' },
  { arca: '063', iso: 'HNL', name: 'Lempiras' },
  { arca: '030', iso: 'ILS', name: 'Shekels' },
  { arca: '034', iso: 'ZAR', name: 'Rands' },
  { arca: '045', iso: 'MAD', name: 'Dirhams marroquíes' },
  { arca: '046', iso: 'EGP', name: 'Libras egipcias' },
  { arca: '047', iso: 'SAR', name: 'Riyales saudíes' },
  { arca: '059', iso: 'KWD', name: 'Dinares kuwaitíes' },
  { arca: '062', iso: 'INR', name: 'Rupias' },
  { arca: '051', iso: 'HKD', name: 'Dólares de Hong Kong' },
  { arca: '052', iso: 'SGD', name: 'Dólares de Singapur' },
  { arca: '054', iso: 'TWD', name: 'Dólares taiwaneses' },
  { arca: '057', iso: 'THB', name: 'Bahts' },
  { arca: '041', iso: 'XDR', name: 'Derechos Especiales de Giro' },
  { arca: '002', name: 'Dólar libre EEUU' },
  { arca: '049', name: 'Gramos de oro fino' },
];

const BY_ARCA_CODE = new Map(ARCA_CURRENCIES.map((currency) => [currency.arca, currency]));
const BY_ISO_CODE = new Map(
  ARCA_CURRENCIES.flatMap((currency) => (currency.iso ? [[currency.iso, currency] as const] : [])),
);

/** Los codigos ISO que se aceptan como alias, en el orden de la tabla (para el autocompletado). */
export const ISO_CURRENCY_ALIASES: readonly string[] = ARCA_CURRENCIES.flatMap((currency) =>
  currency.iso ? [currency.iso] : [],
);

/**
 * El codigo de ARCA de `code`, que puede ser el ISO o el de ARCA. Uno que no esta en la tabla se manda tal cual:
 * ARCA suma monedas y las rechaza ella si no existen.
 */
export function toArcaCurrencyCode(code: string): string {
  const normalized = code.trim().toUpperCase();

  return BY_ISO_CODE.get(normalized)?.arca ?? normalized;
}

/** El ISO de un codigo de ARCA, para mostrarlo; si no tiene, el mismo codigo. */
export function toIsoCurrencyCode(arcaCode: string): string {
  const normalized = arcaCode.trim().toUpperCase();

  return BY_ARCA_CODE.get(normalized)?.iso ?? normalized;
}

export function findArcaCurrency(code: string): ArcaCurrency | undefined {
  return BY_ARCA_CODE.get(toArcaCurrencyCode(code));
}
