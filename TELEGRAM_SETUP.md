# Telegram Bot Integration Guide

## Overview

OpenPanda now supports Telegram bot integration, allowing you to interact with AI agents via Telegram messaging. This guide walks through the setup process step-by-step.

## Quick Start

```bash
npm run cli -- setup

# Then select "Telegram Bot (messaging)" from the setup menu
```

---

## Step-by-Step Setup

### **Step 1: Create a Telegram Bot with BotFather**

1. **Open Telegram** (web or app)
2. **Search for:** `BotFather` (official Telegram bot for creating bots)
3. **Click:** Start chat with @BotFather
4. **Send:** `/newbot`

BotFather will prompt you:

```
🤖 Alright, a new bot. How are we going to call it?
Please choose a name for your bot.
```

### **Step 2: Name Your Bot**

Enter a name for your bot. Examples:
- `MyOpenPandaBot`
- `OpenPanda Agent`
- `AI Assistant Bot`

This is just a display name; it doesn't need to be unique.

```
Alright! What should your bot be called? Give me a name.
→ MyOpenPandaBot
```

### **Step 3: Choose a Username**

BotFather will now ask for a username:

```
Good. Now let's choose a username for your bot.
It must end in 'bot'. (e.g., TetrisBot or tetris_bot)
```

**Important:** Username must:
- End with `_bot` or `Bot`
- Be globally unique (no other Telegram bot can use this username)
- Use only letters, numbers, and underscores

Examples:
- `my_openpanda_bot`
- `myopenpandabot`
- `openpanda_ai_bot`

```
→ my_openpanda_bot
```

### **Step 4: Receive Your Bot Token**

BotFather will send you a confirmation and **your bot token:**

```
Done! Congratulations on your new bot. You will find it at
t.me/my_openpanda_bot. You can now add a description, about
section and profile picture for your bot, see /help for a
list of commands. By the way, when you've finished creating
your bot and you no longer need it, remember that you can
always delete it with the /cancel command.

Use this token to access the Telegram Bot API:
123456789:ABCdefGHIjklmnoPQRstuvWXYZ1234567890

Keep your token secure and store it safely!
```

**⚠️ Important:** 
- This token is like a password — keep it secret
- Never share it publicly or commit it to version control
- If compromised, you can generate a new token in BotFather with `/cancel` then `/newbot`

---

## Configuring OpenPanda

### **Option 1: Interactive Setup (Recommended)**

```bash
npm run cli -- setup
```

When prompted:

```
? Which AI providers do you want to configure?
❯ Telegram Bot (messaging)
  AI + Telegram
  [other options...]
```

Select Telegram option. The setup will show:

```
📱 How to get your Telegram Bot Token:

  Step 1: Open Telegram and search for: BotFather
  Step 2: Start a chat with @BotFather
  Step 3: Send the command: /newbot
  Step 4: Enter a name for your bot
  Step 5: Enter a username
  Step 6: BotFather will give you a token like: 123456:ABC...
  Step 7: Copy that token and paste it below

Ready? (Open https://t.me/BotFather in your browser first)
→ Yes

Telegram Bot Token: •••••••••••••••••••••
✓ Telegram bot token saved

Want to restrict this bot to specific chat(s)?
→ No / Yes
```

### **Option 2: Environment Variable**

Set the token via environment variable:

```bash
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklmnoPQRstuvWXYZ1234567890"
npm run cli -- chat
```

Or in `.env` file:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklmnoPQRstuvWXYZ1234567890
```

### **Option 3: Direct Config File**

Edit `~/.openpanda/config.json`:

```json
{
  "providers": {
    "telegram": {
      "apiKey": "123456789:ABCdefGHIjklmnoPQRstuvWXYZ1234567890",
      "enabled": true
    }
  }
}
```

---

## Optional: Restrict Bot to Specific Chat

To limit your bot to respond only to a specific chat (instead of all users):

### **Step 1: Get Your Chat ID**

1. **Send a message to your bot** on Telegram (any message)
2. **Open your browser** and visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Replace `<YOUR_TOKEN>` with your actual bot token:
   ```
   https://api.telegram.org/bot123456789:ABCdefGHIjklmnoPQRstuvWXYZ/getUpdates
   ```

3. **Look for the response** (it will be JSON):
   ```json
   {
     "ok": true,
     "result": [
       {
         "update_id": 123456789,
         "message": {
           "message_id": 1,
           "chat": {
             "id": 987654321,
             "type": "private"
           }
         }
       }
     ]
   }
   ```

4. **Copy your chat ID** — in this example: `987654321`
   - For private chats: positive number (e.g., `987654321`)
   - For group chats: negative number (e.g., `-123456789`)

### **Step 2: Save Chat ID**

During setup, when asked "Want to restrict this bot to specific chat(s)?":

```
Want to restrict this bot to specific chat(s)? (optional)
→ Yes

