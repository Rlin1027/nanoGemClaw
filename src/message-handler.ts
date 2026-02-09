/**
 * Message Handler - Core message processing, admin commands, media handling, and agent execution.
 */
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import {
  ASSISTANT_NAME,
  CLEANUP,
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  TELEGRAM_BOT_TOKEN,
  TRIGGER_PATTERN,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
  type ProgressInfo,
} from './container-runner.js';
import {
  getAllTasks,
  getMessagesSince,
  storeMessage,
} from './db.js';
import { logger } from './logger.js';
import { isMaintenanceMode } from './maintenance.js';
import {
  getBot,
  getRegisteredGroups,
  getSessions,
  getLastAgentTimestamp,
  getIpcMessageSentChats,
} from './state.js';
import {
  sendMessage,
  sendMessageWithButtons,
  setTyping,
  QuickReplyButton,
} from './telegram-helpers.js';
import { getAvailableGroups, saveState } from './group-manager.js';
import { RegisteredGroup } from './types.js';
import { formatError, saveJson } from './utils.js';

// ============================================================================
// Media Handling
// ============================================================================

interface MediaInfo {
  type: 'photo' | 'voice' | 'audio' | 'video' | 'document';
  fileId: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

function extractMediaInfo(msg: TelegramBot.Message): MediaInfo | null {
  if (msg.photo && msg.photo.length > 0) {
    // Get highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    return {
      type: 'photo',
      fileId: photo.file_id,
      caption: msg.caption,
    };
  }
  if (msg.voice) {
    return {
      type: 'voice',
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type,
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type,
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type,
      caption: msg.caption,
    };
  }
  if (msg.document) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      caption: msg.caption,
    };
  }
  return null;
}

