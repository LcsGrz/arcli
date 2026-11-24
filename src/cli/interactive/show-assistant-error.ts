import { writeTerminalError, writeTerminalOutput } from '../../ui';
import { isOutputLost, settleOutput } from '../closed-output';
import { formatCliError } from '../error-output';

/** Un error con el que el asistente sigue. Va a stderr y, si ahi se pierde (se sabe un turno despues), a stdout. */
export async function showAssistantError(error: unknown): Promise<void> {
  if (!isOutputLost('stderr')) {
    writeTerminalError(() => formatCliError(error, false));
    await settleOutput('stderr');
  }

  if (isOutputLost('stderr')) {
    writeTerminalOutput(formatCliError(error, false));
  }
}
