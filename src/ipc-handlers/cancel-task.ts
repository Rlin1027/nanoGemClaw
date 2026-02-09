import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

export const CancelTaskHandler: IpcHandler = {
  type: 'cancel_task',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.taskId) {
      logger.warn({ data }, 'cancel_task: missing taskId');
      return;
    }

    const { getTaskById, deleteTask } = await import('../db.js');
    const task = getTaskById(data.taskId);

    if (task && (context.isMain || task.group_folder === context.sourceGroup)) {
      deleteTask(data.taskId);
      logger.info(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Task cancelled via IPC',
      );
    } else {
      logger.warn(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Unauthorized task cancel attempt',
      );
    }
  },
};