async function downloadMedia(
  fileId: string,
  groupFolder: string,
  fileName?: string,
): Promise<string | null> {
  const bot = getBot();
  try {
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo.file_path) return null;

    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    const ext = path.extname(fileInfo.file_path) || '.bin';
    const sanitizedName = path.basename(fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalName = sanitizedName || `${Date.now()}${ext}`;
    const localPath = path.join(mediaDir, finalName);
    // Security: verify path is within mediaDir
    if (!path.resolve(localPath).startsWith(path.resolve(mediaDir))) {
      throw new Error('Invalid file path detected');
    }

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https.get(fileUrl, (response) => {
        // Check for successful HTTP response
        if (response.statusCode !== 200) {
          fs.unlink(localPath, () => { });
          reject(new Error(`HTTP ${response.statusCode}: Failed to download media`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(localPath, () => { });
        reject(err);
      });
    });

    logger.debug({ localPath }, 'Media downloaded');
    return localPath;
  } catch (err) {
    logger.error({ err, fileId }, 'Failed to download media');
    return null;
  }
}

// ============================================================================
// Media Cleanup
// ============================================================================

function cleanupOldMedia(): void {
  const now = Date.now();
  const maxAge = CLEANUP.MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    // Iterate through all group folders
    const groupFolders = fs.readdirSync(GROUPS_DIR);
    for (const folder of groupFolders) {
      const mediaDir = path.join(GROUPS_DIR, folder, 'media');
      if (!fs.existsSync(mediaDir)) continue;

      const files = fs.readdirSync(mediaDir);
      for (const file of files) {
        const filePath = path.join(mediaDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {
          // Ignore individual file errors
        }
      }
    }

    if (deletedCount > 0) {
      logger.info({ deletedCount }, 'Old media files cleaned up');
    }
  } catch (err) {
    logger.error({ err: formatError(err) }, 'Error during media cleanup');
  }
}

export function startMediaCleanupScheduler(): void {
  // Run immediately on startup
  cleanupOldMedia();
  // Then run periodically
  setInterval(cleanupOldMedia, CLEANUP.MEDIA_CLEANUP_INTERVAL_MS);
  logger.info({ intervalHours: CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS }, 'Media cleanup scheduler started');
}

// ============================================================================
// Admin Commands (Main Group Only)
// ============================================================================

const ADMIN_COMMANDS = {
  stats: 'Show usage statistics',
  groups: 'List all registered groups',
  tasks: 'List all scheduled tasks',
  help: 'Show available admin commands',
  errors: 'Show groups with recent errors',
  report: 'Generate daily usage report',
  language: 'Switch language (zh-TW/en)',
  persona: 'Set persona for a group (list/set)',
  trigger: 'Toggle @trigger requirement for a group (on/off)',
  export: 'Export conversation history for a group',
} as const;

async function handleAdminCommand(
  command: string,
  args: string[],
): Promise<string> {
  const { getAllTasks, getUsageStats, getAllErrorStates } = await import('./db.js');
  const { t, setLanguage, availableLanguages, getLanguage } = await import('./i18n.js');
  type Language = import('./i18n.js').Language;
  const { PERSONAS, getAllPersonas } = await import('./personas.js');

  const registeredGroups = getRegisteredGroups();

  switch (command) {
    case 'persona': {
      const subCmd = args[0];

      if (subCmd === 'list') {
        const allPersonas = getAllPersonas();
        return `\ud83c\udfad **Available Personas**\n\n${Object.entries(allPersonas)
          .map(([key, p]) => `\u2022 \`${key}\`: ${p.name} - ${p.description}`)
          .join('\n')}`;
      }

      if (subCmd === 'set' && args[1] && args[2]) {
        const targetGroup = args[1]; // folder name or 'main'
        const key = args[2];

        let targetId: string | undefined;
        // Resolve group folder
        for (const [id, g] of Object.entries(registeredGroups)) {
          if (g.folder === targetGroup || g.name === targetGroup) {
            targetId = id;
            break;
          }
        }

        if (!targetId) {
          return `\u274c Group not found: ${targetGroup}`;
        }

        const allPersonas = getAllPersonas();
        if (!allPersonas[key]) {
          return `\u274c Invalid persona key: ${key}. Use \`/admin persona list\``;
        }

        registeredGroups[targetId].persona = key;
        saveState();
        return `\u2705 Persona for **${registeredGroups[targetId].name}** set to **${allPersonas[key].name}**`;
      }

      return 'Usage: `/admin persona list` or `/admin persona set <group_folder> <persona_key>`';
    }

    case 'trigger': {
      const targetGroup = args[0];
      const mode = args[1]?.toLowerCase();

      if (!targetGroup || !mode || !['on', 'off'].includes(mode)) {
        return 'Usage: `/admin trigger <group_folder> on|off`\n\n`on` = require @trigger prefix\n`off` = respond to all messages';
      }

      let targetId: string | undefined;
      for (const [id, g] of Object.entries(registeredGroups)) {
        if (g.folder === targetGroup || g.name === targetGroup) {
          targetId = id;
          break;
        }
      }

      if (!targetId) {
        return `\u274c Group not found: ${targetGroup}`;
      }

      registeredGroups[targetId].requireTrigger = mode === 'on';
      saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
      const status = mode === 'on' ? '\u9700\u8981 @trigger \u524d\u7db4' : '\u56de\u61c9\u6240\u6709\u8a0a\u606f';
      return `\u2705 **${registeredGroups[targetId].name}** trigger mode: **${mode}** (${status})`;
    }

    case 'stats': {
      const groupCount = Object.keys(registeredGroups).length;
      const uptime = process.uptime();
      const uptimeHours = Math.floor(uptime / 3600);
      const uptimeMinutes = Math.floor((uptime % 3600) / 60);

      // Get usage stats
      const usage = getUsageStats();
      const avgDuration = usage.total_requests > 0
        ? Math.round(usage.avg_duration_ms / 1000)
        : 0;

      return `${t().statsTitle}

\u2022 ${t().registeredGroups}: ${groupCount}
\u2022 ${t().uptime}: ${uptimeHours}h ${uptimeMinutes}m
\u2022 ${t().memory}: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

${t().usageAnalytics}
\u2022 ${t().totalRequests}: ${usage.total_requests}
\u2022 ${t().avgResponseTime}: ${avgDuration}s
\u2022 ${t().totalTokens}: ${usage.total_prompt_tokens + usage.total_response_tokens}`;
    }

    case 'groups': {
      const groups = Object.values(registeredGroups);
      if (groups.length === 0) {
        return '\ud83d\udcc1 No groups registered.';
      }

      const groupList = groups.map((g, i) => {
        const isMain = g.folder === MAIN_GROUP_FOLDER;
        const searchStatus = g.enableWebSearch !== false ? '\ud83d\udd0d' : '';
        const hasPrompt = g.systemPrompt ? '\ud83d\udcac' : '';
        const triggerStatus = isMain || g.requireTrigger === false ? '\ud83d\udce2' : '';
        return `${i + 1}. **${g.name}** ${isMain ? '(main)' : ''} ${searchStatus}${hasPrompt}${triggerStatus}
   \ud83d\udcc1 ${g.folder} | \ud83c\udfaf ${g.trigger}`;
      }).join('\n');

      return `\ud83d\udcc1 **${t().registeredGroups}** (${groups.length})

${groupList}

Legend: \ud83d\udd0d=Search \ud83d\udcac=Custom Prompt \ud83d\udce2=All Messages`;
    }

    case 'tasks': {
      const tasks = getAllTasks();
      if (tasks.length === 0) {
        return '\ud83d\udcc5 No scheduled tasks.';
      }

      const taskList = tasks.slice(0, 10).map((t, i) => {
        const status = t.status === 'active' ? '\u2705' : t.status === 'paused' ? '\u23f8\ufe0f' : '\u2713';
        const nextRun = t.next_run ? new Date(t.next_run).toLocaleString() : 'N/A';
        return `${i + 1}. ${status} **${t.group_folder}**
   \ud83d\udccb ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '...' : ''}
   \u23f0 ${t.schedule_type}: ${t.schedule_value} | Next: ${nextRun}`;
      }).join('\n');

      const moreText = tasks.length > 10 ? `\n\n_...and ${tasks.length - 10} more tasks_` : '';

      return `\ud83d\udcc5 **Scheduled Tasks** (${tasks.length})

${taskList}${moreText}`;
    }

    case 'errors': {
      const errorStates = getAllErrorStates();

      if (errorStates.length === 0) {
        return t().noErrors;
      }

      const errorList = errorStates
        .filter(e => e.state.consecutiveFailures > 0)
        .map(e => {
          const group = registeredGroups[Object.keys(registeredGroups).find(
            k => registeredGroups[k].folder === e.group
          ) || ''];
          return `\u2022 **${group?.name || e.group}**: ${e.state.consecutiveFailures} failures\n  Last: ${e.state.lastError?.slice(0, 80)}...`;
        })
        .join('\n');

      return errorList
        ? `${t().groupsWithErrors}\n\n${errorList}`
        : t().noActiveErrors;
    }

    case 'report': {
      const { getDailyReportMessage } = await import('./daily-report.js');
      return getDailyReportMessage();
    }

    case 'export': {
      const targetFolder = args[0];
      if (!targetFolder) {
        return 'Usage: `/admin export <group_folder>`\nExports conversation as a file.';
      }

      // Find chatId for this folder
      let targetChatId: string | undefined;
      for (const [id, g] of Object.entries(registeredGroups)) {
        if (g.folder === targetFolder || g.name === targetFolder) {
          targetChatId = id;
          break;
        }
      }

      if (!targetChatId) {
        return `\u274c Group not found: ${targetFolder}`;
      }

      const { getConversationExport, formatExportAsMarkdown } = await import('./db.js');
      const exportData = getConversationExport(targetChatId);

      if (exportData.messageCount === 0) {
        return `\ud83d\udced No messages found for **${targetFolder}**.`;
      }

      const md = formatExportAsMarkdown(exportData);

      // Write to temp file and send via Telegram
      const tmpPath = path.join(DATA_DIR, `export-${targetFolder}-${Date.now()}.md`);
      fs.writeFileSync(tmpPath, md, 'utf-8');

      try {
        // Send the file. We need to find a main group chatId to send to.
        // The admin command is executed from the main group, so we use MAIN_GROUP_FOLDER
        const mainChatId = Object.entries(registeredGroups).find(
          ([, g]) => g.folder === MAIN_GROUP_FOLDER
        )?.[0];

        const bot = getBot();
        if (mainChatId && bot) {
          await bot.sendDocument(parseInt(mainChatId), tmpPath, {
            caption: `\ud83d\udce4 Export: ${targetFolder} (${exportData.messageCount} messages)`,
          });
        }
      } catch (err) {
        logger.error({ err: formatError(err) }, 'Failed to send export file');
      } finally {
        // Clean up temp file
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      return `\u2705 Exported **${exportData.messageCount}** messages for **${targetFolder}**.`;
    }

    case 'language': {
      const lang = args[0] as Language;
      if (availableLanguages.includes(lang)) {
        setLanguage(lang);
        saveState(); // Persist change
        return `\u2705 Language switched to: **${lang}**`;
      }
      return `\u274c Invalid language. Available: ${availableLanguages.join(', ')}\nCurrent: ${getLanguage()}`;
    }

    case 'help':
    default: {
      const commandList = Object.entries(ADMIN_COMMANDS)
        .map(([cmd, desc]) => `\u2022 \`/admin ${cmd}\` - ${desc}`)
        .join('\n');

      return `${t().adminCommandsTitle}

${commandList}

${t().adminOnlyNote}`;
    }
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming message.
 * Concurrency is handled at the container level (container-runner.ts).
 */
export async function processMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id.toString();
  const registeredGroups = getRegisteredGroups();
  const group = registeredGroups[chatId];
  if (!group) return;

  const bot = getBot();

  // Maintenance mode: auto-reply and skip processing
  if (isMaintenanceMode()) {
    await bot.sendMessage(parseInt(chatId), '\u2699\ufe0f \u7cfb\u7d71\u7dad\u8b77\u4e2d\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
    return;
  }

  // Extract content (text or caption)
  let content = msg.text || msg.caption || '';
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Handle admin commands (main group only)
  if (isMainGroup && content.startsWith('/admin')) {
    const parts = content.slice(7).trim().split(/\s+/);
    const adminCmd = parts[0] || 'help';
    const adminArgs = parts.slice(1);

    try {
      const response = await handleAdminCommand(adminCmd, adminArgs);
      await sendMessage(chatId, response);
    } catch (err) {
      logger.error({ err: formatError(err) }, 'Admin command failed');
      await sendMessage(chatId, '\u274c Admin command failed. Check logs for details.');
    }
    return;
  }

  // Check if trigger prefix is required (main group always responds; others check requireTrigger setting)
  const needsTrigger = !isMainGroup && (group.requireTrigger !== false);
  if (needsTrigger && !TRIGGER_PATTERN.test(content)) return;

  // Onboarding check for new groups (before processing first message)
  const isCommand = content.startsWith('/');
  if (!isCommand) {
    const { checkAndStartOnboarding } = await import('./onboarding.js');
    const triggered = await checkAndStartOnboarding(chatId, group.folder, group.name);
    if (triggered) return; // Don't process the first message, show onboarding instead
  }

  // Rate limiting check
  const { checkRateLimit } = await import('./db.js');
  const { RATE_LIMIT } = await import('./config.js');
  const { t } = await import('./i18n.js');

  if (RATE_LIMIT.ENABLED) {
    const rateLimitKey = `group:${chatId}`;
    const windowMs = RATE_LIMIT.WINDOW_MINUTES * 60 * 1000;
    const result = checkRateLimit(rateLimitKey, RATE_LIMIT.MAX_REQUESTS, windowMs);

    if (!result.allowed) {
      const waitMinutes = Math.ceil(result.resetInMs / 60000);
      logger.warn({ chatId, remaining: result.remaining, waitMinutes }, 'Rate limited');
      await sendMessage(chatId, `${t().rateLimited} ${t().retryIn(waitMinutes)}`);
      return;
    }
  }

  // Extract reply context if this message is a reply to another
  let replyContext = '';
  if (msg.reply_to_message) {
    const replyMsg = msg.reply_to_message;
    const replySender = replyMsg.from?.first_name || 'Unknown';
    const replyContent = replyMsg.text || replyMsg.caption || '[\u975e\u6587\u5b57\u5167\u5bb9]';
    replyContext = `[\u56de\u8986 ${replySender} \u7684\u8a0a\u606f: "${replyContent.slice(0, 200)}${replyContent.length > 200 ? '...' : ''}"]\n`;
    content = replyContext + content;
    logger.info({ chatId, replyToId: replyMsg.message_id }, 'Processing reply context');
  }

  // Handle media with progress updates
  const mediaInfo = extractMediaInfo(msg);
  let mediaPath: string | null = null;
  let statusMsg: TelegramBot.Message | null = null;

  // Send status message for processing requests
  statusMsg = await bot.sendMessage(chatId, `\u23f3 ${t().processing}...`, {
    reply_to_message_id: msg.message_id,
  });

  if (mediaInfo) {
    await bot.editMessageText(`\ud83d\udce5 ${t().downloadingMedia}...`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
    });

    mediaPath = await downloadMedia(mediaInfo.fileId, group.folder, mediaInfo.fileName);

    if (mediaPath) {
      const containerMediaPath = `/workspace/group/media/${path.basename(mediaPath)}`;

      if (mediaInfo.type === 'voice') {
        // Check voice duration (Telegram provides this in msg.voice.duration)
        if (msg.voice?.duration && msg.voice.duration > 300) {
          await bot.editMessageText(`\u26a0\ufe0f ${t().stt_too_long}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
          return;
        }

        await bot.editMessageText(`\ud83e\udde0 ${t().transcribing}...`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });

        const { transcribeAudio } = await import('./stt.js');
        let transcription: string;
        try {
          transcription = await transcribeAudio(mediaPath);
          // Echo transcription back to user
          await sendMessage(chatId, `\ud83c\udfa4 ${t().stt_transcribed}: "${transcription}"`);
          logger.info({ chatId, transcription: transcription.slice(0, 100) }, 'Voice message transcribed');
        } catch (err) {
          await bot.editMessageText(`\u274c ${t().stt_error}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
          logger.error({ err, chatId }, 'Voice transcription failed');
          return;
        }
        content = `[Voice message transcription: "${transcription}"]\n[Audio file: ${containerMediaPath}]\n${content}`;
      } else {
        content = `[Media: ${mediaInfo.type} at ${containerMediaPath}]\n${content}`;
      }
    }
  }

  await bot.editMessageText(`\ud83e\udd16 ${t().thinking}...`, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
  });

  // Get all messages since last agent interaction
  const lastAgentTimestamp = getLastAgentTimestamp();
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const missedMessages = getMessagesSince(
    chatId,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  const lines = missedMessages.map((m) => {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });
  const prompt = `<messages>\n${lines.join('\n')}\n</messages>`;

  if (!prompt) return;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  const ipcMessageSentChats = getIpcMessageSentChats();
  await setTyping(chatId, true);
  ipcMessageSentChats.delete(chatId); // Reset before agent run
  try {
    const response = await runAgent(group, prompt, chatId, mediaPath, statusMsg);

    // Skip container output if agent already sent response via IPC
    const ipcAlreadySent = ipcMessageSentChats.has(chatId);
    ipcMessageSentChats.delete(chatId); // Clean up

    if (response && !ipcAlreadySent) {
      const timestamp = new Date(msg.date * 1000).toISOString();
      lastAgentTimestamp[chatId] = timestamp;

      // Clean up status message
      if (statusMsg) {
        await bot.deleteMessage(parseInt(chatId), statusMsg.message_id).catch(() => { });
      }

      // Parse follow-up suggestions from response
      const { cleanText, followUps } = extractFollowUps(response);

      // Build buttons: always include retry/feedback, add follow-ups if present
      const buttons: QuickReplyButton[][] = [
        [
          { text: `\ud83d\udd04 ${t().retry}`, callbackData: `retry:${msg.message_id}` },
          { text: `\ud83d\udcac ${t().feedback}`, callbackData: `feedback_menu:${msg.message_id}` }
        ]
      ];

      // Add follow-up suggestions as additional button rows (one per suggestion)
      if (followUps.length > 0) {
        for (const suggestion of followUps) {
          buttons.push([
            { text: `\ud83d\udca1 ${suggestion}`, callbackData: JSON.stringify({ type: 'reply', data: suggestion }) }
          ]);
        }
      }

      await sendMessageWithButtons(chatId, `${ASSISTANT_NAME}: ${cleanText}`, buttons);
    } else if (ipcAlreadySent && statusMsg) {
      // IPC handled the response; just clean up status message
      await bot.deleteMessage(parseInt(chatId), statusMsg.message_id).catch(() => { });
    } else if (statusMsg) {
      // If no response, update status message to error with retry button
      await bot.editMessageText(`\u274c ${t().errorOccurred}`, {
        chat_id: parseInt(chatId),
        message_id: statusMsg.message_id,
        reply_markup: {
          inline_keyboard: [[
            { text: '\ud83d\udd04 Retry', callback_data: `retry:${msg.message_id}` }
          ]]
        }
      }).catch(() => { });
    }
  } finally {
    await setTyping(chatId, false);
  }
}

// ============================================================================
// Follow-up Suggestions Parsing
// ============================================================================

/**
 * Extract follow-up suggestions from agent response.
 * Lines starting with ">>>" are treated as suggestions.
 */
function extractFollowUps(text: string): { cleanText: string; followUps: string[] } {
  const lines = text.split('\n');
  const followUps: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>>>')) {
      const suggestion = trimmed.slice(3).trim();
      if (suggestion) followUps.push(suggestion);
    } else {
      contentLines.push(line);
    }
  }

  // Remove trailing empty lines from content
  while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
    contentLines.pop();
  }

  return {
    cleanText: contentLines.join('\n'),
    followUps: followUps.slice(0, 3), // Max 3 suggestions
  };
}

