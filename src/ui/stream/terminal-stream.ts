import { highlightJsonValues } from '../primitives/renderJson';
import { supportsColor } from '../primitives/text';

interface TerminalStreamOptions {
  readonly json?: boolean;
  readonly target?: 'stderr' | 'stdout';
}

export function formatTerminalOutput(content: string, options: TerminalStreamOptions = {}): string {
  const target = options.target ?? 'stdout';
  const renderedContent = options.json && supportsColor(target) ? highlightJsonValues(content, target) : content;

  return `\n${renderedContent}\n\n`;
}

export function writeTerminalOutput(content: string): void {
  process.stdout.write(formatTerminalOutput(content, { target: 'stdout' }));
}

export function writeTerminalJson(content: string): void {
  process.stdout.write(formatTerminalOutput(content, { json: true, target: 'stdout' }));
}

export function writeTerminalError(content: string): void {
  process.stderr.write(formatTerminalOutput(content, { target: 'stderr' }));
}

export function writeTerminalJsonError(content: string): void {
  process.stderr.write(formatTerminalOutput(content, { json: true, target: 'stderr' }));
}
