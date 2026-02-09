import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

export const ResumeTaskHandler: IpcHandler = {
  type: 'resume_task',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.taskId) {
      logger.warn({ data }, 'resume_task: missing taskId');
      return;
    }

    const { getTaskById, updateTask } = await import('../db.js');
    const task = getTaskById(data.taskId);

    if (task && (context.isMain || task.group_folder === context.sourceGroup)) {
      updateTask(data.taskId, { status: 'active' });
      logger.info(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Task resumed via IPC',
      );
    } else {
      logger.warn(
        { taskId: data.taskId, sourceGroup: context.sourceGroup },
        'Unauthorized task resume attempt',
      );
    }
  },
};