📌 To find your chat ID:
  1. Send any message to your bot on Telegram
  2. Visit this URL in your browser:
     https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
  3. Replace <YOUR_TOKEN> with your bot token from above
  4. Look for 'chat': { 'id': <YOUR_CHAT_ID> }
  5. Copy your chat ID (can be negative, like -123456789)

Chat ID (or press Enter to skip):
→ 987654321

✓ Chat ID saved - bot will only respond in that chat
```

Or edit `~/.openpanda/config.json`:

```json
{
  "providers": {
    "telegram": {
      "apiKey": "123456789:ABCdefGHIjklmnoPQRstuvWXYZ",
      "chatId": "987654321",
      "enabled": true
    }
  }
}
```

---

## Configuration File Locations

### **Config Path:**
```
~/.openpanda/config.json
```

### **Example Complete Config:**
```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "enabled": true
    },
    "telegram": {
      "apiKey": "123456789:ABCdefGHIjklmnoPQRstuvWXYZ",
      "chatId": "987654321",
      "enabled": true
    }
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6"
}
```

---

## Using Your Telegram Bot

Once configured, you can:

1. **Start a chat** with your bot on Telegram (search for username: `my_openpanda_bot`)
2. **Send messages** and interact with AI agents
3. **Use slash commands** to manage sessions, switch models, apply skills
4. **Get real-time responses** streamed as you type

### **Basic Usage:**

```
You: Tell me about climate change
Bot: [Responds with detailed information]

You: /skill summarizer
[Apply summarizer skill]

You: Summarize this article...
Bot: [Professional summary with completion marker]
```

---

## Troubleshooting

### **"Invalid token"**
- Copy the token exactly from BotFather (including the colon)
- Make sure no extra spaces
- Check you didn't accidentally modify it

### **"Chat ID not found"**
- Send a message to your bot first, then run getUpdates
- Make sure you're using the correct token in the URL
- Wait a few seconds after messaging, then try again

### **"Bot is not responding"**
- Verify bot token is correct: `openpanda setup`
- Check if bot is enabled: `cat ~/.openpanda/config.json`
- Restart OpenPanda
- If still not working, regenerate token in BotFather: `/cancel` then `/newbot`

### **"Permission denied"**
- If chat ID is set, verify it's correct (check getUpdates)
- For group chats, make sure you're in the correct group
- Try removing chat ID restriction temporarily: edit config and remove `chatId` field

---

## Security Best Practices

1. **Never commit your token** to git or version control
   ```bash
   # ❌ Don't do this:
   git add ~/.openpanda/config.json
   
   # ✓ Do this instead:
   echo ~/.openpanda/ >> .gitignore
   ```

2. **Use environment variables** for CI/CD:
   ```bash
   export TELEGRAM_BOT_TOKEN="your-token-here"
   ```

3. **If token is compromised:**
   - Open BotFather
   - Send: `/cancel`
   - Send: `/newbot` to create a new bot
   - Update OpenPanda with new token

4. **Use chat ID restriction** to limit who can message the bot

---

## Advanced Options

### **Multiple Bots (different configs)**

Create multiple OpenPanda instances with different tokens:

```bash
# Bot 1
TELEGRAM_BOT_TOKEN=111111:AAA npm run cli -- chat

# Bot 2
TELEGRAM_BOT_TOKEN=222222:BBB npm run cli -- chat
```

### **Bot Commands in Telegram**

When you set up BotFather, you can also configure commands:

In BotFather, send: `/setcommands`

Then select your bot and set commands like:
```
start - Start chatting with the agent
help - Show available commands
new - Create new session
```

---

## Related Documentation

- [Provider Setup Guide](./README.md#setup)
- [CLI Commands](./README.md#commands)
- [Skills Reference](./README.md#skills)
- [Agent Presets](./README.md#agent-presets)

---

## Support

If you encounter issues:

1. **Re-run setup:** `npm run cli -- setup`
2. **Check configuration:** `cat ~/.openpanda/config.json`
3. **Verify token:** Visit `https://api.telegram.org/bot<TOKEN>/getMe`
4. **Review logs** for error messages

**Token validation:**
```bash
# Test if token works:
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

Should return:
```json
{
  "ok": true,
  "result": {
    "id": 123456789,
    "is_bot": true,
    "first_name": "MyOpenPandaBot",
    "username": "my_openpanda_bot"
  }
}
```

---

**Happy chatting! 🤖💬**
