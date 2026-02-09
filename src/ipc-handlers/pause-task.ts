import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

export const PauseTaskHandler: IpcHandler = {
  type: 'pause_task',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.taskId) {
      logger.warn({ data }, 'pause_task: missing taskId');
      return;
    }

    const { getTaskById, updateTask } = await import('../db.js');
    const task = getTaskById(data.taskId);

    if (task && (context.isMain || task.group_folder === context.sourceGroup)) {
      updateTask(data.taskId, { status: 'paused' });
      logger.info(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Task paused via IPC',
      );
    } else {
      logger.warn(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Unauthorized task pause attempt',
      );
    }
  },
};
