/**
 * Fast Path - Direct Gemini API execution with streaming.
 *
 * Provides a high-performance alternative to container-based execution
 * for simple conversational queries. Features:
 *
 * 1. Context Caching: Caches system prompt + knowledge for 75-90% cost reduction
 * 2. Streaming: Real-time token streaming to Telegram
 * 3. Function Calling: Native Gemini function calling replaces file-based IPC
 *
 * The fast path is used when:
 * - The group has enableFastPath !== false (default: enabled)
 * - The message doesn't contain media that needs container processing
 * - The Gemini API client is available (API key configured)
 *
 * Falls back to container execution when:
 * - Media files are attached (images, voice, documents)
 * - Group explicitly disables fast path
 * - API key is not available
 */

import type { Content } from '@google/genai';

import { FAST_PATH, GEMINI_MODEL, MAIN_GROUP_FOLDER } from './config.js';
import { getOrCreateCache } from './context-cache.js';
import {
  isGeminiClientAvailable,
  streamGenerate,
  generate,
  type StreamChunk,
} from './gemini-client.js';
import {
  buildFunctionDeclarations,
  executeFunctionCall,
  type FunctionCallResult,
} from './gemini-tools.js';
import type { ContainerOutput, ProgressInfo } from './container-runner.js';
import { logger } from './logger.js';
import type { RegisteredGroup, IpcContext } from './types.js';

// ============================================================================
// Eligibility Check
// ============================================================================

/**
 * Determine if a message should use the fast path.
 */
export function isFastPathEligible(
  group: RegisteredGroup,
  hasMedia: boolean,
): boolean {
  // Globally disabled
  if (!FAST_PATH.ENABLED) return false;

  // Group explicitly disabled
  if (group.enableFastPath === false) return false;

  // Media requires container for multi-modal file processing
  if (hasMedia) return false;

  // API client must be available
  if (!isGeminiClientAvailable()) return false;

  return true;
}

// ============================================================================
// Fast Path Execution
// ============================================================================

export interface FastPathInput {
  prompt: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  systemPrompt?: string;
  memoryContext?: string;
  enableWebSearch?: boolean;
}

/**
 * Execute a query via the fast path (direct Gemini API).
 *
 * Returns the same ContainerOutput shape for compatibility with
 * the existing message handler.
 */
