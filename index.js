require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= قاعدة البيانات =================
const db = new sqlite3.Database('./voice.db');

// جدول المستخدمين
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0
)
`);

// جدول تخزين رسالة التوب
db.run(`
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
)
`);

// ================= أدوات =================
function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h || 0}h ${m || 0}m`;
}

function getConfig(key) {
  return new Promise(resolve => {
    db.get(`SELECT value FROM config WHERE key = ?`, [key], (err, row) => {
      resolve(row ? row.value : null);
    });
  });
}

function setConfig(key, value) {
  db.run(`INSERT OR REPLACE INTO config(key,value) VALUES(?,?)`, [key, value]);
}

// ================= إرسال / تحديث التوب =================
async function sendTop() {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

  const results = {};
  results.total = await new Promise(res => db.all(
    'SELECT * FROM users ORDER BY total DESC LIMIT 10',
    (e, r) => res(r || [])
  ));

  results.weekly = await new Promise(res => db.all(
    'SELECT * FROM users ORDER BY weekly DESC LIMIT 10',
    (e, r) => res(r || [])
  ));

  results.monthly = await new Promise(res => db.all(
    'SELECT * FROM users ORDER BY monthly DESC LIMIT 10',
    (e, r) => res(r || [])
  ));

  function build(rows, type) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => {
      const ms = type === "total" ? r.total : type === "weekly" ? r.weekly : r.monthly;
      return `**${i + 1}.** <@${r.id}> — ${formatTime(ms)}`;
    }).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 قائمة المتصدرين بالتواجد الصوتي")
    .setColor("Gold")
    .addFields(
      { name: "💯 التوب الكلي", value: build(results.total, "total") },
      { name: "📅 التوب الشهري", value: build(results.monthly, "monthly") },
      { name: "📆 التوب الأسبوعي", value: build(results.weekly, "weekly") }
    )
    .setFooter({ text: "Voice System By Nay 👑" });

  let messageId = await getConfig("topMessageId");

  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      console.log("⚠️ لم أجد الرسالة القديمة — سيتم إنشاء جديدة");
    }
  }

  const msg = await channel.send({ embeds: [embed] });
  setConfig("topMessageId", msg.id);
}

// ================= إضافة وقت يدوي =================
function addTime(userId, type, minutes) {
  const ms = minutes * 60 * 1000;

  db.run(`INSERT OR IGNORE INTO users(id,total,weekly,monthly) VALUES(?,0,0,0)`, [userId]);

  db.run(`
    UPDATE users
    SET ${type} = ${type} + ?
    WHERE id = ?
  `, [ms, userId], sendTop);
}

// ================= السلاش كوماند =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addtime') {

    if (interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const minutes = interaction.options.getInteger('minutes');

    addTime(user.id, type, minutes);

    interaction.reply({
      content: `✅ تمت إضافة ${minutes} دقيقة (${type}) لـ ${user.tag}`,
      ephemeral: true
    });
  }
});

// ================= عند تشغيل البوت =================
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // تسجيل الأمر
  const commands = [
    new SlashCommandBuilder()
      .setName('addtime')
      .setDescription('إضافة وقت')
      .addUserOption(o => o.setName('user').setDescription('الشخص').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('النوع').setRequired(true)
        .addChoices(
          { name: 'total', value: 'total' },
          { name: 'weekly', value: 'weekly' },
          { name: 'monthly', value: 'monthly' }
        ))
      .addIntegerOption(o => o.setName('minutes').setDescription('الدقائق').setRequired(true))
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  // تحديث الوقت كل 15 دقيقة
  setInterval(async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = guild.members.cache.filter(m => m.voice.channelId);
    const increment = 10 * 60 * 1000;

    members.forEach(member => {
      db.run(`INSERT OR IGNORE INTO users(id,total,weekly,monthly) VALUES(?,0,0,0)`, [member.id]);

      db.run(`
        UPDATE users
        SET total = total + ?, weekly = weekly + ?, monthly = monthly + ?
        WHERE id = ?
      `, [increment, increment, increment, member.id]);
    });

    sendTop();

  }, 15 * 60 * 1000);

  // إرسال أول مرة
  sendTop();
});

// ================= تصفيرات =================

// الأسبوعي كل أحد
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير أسبوعي");
});

// الشهري بداية الشهر
cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير شهري");
});

client.login(process.env.TOKEN);
