import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoDir } from './paths.mjs';

/** Lo que abre el plegable del README con el prompt para instalar con IA. */
export const README_PROMPT_SUMMARY = '<summary>Que lo instale tu IA';

/** Anclas del README que tienen su lugar en docs/instalar.md (la pagina "Instalar y configurar"). */
export const README_TO_INSTALL = {
  '': '',
  configuración: 'configurar',
  empezar: 'instalar-a-mano',
  'empezar-sin-saber-de-terminal': 'instalar-a-mano',
  instalación: 'instalar-a-mano',
  'instalar-o-actualizar-con-ia': 'con-un-asistente-de-ia',
};

/** El prompt para instalar o actualizar con IA: el bloque `text` del plegable del README. */
export function installPromptFrom(readme) {
  const start = readme.indexOf(README_PROMPT_SUMMARY);
  const prompt = start === -1 ? undefined : readme.slice(start).match(/```text\n([\s\S]*?)\n```/)?.[1];

  if (!prompt) {
    throw new Error(`README.md: no encontré el prompt de "${README_PROMPT_SUMMARY}".`);
  }

  return prompt;
}

let cached;

/** El prompt del README del repo, leido una sola vez por corrida. */
export function readmeInstallPrompt() {
  cached ??= installPromptFrom(readFileSync(join(repoDir, 'README.md'), 'utf8'));

  return cached;
}
