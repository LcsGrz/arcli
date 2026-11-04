// Lo carga scripts/demo/setup.sh con --import: reemplaza el CUIT del emisor en todo lo que arcli escribe en la
// terminal, asi las grabaciones no muestran el CUIT real (un certificado de testing siempre es del CUIT de quien
// lo genera). Solo para las demos: arcli no lo usa.
const real = process.env.ARCLI_DEMO_CUIT?.replace(/\D/g, '');
const fake = '20111111112';

if (real?.length === 11) {
  const dashed = (cuit) => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
  const replacements = [
    [dashed(real), dashed(fake)],
    [real, fake],
  ];
  const mask = (text) => replacements.reduce((result, [from, to]) => result.replaceAll(from, to), text);

  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) =>
      write(typeof chunk === 'string' ? mask(chunk) : Buffer.isBuffer(chunk) ? mask(chunk.toString('utf8')) : chunk, ...rest);
  }
}
