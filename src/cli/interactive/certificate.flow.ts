import { existsSync, readFileSync, statSync } from 'node:fs';

import { AppError } from '../../lib/errors/app-error';
import { isFileSystemError } from '../../lib/files/file-error';
import { normalizeDroppedPath } from '../../lib/paths/dropped-path';
import {
  formatCertificateStatusAsText,
  formatGeneratedRequestAsText,
  formatImportedCertificateAsText,
} from '../../modules/certificates/certificate.presenter';
import { DEFAULT_CERTIFICATE_ALIAS } from '../../modules/certificates/certificate.service';
import {
  type ArcliEnvironment,
  arcliEnvironmentSchema,
  formatEnvironmentLabel,
} from '../../modules/config/config.schemas';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { noticePanel, uiSymbol, writeTerminalOutput } from '../../ui';
import { withCertificateService } from '../certificate-service';

import { askTextStep, chooseStep, confirm } from './prompts';
import { showAssistantError } from './show-assistant-error';

export type CertificateFlowResult = 'importado' | 'pendiente';

function environmentName(environment: ArcliEnvironment): string {
  const label = formatEnvironmentLabel(environment);

  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

const LATER_NOTICE = `Cuando tengas el .crt, cargalo desde Configuración ${uiSymbol('arrow')} Certificados de ARCA, o con \`arcli certificado importar <archivo>\`. Hasta entonces seguís usando el certificado actual.`;

function validateCertificateFile(value: string): string | true {
  const path = normalizeDroppedPath(value, process.platform);

  if (!path) {
    return 'Indicá la ruta del .crt, o arrastralo a la terminal.';
  }

  return existsSync(path) && statSync(path).isFile() ? true : 'No existe ese archivo.';
}

async function chooseEnvironment(): Promise<ArcliEnvironment | Back> {
  const current = withCertificateService((_service, config) => config.getConfig().entornoPorDefecto);

  return chooseStep(
    '¿Para qué entorno?',
    arcliEnvironmentSchema.options.map((environment) => ({ name: environmentName(environment), value: environment })),
    current,
  );
}

/**
 * Pide el .crt, lo valida y lo configura. Si ya habia otro certificado en ese entorno, pregunta antes de reemplazarlo.
 * Un error (otro CUIT, vencido, otra clave) se muestra y vuelve: nada quedo a medias.
 *
 * @internal Exportado para los tests.
 */
export async function runImportCertificate(): Promise<'importado' | Back> {
  const answer = await askTextStep('Ruta del .crt que bajaste de ARCA (podés arrastrarlo acá):', {
    validate: validateCertificateFile,
  });

  if (answer === BACK) {
    return BACK;
  }

  try {
    const content = readFileSync(normalizeDroppedPath(answer, process.platform), 'utf8');
    let imported;

    try {
      imported = withCertificateService((service) => service.import({ content }));
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'CERTIFICATE_REPLACE_CONFIRMATION') {
        throw error;
      }

      writeTerminalOutput(noticePanel(error.message, 'warning'));

      if (!(await confirm('¿Lo reemplazamos por el nuevo?', 'Sí, reemplazar', 'No, dejar el actual'))) {
        return BACK;
      }

      imported = withCertificateService((service) => service.import({ content, replace: true }));
    }

    writeTerminalOutput(formatImportedCertificateAsText(imported));

    return 'importado';
  } catch (error) {
    if (!(error instanceof AppError) && !isFileSystemError(error)) {
      throw error;
    }

    await showAssistantError(error);

    return BACK;
  }
}

/** Ya hay un pedido sin importar: mostrar su CSR de nuevo, o descartarlo y armar otro. */
async function handlePendingRequest(environment: ArcliEnvironment): Promise<'reemplazar' | 'ver' | Back | undefined> {
  const pendingCsr = withCertificateService((service) => service.readPendingRequest(environment));

  if (!pendingCsr) {
    return undefined;
  }

  const choice = await chooseStep<'reemplazar' | 'ver'>(
    `Ya hay un pedido de ${formatEnvironmentLabel(environment)} sin importar. ¿Qué hacemos?`,
    [
      { description: 'Si ya lo subiste a ARCA, usá este', name: 'Ver el CSR de nuevo', value: 'ver' },
      {
        description: 'El certificado de un CSR anterior ya no va a servir',
        name: 'Descartarlo y armar otro',
        value: 'reemplazar',
      },
    ],
  );

  if (choice === 'ver') {
    writeTerminalOutput(pendingCsr.trim());
  }

  return choice;
}

/**
 * Sacar o renovar un certificado: entorno, alias, la caja de `certificado generar` con el CSR y, si ya se bajo el
 * .crt, cargarlo en el momento. Con `environment` no pregunta el entorno (la configuracion guiada pide testing).
 */
export async function runGenerateCertificate(environment?: ArcliEnvironment): Promise<CertificateFlowResult | Back> {
  const target = environment ?? (await chooseEnvironment());

  if (target === BACK) {
    return BACK;
  }

  const pending = await handlePendingRequest(target);

  if (pending === BACK) {
    return BACK;
  }

  if (pending !== 'ver') {
    const alias = await askTextStep('Nombre del certificado en ARCA (alias):', {
      defaultValue: DEFAULT_CERTIFICATE_ALIAS,
    });

    if (alias === BACK) {
      return BACK;
    }

    const request = withCertificateService((service) =>
      service.generate({ alias, environment: target, replace: pending === 'reemplazar' }),
    );

    writeTerminalOutput(formatGeneratedRequestAsText(request));
  }

  const next = await chooseStep<'despues' | 'importar'>('¿Ya bajaste el certificado (.crt) de ARCA?', [
    { description: 'Lo validamos y queda configurado', name: 'Sí, cargarlo ahora', value: 'importar' },
    { description: 'El pedido queda guardado', name: 'Todavía no, lo cargo después', value: 'despues' },
  ]);

  if (next === 'importar' && (await runImportCertificate()) === 'importado') {
    return 'importado';
  }

  writeTerminalOutput(noticePanel(LATER_NOTICE, 'muted'));

  return 'pendiente';
}

/** Configuracion → Certificados de ARCA: el estado de los dos entornos y que hacer. */
export async function runCertificateMenu(): Promise<void> {
  for (;;) {
    writeTerminalOutput(
      formatCertificateStatusAsText(
        withCertificateService((service) =>
          arcliEnvironmentSchema.options.map((environment) => service.status(environment)),
        ),
        new Date(),
      ),
    );

    const action = await chooseStep<'generar' | 'importar'>('¿Qué querés hacer?', [
      {
        description: 'Arma la clave y el pedido (CSR) para subir a ARCA',
        name: 'Sacar o renovar un certificado',
        value: 'generar',
      },
      { description: 'El que bajaste de ARCA', name: 'Cargar el certificado (.crt)', value: 'importar' },
    ]);

    if (action === BACK) {
      return;
    }

    await (action === 'generar' ? runGenerateCertificate() : runImportCertificate());
  }
}
