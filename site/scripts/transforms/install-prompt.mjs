/** `<!-- arcli: prompt-instalacion -->` y el link de la linea siguiente: el prompt del README, para copiar. */
export function installPrompt(text, { readmePrompt }) {
  return text.replace(/<!-- arcli: prompt-instalacion -->\n+[^\n]*\n/, () => {
    const prompt = readmePrompt();

    return `\`\`\`text title="Prompt" frame="terminal" wrap\n${prompt}\n\`\`\`\n`;
  });
}
