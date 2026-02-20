import { vi, describe, it, expect, beforeEach } from 'vitest';

const {
  mockFastPath,
  mockStreamGenerate,
  mockGetOrCreateCache,
  mockBuildFunctionDeclarations,
  mockExecuteFunctionCall,
  mockIsGeminiClientAvailable,
  mockGetDatabase,
  mockGetRelevantKnowledge,
  mockLogger,
} = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.GEMINI_API_KEY = 'test-key';
  return {
    mockFastPath: {
      ENABLED: true,
      CACHE_TTL_SECONDS: 3600,
      MIN_CACHE_CHARS: 100,
      STREAMING_INTERVAL_MS: 500,
      MAX_HISTORY_MESSAGES: 50,
      TIMEOUT_MS: 5000,
    },
    mockStreamGenerate: vi.fn(),
    mockGetOrCreateCache: vi.fn(),
    mockBuildFunctionDeclarations: vi.fn(),
    mockExecuteFunctionCall: vi.fn(),
    mockIsGeminiClientAvailable: vi.fn(),
    mockGetDatabase: vi.fn(),
    mockGetRelevantKnowledge: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('../config.js', () => ({
  FAST_PATH: mockFastPath,
  GEMINI_MODEL: 'gemini-3-flash-preview',
  MAIN_GROUP_FOLDER: 'main',
}));

vi.mock('../gemini-client.js', () => ({
  isGeminiClientAvailable: mockIsGeminiClientAvailable,
  streamGenerate: mockStreamGenerate,
}));

vi.mock('../context-cache.js', () => ({
  getOrCreateCache: mockGetOrCreateCache,
}));

vi.mock('../gemini-tools.js', () => ({
  buildFunctionDeclarations: mockBuildFunctionDeclarations,
  executeFunctionCall: mockExecuteFunctionCall,
}));

vi.mock('../db.js', () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock('../knowledge.js', () => ({
  getRelevantKnowledge: mockGetRelevantKnowledge,
}));

vi.mock('../logger.js', () => ({
  logger: mockLogger,
}));

import type { RegisteredGroup, IpcContext } from '../types.js';
import { isFastPathEligible, runFastPath } from '../fast-path.js';
import type { FastPathInput } from '../fast-path.js';

describe('fast-path', () => {
  let testGroup: RegisteredGroup;
  let testInput: FastPathInput;
  let testContext: IpcContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mutable config
    mockFastPath.ENABLED = true;
    mockFastPath.TIMEOUT_MS = 5000;

    mockIsGeminiClientAvailable.mockReturnValue(true);
    mockGetOrCreateCache.mockResolvedValue(null);
    mockBuildFunctionDeclarations.mockReturnValue([]);
    mockGetDatabase.mockReturnValue({});
    mockGetRelevantKnowledge.mockReturnValue('');

    testGroup = {
      name: 'Test Group',
      folder: 'test-group',
      trigger: '@TestBot',
      added_at: '2024-01-01T00:00:00Z',
    } as RegisteredGroup;

    testInput = {
      prompt: 'Hello, how are you?',
      groupFolder: 'test-group',
      chatJid: 'chat-123',
      isMain: false,
      systemPrompt: 'You are a helpful assistant',
    };

    testContext = {
      sourceGroup: 'test-group',
      isMain: false,
      registeredGroups: {},
      sendMessage: vi.fn(),
    };
  });

  // ==========================================================================
  // isFastPathEligible
  // ==========================================================================

  describe('isFastPathEligible', () => {
    it('should return true when all conditions are met', () => {
      expect(isFastPathEligible(testGroup, false)).toBe(true);
    });

    it('should return false when globally disabled', () => {
      mockFastPath.ENABLED = false;
      expect(isFastPathEligible(testGroup, false)).toBe(false);
    });

    it('should return false when group explicitly disables fast path', () => {
      const disabledGroup = {
        ...testGroup,
        enableFastPath: false,
      } as RegisteredGroup;
      expect(isFastPathEligible(disabledGroup, false)).toBe(false);
    });

    it('should return true when enableFastPath is undefined (default)', () => {
      expect(testGroup.enableFastPath).toBeUndefined();
      expect(isFastPathEligible(testGroup, false)).toBe(true);
    });

    it('should return false when message has media', () => {
      expect(isFastPathEligible(testGroup, true)).toBe(false);
    });

    it('should return false when Gemini client is unavailable', () => {
      mockIsGeminiClientAvailable.mockReturnValue(false);
      expect(isFastPathEligible(testGroup, false)).toBe(false);
    });
  });

  // ==========================================================================
  // runFastPath — success flows
  // ==========================================================================

  describe('runFastPath — success', () => {
    it('should return successful response with streamed text', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'Hello! ' };
        yield { text: 'I am fine.' };
        yield {
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 20,
          },
        };
      });

      const result = await runFastPath(testGroup, testInput, testContext);

      expect(result.status).toBe('success');
      expect(result.result).toBe('Hello! I am fine.');
      expect(result.promptTokens).toBe(50);
      expect(result.responseTokens).toBe(20);
    });

    it('should emit progress callbacks during streaming', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'chunk1' };
        yield { text: 'chunk2' };
      });

      const progressCalls: any[] = [];
      const onProgress = vi.fn((info: any) => progressCalls.push(info));

      await runFastPath(testGroup, testInput, testContext, onProgress);

      // Should have at least final completion callback
      const completionCall = progressCalls.find((c) => c.isComplete === true);
      expect(completionCall).toBeDefined();
      expect(completionCall.contentSnapshot).toBe('chunk1chunk2');
    });

    it('should use conversation history when provided', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response' };
      });

      testInput.conversationHistory = [
        { role: 'user', text: 'Hi there' },
        { role: 'model', text: 'Hello!' },
      ];

      await runFastPath(testGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      expect(callArgs.contents).toHaveLength(3); // 2 history + 1 current
      expect(callArgs.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'Hi there' }],
      });
      expect(callArgs.contents[1]).toEqual({
        role: 'model',
        parts: [{ text: 'Hello!' }],
      });
    });

    it('should inject knowledge content into user message', async () => {
      mockGetRelevantKnowledge.mockReturnValue('Relevant doc content');
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'answer' };
      });

      await runFastPath(testGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      const lastContent = callArgs.contents[callArgs.contents.length - 1];
      expect(lastContent.parts[0].text).toContain('[RELEVANT KNOWLEDGE]');
      expect(lastContent.parts[0].text).toContain('Relevant doc content');
      expect(lastContent.parts[0].text).toContain(testInput.prompt);
    });

    it('should use cached content when available', async () => {
      mockGetOrCreateCache.mockResolvedValue('cachedContents/abc123');
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'cached response' };
      });

      await runFastPath(testGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      expect(callArgs.cachedContent).toBe('cachedContents/abc123');
      expect(callArgs.systemInstruction).toBeUndefined();
    });

    it('should include system instruction when cache is not used', async () => {
      mockGetOrCreateCache.mockResolvedValue(null);
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response' };
      });

      await runFastPath(testGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      expect(callArgs.cachedContent).toBeUndefined();
      expect(callArgs.systemInstruction).toContain(
        'You are a helpful assistant',
      );
    });

    it('should include web search tool when enabled', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response' };
      });

      testInput.enableWebSearch = true;

      await runFastPath(testGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(2);
    });

    it('should use group model override', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response' };
      });

      const customModelGroup = {
        ...testGroup,
        geminiModel: 'gemini-3-pro-preview',
      } as RegisteredGroup;

      await runFastPath(customModelGroup, testInput, testContext);

      const callArgs = mockStreamGenerate.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-3-pro-preview');
    });

    it('should log completion with metrics', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'done' };
        yield {
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      });

      await runFastPath(testGroup, testInput, testContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          group: 'Test Group',
          textLength: 4,
          promptTokens: 10,
          responseTokens: 5,
        }),
        'Fast path: completed',
      );
    });
  });

  // ==========================================================================
  // runFastPath — function calls
  // ==========================================================================

  describe('runFastPath — function calls', () => {
    it('should handle function calls and stream follow-up', async () => {
      // First stream: text + function call
      const firstStream = (async function* () {
        yield { text: 'Let me schedule that. ' };
        yield {
          functionCalls: [
            {
              name: 'schedule_task',
              args: { prompt: 'daily check', schedule_type: 'cron' },
            },
          ],
        };
      })();

      // Second stream (follow-up after function execution)
      const secondStream = (async function* () {
        yield { text: 'Task scheduled successfully!' };
      })();

      mockStreamGenerate
        .mockReturnValueOnce(firstStream)
        .mockReturnValueOnce(secondStream);

      mockExecuteFunctionCall.mockResolvedValue({
        name: 'schedule_task',
        response: { success: true, task_id: 'task-123' },
      });

      const result = await runFastPath(testGroup, testInput, testContext);

      expect(result.status).toBe('success');
      expect(result.result).toContain('Let me schedule that.');
      expect(result.result).toContain('Task scheduled successfully!');
      expect(mockExecuteFunctionCall).toHaveBeenCalledWith(
        'schedule_task',
        { prompt: 'daily check', schedule_type: 'cron' },
        testContext,
        'test-group',
        'chat-123',
      );
    });

    it('should emit tool_use progress for function calls', async () => {
      const stream = (async function* () {
        yield {
          functionCalls: [{ name: 'generate_image', args: { prompt: 'cat' } }],
        };
      })();

      const followUpStream = (async function* () {
        yield { text: 'Image sent!' };
      })();

      mockStreamGenerate
        .mockReturnValueOnce(stream)
        .mockReturnValueOnce(followUpStream);

      mockExecuteFunctionCall.mockResolvedValue({
        name: 'generate_image',
        response: { success: true },
      });

      const progressCalls: any[] = [];
      await runFastPath(testGroup, testInput, testContext, (info) =>
        progressCalls.push(info),
      );

      const toolUseCall = progressCalls.find((c) => c.type === 'tool_use');
      expect(toolUseCall).toBeDefined();
      expect(toolUseCall.toolName).toBe('generate_image');
    });
  });

  // ==========================================================================
  // runFastPath — error handling
  // ==========================================================================

  describe('runFastPath — error handling', () => {
    it('should return error status on API failure', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        throw new Error('API rate limit exceeded');
      });

      const result = await runFastPath(testGroup, testInput, testContext);

      expect(result.status).toBe('error');
      expect(result.result).toBeNull();
      expect(result.error).toContain('API rate limit exceeded');
    });

    it('should handle timeout', async () => {
      vi.useFakeTimers();
      mockFastPath.TIMEOUT_MS = 100;

      mockStreamGenerate.mockImplementation(async function* () {
        // Simulate a stream that never completes
        await new Promise((resolve) => setTimeout(resolve, 10000));
        yield { text: 'too late' };
      });

      const resultPromise = runFastPath(testGroup, testInput, testContext);

      await vi.advanceTimersByTimeAsync(200);

      const result = await resultPromise;

      expect(result.status).toBe('error');
      expect(result.error).toContain('timed out');

      vi.useRealTimers();
    });

    it('should handle knowledge search failure gracefully', async () => {
      mockGetRelevantKnowledge.mockImplementation(() => {
        throw new Error('FTS5 query error');
      });
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response without knowledge' };
      });

      const result = await runFastPath(testGroup, testInput, testContext);

      // Should succeed despite knowledge search failure
      expect(result.status).toBe('success');
      expect(result.result).toBe('response without knowledge');
    });

    it('should return null result when response is empty', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        // Yield nothing meaningful
      });

      const result = await runFastPath(testGroup, testInput, testContext);

      expect(result.status).toBe('success');
      expect(result.result).toBeNull();
    });

    it('should log error on timeout', async () => {
      vi.useFakeTimers();
      mockFastPath.TIMEOUT_MS = 50;

      mockStreamGenerate.mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        yield { text: 'late' };
      });

      const resultPromise = runFastPath(testGroup, testInput, testContext);
      await vi.advanceTimersByTimeAsync(100);
      await resultPromise;

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          group: 'Test Group',
          err: expect.stringContaining('timed out'),
        }),
        'Fast path: timeout or fatal error',
      );

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // runFastPath — follow-up suggestions
  // ==========================================================================

  describe('runFastPath — follow-up suggestions', () => {
    it('should include follow-up instruction in system prompt by default', async () => {
      mockStreamGenerate.mockImplementation(async function* () {
        yield { text: 'response' };
      });

      await runFastPath(testGroup, testInput, testContext);

      // Verify the system instruction includes follow-up suggestion
      const callArgs = mockStreamGenerate.mock.calls[0][0];
      // When no cache is used, systemInstruction should be in the call
      if (callArgs.systemInstruction) {
        expect(callArgs.systemInstruction).toContain('>>>');
      }
    });
  });
});
