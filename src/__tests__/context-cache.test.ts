import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockGeminiClient, mockLogger } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.GEMINI_API_KEY = 'test-key';
  return {
    mockGeminiClient: {
      caches: {
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('../gemini-client.js', () => ({
  getGeminiClient: vi.fn(() => mockGeminiClient),
}));

vi.mock('../config.js', () => ({
  FAST_PATH: {
    ENABLED: true,
    CACHE_TTL_SECONDS: 3600,
    MIN_CACHE_CHARS: 100,
    STREAMING_INTERVAL_MS: 500,
    MAX_HISTORY_MESSAGES: 50,
    TIMEOUT_MS: 5000,
  },
}));

vi.mock('../logger.js', () => ({
  logger: mockLogger,
}));

import { getGeminiClient } from '../gemini-client.js';
import {
  buildCacheableContent,
  getOrCreateCache,
  invalidateCache,
  getCacheStats,
} from '../context-cache.js';

describe('context-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient.caches.create.mockResolvedValue({
      name: 'cachedContents/test-cache-123',
    });
    mockGeminiClient.caches.delete.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // buildCacheableContent
  // ==========================================================================

  describe('buildCacheableContent', () => {
    it('should combine system prompt, knowledge, and memory', () => {
      const result = buildCacheableContent(
        'Be helpful',
        'Doc content',
        'Memory summary',
      );

      expect(result).toContain('[SYSTEM INSTRUCTION]');
      expect(result).toContain('Be helpful');
      expect(result).toContain('[KNOWLEDGE BASE]');
      expect(result).toContain('Doc content');
      expect(result).toContain('Memory summary');
    });

    it('should handle missing knowledge content', () => {
      const result = buildCacheableContent('Be helpful', undefined, 'Memory');

      expect(result).toContain('Be helpful');
      expect(result).not.toContain('[KNOWLEDGE BASE]');
      expect(result).toContain('Memory');
    });

    it('should handle missing memory context', () => {
      const result = buildCacheableContent('Be helpful', 'Knowledge');

      expect(result).toContain('Be helpful');
      expect(result).toContain('Knowledge');
    });

    it('should handle empty system prompt', () => {
      const result = buildCacheableContent('', 'Knowledge', 'Memory');

      expect(result).not.toContain('[SYSTEM INSTRUCTION]');
      expect(result).toContain('Knowledge');
      expect(result).toContain('Memory');
    });

    it('should return empty string when all inputs are empty', () => {
      const result = buildCacheableContent('');
      expect(result).toBe('');
    });
  });

  // ==========================================================================
  // getOrCreateCache
  // ==========================================================================

  describe('getOrCreateCache', () => {
    it('should return null when client is unavailable', async () => {
      vi.mocked(getGeminiClient).mockReturnValueOnce(null);

      const result = await getOrCreateCache(
        'group-no-client',
        'gemini-3-flash-preview',
        'System prompt',
      );

      expect(result).toBeNull();
      expect(mockGeminiClient.caches.create).not.toHaveBeenCalled();
    });

    it('should return null when content is below minimum threshold', async () => {
      const result = await getOrCreateCache(
        'group-small',
        'gemini-3-flash-preview',
        'Short prompt', // Much shorter than MIN_CACHE_CHARS (100)
      );

      expect(result).toBeNull();
      expect(mockGeminiClient.caches.create).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ groupFolder: 'group-small' }),
        'Content below cache threshold, skipping cache',
      );
    });

    it('should create cache and return cache name for large content', async () => {
      const longContent = 'A'.repeat(200);

      const result = await getOrCreateCache(
        'group-large',
        'gemini-3-flash-preview',
        longContent,
      );

      expect(result).toBe('cachedContents/test-cache-123');
      expect(mockGeminiClient.caches.create).toHaveBeenCalledWith({
        model: 'gemini-3-flash-preview',
        config: expect.objectContaining({
          contents: [
            {
              role: 'user',
              parts: [{ text: expect.stringContaining(longContent) }],
            },
          ],
          ttl: '3600s',
          displayName: 'nanoclaw-group-large',
        }),
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ cacheName: 'cachedContents/test-cache-123' }),
        'Context cache created',
      );
    });

    it('should return existing cache when content has not changed', async () => {
      const longContent = 'B'.repeat(200);

      const result1 = await getOrCreateCache(
        'group-cached',
        'gemini-3-flash-preview',
        longContent,
      );
      const result2 = await getOrCreateCache(
        'group-cached',
        'gemini-3-flash-preview',
        longContent,
      );

      expect(result1).toBe('cachedContents/test-cache-123');
      expect(result2).toBe('cachedContents/test-cache-123');
      expect(mockGeminiClient.caches.create).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ cacheName: 'cachedContents/test-cache-123' }),
        'Using existing context cache',
      );
    });

    it('should recreate cache when content changes', async () => {
      const content1 = 'C'.repeat(200);
      const content2 = 'D'.repeat(200);

      mockGeminiClient.caches.create
        .mockResolvedValueOnce({ name: 'cachedContents/cache-v1' })
        .mockResolvedValueOnce({ name: 'cachedContents/cache-v2' });

      const result1 = await getOrCreateCache(
        'group-change',
        'gemini-3-flash-preview',
        content1,
      );
      const result2 = await getOrCreateCache(
        'group-change',
        'gemini-3-flash-preview',
        content2,
      );

      expect(result1).toBe('cachedContents/cache-v1');
      expect(result2).toBe('cachedContents/cache-v2');
      expect(mockGeminiClient.caches.create).toHaveBeenCalledTimes(2);
    });

    it('should recreate cache when model changes', async () => {
      const content = 'E'.repeat(200);

      mockGeminiClient.caches.create
        .mockResolvedValueOnce({ name: 'cachedContents/flash-cache' })
        .mockResolvedValueOnce({ name: 'cachedContents/pro-cache' });

      const result1 = await getOrCreateCache(
        'group-model',
        'gemini-3-flash-preview',
        content,
      );
      const result2 = await getOrCreateCache(
        'group-model',
        'gemini-3-pro-preview',
        content,
      );

      expect(result1).toBe('cachedContents/flash-cache');
      expect(result2).toBe('cachedContents/pro-cache');
      expect(mockGeminiClient.caches.create).toHaveBeenCalledTimes(2);
    });

    it('should handle cache creation error gracefully', async () => {
      mockGeminiClient.caches.create.mockRejectedValueOnce(
        new Error('API error'),
      );

      const result = await getOrCreateCache(
        'group-error',
        'gemini-3-flash-preview',
        'F'.repeat(200),
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ groupFolder: 'group-error' }),
        'Failed to create context cache',
      );
    });

    it('should log debug for "not supported" errors', async () => {
      mockGeminiClient.caches.create.mockRejectedValueOnce(
        new Error('Caching is not supported for this model'),
      );

      const result = await getOrCreateCache(
        'group-unsupported',
        'gemini-3-flash-preview',
        'G'.repeat(200),
      );

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ groupFolder: 'group-unsupported' }),
        'Context caching not available for this request',
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should log debug for "too few tokens" errors', async () => {
      mockGeminiClient.caches.create.mockRejectedValueOnce(
        new Error('Content has too few tokens'),
      );

      const result = await getOrCreateCache(
        'group-toofew',
        'gemini-3-flash-preview',
        'H'.repeat(200),
      );

      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ groupFolder: 'group-toofew' }),
        'Context caching not available for this request',
      );
    });

    it('should return null when cache creation returns no name', async () => {
      mockGeminiClient.caches.create.mockResolvedValueOnce({});

      const result = await getOrCreateCache(
        'group-noname',
        'gemini-3-flash-preview',
        'I'.repeat(200),
      );

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // invalidateCache
  // ==========================================================================

  describe('invalidateCache', () => {
    it('should remove cache from registry and delete from API', async () => {
      // First create a cache
      await getOrCreateCache(
        'group-invalidate',
        'gemini-3-flash-preview',
        'J'.repeat(200),
      );

      const statsBefore = getCacheStats();
      expect(statsBefore.totalCaches).toBeGreaterThan(0);

      invalidateCache('group-invalidate');

      // Verify API delete was called
      expect(mockGeminiClient.caches.delete).toHaveBeenCalledWith({
        name: 'cachedContents/test-cache-123',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { groupFolder: 'group-invalidate' },
        'Context cache invalidated',
      );
    });

    it('should be a noop for non-existent cache', () => {
      invalidateCache('group-nonexistent');

      expect(mockGeminiClient.caches.delete).not.toHaveBeenCalled();
    });

    it('should handle API delete failure gracefully', async () => {
      await getOrCreateCache(
        'group-delfail',
        'gemini-3-flash-preview',
        'K'.repeat(200),
      );

      mockGeminiClient.caches.delete.mockRejectedValueOnce(
        new Error('Delete failed'),
      );

      // Should not throw
      invalidateCache('group-delfail');
    });
  });

  // ==========================================================================
  // getCacheStats
  // ==========================================================================

  describe('getCacheStats', () => {
    it('should return zero counts when no caches exist', () => {
      // Clean slate — use a unique prefix test
      const stats = getCacheStats();
      expect(stats).toHaveProperty('totalCaches');
      expect(stats).toHaveProperty('activeCaches');
      expect(stats).toHaveProperty('entries');
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it('should count active caches correctly', async () => {
      await getOrCreateCache(
        'group-stats-1',
        'gemini-3-flash-preview',
        'L'.repeat(200),
      );

      const stats = getCacheStats();
      const entry = stats.entries.find(
        (e) => e.groupFolder === 'group-stats-1',
      );

      expect(entry).toBeDefined();
      expect(entry!.model).toBe('gemini-3-flash-preview');
      expect(entry!.expiresIn).toBeGreaterThan(0);
      expect(entry!.expiresIn).toBeLessThanOrEqual(3600);
    });

    it('should reflect cache removal after invalidation', async () => {
      await getOrCreateCache(
        'group-stats-rm',
        'gemini-3-flash-preview',
        'M'.repeat(200),
      );

      invalidateCache('group-stats-rm');

      const stats = getCacheStats();
      const entry = stats.entries.find(
        (e) => e.groupFolder === 'group-stats-rm',
      );
      expect(entry).toBeUndefined();
    });
  });
});
