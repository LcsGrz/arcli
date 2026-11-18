import { inlineHtml } from '../lib/markdown.mjs';

/** `<!-- arcli: chat -->` y una cita con **Vos:** y **Tu asistente:**: en el sitio, como una conversación. */
export function chats(text) {
  return text.replace(/<!-- arcli: chat -->\n+((?:>.*\n?)+)/g, (_, quote) => {
    const messages = quote
      .split('\n')
      .map((line) => line.replace(/^>\s?/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^\*\*(Vos|Tu asistente):\*\*\s*(.*)$/);

        return match
          ? `<div class="arcli-msg ${match[1] === 'Vos' ? 'user' : 'bot'}"><span class="who">${match[1]}</span>${inlineHtml(match[2])}</div>`
          : '';
      })
      .join('');

    return `<div class="arcli-chat">${messages}</div>\n`;
  });
}
