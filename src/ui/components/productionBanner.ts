import { noticePanel } from './noticePanel';

export interface ProductionBannerProps {
  /** El de produccion vencido: "El certificado de producción venció el 20/11/2026." */
  readonly expiredSummary?: string;
  readonly missesCertificate: boolean;
  readonly missesKey: boolean;
  /** `--testing` de `arcli interactivo` le gana a la config: se guardo, pero la sesion sigue en testing. */
  readonly sessionInTesting: boolean;
}

function certificateLine({ expiredSummary, missesCertificate, missesKey }: ProductionBannerProps): string {
  if (missesCertificate && missesKey) return 'Faltan el certificado y la clave de producción.';
  if (missesCertificate) return 'Falta el certificado de producción.';
  if (missesKey) return 'Falta la clave de producción.';

  return expiredSummary ?? 'Se usa el certificado de producción.';
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
        `Los comprobantes que emitas van a tener validez fiscal.\n${certificateLine(props)}`,
      ];

  return noticePanel(message, 'production', 'warning', title);
}
