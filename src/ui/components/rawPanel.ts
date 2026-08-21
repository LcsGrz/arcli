import { contentPanel } from './contentPanel';

export function rawPanel(title: string, content: string): string {
  return contentPanel(title, content, 'wide', 'info');
}
