import { noticePanel } from './noticePanel';

type CredentialState = 'falta' | 'ilegible' | 'ok';

export interface ProductionBannerProps {
  readonly certificate: CredentialState;
  /** El de produccion vencido: "El certificado de producción venció el 20/11/2026." */
  readonly expiredSummary?: string;
  readonly key: CredentialState;
  /** `--testing` de `arcli interactivo` le gana a la config: se guardo, pero la sesion sigue en testing. */
  readonly sessionInTesting: boolean;
}

const PROBLEM_TEXTS = {
  falta: ['Falta', 'Faltan'],
  ilegible: ['No se pudo leer', 'No se pudieron leer'],
} as const;

function credentialLines({ certificate, expiredSummary, key }: ProductionBannerProps): string[] {
  if (certificate !== 'ok' && certificate === key) {
    return [`${PROBLEM_TEXTS[certificate][1]} el certificado y la clave de producción.`];
  }

  const problems = [
    ...(certificate === 'ok' ? [] : [`${PROBLEM_TEXTS[certificate][0]} el certificado de producción.`]),
    ...(expiredSummary ? [expiredSummary] : []),
    ...(key === 'ok' ? [] : [`${PROBLEM_TEXTS[key][0]} la clave de producción.`]),
  ];

  return problems.length > 0 ? problems : ['Se usa el certificado de producción.'];
}

/** Aviso de que el entorno de la config paso a produccion, en lugar de "Guardado.". */
export function productionBanner(props: ProductionBannerProps): string {
  const [title, message] = props.sessionInTesting
    ? [
        'El entorno guardado es PRODUCCIÓN',
        'Esta sesión sigue en TESTING por `--testing`.\nSin ese flag, los comprobantes que emitas van a tener validez fiscal.',
      ]
    : [
        'Ahora estás en PRODUCCIÓN',
        ['Los comprobantes que emitas van a tener validez fiscal.', ...credentialLines(props)].join('\n'),
      ];

  return noticePanel(message, 'production', 'warning', title);
}
