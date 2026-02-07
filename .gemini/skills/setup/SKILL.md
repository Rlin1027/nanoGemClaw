---
name: setup
description: Run initial NanoGemClaw setup. Use when user wants to install dependencies, authenticate Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanogemclaw", or first-time setup requests.
---

# NanoGemClaw Setup

Run all commands automatically. Only pause when user action is required (scanning QR codes, entering API keys).

## 1. Install Dependencies

```bash
npm install
```

## 2. Install Container Runtime

First, detect the platform and check what's available:

```bash
echo "Platform: $(uname -s)"
which container && echo "Apple Container: installed" || echo "Apple Container: not installed"
which docker && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

### If NOT on macOS (Linux, etc.)

Apple Container is macOS-only. Use Docker instead.

Tell the user:
> You're on Linux, so we'll use Docker for container isolation. Let me set that up now.

**Use the `/convert-to-docker` skill** to convert the codebase to Docker, then continue to Section 3.

### If on macOS

**If Apple Container is already installed:** Continue to Section 3.

**If Apple Container is NOT installed:** Ask the user:
> NanoGemClaw needs a container runtime for isolated agent execution. You have two options:
>
> 1. **Apple Container** (default) - macOS-native, lightweight, designed for Apple silicon
> 2. **Docker** - Cross-platform, widely used, works on macOS and Linux
>
> Which would you prefer?

#### Option A: Apple Container

Tell the user:
> Apple Container is required for running agents in isolated environments.
>
> 1. Download the latest `.pkg` from https://github.com/apple/container/releases
> 2. Double-click to install
> 3. Run `container system start` to start the service
>
> Let me know when you've completed these steps.

Wait for user confirmation, then verify:

```bash
container system start
container --version
```

**Note:** NanoGemClaw automatically starts the Apple Container system when it launches, so you don't need to start it manually after reboots.

#### Option B: Docker

Tell the user:
> You've chosen Docker. Let me set that up now.

**Use the `/convert-to-docker` skill** to convert the codebase to Docker, then continue to Section 3.

## 3. Configure Gemini Authentication

Ask the user:
> Do you have a Google AI Studio API key for Gemini?

### Get API Key

Tell the user:
> You'll need a Gemini API key to run the agents.
>
> 1. Go to https://aistudio.google.com/app/apikey
> 2. Click "Create API key"
> 3. Copy the key (starts with `AIza...`)
>
> Paste the key here, or add it to `.env` yourself as `GEMINI_API_KEY=<your-key>`

If they give you the key, add it to `.env`:

```bash
echo "GEMINI_API_KEY=<key>" > .env
```

**Verify:**
```bash
KEY=$(grep "^GEMINI_API_KEY=" .env | cut -d= -f2)
[ -n "$KEY" ] && echo "API key configured: ${KEY:0:10}...${KEY: -4}" || echo "Missing"
```

## 4. Build Container Image

Build the NanoGemClaw agent container:

```bash
./container/build.sh
```

This creates the `nanogemclaw-agent:latest` image with Node.js, Chromium, Gemini CLI, and agent-browser.

Verify the build succeeded by running a simple test (this auto-detects which runtime you're using):

```bash
if which docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo '{}' | docker run -i --entrypoint /bin/echo nanogemclaw-agent:latest "Container OK" || echo "Container build failed"
else
  echo '{}' | container run -i --entrypoint /bin/echo nanogemclaw-agent:latest "Container OK" || echo "Container build failed"
