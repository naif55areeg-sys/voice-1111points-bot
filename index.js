require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const express = require("express");

const CHANNEL_ID = "1461062092642717964";

/* ================== EXPRESS (حل مشكلة Railway) ================== */
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive and running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web server is listening on port ${PORT}`);
});

/* ================== DISCORD ================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new sqlite3.Database('./voice.db');

db.run(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  all_time INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0
)
`);

const voiceTimes = new Map();

/* ================== VOICE TRACK ================== */
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;
  const now = Date.now();

  // دخل الروم
  if (!oldState.channel && newState.channel) {
    voiceTimes.set(userId, now);
  } 
  // خرج من الروم
  else if (oldState.channel && !newState.channel) {
    const start = voiceTimes.get(userId);
    if (!start) return;

    const minutes = Math.floor((now - start) / 60000);

    // تحديث الوقت
    db.run(`
      UPDATE users SET
        all_time = all_time + ?,
        monthly = monthly + ?,
        weekly = weekly + ?
      WHERE user_id = ?
    `, [minutes, minutes, minutes, userId]);

    // إذا المستخدم جديد ضيفه
    db.run(`
      INSERT OR IGNORE INTO users (user_id, all_time, monthly, weekly)
      VALUES (?, 0, 0, 0)
    `, [userId]);

    voiceTimes.delete(userId);
  } 
  // نقل بين الرومات
  else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    const start = voiceTimes.get(userId);
    if (!start) return;

    const minutes = Math.floor((now - start) / 60000);

    db.run(`
      UPDATE users SET
        all_time = all_time + ?,
        monthly = monthly + ?,
        weekly = weekly + ?
      WHERE user_id = ?
    `, [minutes, minutes, minutes, userId]);

    voiceTimes.set(userId, now);
  }
});

/* ================== FUNCTIONS ================== */
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getTimeLeft(type) {
  const now = new Date();
  const target = new Date();

  if (type === "week") {
    target.setDate(now.getDate() + (7 - now.getDay()));
  } else if (type === "month") {
    target.setMonth(now.getMonth() + 1);
    target.setDate(1);
  }

  target.setHours(0,0,0,0);

  const diff = target - now;
  const d = Math.floor(diff / (1000*60*60*24));
  const h = Math.floor((diff / (1000*60*60)) % 24);
  const m = Math.floor((diff / (1000*60)) % 60);

  return `${d}d ${h}h ${m}m`;
}

/* ================== COMMAND ================== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'top') return;

  db.all(`SELECT * FROM users ORDER BY all_time DESC LIMIT 10`, (err, allRows) => {
    db.all(`SELECT * FROM users ORDER BY monthly DESC LIMIT 10`, (err2, monthRows) => {
      db.all(`SELECT * FROM users ORDER BY weekly DESC LIMIT 10`, async (err3, weekRows) => {

        let desc = `🏆 **توب الكل (لا يتم تصفيرهم)**\n\n`;

        if (allRows) allRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.all_time)}\n`;
        });

        desc += `\n🥇 **التوب الشهري**\n\n`;
        if (monthRows) monthRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.monthly)}\n`;
        });

        desc += `\n📅 **التوب الأسبوعي**\n\n`;
        if (weekRows) weekRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.weekly)}\n`;
        });

        desc += `\n\n♻ إعادة الضبط الأسبوعي بعد: ${getTimeLeft("week")}`;
        desc += `\n♻ إعادة الضبط الشهري بعد: ${getTimeLeft("month")}`;

        const embed = new EmbedBuilder()
          .setColor("#6a0dad")
          .setTitle("قائمة المتصدرين بالتواجد الصوتي 🏆")
          .setDescription(desc)
          .setFooter({ text: "Voice System By Nay 👑" });

        try {
          const channel = await client.channels.fetch(CHANNEL_ID);
          if (channel) channel.send({ embeds: [embed] });

          interaction.reply({
            content: "تم إرسال القائمة في الروم المحدد ✅",
            ephemeral: true
          });
        } catch (e) {
          console.error("Error sending embed:", e);
        }

      });
    });
  });
});

/* ================== RESET ================== */
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
}, { timezone: "Asia/Riyadh" });

cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
}, { timezone: "Asia/Riyadh" });

/* ================== LOGIN ================== */
client.login(process.env.TOKEN);
