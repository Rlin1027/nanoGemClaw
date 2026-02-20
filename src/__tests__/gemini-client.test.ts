import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { mockModels, mockLogger } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  return {
    mockModels: {
      generateContentStream: vi.fn(),
      generateContent: vi.fn(),
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    models = mockModels;
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

vi.mock('../logger.js', () => ({
  logger: mockLogger,
}));

import {
  resolveApiKey,
  getGeminiClient,
  isGeminiClientAvailable,
  streamGenerate,
  generate,
} from '../gemini-client.js';

describe('gemini-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.GOOGLE_API_KEY;
  });

  // ==========================================================================
  // resolveApiKey
  // ==========================================================================

  describe('resolveApiKey', () => {
    it('should return GEMINI_API_KEY when set', () => {
      process.env.GEMINI_API_KEY = 'my-key';
      expect(resolveApiKey()).toBe('my-key');
    });

    it('should fall back to GOOGLE_API_KEY when GEMINI_API_KEY is not set', () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'google-key';
      expect(resolveApiKey()).toBe('google-key');
    });

    it('should return null when no key is available', () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      expect(resolveApiKey()).toBeNull();
    });

    it('should prefer GEMINI_API_KEY over GOOGLE_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'gemini-key';
      process.env.GOOGLE_API_KEY = 'google-key';
      expect(resolveApiKey()).toBe('gemini-key');
    });
  });

  // ==========================================================================
  // isGeminiClientAvailable
  // ==========================================================================

  describe('isGeminiClientAvailable', () => {
    it('should return true when GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      expect(isGeminiClientAvailable()).toBe(true);
    });

    it('should return true when GOOGLE_API_KEY is set', () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'google-key';
      expect(isGeminiClientAvailable()).toBe(true);
    });

    it('should return false when no key is available', () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      expect(isGeminiClientAvailable()).toBe(false);
    });
  });

  // ==========================================================================
  // getGeminiClient
  // ==========================================================================

  describe('getGeminiClient', () => {
    it('should return a client instance when API key is available', () => {
      const client = getGeminiClient();
      expect(client).not.toBeNull();
    });

    it('should return the same instance on subsequent calls (singleton)', () => {
      const client1 = getGeminiClient();
      const client2 = getGeminiClient();
      expect(client1).toBe(client2);
    });
  });

  // ==========================================================================
  // streamGenerate
  // ==========================================================================

  describe('streamGenerate', () => {
    it('should yield text chunks from the API response', async () => {
      const mockStream = (async function* () {
        yield { text: 'Hello' };
        yield { text: ' world' };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe('Hello');
      expect(chunks[1].text).toBe(' world');
    });

    it('should yield function calls', async () => {
      const mockStream = (async function* () {
        yield {
          functionCalls: [
            { name: 'schedule_task', args: { prompt: 'daily check' } },
          ],
        };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'schedule a task' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].functionCalls).toHaveLength(1);
      expect(chunks[0].functionCalls![0].name).toBe('schedule_task');
      expect(chunks[0].functionCalls![0].args).toEqual({
        prompt: 'daily check',
      });
    });

    it('should handle function calls with null args', async () => {
      const mockStream = (async function* () {
        yield {
          functionCalls: [{ name: 'cancel_task', args: null }],
        };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].functionCalls![0].args).toEqual({});
    });

    it('should yield usage metadata', async () => {
      const mockStream = (async function* () {
        yield {
          text: 'response',
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150,
          },
        };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].usageMetadata).toEqual({
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      });
    });

    it('should handle null values in usage metadata', async () => {
      const mockStream = (async function* () {
        yield {
          usageMetadata: {
            promptTokenCount: null,
            candidatesTokenCount: null,
            totalTokenCount: null,
          },
        };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0].usageMetadata).toEqual({
        promptTokenCount: undefined,
        candidatesTokenCount: undefined,
        totalTokenCount: undefined,
      });
    });

    it('should pass system instruction and tools to the API', async () => {
      const mockStream = (async function* () {
        yield { text: 'ok' };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      // Consume the generator
      for await (const _ of streamGenerate({
        model: 'gemini-3-flash-preview',
        systemInstruction: 'Be helpful',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        tools: [{ functionDeclarations: [] }],
        cachedContent: 'cachedContents/abc123',
      })) {
        // consume
      }

      expect(mockModels.generateContentStream).toHaveBeenCalledWith({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        config: {
          systemInstruction: 'Be helpful',
          tools: [{ functionDeclarations: [] }],
          cachedContent: 'cachedContents/abc123',
        },
      });
    });

    it('should not include undefined config fields', async () => {
      const mockStream = (async function* () {
        yield { text: 'ok' };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      for await (const _ of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        // consume
      }

      const callArgs = mockModels.generateContentStream.mock.calls[0][0];
      expect(callArgs.config).not.toHaveProperty('systemInstruction');
      expect(callArgs.config).not.toHaveProperty('tools');
      expect(callArgs.config).not.toHaveProperty('cachedContent');
    });

    it('should skip empty chunks', async () => {
      const mockStream = (async function* () {
        yield {}; // empty chunk
        yield { text: 'data' };
      })();
      mockModels.generateContentStream.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of streamGenerate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({});
      expect(chunks[1].text).toBe('data');
    });
  });

  // ==========================================================================
  // generate (non-streaming)
  // ==========================================================================

  describe('generate', () => {
    it('should return text from non-streaming response', async () => {
      mockModels.generateContent.mockResolvedValue({
        text: 'Generated response',
      });

      const result = await generate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      expect(result.text).toBe('Generated response');
    });

    it('should return function calls', async () => {
      mockModels.generateContent.mockResolvedValue({
        functionCalls: [{ name: 'generate_image', args: { prompt: 'a cat' } }],
      });

      const result = await generate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'draw a cat' }] }],
      });

      expect(result.functionCalls).toHaveLength(1);
      expect(result.functionCalls![0].name).toBe('generate_image');
      expect(result.functionCalls![0].args).toEqual({ prompt: 'a cat' });
    });

    it('should return usage metadata', async () => {
      mockModels.generateContent.mockResolvedValue({
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 100,
          totalTokenCount: 300,
        },
      });

      const result = await generate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      expect(result.usageMetadata).toEqual({
        promptTokenCount: 200,
        candidatesTokenCount: 100,
        totalTokenCount: 300,
      });
    });

    it('should return empty object when response has no content', async () => {
      mockModels.generateContent.mockResolvedValue({});

      const result = await generate({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      expect(result.text).toBeUndefined();
      expect(result.functionCalls).toBeUndefined();
      expect(result.usageMetadata).toBeUndefined();
    });

    it('should pass config options to the API', async () => {
      mockModels.generateContent.mockResolvedValue({ text: 'ok' });

      await generate({
        model: 'gemini-3-flash-preview',
        systemInstruction: 'Be concise',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        tools: [{ googleSearch: {} }],
      });

      expect(mockModels.generateContent).toHaveBeenCalledWith({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        config: {
          systemInstruction: 'Be concise',
          tools: [{ googleSearch: {} }],
        },
      });
    });
  });
});
