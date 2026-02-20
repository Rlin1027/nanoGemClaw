import { vi, describe, it, expect, beforeEach } from 'vitest';

const {
  mockCreateTask,
  mockUpdateTask,
  mockDeleteTask,
  mockSetPreference,
  mockGenerateImage,
  mockLogger,
} = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.ASSISTANT_NAME = 'TestBot';
  return {
    mockCreateTask: vi.fn(),
    mockUpdateTask: vi.fn(),
    mockDeleteTask: vi.fn(),
    mockSetPreference: vi.fn(),
    mockGenerateImage: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('../db.js', () => ({
  createTask: mockCreateTask,
  updateTask: mockUpdateTask,
  deleteTask: mockDeleteTask,
  setPreference: mockSetPreference,
}));

vi.mock('../image-gen.js', () => ({
  generateImage: mockGenerateImage,
}));

vi.mock('../config.js', () => ({
  TIMEZONE: 'UTC',
  GROUPS_DIR: '/tmp/test-groups',
}));

vi.mock('../logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: vi.fn().mockReturnValue({
      next: () => ({
        toISOString: () => '2024-06-15T09:00:00.000Z',
      }),
    }),
  },
}));

import type { IpcContext } from '../types.js';
import {
  buildFunctionDeclarations,
  executeFunctionCall,
} from '../gemini-tools.js';

