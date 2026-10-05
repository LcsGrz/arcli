// Genera docs/assets/demo/pdf-factura.png con datos ficticios (no consulta ARCA).
// Requiere el plugin de PDF instalado (`arcli pdf instalar`) y macOS (qlmanage) para pasar el PDF a PNG:
//   node --import tsx scripts/demo/pdf-sample.mts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getVoucherKindByShortcut } from '../../src/modules/billing/voucher-kind-map';
import { ConfigService } from '../../src/modules/config/config.service';
import { exportBillingPdf } from '../../src/services/pdf/pdf-exporter';
import { PdfPlugin } from '../../src/services/pdf/pdf-plugin';

const service = new ConfigService();
const pluginPath = process.env.ARCLI_PDF_PLUGIN ?? join(service.getPluginsPath(), 'pdf');
service.close();

const renderer = new PdfPlugin({ path: pluginPath }).load();
const folder = mkdtempSync(join(tmpdir(), 'arcli-pdf-sample-'));
const voucherKind = getVoucherKindByShortcut('fb');

if (!voucherKind) {
  throw new Error('fb');
}

const path = await exportBillingPdf({
  config: {
    cuit: '20111111112',
    emisor: { domicilio: 'Av. Siempreviva 742, CABA', inicioActividades: '20200301', razonSocial: 'Tu Empresa SRL' },
  },
  extras: {
    descripcion: 'Servicios de desarrollo - septiembre',
    receptorDomicilio: 'Calle Falsa 123, CABA',
    receptorNombre: 'Cliente Ejemplo SA',
  },
  folder,
  renderer,
  result: {
    dryRun: false,
    environment: 'produccion',
    payload: {
      CantReg: 1,
      CbteFch: '20261005',
      CbteTipo: 6,
      Concepto: 2,
      CondicionIVAReceptorId: 4,
      DocNro: 30000000007,
      DocTipo: 80,
      FchServDesde: '20260901',
      FchServHasta: '20260930',
      FchVtoPago: '20261015',
      ImpIVA: 26250,
      ImpNeto: 125000,
      ImpOpEx: 0,
      ImpTotConc: 0,
      ImpTotal: 151250,
      ImpTrib: 0,
      Iva: [{ BaseImp: 125000, Id: 5, Importe: 26250 }],
      MonCotiz: 1,
      MonId: 'PES',
      PtoVta: 3,
    },
    response: {
      cae: '76123456789012',
      caeVencimiento: '20261015',
      errors: [],
      events: [],
      observaciones: [],
      observacion: null,
      raw: {
        cae: '76123456789012',
        caeFchVto: '20261015',
        response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 125 }] } },
      },
      resultado: 'A',
      suggestions: [],
      status: 'aprobado',
    },
    voucherKind,
  },
});

execFileSync('qlmanage', ['-t', '-s', '1000', '-o', folder, path], { stdio: 'ignore' });
renameSync(`${path}.png`, 'docs/assets/demo/pdf-factura.png');
console.log('Listo: docs/assets/demo/pdf-factura.png');
