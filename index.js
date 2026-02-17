require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const express = require("express");

const CHANNEL_ID = "1461062092642717964";

/* ================== EXPRESS ================== */
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web server on port ${PORT}`));

/* ================== DISCORD CLIENT ================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// ملاحظة: غيرنا المسار ليكون داخل مجلد data عشان نربطه بالـ Volume لاحقاً
const db = new sqlite3.Database('./data/voice.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    all_time INTEGER DEFAULT 0,
    monthly INTEGER DEFAULT 0,
    weekly INTEGER DEFAULT 0,
    join_time INTEGER DEFAULT NULL
  )`);
});

/* ================== REGISTER COMMANDS ================== */
const commands = [{ name: 'top', description: 'عرض قائمة المتصدرين' }];
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('جاري تعريف أوامر السلاش...');
    // تأكد من إضافة CLIENT_ID في متغيرات Railway
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || "أيدي_البوت_هنا"), { body: commands });
    console.log('تم تعريف الأوامر بنجاح!');
  } catch (error) {
    console.error('خطأ في تعريف الأوامر:', error);
  }
})();

/* ================== VOICE TRACKING & REMAINING LOGIC ================== */
// (نفس كود التتبع اللي أرسلته سابقاً يبقى كما هو هنا...)
const voiceTimes = new Map();

client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;
  if (!oldState.channel && newState.channel) {
    const now = Date.now();
    voiceTimes.set(userId, now);
    db.run(`INSERT OR REPLACE INTO users (user_id, join_time) VALUES (?, ?)`, [userId, now]);
    return;
  }
  if (oldState.channel) {
    const start = voiceTimes.get(userId);
    if (!start) return;
    const minutes = Math.floor((Date.now() - start) / 60000);
    db.run(`INSERT INTO users (user_id, all_time, monthly, weekly) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET all_time = all_time + ?, monthly = monthly + ?, weekly = weekly + ?, join_time = NULL`,
      [userId, minutes, minutes, minutes, minutes, minutes, minutes]);
    voiceTimes.delete(userId);
  }
});

// دالة التنسيق
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'top') return;

  db.all(`SELECT * FROM users WHERE all_time > 0 ORDER BY all_time DESC LIMIT 10`, async (err, rows) => {
    if (rows.length === 0) {
      return interaction.reply({ content: "⚠️ لا توجد بيانات مسجلة حتى الآن. ادخل روم صوتي واخرج لتسجيل النقاط!", ephemeral: true });
    }
    
    // ... (بقية كود الـ Embed اللي أرسلته لك سابقاً)
    let desc = `🏆 **توب الكل**\n` + rows.map((u, i) => `\`${i+1}.\` <@${u.user_id}> — ${formatTime(u.all_time)}`).join('\n');
    const embed = new EmbedBuilder().setColor("#6a0dad").setTitle("قائمة المتصدرين").setDescription(desc);
    
    const channel = await client.channels.fetch(CHANNEL_ID);
    channel.send({ embeds: [embed] });
    interaction.reply({ content: "تم الإرسال!", ephemeral: true });
  });
});

client.login(process.env.TOKEN);
