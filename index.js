require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
function saveTopMessageId(id) { fs.writeFileSync(messageFile, JSON.stringify({ id })); }
function getTopMessageId() { if (!fs.existsSync(messageFile)) return null; return JSON.parse(fs.readFileSync(messageFile)).id; }

// إنشاء جدول المستخدمين
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0
)
`);

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

  results.total = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY total DESC LIMIT 10', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  results.weekly = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY weekly DESC LIMIT 10', (err, rows) => err ? reject(err) : resolve(rows || []));
  });

  results.monthly = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM users ORDER BY monthly DESC LIMIT 10', (err, rows) => err ? reject(err) : resolve(rows || []));
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

// دالة لإضافة وقت لأي شخص
function addTime(userId, type, minutes) {
  const ms = minutes * 60 * 1000;
  let column;
  if (type === 'total') column = 'total';
  else if (type === 'weekly') column = 'weekly';
  else if (type === 'monthly') column = 'monthly';
  else return;

  db.run(`INSERT OR IGNORE INTO users(id, total, weekly, monthly) VALUES(?,0,0,0)`, [userId]);
  db.run(`UPDATE users SET ${column} = ${column} + ? WHERE id = ?`, [ms, userId], () => sendTop());
}

// === إعداد السلاش كوماند مع حماية ID ===
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addtime') {
    const allowedId = process.env.OWNER_ID; // ضع ID حسابك هنا
    if (interaction.user.id !== allowedId) {
      return interaction.reply({ content: "❌ ما عندك صلاحية لتعديل الوقت!", ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type'); // total, weekly, monthly
    const minutes = interaction.options.getInteger('minutes');

    addTime(user.id, type, minutes);
    await interaction.reply({ content: `✅ تم إضافة ${minutes} دقيقة لـ ${type} للشخص ${user.tag}`, ephemeral: true });
  }
});

// تسجيل السلاش كوماند عند التشغيل
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('addtime')
      .setDescription('إضافة وقت لشخص للكلي/الأسبوعي/الشهري')
      .addUserOption(option => option.setName('user').setDescription('اختر الشخص').setRequired(true))
      .addStringOption(option => option.setName('type').setDescription('النوع').setRequired(true).addChoices(
        { name: 'total', value: 'total' },
        { name: 'weekly', value: 'weekly' },
        { name: 'monthly', value: 'monthly' }
      ))
      .addIntegerOption(option => option.setName('minutes').setDescription('عدد الدقائق').setRequired(true))
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );

  // تحديث الكلي + الأسبوعي + الشهري كل 15 دقيقة
  setInterval(async () => {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const members = guild.members.cache.filter(m => m.voice.channelId);
    const increment = 10 * 60 * 1000; // 10 دقائق

    members.forEach(member => {
      const userId = member.id;
      db.run(`INSERT OR IGNORE INTO users(id, total, weekly, monthly) VALUES(?,0,0,0)`, [userId]);
      db.run(`UPDATE users SET total = total + ?, weekly = weekly + ?, monthly = monthly + ? WHERE id = ?`,
        [increment, increment, increment, userId]);
    });

    sendTop();
  }, 15 * 60 * 1000);

  sendTop();
});

// تصفير الأسبوعي كل أحد
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير الأسبوعي - بدأ أسبوع جديد");
});

// تصفير الشهري أول يوم بالشهر
cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير الشهري - بدأ شهر جديد");
});

client.login(process.env.TOKEN);
