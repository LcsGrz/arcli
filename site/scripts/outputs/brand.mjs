/**
 * El logo ASCII y la version salen del CLI (`renderLogo.ts` y `package.json`), para que la portada muestre lo mismo
 * que la terminal sin copiarlo a mano. Tambien lleva el prompt para instalar con IA (la portada lo copia con un boton)
 * y las estrellas de GitHub.
 */
export function brandData({ installPrompt, logoSource, packageJson, stars }) {
  const block = logoSource.match(/ARCLI_ASCII_BANNER = \[([\s\S]*?)\]\.join/);
  const split = logoSource.match(/ARCLI_BANNER_AR_CLI_SPLIT_COLUMN = (\d+)/);

  if (!block || !split) {
    throw new Error('renderLogo.ts: no encontre ARCLI_ASCII_BANNER o ARCLI_BANNER_AR_CLI_SPLIT_COLUMN.');
  }

  const banner = [...block[1].matchAll(/'([^']*)'/g)].map((match) => match[1].replace(/\s+$/, ''));
  const { version } = JSON.parse(packageJson);

  return { banner, installPrompt, splitColumn: Number(split[1]), stars, version };
}

/** Las estrellas del repo en GitHub; `null` si la API no contesta en 5 segundos (el build no depende de la red). */
export async function githubStars() {
  try {
    const response = await fetch('https://api.github.com/repos/LcsGrz/arcli', { signal: AbortSignal.timeout(5000) });

    return response.ok ? (await response.json()).stargazers_count : null;
  } catch {
    return null;
  }
}
