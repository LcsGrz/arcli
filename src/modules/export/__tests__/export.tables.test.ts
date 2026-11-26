import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/errors/app-error';
import { QueryCancelledError } from '../../../lib/errors/query-cancelled';
import { createExportTableReader } from '../export.tables';

describe('createExportTableReader', () => {
  it('una tabla no obligatoria que falla en WSFEX sigue sin ella', async () => {
    const error = new AppError('ARCA caido', { code: 'ARCA_EXPORT_ERROR' });

    await expect(
      createExportTableReader().read(async () => {
        throw error;
      }),
    ).resolves.toEqual({ error, ok: false, rows: [] });
  });

  it('una consulta cancelada (Ctrl+C en el asistente) no es una tabla que fallo: sigue de largo', async () => {
    const cancelled = new QueryCancelledError();

    await expect(
      createExportTableReader().read(async () => {
        throw cancelled;
      }),
    ).rejects.toBe(cancelled);
  });
});
