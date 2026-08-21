import type { UiWidthPreset } from '../../ui';

export interface StorybookShowcaseTheme {
  readonly borderColor: string;
  readonly indexPanelWidth: UiWidthPreset;
  readonly sceneWidth: UiWidthPreset;
}

export const STORYBOOK_SHOWCASE_THEME: StorybookShowcaseTheme = {
  borderColor: 'magenta',
  indexPanelWidth: 'wide',
  sceneWidth: 'wide',
};
