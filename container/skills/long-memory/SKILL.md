---
name: long-memory
description: Enables Gemini's long-context memory by injecting recent conversation archives into the context window.
---

# Long-Context Memory for NanoGemClaw

 This skill modifies the agent runner to automatically load recent archived conversations into Gemini's context window. This leverages Gemini 2.5 Pro's 2M token window to provide deep recall of past interactions without relying on lossy summarization.

## Changes Applied

1. Modifies `container/agent-runner/src/index.ts` to add `loadRecentConversations` function.
2. Updates `buildSystemContext` to include these conversations.

## Implementation Details

The agent will look into `/workspace/group/conversations/` and load the text of the 5 most recent archived chats (configurable).

## Instructions for Agent

Please modify `container/agent-runner/src/index.ts` with the following changes:

### 1. Add `loadRecentConversations` function

Add this function before `buildSystemContext`:

```typescript
function loadRecentConversations(limit: number = 5): string {
  const conversationsDir = '/workspace/group/conversations';
  if (!fs.existsSync(conversationsDir)) return '';

  try {
    const files = fs.readdirSync(conversationsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(conversationsDir, f))
      .map(f => ({ path: f, mtime: fs.statSync(f).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime) // Newest first
      .slice(0, limit);

    if (files.length === 0) return '';

    const archives = files.map(f => {
      const content = fs.readFileSync(f.path, 'utf-8');
      return `--- ARCHIVED CONVERSATION (${path.basename(f.path)}) ---\n${content}\n`;
    }).join('\n');

    return `\n\n=== LONG-TERM MEMORY (Recent Archives) ===\n${archives}\n==========================================\n`;
  } catch (err) {
    log(`Failed to load long-term memory: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}
```

### 2. Update `buildSystemContext`

Locate the `buildSystemContext` function and call `loadRecentConversations` at the beginning, then append it to the returned string.

```typescript
function buildSystemContext(input: ContainerInput): string {
  // ... existing code ...
  
  // Load long-term memory
  const memoryContext = loadRecentConversations(10); // Load last 10 conversations

  return \`You are an AI assistant for NanoGemClaw...
  ...
  Current context:
  - Group: \${groupFolder}
  ...
  \${memoryContext}\`;
}
```
