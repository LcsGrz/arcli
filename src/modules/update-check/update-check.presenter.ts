import { noticePanel } from '../../ui';

import type { UpdateCheckResult } from './update-check.service';

export function renderUpdateNoticePanel(result: UpdateCheckResult): string {
  return noticePanel(
    `Nueva version disponible: ${result.latestVersion} (actual: ${result.currentVersion})\n` +
      'Actualiza con: npm install -g arcli@latest',
    'info',
  );
}
