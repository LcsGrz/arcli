import { InputValidationError } from '../../lib/errors/app-error';
import { errorText } from '../../lib/files/file-error';

import type { ExportGateway, ExportPermitCheck, ExportPermitCheckStatus, ExportVoucherPayload } from './export.types';

/** `Status` de `FEXCheck_Permiso`. */
const PERMIT_VALID_STATUS = 'OK';
const PERMIT_INVALID_STATUS = 'NO';

export interface ExportPermitsCheckResult {
  readonly checks: readonly ExportPermitCheck[];
  readonly warnings: readonly string[];
}

function describeFailure(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? errorText(error).trim().replace(/\.$/, '')
    : 'error desconocido';
}

function mapStatus(status: string): ExportPermitCheckStatus {
  if (status === PERMIT_VALID_STATUS) {
    return 'valido';
  }

  return status === PERMIT_INVALID_STATUS ? 'invalido' : 'sin-verificar';
}

function invalidPermitsError(invalid: readonly string[], countryLabel: string): InputValidationError {
  const list = invalid.join(', ');
  const message =
    invalid.length === 1
      ? `ARCA dice que el permiso de embarque ${list} no es válido para ${countryLabel}: rechazaría el comprobante.`
      : `ARCA dice que los permisos de embarque ${list} no son válidos para ${countryLabel}: rechazaría el comprobante.`;

  return new InputValidationError(
    message,
    { permisos: invalid },
    'Revisá el número en `--permiso` y el país en `--pais-destino`: tienen que coincidir con la destinación de la Aduana.',
  );
}

/**
 * Consulta cada permiso de embarque del `Cmp` con `FEXCheck_Permiso` antes de emitir. Si ARCA contesta `NO` corta
 * con un error de validacion: con ese permiso `FEXAuthorize` rechazaria el comprobante. Si la consulta falla o la
 * respuesta no es `OK` ni `NO`, no se sabe: se avisa y se sigue, para que una caida del servicio no frene la emision.
 */
export async function checkExportPermits(
  payload: ExportVoucherPayload,
  gateway: Pick<ExportGateway, 'checkPermit'>,
  countryName?: string,
): Promise<ExportPermitsCheckResult | undefined> {
  const permits = payload.Permisos?.Permiso ?? [];

  if (permits.length === 0) {
    return undefined;
  }

  const checks: ExportPermitCheck[] = [];
  const warnings: string[] = [];

  for (const permit of permits) {
    try {
      const status = await gateway.checkPermit(permit.Id_permiso, permit.Dst_merc);
      const mapped = mapStatus(status);

      checks.push({ permit: permit.Id_permiso, status: mapped });

      if (mapped === 'sin-verificar') {
        warnings.push(
          `ARCA no confirmó el permiso de embarque ${permit.Id_permiso} (respondió ${status ? `"${status}"` : 'sin estado'}): revisalo antes de emitir.`,
        );
      }
    } catch (error) {
      checks.push({ permit: permit.Id_permiso, status: 'sin-verificar' });
      warnings.push(
        `No se pudo verificar el permiso de embarque ${permit.Id_permiso} en ARCA (${describeFailure(error)}): revisalo antes de emitir.`,
      );
    }
  }

  const invalid = checks.filter((check) => check.status === 'invalido').map((check) => check.permit);

  if (invalid.length > 0) {
    const country = permits[0].Dst_merc;

    throw invalidPermitsError(invalid, `el destino ${countryName ? `${country} - ${countryName}` : country}`);
  }

  return { checks, warnings };
}
