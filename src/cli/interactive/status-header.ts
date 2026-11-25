import { formatCuit } from '../../lib/identity/format-cuit';
import {
  CertificateExpiredError,
  type CertificateExpiryNotice,
  inspectConfiguredCertificates,
} from '../../modules/config/certificate-expiry';
import { type ArcliEnvironment, formatEnvironmentLabel } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { type ArcaHealth, checkArcaHealth } from '../../modules/parameters/health';
import { fetchWsfeServerStatus } from '../../services/arca/wsfe-status';
import {
  noticePanel,
  sanitizeTerminalText,
  statusBar,
  type StatusBarSegment,
  uiSymbol,
  type UiTextColor,
} from '../../ui';
import { renderCertificateNotices } from '../arca-runtime';
import type { GlobalCliOptions } from '../types';

import { type BackgroundQuery, startBackgroundQuery } from './background-query';
import { createInteractiveSession, type InteractiveSession } from './session';

const HEALTH_LABELS: Record<ArcaHealth, readonly [label: string, color: UiTextColor]> = {
  'con-demoras': ['ARCA con demoras', 'warning'],
  'con-problemas': ['ARCA con problemas', 'danger'],
  funcionando: ['ARCA funcionando', 'success'],
  'sin-respuesta': ['ARCA sin respuesta', 'danger'],
};

const HEALTHS = Object.keys(HEALTH_LABELS) as ArcaHealth[];

/** Lo que dice la barra sin el resultado, si ya no se espera. */
const UNVERIFIED = 'ARCA SIN VERIFICAR';

/** La razon social, si es tan larga que no entra en la barra, se corta. */
const MAX_ISSUER_NAME_LENGTH = 32;

/**
 * La barra de estado, y debajo el recuadro de certificados. Se puede seguir escribiendo en su lugar (`text`) hasta que
 * queda en el historial (`settle`): desde ahi, `text` es solo el aviso de un resultado malo que llego despues.
 */
export interface StatusHeader {
  /** Corta la consulta a ARCA: su resultado ya no se muestra. */
  readonly cancel: () => void;
  /** El resultado que la barra no llego a mostrar ya no hace falta avisarlo: se vio en otro lado. */
  readonly dismissResult: () => void;
  /** Todo lo que `text` puede llegar a decir, para saber cuanto lugar ocupa. */
  readonly possibleTexts: () => readonly string[];
  /** La consulta a ARCA, si hay algo que consultar. */
  readonly query?: BackgroundQuery<ArcaHealth>;
  /** Da `text` por ultima vez: lo que queda escrito. */
  readonly settle: () => string;
  /** Si la barra ya quedo en el historial. */
  readonly settled: () => boolean;
  /** Lo que va arriba de la pregunta; vacio, nada. */
  readonly text: () => string;
}

function environmentSegment(environment: ArcliEnvironment): StatusBarSegment {
  return {
    color: environment === 'produccion' ? 'production' : 'testing',
    text: formatEnvironmentLabel(environment).toUpperCase(),
  };
}

/**
 * Recuadro de los certificados por vencer o vencidos, de cualquier entorno, debajo de la barra: queda arriba de
 * todo lo que se haga en la sesion.
 */
function certificateBox(notices: readonly CertificateExpiryNotice[]): string {
  const box = renderCertificateNotices(notices);

  return box ? `\n\n${box}` : '';
}

/**
 * Con el certificado activo vencido la sesion no se crea, asi que los del resto de los entornos se leen aparte de
 * la config. Si no se puede, queda solo el vencido.
 */
function noticesWithExpired(expired: CertificateExpiryNotice): CertificateExpiryNotice[] {
  const service = new ConfigService();

  try {
    const others = inspectConfiguredCertificates(service.getConfig(), {
      activeEnvironment: expired.environment,
      now: new Date(),
    }).filter((notice) => notice.environment !== expired.environment || notice.use !== expired.use);

    return [expired, ...others];
  } catch {
    return [expired];
  } finally {
    service.close();
  }
}

function formatIssuer(businessName: string | undefined, cuit: number): string {
  if (!businessName) {
    return formatCuit(cuit);
  }

  return businessName.length > MAX_ISSUER_NAME_LENGTH
    ? `${businessName.slice(0, MAX_ISSUER_NAME_LENGTH - 1).trimEnd()}${uiSymbol('ellipsis')}`
    : businessName;
}

