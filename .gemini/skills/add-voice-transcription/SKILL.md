---
name: add-voice-transcription
description: Add voice message transcription to NanoGemClaw using Gemini's multimodal capabilities or Google Cloud Speech API. Automatically transcribes Telegram voice notes so the agent can read and respond to them.
---

# Add Voice Message Transcription

This skill adds automatic voice message transcription using Gemini's multimodal capabilities or Google Cloud Speech API. When users send voice notes in Telegram, they'll be transcribed and the agent can read and respond to the content.

## Prerequisites

**USER ACTION REQUIRED**

Ask the user:
> You have two options for voice transcription:
>
> **Option 1: Gemini Multimodal (Recommended)**
> - Uses your existing GEMINI_API_KEY
> - Free tier available
> - Supports many audio formats
>
> **Option 2: Google Cloud Speech API**
> - Requires separate GCP project and service account
> - Pay-per-use pricing (~$0.006 per minute)
> - More accurate for some languages
>
> Which would you prefer?

Wait for user choice before continuing.

---

## Implementation

### Step 1: Add Dependencies

Read `package.json` and add required packages to dependencies:

For Gemini multimodal:
```json
"dependencies": {
  ...existing dependencies...
  "@google/generative-ai": "^0.1.0"
}
```

For Google Cloud Speech:
```json
"dependencies": {
  ...existing dependencies...
  "@google-cloud/speech": "^6.0.0"
}
```

Then install:

```bash
npm install
```

### Step 2: Create Transcription Configuration

Create a configuration file for transcription settings:

Write to `.transcription.config.json`:

```json
{
  "provider": "gemini",
  "gemini": {
    "apiKey": "",
    "model": "gemini-2.0-flash-exp"
  },
  "gcp": {
    "keyFile": ""
  },
  "enabled": true,
  "fallbackMessage": "[Voice Message - transcription unavailable]"
}
```

Add this file to `.gitignore` to prevent committing API keys:

```bash
echo ".transcription.config.json" >> .gitignore
```

If using Gemini (recommended), tell the user:
> I'll use your existing GEMINI_API_KEY from .env for voice transcription. No additional setup needed!

If using GCP Speech, ask the user:
> I've created `.transcription.config.json`. You'll need to:
>
> 1. Create a service account at https://console.cloud.google.com
> 2. Enable Cloud Speech-to-Text API
> 3. Download the service account key JSON
> 4. Update `"keyFile"` in `.transcription.config.json` with the path
>
> Let me know when you've added it.

Wait for user confirmation if using GCP Speech.

### Step 3: Create Transcription Module

Create `src/stt.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration interface
interface TranscriptionConfig {
  provider: 'gemini' | 'gcp';
  gemini?: {
    apiKey: string;
    model: string;
  };
  gcp?: {
    keyFile: string;
  };
  enabled: boolean;
  fallbackMessage: string;
}

// Load configuration
function loadConfig(): TranscriptionConfig {
  const configPath = path.join(__dirname, '../.transcription.config.json');
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (err) {
    console.error('Failed to load transcription config:', err);
    return {
      provider: 'gemini',
      enabled: false,
      fallbackMessage: '[Voice Message - transcription unavailable]'
    };
  }
}

// Transcribe audio using Gemini multimodal
async function transcribeWithGemini(audioBuffer: Buffer, config: TranscriptionConfig): Promise<string | null> {
  if (!config.gemini?.apiKey || config.gemini.apiKey === '') {
    // Try to get from env
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('Gemini API key not configured');
      return null;
    }
    config.gemini = { apiKey, model: config.gemini?.model || 'gemini-2.0-flash-exp' };
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    const model = genAI.getGenerativeModel({ model: config.gemini.model });

    const result = await model.generateContent([
      {
        inlineData: {
          data: audioBuffer.toString('base64'),
          mimeType: 'audio/ogg'
        }
      },
      'Transcribe this audio message to text. Return only the transcription, no additional commentary.'
    ]);

    const response = await result.response;
    return response.text();
  } catch (err) {
    console.error('Gemini transcription failed:', err);
    return null;
  }
}

// Transcribe audio using Google Cloud Speech API
async function transcribeWithGCP(audioBuffer: Buffer, config: TranscriptionConfig): Promise<string | null> {
  if (!config.gcp?.keyFile) {
    console.warn('GCP key file not configured');
    return null;
  }

  try {
    const speech = await import('@google-cloud/speech');
    const client = new speech.SpeechClient({ keyFilename: config.gcp.keyFile });

    const audio = {
      content: audioBuffer.toString('base64'),
    };

    const request = {
      audio: audio,
      config: {
        encoding: 'OGG_OPUS' as const,
        sampleRateHertz: 16000,
        languageCode: 'en-US',
      },
    };

    const [response] = await client.recognize(request);
    const transcription = response.results
      ?.map(result => result.alternatives?.[0]?.transcript)
      .join('\n');

    return transcription || null;
  } catch (err) {
    console.error('GCP transcription failed:', err);
    return null;
  }
}

// Main transcription function
export async function transcribeAudioMessage(audioBuffer: Buffer): Promise<string | null> {
  const config = loadConfig();

  // Check if transcription is enabled
  if (!config.enabled) {
    console.log('Transcription disabled in config');
    return config.fallbackMessage;
  }

  try {
    let transcript: string | null = null;

    switch (config.provider) {
      case 'gemini':
        transcript = await transcribeWithGemini(audioBuffer, config);
        break;
      case 'gcp':
        transcript = await transcribeWithGCP(audioBuffer, config);
        break;
      default:
        console.error(`Unknown transcription provider: ${config.provider}`);
        return config.fallbackMessage;
    }

    if (!transcript) {
      return config.fallbackMessage;
    }

    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return config.fallbackMessage;
  }
}
```

