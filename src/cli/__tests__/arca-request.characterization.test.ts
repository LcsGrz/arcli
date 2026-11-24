import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSoapArca } from '../../services/arca/__tests__/arca-soap.fixture';
import { createProgram } from '../program';

import { answerAssociated, CLIENT_CUIT, CLOCK_CONFIG, sdk, setClock, useClockFixture } from './clock.fixture';

/**
 * La solicitud exacta de cada comprobante (ARQ-4): lo que recibe el SDK y el XML que saldria a ARCA, con el SDK y
 * node-soap de verdad para la llamada que emite y el HTTP reemplazado. Cada caso es un archivo de
 * `__golden__/solicitudes/`: un cambio ahi es un cambio en lo que se le manda a ARCA. Se regeneran con
 * `yarn test src/cli/__tests__/arca-request.characterization.test.ts -u`.
 */

vi.mock('@arcasdk/core', async (original) =>
  (await import('./clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);

const profile = useClockFixture();

let xml: string[] = [];

const envelope = (body: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const WSFE_ANSWER = envelope(
  [
    '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>',
    '<FeCabResp><Cuit>20123456786</Cuit><PtoVta>3</PtoVta><Resultado>A</Resultado></FeCabResp>',
    '<FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><Resultado>A</Resultado>',
    '<Observaciones><Obs><Code>10217</Code><Msg>Aviso</Msg></Obs></Observaciones>',
    '<CAE>76463926585341</CAE><CAEFchVto>20261120</CAEFchVto></FECAEDetResponse></FeDetResp>',
    '<Events><Evt><Code>39</Code><Msg>Evento</Msg></Evt></Events>',
    '</FECAESolicitarResult></FECAESolicitarResponse>',
  ].join(''),
);

const WSFEX_ANSWER = envelope(
  [
    '<FEXAuthorizeResponse xmlns="http://ar.gov.afip.dif.fexv1/"><FEXAuthorizeResult>',
    '<FEXResultAuth><Id>42</Id><Cuit>20123456786</Cuit><Cbte_tipo>19</Cbte_tipo><Punto_vta>3</Punto_vta>',
    '<Cbte_nro>8</Cbte_nro><Cae>76463926585399</Cae><Fch_venc_Cae>20261120</Fch_venc_Cae>',
    '<Fch_cbte>20261110</Fch_cbte><Resultado>A</Resultado><Reproceso>N</Reproceso><Motivos_Obs/></FEXResultAuth>',
    '<FEXErr><ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg></FEXErr>',
    '<FEXEvents><EventCode>0</EventCode><EventMsg>Ok</EventMsg></FEXEvents>',
    '</FEXAuthorizeResult></FEXAuthorizeResponse>',
  ].join(''),
);

beforeEach(async () => {
  const serve = (body: string) => (sent: string) => {
    xml.push(sent);

    return { body };
  };
  const wsfe = await createSoapArca('wsfe', serve(WSFE_ANSWER));
  const wsfex = await createSoapArca('wsfex', serve(WSFEX_ANSWER));

  xml = [];
  sdk.wsfe.createVoucher.mockImplementation((voucher: never) => wsfe.electronicBillingService.createVoucher(voucher));
  sdk.wsfex.authorize.mockImplementation((input: never) => wsfex.wsfexService.authorize(input));
  profile.writeConfig(profile.configWith(profile.healthy, CLOCK_CONFIG));
  // El mediodia de Argentina.
  setClock(new Date('2026-11-10T15:00:00Z'));
});

const CBU = '0110599520000012345678';
const CUIT = ['--cuit', String(CLIENT_CUIT)];
const RI = [...CUIT, '--ir-ri'];
const PERIOD = ['--sd', '01/10/2026', '--sh', '31/10/2026', '--vto', '20/11/2026'];
const FCE = ['-m', '5000000', '--cs', ...RI, '--cbu', CBU];
const over = (shortcut: string) => ['--ac', shortcut, '--apv', '3', '--ar', '12'];
const MONTH = ['--periodo-desde', '01/10/2026', '--periodo-hasta', '31/10/2026'];
const CLIENT = ['--cliente', 'ACME LLC', '--domicilio-cliente', '123 Main St', '--pais-destino', '212'];
const FE = ['fe', ...CLIENT, '-m', '1500', '--item', '001|Servicios|1|1500|unidad'];
const PERMITS = ['--permiso-existente', '--permiso', '26001EC01000123A', '--permiso', '26001EC01000124B'];

const FOR_RI = { DocNro: CLIENT_CUIT, DocTipo: 80, ImpTotal: 5_000_000 };

const CASES: ReadonlyArray<readonly [string, readonly string[], Record<string, unknown>?]> = [
  ['fa', ['fa', '-m', '12100', '--cs', ...RI]],
  [
    'fa-alicuotas',
    [
      ...['fa', '--cp', ...RI, '--alicuota', '21:12100', '--alicuota', '10.5:11050', '--alicuota', '0:500'],
      ...['--exento', '300', '--nogravado', '200,55'],
    ],
  ],
  ['fb-consumidor-final', ['fb', '-m', '12100', '--cs', '--cfinal']],
  ['fb-dni-alicuota', ['fb', '-m', '1105', '--cp', '--dni', '20123456', '--ir-cf', '--alicuota', '10.5']],
  ['fc', ['fc', '-m', '1000', '--cs', '--cfinal']],
  ['fc-productos', ['fc', '-m', '1000,5', '--cp', '--cfinal', '-f', '08/11/2026']],
  ['fc-productos-y-servicios', ['fc', '-m', '1000', '--csp', ...RI, ...PERIOD]],
  ['fc-dolares', ['fc', '-m', '100', '--cs', '--cfinal', '--mda', 'USD']],
  ['fc-dolares-cotizacion', ['fc', '-m', '100', '--cs', '--cfinal', '--mda', 'USD', '--cm', '1500,25']],
  ['fc-misma-moneda', ['fc', '-m', '100', '--cs', '--cfinal', '--mda', 'USD', '--misma-moneda']],
  ['fcea', ['fcea', ...FCE]],
  [
    'fceb-alias-adc',
    [
      ...['fceb', '-m', '5000000', '--cp', ...CUIT, '--ir-se', '--cbu', CBU, '--alias', 'mi.alias'],
      ...['--transferencia', 'adc', '--vto', '30/11/2026'],
    ],
  ],
  ['fcec', ['fcec', ...FCE]],
  ['ra', ['ra', '-m', '12100', '--cs', ...RI]],
  ['rb', ['rb', '-m', '12100', '--cs', '--cfinal']],
  ['rc', ['rc', '-m', '1000', '--cs', '--cfinal']],
  ['nca-asociado', ['nca', '-m', '1210', '--cs', ...RI, ...over('fa')], FOR_RI],
  ['ndb-periodo', ['ndb', '-m', '1210', '--cs', '--cfinal', ...MONTH]],
  ['ncc-asociado-con-fecha', ['ncc', '-m', '100', '--cs', '--cfinal', ...over('fc'), '--afecha', '01/11/2026']],
  ['ncc-periodo', ['ncc', '-m', '100', '--cs', '--cfinal', ...MONTH]],
  ['ncea', ['ncea', '-m', '1000000', '--cs', ...RI, ...over('fcea')], FOR_RI],
  ['ndea-anulacion', ['ndea', '-m', '1000000', '--cs', ...RI, ...over('ncea'), '--anulacion'], FOR_RI],
  ['fe', FE],
  ['fe-pesos', [...FE, '--moneda', 'PES']],
  ['fe-misma-moneda', [...FE, '--misma-moneda', '--fecha-pago', '30/11/2026']],
  ['fe-bienes-permisos', [...FE, '--tipo-expo', '1', '--incoterm', 'FOB', ...PERMITS]],
  ['fe-bienes-sin-permisos', [...FE, '--tipo-expo', '1', '--incoterm', 'FOB', '--incoterms-desc', 'Puerto']],
  [
    'fe-otros-completa',
    [
      ...['fe', ...CLIENT, '-m', '1500', '--tipo-expo', '4', '--id-impositivo', 'TAX-1', '--cuit-pais', '55000002126'],
      ...['--item', '001|Licencia & soporte|2|500|unidad', '--item', '002|Capacitación|1|500|unidad'],
      ...['--forma-pago', 'Cheque', '--observaciones', 'Obs <1>', '--obs-comerciales', 'Obs 2', '--numero', '9'],
      ...['--id-solicitud', '77', '--idioma', '1', '--cotizacion-moneda', '1450,25'],
    ],
  ],
  ['nce', ['nce', '-m', '500', '--ar', '1', '--apv', '3']],
  ['nde', ['nde', '-m', '500', '--ar', '1', '--apv', '3']],
  [
    'nce-bienes-sin-asociado',
    ['nce', ...CLIENT, '-m', '500', '--tipo-expo', '1', '--incoterm', 'FOB', '--moneda', 'PES'],
  ],
];

async function emit(args: readonly string[]): Promise<Record<string, unknown>> {
  await createProgram().parseAsync(['node', 'arcli', ...args, '--emitir', '--json', '--bruto']);

  return JSON.parse(profile.stdout) as Record<string, unknown>;
}

describe('la solicitud que recibe ARCA', () => {
  it.each(CASES.map(([name, args, associated = {}]) => [name, args, associated] as const))(
    '%s',
    async (name, args, associated) => {
      answerAssociated(associated);

      const json = await emit(args);
      const calls = [...sdk.wsfe.createVoucher.mock.calls, ...sdk.wsfex.authorize.mock.calls];

      expect(calls).toHaveLength(1);
      expect(xml).toHaveLength(1);

      const [request] = calls[0] as [Record<string, unknown>];

      // Lo que se muestra en `solicitud` es lo que se mando, con las claves en el mismo orden.
      expect(JSON.stringify(json.solicitud)).toBe(JSON.stringify('Cmp' in request ? request.Cmp : request));

      const text = [
        `$ arcli ${args.join(' ')}`,
        '--- SDK ---',
        JSON.stringify(request, null, 2),
        '--- SOAP ---',
        xml[0]!.replaceAll('><', '>\n<'),
        '',
      ].join('\n');

      await expect(text).toMatchFileSnapshot(`__golden__/solicitudes/${name}.txt`);
    },
  );

  it('un lote: cada solicitud con su número y sus datos', async () => {
    const path = join(profile.configDirectory, 'lote.json');
    const item = { concepto: 'servicios', ivaReceptor: 'consumidor-final', tipoDocumento: 'consumidor-final' };

    writeFileSync(path, JSON.stringify([1000, 2000].map((montoTotal) => ({ ...item, montoTotal }))));
    sdk.wsfe.getLastVoucher.mockResolvedValueOnce({ cbteNro: 41 }).mockResolvedValueOnce({ cbteNro: 42 });
    await emit(['fc', '--cargar', path]);

    expect(sdk.wsfe.createVoucher.mock.calls.map(([request]) => request as unknown)).toMatchObject([
      { CbteDesde: 42, CbteHasta: 42, ImpTotal: 1000 },
      { CbteDesde: 43, CbteHasta: 43, ImpTotal: 2000 },
    ]);
  });
});

describe('la respuesta de ARCA, del XML al JSON', () => {
  it('fc con una observación y un evento', async () => {
    expect(await emit(['fc', '-m', '1000', '--cs', '--cfinal'])).toMatchObject({
      cae: '76463926585341',
      caeVencimiento: '20261120',
      errores: [],
      estado: 'observado',
      eventos: [{ codigo: 39, mensaje: 'Evento' }],
      observaciones: ['Aviso'],
      resultado: 'A',
    });
  });

  it('fe', async () => {
    expect(await emit(FE)).toMatchObject({
      cae: '76463926585399',
      caeVencimiento: '20261120',
      errores: [],
      estado: 'aprobado',
      eventos: [],
      resultado: 'A',
    });
  });
});
