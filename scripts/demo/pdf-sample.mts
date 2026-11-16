// Genera docs/assets/demo/pdf-factura.png con datos ficticios (no consulta ARCA).
// Requiere el plugin de PDF instalado (`arcli pdf instalar`) y macOS (qlmanage) para pasar el PDF a PNG:
//   node --import tsx scripts/demo/pdf-sample.mts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getVoucherKindByShortcut } from '../../src/modules/billing/voucher-kind-map';
import { ConfigService } from '../../src/modules/config/config.service';
import { exportBillingPdf } from '../../src/services/pdf/pdf-exporter';
import { PdfPlugin } from '../../src/services/pdf/pdf-plugin';

const service = new ConfigService();
const pluginPath = process.env.ARCLI_PDF_PLUGIN ?? join(service.getPluginsPath(), 'pdf');
service.close();

const renderer = new PdfPlugin({ path: pluginPath }).load();
const folder = mkdtempSync(join(tmpdir(), 'arcli-pdf-sample-'));
const voucherKind = getVoucherKindByShortcut('fc');

if (!voucherKind) {
  throw new Error('fc');
}

const path = await exportBillingPdf({
  config: {
    cuit: '20111111112',
    emisor: { domicilio: 'Av. Siempreviva 742, CABA', inicioActividades: '20200301', razonSocial: 'Ana Gómez' },
  },
  extras: {
    descripcion: 'Desarrollo de software - octubre',
    
    receptorDomicilio: 'Calle Falsa 123, CABA',
    receptorNombre: 'Juan Pérez',
  },
  folder,
  renderer,
  result: {
    dryRun: false,
    environment: 'produccion',
    payload: {
      CantReg: 1,
      CbteFch: '20261108',
      CbteTipo: 11,
      Concepto: 2,
      CondicionIVAReceptorId: 5,
      DocNro: 0,
      DocTipo: 99,
      FchServDesde: '20261001',
      FchServHasta: '20261031',
      FchVtoPago: '20261118',
      ImpIVA: 0,
      ImpNeto: 15000,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 15000,
      ImpTrib: 0,
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
    },
    response: {
      cae: '86451064378488',
      caeVencimiento: '20261118',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: {
        cae: '86451064378488',
        caeFchVto: '20261118',
        response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 118 }] } },
      },
      resultado: 'A',
      suggestions: [],
      status: 'aprobado',
    },
    voucherKind,
  },
});

// El PDF queda en una subcarpeta por CUIT: qlmanage deja el PNG en la carpeta que se le indica.
execFileSync('qlmanage', ['-t', '-s', '1000', '-o', dirname(path), path], { stdio: 'ignore' });
renameSync(`${path}.png`, 'docs/assets/demo/pdf-factura.png');
console.log('Listo: docs/assets/demo/pdf-factura.png');
