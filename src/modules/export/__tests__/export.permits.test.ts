import { describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { checkExportPermits } from '../export.permits';
import type { ExportVoucherPayload } from '../export.types';

function payloadWith(permits: readonly string[]): ExportVoucherPayload {
  return {
    ...(permits.length > 0 ? { Permisos: { Permiso: permits.map((id) => ({ Dst_merc: 203, Id_permiso: id })) } } : {}),
  } as ExportVoucherPayload;
}

describe('checkExportPermits', () => {
  it('sin permisos no consulta ARCA', async () => {
    const checkPermit = vi.fn();

    await expect(checkExportPermits(payloadWith([]), { checkPermit })).resolves.toBeUndefined();
    expect(checkPermit).not.toHaveBeenCalled();
  });

  it('consulta cada permiso con su destino y los marca válidos con OK', async () => {
    const checkPermit = vi.fn(async () => 'OK');

    await expect(checkExportPermits(payloadWith(['P1', 'P2']), { checkPermit }, 'BRASIL')).resolves.toEqual({
      checks: [
        { permit: 'P1', status: 'valido' },
        { permit: 'P2', status: 'valido' },
      ],
      warnings: [],
    });
    expect(checkPermit).toHaveBeenNthCalledWith(1, 'P1', 203);
    expect(checkPermit).toHaveBeenNthCalledWith(2, 'P2', 203);
  });

  it('con NO corta con un error de validación que nombra el permiso y el destino', async () => {
    const checkPermit = vi.fn(async (permit: string) => (permit === 'P2' ? 'NO' : 'OK'));
    const result = checkExportPermits(payloadWith(['P1', 'P2']), { checkPermit }, 'BRASIL');

    await expect(result).rejects.toBeInstanceOf(InputValidationError);
    await expect(result).rejects.toMatchObject({
      details: { permisos: ['P2'] },
      message:
        'ARCA dice que el permiso de embarque P2 no es válido para el destino 203 - BRASIL: rechazaría el comprobante.',
    });
  });

  it('varios permisos con NO van juntos, en plural', async () => {
    const checkPermit = vi.fn(async () => 'NO');

    await expect(checkExportPermits(payloadWith(['P1', 'P2']), { checkPermit })).rejects.toThrow(
      'los permisos de embarque P1, P2 no son válidos para el destino 203',
    );
  });

  it('si la consulta falla avisa y sigue: no bloquea la emisión', async () => {
    const checkPermit = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    await expect(checkExportPermits(payloadWith(['P1']), { checkPermit })).resolves.toEqual({
      checks: [{ permit: 'P1', status: 'sin-verificar' }],
      warnings: ['No se pudo verificar el permiso de embarque P1 en ARCA (socket hang up): revisalo antes de emitir.'],
    });
  });

  it('un estado que no es OK ni NO se avisa, sin bloquear', async () => {
    await expect(checkExportPermits(payloadWith(['P1']), { checkPermit: async () => '' })).resolves.toEqual({
      checks: [{ permit: 'P1', status: 'sin-verificar' }],
      warnings: ['ARCA no confirmó el permiso de embarque P1 (respondió sin estado): revisalo antes de emitir.'],
    });
  });

  it('un error y un NO: corta igual por el NO', async () => {
    const checkPermit = vi.fn(async (permit: string) => {
      if (permit === 'P1') {
        throw new Error('timeout');
      }

      return 'NO';
    });

    await expect(checkExportPermits(payloadWith(['P1', 'P2']), { checkPermit })).rejects.toMatchObject({
      details: { permisos: ['P2'] },
    });
  });
});
