import { noticePanel } from './noticePanel';

/** Banner del entorno de testing. Unico lugar que lo arma, para que el CLI y el storybook no se desfasen. */
export function testingBanner(): string {
  return noticePanel(
    'Estás en TESTING: los comprobantes son de prueba y no tienen validez fiscal.',
    'warning',
    'warning',
  );
}
