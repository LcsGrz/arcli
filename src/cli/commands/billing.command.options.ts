import { type Command, Option } from 'commander';

export function registerBillingOptions(command: Command): void {
  command
    .option('-m, --monto <number>', 'importe total del comprobante', parseFloat)
    .option('-d, --dia <number>', 'dia de vencimiento o referencia del servicio', (value: string) =>
      Number.parseInt(value, 10),
    )
    .option('--punto-venta <number>', 'punto de venta', (value: string) => Number.parseInt(value, 10))
    .option('--pv <number>', 'alias de punto de venta', (value: string) => Number.parseInt(value, 10))
    .option('--cargar <path>', 'cargar datos base desde un archivo JSON')
    .option('-f, --fecha <fecha>', 'fecha del comprobante; acepta D, D/M, D/M/YY o D/M/YYYY con - o /')
    .option('-c, --concepto <tipo>', 'productos, servicios o productos y servicios (alias: cs, cp, csp)')
    .option('--cs', 'usar concepto servicios')
    .option('--cp', 'usar concepto productos')
    .option('--csp', 'usar concepto productos y servicios')
    .option('--moneda <codigo>', 'codigo de moneda, por ejemplo ARS o USD')
    .option('--mda <codigo>', 'alias de moneda, por ejemplo ARS o USD')
    .option('--cm <number>', 'alias de cotizacion de la moneda', parseFloat)
    .option('--cotizacion-moneda <number>', 'cotizacion de la moneda', parseFloat)
    .option('--cuit <number>', 'usar CUIT del receptor', (value: string) => Number.parseInt(value, 10))
    .option('--cuil <number>', 'usar CUIL del receptor', (value: string) => Number.parseInt(value, 10))
    .option('--dni <number>', 'usar DNI del receptor', (value: string) => Number.parseInt(value, 10))
    .option('--consumidor-final', 'usar consumidor final con documento 0')
    .option('--cfinal', 'alias de consumidor final con documento 0')
    .option('--iva-receptor <tipo>', 'condicion IVA del receptor')
    .option('--ir <tipo>', 'alias rapido de condicion IVA del receptor')
    .option('--ir-ce', 'IVA receptor: cliente del exterior')
    .option('--ir-cf', 'IVA receptor: consumidor final')
    .option('--ir-il', 'IVA receptor: IVA liberado')
    .option('--ir-ina', 'IVA receptor: IVA no alcanzado')
    .option('--ir-ms', 'IVA receptor: monotributista social')
    .option('--ir-mtip', 'IVA receptor: monotributo trabajador independiente promovido')
    .option('--ir-pe', 'IVA receptor: proveedor del exterior')
    .option('--ir-ri', 'IVA receptor: responsable inscripto')
    .option('--ir-rm', 'IVA receptor: responsable monotributo')
    .option('--ir-se', 'IVA receptor: sujeto exento')
    .option('--ir-snc', 'IVA receptor: sujeto no categorizado')
    .option('--sd <fecha>', 'alias rapido de fecha de inicio de servicio')
    .option('--servicio-desde <fecha>', 'fecha de inicio de servicio')
    .option('--sh <fecha>', 'alias rapido de fecha de fin de servicio')
    .option('--servicio-hasta <fecha>', 'fecha de fin de servicio')
    .option('--at <number>', 'tipo ARCA del comprobante asociado', (value: string) => Number.parseInt(value, 10))
    .option('--apv <number>', 'punto de venta del comprobante asociado', (value: string) => Number.parseInt(value, 10))
    .option('--asociado-punto-venta <number>', 'punto de venta del comprobante asociado', (value: string) =>
      Number.parseInt(value, 10),
    )
    .option('--ar <number>', 'numero del comprobante asociado', (value: string) => Number.parseInt(value, 10))
    .option('--ac <shortcut>', 'atajo del comprobante asociado, por ejemplo fc o fa')
    .option('--acuit <number>', 'CUIT del comprobante asociado')
    .option('--previsualizar', 'mostrar el payload antes de emitir en ARCA')
    .addOption(new Option('--emitir', 'emitir realmente en ARCA'));
}
