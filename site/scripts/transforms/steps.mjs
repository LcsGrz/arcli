/**
 * `<!-- arcli: pasos -->` y despues `### 1. ...`, `### 2. ...` hasta el proximo `##`: en el sitio, pasos numerados con
 * una linea que los une. En GitHub se leen como subtitulos numerados.
 */
export function steps(text) {
  return text.replace(/<!-- arcli: pasos -->\n([\s\S]*?)(?=\n## |$)/g, (_, block) => {
    // Un desplegable de capturas va envuelto, asi su borde no corta la linea que une los pasos.
    const body = block
      .trim()
      .replace(/^### \d+\. /gm, '### ')
      .replace(/^<details>[\s\S]*?^<\/details>/gm, (details) => `<div class="arcli-block">\n\n${details}\n\n</div>`)
      // Los avisos también, para que tengan el mismo espacio arriba y abajo.
      .replace(/^:::\w+(?:\[[^\]]*\])?\n[\s\S]*?^:::$/gm, (aside) => `<div class="arcli-block">\n\n${aside}\n\n</div>`);

    return `<div class="arcli-steps">\n\n${body}\n\n</div>\n`;
  });
}
