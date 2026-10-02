import { noticePanel } from './noticePanel';

/** Banner del entorno de testing. Unico lugar que lo arma, para que el CLI y el storybook no se desfasen. */
export function testingBanner(): string {
  return noticePanel('Estas utilizando el entorno de TESTING', 'warning', 'warning');
}
