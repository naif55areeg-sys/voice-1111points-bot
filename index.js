require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// قاعدة البيانات
const db = new sqlite3.Database('./voice.db');

// ملف لتخزين ID الرسالة
const messageFile = './topMessage.json';
function saveTopMessageId(id) {
  fs.writeFileSync(messageFile, JSON.stringify({ id }));
}
function getTopMessageId() {
  if (!fs.existsSync(messageFile)) return null;
  return JSON.parse(fs.readFileSync(messageFile)).id;
}

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

// تسجيل الدخول والخروج من الرومات
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;

  // دخول روم
  if (!oldState.channelId && newState.channelId) {
    db.run(`INSERT OR IGNORE INTO users(id, joinTime) VALUES(?, ?)`, [userId, Date.now()]);
    db.run(`UPDATE users SET joinTime = ? WHERE id = ?`, [Date.now(), userId]);
  }

  // خروج روم
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

// تحويل ms إلى h m
function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h || 0}h ${m || 0}m`;
}

// تحديث Embed التوب
async function sendTop() {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

  const results = {};

  // الكلي أفضل 2
  results.total = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY total DESC LIMIT 2', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  // الأسبوعي أفضل 4
  results.weekly = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY weekly DESC LIMIT 4', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  // الشهري أفضل 5
  results.monthly = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY monthly DESC LIMIT 5', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  function buildDesc(rows, type) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => {
      let ms = type === "total" ? r.total : type === "monthly" ? r.monthly : r.weekly;
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

  let topMessageId = getTopMessageId();
  if (topMessageId) {
    try {
      const msg = await channel.messages.fetch(topMessageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      console.log("لم أتمكن من تعديل الرسالة، سيتم إنشاء رسالة جديدة");
    }
  }

  const msg = await channel.send({ embeds: [embed] });
  saveTopMessageId(msg.id);
}

// تشغيل عند الجاهزية
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // التوب الكلي يتم تحديثه كل 15 دقيقة
setInterval(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const members = guild.members.cache.filter(m => m.voice.channelId);

  const increment = 1 * 60 * 1000; // 1 دقيقة بدلاً من 10 دقائق
  members.forEach(member => {
    const userId = member.id;

    db.run(`
      INSERT OR IGNORE INTO users(id, total, weekly, monthly)
      VALUES(?, 0, 0, 0)
    `, [userId]);

    db.run(`
      UPDATE users
      SET total = total + ?
        WHERE id = ?
    `, [increment, userId]);
  });

  sendTop();
}, 1 * 60 * 1000); // كل دقيقة بدلاً من 15 دقيقة

  // تحديث فوري عند التشغيل
  sendTop();
});

// الأسبوعي → كل 2 دقيقة للتجربة
cron.schedule('*/2 * * * *', () => {
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير الأسبوعي - تجربة");
});

// الشهري → كل 3 دقائق للتجربة
cron.schedule('*/3 * * * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير الشهري - تجربة");
});

// الكلي لا يتصفّر
client.login(process.env.TOKEN);
