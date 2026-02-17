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

// ==== بيانات تجريبية تلقائية لمستخدمين للتجربة ====
const testUsers = [
  { id: "123456789012345678", total: 3600000, weekly: 1800000, monthly: 900000 }, // 1h, 30m, 15m
  { id: "987654321098765432", total: 7200000, weekly: 3600000, monthly: 1800000 }  // 2h, 1h, 30m
];

testUsers.forEach(u => {
  db.run(`INSERT OR IGNORE INTO users(id, total, weekly, monthly) VALUES(?, ?, ?, ?)`,
    [u.id, u.total, u.weekly, u.monthly]);
});

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

      const diff = Date.now() - row.joinTime; // الوقت الذي قضاه المستخدم

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

// تحويل الوقت من ms إلى h m
function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h || 0}h ${m || 0}m`;
}

// ID الرسالة التي تتحدث تلقائياً
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

  // دوال بناء النصوص
  function buildDesc(rows, type) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => {
      let ms = 0;
      if (type === "total") ms = r.total;
      else if (type === "monthly") ms = r.monthly;
      else if (type === "weekly") ms = r.weekly;
      return `**${i + 1}.** <@${r.id}> — ${formatTime(ms)}`;
    }).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 قائمة المتصدرين بالتواجد الصوتي")
    .setColor("Gold")
    .addFields(
      { name: "💯 التوب الكلي", value: buildDesc(results.total, "total"), inline: false },
      { name: "📅 التوب الشهري", value: buildDesc(results.monthly, "monthly"), inline: false },
      { name: "📆 التوب الأسبوعي", value: buildDesc(results.weekly, "weekly"), inline: false }
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

// ==== تصفير الأسبوعي كل دقيقة للتجربة ====
cron.schedule('* * * * *', () => {
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير الأسبوعي (تجربة)");
});

// ==== تصفير الشهري كل دقيقتين للتجربة ====
cron.schedule('*/2 * * * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير الشهري (تجربة)");
});

// الكلي يبقى دائمًا بدون تصفير

client.login(process.env.TOKEN);
