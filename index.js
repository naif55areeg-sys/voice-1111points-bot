require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const CHANNEL_ID = "1461062092642717964";

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
)`);

const voiceTimes = new Map();

client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;

  // دخل روم
  if (!oldState.channel && newState.channel) {
    voiceTimes.set(userId, Date.now());
    return;
  }

  // خرج او نقل
  if (oldState.channel) {
    const start = voiceTimes.get(userId);
    if (!start) return;

    const minutes = Math.floor((Date.now() - start) / 60000);

    db.run(`
      INSERT INTO users (user_id, all_time, monthly, weekly)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
      all_time = all_time + ?,
      monthly = monthly + ?,
      weekly = weekly + ?
    `, [userId, minutes, minutes, minutes, minutes, minutes, minutes]);

    voiceTimes.delete(userId);
  }

  // لو نقل لروم جديد
  if (newState.channel) {
    voiceTimes.set(userId, Date.now());
  }
});

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
  }

  if (type === "month") {
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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'top') return;

  db.all(`SELECT * FROM users ORDER BY all_time DESC LIMIT 10`, async (err, allRows) => {
    db.all(`SELECT * FROM users ORDER BY monthly DESC LIMIT 10`, async (err2, monthRows) => {
      db.all(`SELECT * FROM users ORDER BY weekly DESC LIMIT 10`, async (err3, weekRows) => {

        let desc = `🏆 **توب الكل (لا يتم تصفيرهم)**\n\n`;

        allRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.all_time)}\n`;
        });

        desc += `\n🥇 **التوب الشهري**\n\n`;

        monthRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.monthly)}\n`;
        });

        desc += `\n📅 **التوب الأسبوعي**\n\n`;

        weekRows.forEach((u, i) => {
          desc += `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.weekly)}\n`;
        });

        desc += `\n\n♻ إعادة الضبط الأسبوعي بعد: ${getTimeLeft("week")}`;
        desc += `\n♻ إعادة الضبط الشهري بعد: ${getTimeLeft("month")}`;

        const embed = new EmbedBuilder()
          .setColor("#6a0dad")
          .setTitle("قائمة المتصدرين بالتواجد الصوتي 🏆")
          .setDescription(desc)
          .setFooter({ text: "Voice System By Nay 👑" });

        // ارسال في الروم المحدد
        const channel = await client.channels.fetch(CHANNEL_ID);
        channel.send({ embeds: [embed] });

        // رد مخفي للشخص
        interaction.reply({
          content: "تم إرسال القائمة في الروم المحدد ✅",
          ephemeral: true
        });

      });
    });
  });
});

// تصفير تلقائي بتوقيت السعودية
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
}, {
  timezone: "Asia/Riyadh"
});

cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
}, {
  timezone: "Asia/Riyadh"
});

client.login(process.env.TOKEN);