describe('gemini-tools', () => {
  let mockContext: IpcContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      sourceGroup: 'test-group',
      isMain: false,
      registeredGroups: {},
      sendMessage: vi.fn(),
      bot: {
        sendPhoto: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  // ==========================================================================
  // buildFunctionDeclarations
  // ==========================================================================

  describe('buildFunctionDeclarations', () => {
    it('should return 6 declarations for non-main groups', () => {
      const declarations = buildFunctionDeclarations(false);

      expect(declarations).toHaveLength(6);
      const names = declarations.map((d: any) => d.name);
      expect(names).toContain('schedule_task');
      expect(names).toContain('pause_task');
      expect(names).toContain('resume_task');
      expect(names).toContain('cancel_task');
      expect(names).toContain('generate_image');
      expect(names).toContain('set_preference');
      expect(names).not.toContain('register_group');
    });

    it('should return 7 declarations for main group (includes register_group)', () => {
      const declarations = buildFunctionDeclarations(true);

      expect(declarations).toHaveLength(7);
      const names = declarations.map((d: any) => d.name);
      expect(names).toContain('register_group');
    });

    it('should have correct schema for schedule_task', () => {
      const declarations = buildFunctionDeclarations(false);
      const scheduleTask = declarations.find(
        (d: any) => d.name === 'schedule_task',
      );

      expect(scheduleTask).toBeDefined();
      expect(scheduleTask.parameters.required).toEqual(
        expect.arrayContaining(['prompt', 'schedule_type', 'schedule_value']),
      );
      expect(scheduleTask.parameters.properties.schedule_type.enum).toEqual([
        'cron',
        'interval',
        'once',
      ]);
    });

    it('should have correct schema for set_preference', () => {
      const declarations = buildFunctionDeclarations(false);
      const setPref = declarations.find(
        (d: any) => d.name === 'set_preference',
      );

      expect(setPref).toBeDefined();
      expect(setPref.parameters.properties.key.enum).toEqual([
        'language',
        'nickname',
        'response_style',
        'interests',
        'timezone',
        'custom_instructions',
      ]);
    });
  });

  // ==========================================================================
  // executeFunctionCall — schedule_task
  // ==========================================================================

  describe('executeFunctionCall — schedule_task', () => {
    it('should create a cron task', async () => {
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Check weather daily',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.name).toBe('schedule_task');
      expect(result.response.success).toBe(true);
      expect(result.response.task_id).toMatch(/^task-/);
      expect(result.response.next_run).toBe('2024-06-15T09:00:00.000Z');
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          group_folder: 'test-group',
          chat_jid: 'chat-1',
          prompt: 'Check weather daily',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          context_mode: 'isolated',
          status: 'active',
        }),
      );
    });

    it('should create an interval task', async () => {
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Monitor site',
          schedule_type: 'interval',
          schedule_value: '3600000',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.next_run).toBeDefined();
      expect(mockCreateTask).toHaveBeenCalled();
    });

    it('should reject invalid interval value', async () => {
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Bad task',
          schedule_type: 'interval',
          schedule_value: 'not-a-number',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Invalid interval value');
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('should reject negative interval value', async () => {
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Bad task',
          schedule_type: 'interval',
          schedule_value: '-1000',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Invalid interval value');
    });

    it('should create a one-time task', async () => {
      const futureDate = '2025-12-25T00:00:00Z';
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Christmas greeting',
          schedule_type: 'once',
          schedule_value: futureDate,
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.next_run).toBe(new Date(futureDate).toISOString());
    });

    it('should reject invalid timestamp for once task', async () => {
      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Bad task',
          schedule_type: 'once',
          schedule_value: 'invalid-date',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Invalid timestamp');
    });

    it('should use provided context_mode', async () => {
      await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'Group context task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          context_mode: 'group',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ context_mode: 'group' }),
      );
    });
  });

  // ==========================================================================
  // executeFunctionCall — task lifecycle
  // ==========================================================================

  describe('executeFunctionCall — task lifecycle', () => {
    it('should pause a task', async () => {
      const result = await executeFunctionCall(
        'pause_task',
        { task_id: 'task-123' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.status).toBe('paused');
      expect(mockUpdateTask).toHaveBeenCalledWith('task-123', {
        status: 'paused',
      });
    });

    it('should resume a task', async () => {
      const result = await executeFunctionCall(
        'resume_task',
        { task_id: 'task-123' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.status).toBe('active');
      expect(mockUpdateTask).toHaveBeenCalledWith('task-123', {
        status: 'active',
      });
    });

    it('should cancel a task', async () => {
      const result = await executeFunctionCall(
        'cancel_task',
        { task_id: 'task-123' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.deleted).toBe(true);
      expect(mockDeleteTask).toHaveBeenCalledWith('task-123');
    });
  });

  // ==========================================================================
  // executeFunctionCall — generate_image
  // ==========================================================================

  describe('executeFunctionCall — generate_image', () => {
    it('should generate and send image on success', async () => {
      mockGenerateImage.mockResolvedValue({
        success: true,
        imagePath: '/tmp/test-groups/test-group/media/image.png',
      });

      const result = await executeFunctionCall(
        'generate_image',
        { prompt: 'A futuristic city' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.sent).toBe(true);
      expect(mockGenerateImage).toHaveBeenCalledWith(
        'A futuristic city',
        '/tmp/test-groups/test-group/media',
      );
      expect(mockContext.bot.sendPhoto).toHaveBeenCalledWith(
        'chat-1',
        '/tmp/test-groups/test-group/media/image.png',
        expect.objectContaining({
          caption: expect.stringContaining('A futuristic city'),
        }),
      );
    });

    it('should handle image generation failure', async () => {
      mockGenerateImage.mockResolvedValue({
        success: false,
        error: 'Model error',
      });

      const result = await executeFunctionCall(
        'generate_image',
        { prompt: 'test' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Model error');
    });

    it('should handle missing bot instance', async () => {
      mockGenerateImage.mockResolvedValue({
        success: true,
        imagePath: '/tmp/image.png',
      });

      const noBotContext: IpcContext = {
        ...mockContext,
        bot: undefined,
      };

      const result = await executeFunctionCall(
        'generate_image',
        { prompt: 'test' },
        noBotContext,
        'test-group',
        'chat-1',
      );

      // Image generated but can't be sent (no bot) — code returns
      // success from generateImage but includes fallback error message
      expect(result.response.success).toBe(true);
      expect(result.response.error).toBe('No bot instance available');
    });
  });

  // ==========================================================================
  // executeFunctionCall — set_preference
  // ==========================================================================

  describe('executeFunctionCall — set_preference', () => {
    it('should store a valid preference', async () => {
      const result = await executeFunctionCall(
        'set_preference',
        { key: 'language', value: 'zh-TW' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.key).toBe('language');
      expect(mockSetPreference).toHaveBeenCalledWith(
        'test-group',
        'language',
        'zh-TW',
      );
    });

    it('should reject invalid preference key', async () => {
      const result = await executeFunctionCall(
        'set_preference',
        { key: 'invalid_key', value: 'test' },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toContain('Invalid key');
      expect(mockSetPreference).not.toHaveBeenCalled();
    });

    it('should accept all valid preference keys', async () => {
      const validKeys = [
        'language',
        'nickname',
        'response_style',
        'interests',
        'timezone',
        'custom_instructions',
      ];

      for (const key of validKeys) {
        vi.clearAllMocks();
        const result = await executeFunctionCall(
          'set_preference',
          { key, value: 'test-value' },
          mockContext,
          'test-group',
          'chat-1',
        );
        expect(result.response.success).toBe(true);
        expect(mockSetPreference).toHaveBeenCalledWith(
          'test-group',
          key,
          'test-value',
        );
      }
    });
  });

  // ==========================================================================
  // executeFunctionCall — register_group
  // ==========================================================================

  describe('executeFunctionCall — register_group', () => {
    it('should register a group when called from main', async () => {
      const mockRegisterGroup = vi.fn();
      const mainContext: IpcContext = {
        ...mockContext,
        isMain: true,
        registerGroup: mockRegisterGroup,
      };

      const result = await executeFunctionCall(
        'register_group',
        { chat_id: '-100123456', name: 'New Group' },
        mainContext,
        'main',
        'main-chat',
      );

      expect(result.response.success).toBe(true);
      expect(result.response.chat_id).toBe('-100123456');
      expect(mockRegisterGroup).toHaveBeenCalledWith(
        '-100123456',
        expect.objectContaining({
          name: 'New Group',
          folder: 'new_group',
          trigger: '@TestBot',
        }),
      );
    });

    it('should deny registration from non-main group', async () => {
      const result = await executeFunctionCall(
        'register_group',
        { chat_id: '-100123456', name: 'New Group' },
        mockContext, // isMain: false
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Permission denied');
    });

    it('should handle missing registerGroup function', async () => {
      const mainContext: IpcContext = {
        ...mockContext,
        isMain: true,
        registerGroup: undefined,
      };

      const result = await executeFunctionCall(
        'register_group',
        { chat_id: '-100123456', name: 'Test' },
        mainContext,
        'main',
        'main-chat',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Registrar not available');
    });
  });

  // ==========================================================================
  // executeFunctionCall — error handling
  // ==========================================================================

  describe('executeFunctionCall — error handling', () => {
    it('should return error for unknown function', async () => {
      const result = await executeFunctionCall(
        'unknown_function',
        {},
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toContain('Unknown function');
    });

    it('should handle unexpected errors gracefully', async () => {
      mockCreateTask.mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const result = await executeFunctionCall(
        'schedule_task',
        {
          prompt: 'test',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
        },
        mockContext,
        'test-group',
        'chat-1',
      );

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBe('Function execution failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'schedule_task' }),
        'Function call execution error',
      );
    });
  });
});