/** La barra, si no hay nada que consultar. */
function renderWithoutSession(error: unknown): string {
  // Vencido no se consulta ARCA (WSAA lo rechazaria): se dice por que en lugar de "falta configurar".
  if (error instanceof CertificateExpiredError) {
    const bar = statusBar(
      [{ text: 'certificado vencido' }],
      [{ color: 'danger', text: UNVERIFIED }, environmentSegment(error.notice.environment)],
      { rightSeparator: 'rule' },
    );

    return `${bar}${certificateBox(noticesWithExpired(error.notice))}`;
  }

  return statusBar([{ text: 'falta completar la configuración' }], [{ color: 'muted', text: UNVERIFIED }]);
}

function healthSegment(health: ArcaHealth): StatusBarSegment {
  const [label, color] = HEALTH_LABELS[health];

  return { color, text: label.toUpperCase() };
}

/** El aviso de un resultado que la barra ya no puede mostrar, con el margen de `writeTerminalOutput`. */
function renderLateNotice(health: ArcaHealth): string {
  const [label, color] = HEALTH_LABELS[health];

  return `\n${noticePanel(`${label}. Para más detalle, elegí "Estado de ARCA" en el menú.`, color)}`;
}

/**
 * A la izquierda, quien emite (razon social, o el CUIT si no esta configurada) y el punto de venta; a la derecha, como
 * esta ARCA y el entorno, cada uno en su color.
 */
function renderSessionBar({ runtime }: InteractiveSession, arca: StatusBarSegment): string {
  const { config, cuit, environment, pointOfSale } = runtime;

  return statusBar(
    [{ text: formatIssuer(config.emisor?.razonSocial, cuit) }, { text: `PV ${pointOfSale ?? 'sin configurar'}` }],
    [arca, environmentSegment(environment)],
    { rightSeparator: 'rule' },
  );
}

/** Arma la barra y empieza a consultar como esta ARCA. `margin` va antes, por ejemplo una linea en blanco. */
export function openStatusHeader(options: GlobalCliOptions, margin = ''): StatusHeader {
  let session: InteractiveSession | undefined;
  let fixed = '';

  try {
    session = createInteractiveSession(options);
  } catch (error) {
    fixed = renderWithoutSession(error);
  }

  // Una vez: la barra se dibuja con cada tecla y armar el recuadro es lo que mas tarda.
  const box = session ? certificateBox(session.runtime.certificateNotices) : '';
  const environment = session?.runtime.environment;
  const query =
    environment &&
    startBackgroundQuery<ArcaHealth>(
      (signal) =>
        checkArcaHealth({
          gateway: { getServerStatus: () => fetchWsfeServerStatus(environment, signal) },
          now: Date.now,
        }),
      'sin-respuesta',
    );
  const render = (arca: StatusBarSegment): string =>
    sanitizeTerminalText(`${margin}${session ? `${renderSessionBar(session, arca)}${box}` : fixed}`);
  const renderNow = (pending: StatusBarSegment): string => {
    const health = query?.value();

    return render(health ? healthSegment(health) : pending);
  };
  let settled = false;
  // La barra quedo sin el resultado: si despues es malo, se avisa una vez.
  let owesResult = false;

  const lateNotice = (): string => {
    const health = owesResult ? query?.value() : undefined;

    return health && health !== 'funcionando' ? renderLateNotice(health) : '';
  };
  const checking: StatusBarSegment = { color: 'muted', text: 'COMPROBANDO ARCA' };
  const unverified: StatusBarSegment = { color: 'muted', text: UNVERIFIED };

  return {
    cancel: () => query?.cancel(),
    dismissResult: () => {
      owesResult = false;
    },
    possibleTexts: () => {
      if (settled) {
        return owesResult ? HEALTHS.map(renderLateNotice) : [];
      }

      return [checking, unverified, ...HEALTHS.map(healthSegment)].map(render);
    },
    query,
    settle: () => {
      if (settled) {
        const notice = lateNotice();

        owesResult &&= !notice;

        return notice;
      }

      settled = true;
      owesResult = query?.value() === undefined;

      return renderNow(unverified);
    },
    settled: () => settled,
    text: () => (settled ? lateNotice() : renderNow(checking)),
  };
}
