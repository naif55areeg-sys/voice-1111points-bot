require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new sqlite3.Database('./voice.db');

// إنشاء جدول المستخدمين
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0,
  joinTime INTEGER
)
`);

// تسجيل دخول وخروج الرومات الصوتية
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;

  // دخول روم
  if (!oldState.channelId && newState.channelId) {
    db.run(`INSERT OR IGNORE INTO users(id, joinTime) VALUES(?, ?)`, [userId, Date.now()]);
    db.run(`UPDATE users SET joinTime = ? WHERE id = ?`, [Date.now(), userId]);
  }

  // خروج من روم
  if (oldState.channelId && !newState.channelId) {
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
      if (!row || !row.joinTime) return;

      const diff = Date.now() - row.joinTime;

      db.run(`
        UPDATE users
        SET total = total + ?,
            weekly = weekly + ?,
            monthly = monthly + ?,
            joinTime = NULL
        WHERE id = ?
      `, [diff, diff, diff, userId]);
    });
  }
});

// تحويل الوقت من ms لـ h m
function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ID الرسالة اللي تتحدث تلقائياً
let topMessageId = null;

async function sendTop() {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

  // جلب أفضل 10 لكل / شهري / أسبوعي
  const queries = {
    total: 'SELECT * FROM users ORDER BY total DESC LIMIT 10',
    monthly: 'SELECT * FROM users ORDER BY monthly DESC LIMIT 10',
    weekly: 'SELECT * FROM users ORDER BY weekly DESC LIMIT 10'
  };

  const results = {};
  for (const key in queries) {
    results[key] = await new Promise((resolve, reject) => {
      db.all(queries[key], (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      });
    });
  }

  // إنشاء النصوص بشكل مرتب
  function buildDesc(rows) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${formatTime(r.total)}`).join('\n');
  }

  function buildDescMonthly(rows) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${formatTime(r.monthly)}`).join('\n');
  }

  function buildDescWeekly(rows) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${formatTime(r.weekly)}`).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 قائمة المتصدرين بالتواجد الصوتي")
    .setColor("Gold")
    .addFields(
      { name: "💯 التوب الكلي", value: buildDesc(results.total), inline: false },
      { name: "📅 التوب الشهري", value: buildDescMonthly(results.monthly), inline: false },
      { name: "📆 التوب الأسبوعي", value: buildDescWeekly(results.weekly), inline: false }
    )
    .setFooter({ text: "Voice System By Nay 👑" });

  // تحديث الرسالة إذا موجودة، أو إنشاء رسالة جديدة
  if (topMessageId) {
    try {
      const msg = await channel.messages.fetch(topMessageId);
      await msg.edit({ embeds: [embed] });
    } catch {
      const msg = await channel.send({ embeds: [embed] });
      topMessageId = msg.id;
    }
  } else {
    const msg = await channel.send({ embeds: [embed] });
    topMessageId = msg.id;
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // تحديث الرسالة كل ساعة
  setInterval(sendTop, 60 * 60 * 1000);

  // تحديث فوري عند بدء التشغيل
  sendTop();
});

// تصفير أسبوعي
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
});

// تصفير شهري
cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
});

client.login(process.env.TOKEN);