export async function runFastPath(
  group: RegisteredGroup,
  input: FastPathInput,
  ipcContext: IpcContext,
  onProgress?: (info: ProgressInfo) => void,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const model = group.geminiModel || GEMINI_MODEL;

  logger.info(
    { group: group.name, model, isMain: input.isMain },
    'Fast path: starting direct API execution',
  );

  try {
    // Build system instruction
    let systemInstruction = input.systemPrompt || '';

    // Add follow-up suggestions instruction if enabled
    if ((group as any).enableFollowUp !== false) {
      systemInstruction += `

After your response, if there are natural follow-up questions the user might ask, suggest 2-3 of them on separate lines at the very end of your response, each prefixed with ">>>" (three greater-than signs). For example:
>>> What are the other options?
>>> Can you explain in more detail?
>>> Show me an example
Only suggest follow-ups when they genuinely add value. Do not suggest them for simple greetings or short answers.`;
    }

    // Try to get or create context cache
    let cachedContent: string | null = null;

    // Fetch knowledge content for caching
    let knowledgeContent = '';
    try {
      const { getDatabase } = await import('./db.js');
      const { getRelevantKnowledge } = await import('./knowledge.js');
      const db = getDatabase();
      // Use the user's prompt to find relevant knowledge
      const queryText = input.prompt.replace(/<[^>]*>/g, '').slice(0, 200);
      knowledgeContent = getRelevantKnowledge(db, queryText, input.groupFolder);
    } catch {
      // Knowledge search may fail if no docs exist
    }

    cachedContent = await getOrCreateCache(
      input.groupFolder,
      model,
      systemInstruction,
      knowledgeContent,
      input.memoryContext,
    );

    // Build content messages
    const contents: Content[] = [
      {
        role: 'user' as const,
        parts: [{ text: input.prompt }],
      },
    ];

    // If we have knowledge but no cache, inject it into the system instruction
    if (knowledgeContent && !cachedContent) {
      systemInstruction += `\n\n[KNOWLEDGE BASE]\n${knowledgeContent}\n[END KNOWLEDGE BASE]`;
    }

    // If we have memory context but no cache, inject it
    if (input.memoryContext && !cachedContent) {
      systemInstruction += `\n\n${input.memoryContext}`;
    }

    // Build tools
    const tools = [
      { functionDeclarations: buildFunctionDeclarations(input.isMain) },
    ];

    // Add web search tool if enabled
    if (input.enableWebSearch !== false) {
      tools.push({ googleSearch: {} } as any);
    }

    // Stream the response
    let fullText = '';
    let promptTokens: number | undefined;
    let responseTokens: number | undefined;
    let lastProgressTime = 0;
    let pendingFunctionCalls: Array<{
      name: string;
      args: Record<string, any>;
    }> = [];

    const streamOptions = {
      model,
      systemInstruction: cachedContent ? undefined : systemInstruction,
      contents,
      tools,
      cachedContent: cachedContent || undefined,
    };

    for await (const chunk of streamGenerate(streamOptions)) {
      // Handle text chunks
      if (chunk.text) {
        fullText += chunk.text;

        // Emit progress with throttling
        if (onProgress) {
          const now = Date.now();
          if (now - lastProgressTime >= FAST_PATH.STREAMING_INTERVAL_MS) {
            lastProgressTime = now;
            onProgress({
              type: 'message',
              content: fullText.slice(0, 100),
              contentDelta: chunk.text,
              contentSnapshot: fullText,
              isComplete: false,
            });
          }
        }
      }

      // Collect function calls
      if (chunk.functionCalls) {
        pendingFunctionCalls.push(...chunk.functionCalls);

        // Notify progress about tool use
        if (onProgress) {
          for (const fc of chunk.functionCalls) {
            onProgress({
              type: 'tool_use',
              toolName: fc.name,
            });
          }
        }
      }

      // Capture usage metadata
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount;
        responseTokens = chunk.usageMetadata.candidatesTokenCount;
      }
    }

    // Handle function calls if any
    if (pendingFunctionCalls.length > 0) {
      const functionResults = await handleFunctionCalls(
        pendingFunctionCalls,
        ipcContext,
        input.groupFolder,
        input.chatJid,
      );

      // Send function results back to model for final response
      const followUpContents: Content[] = [
        ...contents,
        {
          role: 'model' as const,
          parts: pendingFunctionCalls.map((fc) => ({
            functionCall: { name: fc.name, args: fc.args },
          })),
        },
        {
          role: 'user' as const,
          parts: functionResults.map((fr) => ({
            functionResponse: {
              name: fr.name,
              response: fr.response,
            },
          })),
        },
      ];

      // Generate follow-up response (non-streaming for simplicity)
      const followUp = await generate({
        model,
        systemInstruction: cachedContent ? undefined : systemInstruction,
        contents: followUpContents,
        tools,
        cachedContent: cachedContent || undefined,
      });

      if (followUp.text) {
        fullText += followUp.text;
      }

      if (followUp.usageMetadata) {
        promptTokens =
          (promptTokens || 0) + (followUp.usageMetadata.promptTokenCount || 0);
        responseTokens =
          (responseTokens || 0) +
          (followUp.usageMetadata.candidatesTokenCount || 0);
      }
    }

    // Send final completion progress
    if (onProgress && fullText) {
      onProgress({
        type: 'message',
        content: fullText.slice(0, 100),
        contentSnapshot: fullText,
        isComplete: true,
      });
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        group: group.name,
        duration,
        textLength: fullText.length,
        promptTokens,
        responseTokens,
        cached: !!cachedContent,
        functionCalls: pendingFunctionCalls.length,
      },
      'Fast path: completed',
    );

    return {
      status: 'success',
      result: fullText || null,
      promptTokens,
      responseTokens,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    logger.error(
      { group: group.name, duration, err: errorMsg },
      'Fast path: execution error',
    );

    return {
      status: 'error',
      result: null,
      error: `Fast path error: ${errorMsg}`,
    };
  }
}

// ============================================================================
// Function Call Handler
// ============================================================================

async function handleFunctionCalls(
  calls: Array<{ name: string; args: Record<string, any> }>,
  context: IpcContext,
  groupFolder: string,
  chatJid: string,
): Promise<FunctionCallResult[]> {
  const results: FunctionCallResult[] = [];

  for (const call of calls) {
    const result = await executeFunctionCall(
      call.name,
      call.args,
      context,
      groupFolder,
      chatJid,
    );
    results.push(result);
  }

  return results;
}