### Step 4: Update Database to Handle Transcribed Content

Read `src/db.ts` and find the `storeMessage` function. Update its signature and implementation to accept transcribed content:

Change the function signature from:
```typescript
export function storeMessage(msg: Message, chatJid: string, isFromMe: boolean, senderName?: string): void
```

To:
```typescript
export function storeMessage(msg: Message, chatJid: string, isFromMe: boolean, senderName?: string, transcribedContent?: string): void
```

Update the content extraction to use transcribed content if provided:
```typescript
const content = transcribedContent ||
  msg.text ||
  msg.caption ||
  (msg.voice ? '[Voice Message]' : '') ||
  '';
```

### Step 5: Integrate Transcription into Message Handler

**Note:** Voice messages are transcribed for all messages in registered groups, regardless of the trigger word. This is because:
1. Voice notes can't easily include a trigger word
2. Users expect voice notes to work the same as text messages
3. The transcribed content is stored in the database for context, even if it doesn't trigger the agent

Read `src/index.ts` and find the Telegram message handler event.

Change the callback from synchronous to async if needed, and add voice message detection and transcription:

```typescript
// Check if this is a voice message
if (msg.voice) {
  try {
    // Download voice message
    const file = await bot.getFile(msg.voice.file_id);
    const filePath = file.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    // Download audio buffer
    const response = await fetch(fileUrl);
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Import transcription module
    const { transcribeAudioMessage } = await import('./stt.js');
    const transcript = await transcribeAudioMessage(audioBuffer);

    if (transcript) {
      // Store with transcribed content
      storeMessage(msg, chatJid, msg.from?.id === bot.botInfo?.id || false, msg.from?.first_name, `[Voice: ${transcript}]`);
      logger.info({ chatJid, length: transcript.length }, 'Transcribed voice message');
    } else {
      // Store with fallback message
      storeMessage(msg, chatJid, msg.from?.id === bot.botInfo?.id || false, msg.from?.first_name, '[Voice Message - transcription unavailable]');
    }
  } catch (err) {
    logger.error({ err }, 'Voice transcription error');
    storeMessage(msg, chatJid, msg.from?.id === bot.botInfo?.id || false, msg.from?.first_name, '[Voice Message - transcription failed]');
  }
} else {
  // Regular message, store normally
  storeMessage(msg, chatJid, msg.from?.id === bot.botInfo?.id || false, msg.from?.first_name);
}
```

### Step 6: Update Package Lock and Build

Run these commands to ensure everything compiles:

```bash
npm install
npm run build
```

### Step 7: Restart NanoGemClaw

Restart the service to load the new transcription code:

```bash
# If using launchd (macOS):
launchctl kickstart -k gui/$(id -u)/com.nanogemclaw

# Or if running manually:
# Stop the current process and restart with:
npm start
```

Verify it started:

```bash
sleep 2 && launchctl list | grep nanogemclaw
# or check logs:
tail -f logs/nanogemclaw.log
```

### Step 8: Test Voice Transcription

Tell the user:

> Voice transcription is ready! Test it by:
>
> 1. Open Telegram
> 2. Go to a registered chat
> 3. Send a voice note using the microphone button
> 4. The agent should receive the transcribed text and respond
>
> In the database and agent context, voice messages appear as:
> `[Voice: <transcribed text here>]`

Watch for transcription in the logs:

```bash
tail -f logs/nanogemclaw.log | grep -i "voice\|transcri"
```

---

## Configuration Options

### Enable/Disable Transcription

To temporarily disable without removing code, edit `.transcription.config.json`:

```json
{
  "enabled": false
}
```

### Change Provider

To switch between Gemini and GCP:

```json
{
  "provider": "gcp"
}
```

### Change Fallback Message

Customize what's stored when transcription fails:

```json
{
  "fallbackMessage": "[🎤 Voice note - transcription unavailable]"
}
```

---

## Troubleshooting

### "Transcription unavailable" or "Transcription failed"

Check logs for specific errors:
```bash
tail -100 logs/nanogemclaw.log | grep -i transcription
```

Common causes:
- API key not configured or invalid
- No API credits remaining
- Network connectivity issues
- Audio format not supported

### Voice messages not being detected

- Ensure you're sending actual voice notes (microphone button), not audio file attachments
- Check that the message has a `voice` property

### ES Module errors (`__dirname is not defined`)

The fix is already included in the implementation above using:
```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

---

## Security Notes

- The `.transcription.config.json` file contains your API key and should NOT be committed to version control
- It's added to `.gitignore` by this skill
- Audio files are sent to Google for transcription - review their data usage policy
- No audio files are stored locally after transcription
- Transcripts are stored in the SQLite database like regular text messages

---

## Cost Management

For Gemini: Use your existing API key, free tier available

For GCP: Monitor usage in Google Cloud Console

Tips to control costs:
- Set spending limits in Google Cloud
- Disable transcription during development/testing with `"enabled": false`
- Use Gemini instead of GCP Speech (free tier)

---

## Removing Voice Transcription

To remove the feature:

1. Remove from `package.json`:
   ```bash
   npm uninstall @google/generative-ai @google-cloud/speech
   ```

2. Delete `src/stt.ts`

3. Revert changes in `src/index.ts`:
   - Remove the voice message handling block
   - Change callback back to synchronous if desired

4. Revert changes in `src/db.ts`:
   - Remove the `transcribedContent` parameter from `storeMessage`

5. Delete `.transcription.config.json`

6. Rebuild:
   ```bash
   npm run build
   launchctl kickstart -k gui/$(id -u)/com.nanogemclaw
   ```
