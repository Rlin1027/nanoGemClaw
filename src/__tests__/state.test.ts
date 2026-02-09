import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  getBot,
  setBot,
  getSessions,
  setSessions,
  getRegisteredGroups,
  setRegisteredGroups,
  getLastAgentTimestamp,
  setLastAgentTimestamp,
  getIpcMessageSentChats,
  getTypingIntervals,
  setTypingInterval,
  clearTypingInterval,
} from '../state.js';

describe('state.ts', () => {
  beforeEach(() => {
    // Clear all state between tests
    setSessions({});
    setRegisteredGroups({});
    setLastAgentTimestamp({});
    // Clear typing intervals
    const intervals = getTypingIntervals();
    for (const [key, interval] of intervals.entries()) {
      clearInterval(interval);
      intervals.delete(key);
    }
    // Clear IPC set
    getIpcMessageSentChats().clear();
  });

  describe('Bot Instance', () => {
    it('should get and set bot instance', () => {
      const mockBot = { id: 'test-bot' } as any;
      setBot(mockBot);
      expect(getBot()).toBe(mockBot);
    });

    it('should replace existing bot instance', () => {
      const bot1 = { id: 'bot1' } as any;
      const bot2 = { id: 'bot2' } as any;
      setBot(bot1);
      setBot(bot2);
      expect(getBot()).toBe(bot2);
    });
  });

  describe('Sessions', () => {
    it('should initialize as empty object', () => {
      expect(getSessions()).toEqual({});
    });

    it('should set and get sessions', () => {
      const sessions = { '123': { lastTimestamp: '2024-01-01' } };
      setSessions(sessions);
      expect(getSessions()).toBe(sessions);
    });

    it('should replace existing sessions', () => {
      setSessions({ '1': { lastTimestamp: '2024-01-01' } });
      const newSessions = { '2': { lastTimestamp: '2024-01-02' } };
      setSessions(newSessions);
      expect(getSessions()).toBe(newSessions);
    });
  });

  describe('Registered Groups', () => {
    it('should initialize as empty object', () => {
      expect(getRegisteredGroups()).toEqual({});
    });

    it('should set and get registered groups', () => {
      const groups = {
        '123': { name: 'Test Group', folder: 'test-group', persona: 'default' },
      };
      setRegisteredGroups(groups);
      expect(getRegisteredGroups()).toBe(groups);
    });

    it('should replace existing groups', () => {
      setRegisteredGroups({ '1': { name: 'G1', folder: 'g1', persona: 'p1' } });
      const newGroups = { '2': { name: 'G2', folder: 'g2', persona: 'p2' } };
      setRegisteredGroups(newGroups);
      expect(getRegisteredGroups()).toBe(newGroups);
    });
  });

  describe('Last Agent Timestamp', () => {
    it('should initialize as empty object', () => {
      expect(getLastAgentTimestamp()).toEqual({});
    });

    it('should set and get last agent timestamp', () => {
      const timestamps = { '123': '2024-01-01T00:00:00Z' };
      setLastAgentTimestamp(timestamps);
      expect(getLastAgentTimestamp()).toBe(timestamps);
    });

    it('should track multiple chat timestamps', () => {
      const timestamps = {
        '1': '2024-01-01T00:00:00Z',
        '2': '2024-01-02T00:00:00Z',
        '3': '2024-01-03T00:00:00Z',
      };
      setLastAgentTimestamp(timestamps);
      expect(getLastAgentTimestamp()).toEqual(timestamps);
    });
  });

  describe('IPC Message Sent Chats', () => {
    it('should return a Set', () => {
      const set = getIpcMessageSentChats();
      expect(set).toBeInstanceOf(Set);
    });

    it('should persist across calls (singleton)', () => {
      const set1 = getIpcMessageSentChats();
      const set2 = getIpcMessageSentChats();
      expect(set1).toBe(set2);
    });

    it('should allow adding and checking values', () => {
      const set = getIpcMessageSentChats();
      set.add('chat-1');
      set.add('chat-2');
      expect(set.has('chat-1')).toBe(true);
      expect(set.has('chat-2')).toBe(true);
      expect(set.has('chat-3')).toBe(false);
    });
  });

  describe('Typing Intervals', () => {
    it('should return a Map', () => {
      const map = getTypingIntervals();
      expect(map).toBeInstanceOf(Map);
    });

    it('should persist across calls (singleton)', () => {
      const map1 = getTypingIntervals();
      const map2 = getTypingIntervals();
      expect(map1).toBe(map2);
    });

    it('should set and retrieve typing interval', () => {
      const interval = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-1', interval);
      const map = getTypingIntervals();
      expect(map.get('chat-1')).toBe(interval);
      clearInterval(interval);
    });

    it('should clear typing interval by chatId', () => {
      const interval = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-1', interval);
      clearTypingInterval('chat-1');
      const map = getTypingIntervals();
      expect(map.has('chat-1')).toBe(false);
    });

    it('should handle clearing non-existent interval gracefully', () => {
      expect(() => clearTypingInterval('non-existent')).not.toThrow();
    });

    it('should enforce MAX_TYPING_ENTRIES cap at 100', () => {
      // Add 100 intervals
      for (let i = 0; i < 100; i++) {
        const interval = setInterval(() => {}, 1000) as NodeJS.Timeout;
        setTypingInterval(`chat-${i}`, interval);
      }
      const map = getTypingIntervals();
      expect(map.size).toBe(100);

      // Adding 101st should evict oldest (chat-0)
      const interval101 = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-100', interval101);
      expect(map.size).toBe(100);
      expect(map.has('chat-0')).toBe(false); // Oldest evicted
      expect(map.has('chat-100')).toBe(true); // New one added

      // Cleanup
      for (const [, interval] of map.entries()) {
        clearInterval(interval);
      }
      map.clear();
    });

    it('should not evict if updating existing chatId', () => {
      // Fill to capacity
      for (let i = 0; i < 100; i++) {
        const interval = setInterval(() => {}, 1000) as NodeJS.Timeout;
        setTypingInterval(`chat-${i}`, interval);
      }

      // Update existing chat-50
      const newInterval = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-50', newInterval);
      const map = getTypingIntervals();
      expect(map.size).toBe(100); // No eviction
      expect(map.has('chat-0')).toBe(true); // Oldest still present
      expect(map.get('chat-50')).toBe(newInterval);

      // Cleanup
      for (const [, interval] of map.entries()) {
        clearInterval(interval);
      }
      map.clear();
    });

    it('should clear old interval when updating existing chatId', () => {
      const interval1 = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-1', interval1);

      const interval2 = setInterval(() => {}, 1000) as NodeJS.Timeout;
      setTypingInterval('chat-1', interval2);

      const map = getTypingIntervals();
      expect(map.get('chat-1')).toBe(interval2);
      expect(map.size).toBe(1);

      clearInterval(interval2);
      map.clear();
    });
  });
});