// ============================================================================
// Agent Execution
// ============================================================================

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatId: string,
  mediaPath: string | null = null,
  statusMsg: TelegramBot.Message | null = null,
): Promise<string | null> {
  const bot = getBot();
  const sessions = getSessions();
  const registeredGroups = getRegisteredGroups();
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Import streaming utilities
  const { telegramRateLimiter, safeMarkdownTruncate } = await import('./telegram-rate-limiter.js');

  // Create progress callback that updates Telegram statusMsg with streaming support
  const onProgress = async (info: ProgressInfo) => {
    if (!statusMsg) return;
    try {
      let progressText = '\ud83e\udd16 \u601d\u8003\u4e2d...';
      if (info.type === 'tool_use') {
        const toolEmoji: Record<string, string> = {
          'google_search': '\ud83d\udd0d \u6b63\u5728\u641c\u5c0b\u7db2\u8def...',
          'web_search': '\ud83d\udd0d \u6b63\u5728\u641c\u5c0b\u7db2\u8def...',
          'read_file': '\ud83d\udcc4 \u6b63\u5728\u8b80\u53d6\u6a94\u6848...',
          'write_file': '\u270d\ufe0f \u6b63\u5728\u5beb\u5165...',
          'generate_image': '\ud83c\udfa8 \u6b63\u5728\u751f\u6210\u5716\u7247...',
          'execute_code': '\u2699\ufe0f \u6b63\u5728\u57f7\u884c\u7a0b\u5f0f...',
        };
        progressText = toolEmoji[info.toolName || ''] || `\ud83d\udd27 \u4f7f\u7528\u5de5\u5177: ${info.toolName}...`;
        await bot.editMessageText(progressText, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        }).catch(() => {});
      } else if (info.type === 'message') {
        // Use streaming for long responses (>100 chars)
        if (info.contentSnapshot && info.contentSnapshot.length > 100) {
          // Check rate limit before editing
          if (telegramRateLimiter.canEdit(chatId)) {
            const truncated = safeMarkdownTruncate(info.contentSnapshot, 4096);
            const streamingIndicator = info.isComplete ? '' : ' \u23f3';
            await bot.editMessageText(`\ud83d\udcac ${truncated}${streamingIndicator}`, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown',
            }).catch(() => {});
            telegramRateLimiter.recordEdit(chatId);
          }
        } else if (info.content || info.contentSnapshot) {
          // Short response or fallback
          progressText = `\ud83d\udcac \u56de\u61c9\u4e2d...`;
          await bot.editMessageText(progressText, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          }).catch(() => {});
        }
      }
    } catch {}
  };

  // Import message consolidator and mark streaming as active
  const { messageConsolidator } = await import('./message-consolidator.js');
  messageConsolidator.setStreaming(chatId, true);

  try {
    // Get memory context from conversation summaries
    const { getMemoryContext } = await import('./memory-summarizer.js');
    const memoryContext = getMemoryContext(group.folder);

    const output = await runContainerAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId, // Using chatId as chatJid for compatibility
      isMain,
      systemPrompt: group.systemPrompt,
      persona: group.persona,
      enableWebSearch: group.enableWebSearch ?? true, // Default: enabled
      mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
      memoryContext: memoryContext ?? undefined,
    }, onProgress);

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      // Auto-retry without session if resume failed
      if (sessionId && output.error?.includes('No previous sessions found')) {
        logger.warn({ group: group.name }, 'Session resume failed, retrying without session');
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runContainerAgent(group, {
          prompt,
          sessionId: undefined,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
          memoryContext: memoryContext ?? undefined,
        });

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error({ group: group.name, error: retryOutput.error }, 'Container agent error (retry)');
          return null;
        }
        return retryOutput.result;
      }

      // Auto-retry on timeout or non-zero exit (fresh session)
      const isTimeout = output.error?.includes('Container timed out after');
      const isNonZeroExit = output.error?.includes('Container exited with code');

      if (isTimeout || isNonZeroExit) {
        logger.warn({ group: group.name, error: output.error }, 'Container timeout/error, retrying with fresh session');

        // Send retry status update to chat
        try {
          await bot.sendMessage(parseInt(chatId), '\ud83d\udd04 \u91cd\u8a66\u4e2d...').catch(() => {});
        } catch {}

        // Wait 2 seconds before retry
        await new Promise(r => setTimeout(r, 2000));

        // Clear session for fresh start
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runContainerAgent(group, {
          prompt,
          sessionId: undefined,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
          memoryContext: memoryContext ?? undefined,
        });

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error({ group: group.name, error: retryOutput.error }, 'Container agent error (retry after timeout)');
          return null;
        }
        return retryOutput.result;
      }

      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return null;
  } finally {
    // Clear streaming state
    messageConsolidator.setStreaming(chatId, false);
  }
}