fi
```

## 5. Telegram Bot Token

**USER ACTION REQUIRED**

Ask the user:
> Do you have a Telegram bot token, or do you need to create one?

**If they need to create one:**

Tell the user:
> 1. Open Telegram and search for @BotFather
> 2. Send `/newbot` to BotFather
> 3. Follow the prompts to name your bot
> 4. BotFather will give you a token like `1234567890:ABCdefGhIjKlmNoPQRsTUVwxyZ`
> 5. Paste the token here

Wait for the token, then add it to `.env`:

```bash
echo "TELEGRAM_BOT_TOKEN=<token>" >> .env
```

**Verify:**
```bash
grep "^TELEGRAM_BOT_TOKEN=" .env | head -c 50
```

## 6. Configure Assistant Name

Ask the user:
> What trigger word do you want to use? (default: `Andy`)
>
> Messages starting with `@TriggerWord` will be sent to the Gemini agent.

If they choose something other than `Andy`, update it in these places:
1. `groups/GEMINI.md` - Change "# Andy" and "You are Andy" to the new name
2. `groups/main/GEMINI.md` - Same changes at the top
3. `data/registered_groups.json` - Use `@NewName` as the trigger when registering groups

Store their choice - you'll use it when creating the registered_groups.json and when telling them how to test.

## 7. Understand the Security Model

Before registering your main channel, you need to understand an important security concept.

Tell the user:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire NanoGemClaw project
>
> **Recommendation:** Use a private Telegram chat (just you and the bot) as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Private chat (just you and the bot) - Recommended
> 2. Private group (just you)
> 3. Group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over NanoGemClaw.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a private chat or solo group instead

## 8. Register Main Channel

Ask the user:
> Do you want to use a **private chat** (just you and the bot) or a **Telegram group** as your main control channel?

For private chat:
> Send any message to your bot in Telegram (search for your bot by name). Tell me when done.

For group:
> 1. Create a Telegram group
> 2. Add your bot to the group
> 3. Send any message in the group
> Tell me when done.

After user confirms, start the app briefly to capture the message:

```bash
timeout 10 npm run dev || true
```

Then find the chat ID from the database:

```bash
# For private chat
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages ORDER BY timestamp DESC LIMIT 5"

# For group (negative ID)
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid < 0 ORDER BY timestamp DESC LIMIT 5"
```

Create/update `data/registered_groups.json` using the chat ID from above and the assistant name from step 6:
```json
{
  "CHAT_ID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP"
  }
}
```

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 9. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the NanoGemClaw project?
>
> Examples: Git repositories, project folders, documents you want the agent to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/nanogemclaw
cat > ~/.config/nanogemclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 9a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 9b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other Telegram chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 9c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/nanogemclaw
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/nanogemclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/nanogemclaw/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the NanoGemClaw service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app", "containerPath": "my-app", "readonly": false }
>   ]
> }
> ```

## 10. Configure launchd Service

Generate the plist file with correct paths automatically:

```bash
NODE_PATH=$(which node)
PROJECT_PATH=$(pwd)
HOME_PATH=$HOME

cat > ~/Library/LaunchAgents/com.nanogemclaw.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanogemclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${PROJECT_PATH}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_PATH}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME_PATH}/.local/bin</string>
        <key>HOME</key>
        <string>${HOME_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${PROJECT_PATH}/logs/nanogemclaw.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_PATH}/logs/nanogemclaw.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist with:"
echo "  Node: ${NODE_PATH}"
echo "  Project: ${PROJECT_PATH}"
```

Build and start the service:

```bash
npm run build
mkdir -p logs
launchctl load ~/Library/LaunchAgents/com.nanogemclaw.plist
```

Verify it's running:
```bash
launchctl list | grep nanogemclaw
```

## 11. Test

Tell the user (using the assistant name they configured):
> Send `@ASSISTANT_NAME hello` in your registered Telegram chat.

Check the logs:
```bash
tail -f logs/nanogemclaw.log
```

The user should receive a response in Telegram.

## Troubleshooting

**Service not starting**: Check `logs/nanogemclaw.error.log`

**Container agent fails with "Gemini CLI process exited with code 1"**:
- Ensure the container runtime is running:
  - Apple Container: `container system start`
  - Docker: `docker info` (start Docker Desktop on macOS, or `sudo systemctl start docker` on Linux)
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Check that the chat ID is in `data/registered_groups.json`
- Check `logs/nanogemclaw.log` for errors

**Telegram disconnected**:
- Check bot token is valid
- Restart the service: `launchctl kickstart -k gui/$(id -u)/com.nanogemclaw`

**Unload service**:
```bash
launchctl unload ~/Library/LaunchAgents/com.nanogemclaw.plist
```
