require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// ================= تعريف العميل =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= قاعدة البيانات (المسار الدائم في Railway) =================
// تم تعديل المسار ليكون داخل الـ Volume المحمي
const db = new sqlite3.Database('/data/voice.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
)`);

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

// ================= متغير لمرة المنشن =================
let mentionSent = false;

// ================= تحديث / إرسال التوب =================
async function sendTop() {
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);
  if (!channel) return;

  const results = {};
  results.total = await new Promise(res => db.all('SELECT * FROM users ORDER BY total DESC LIMIT 10', (e, r) => res(r || [])));
  results.weekly = await new Promise(res => db.all('SELECT * FROM users ORDER BY weekly DESC LIMIT 10', (e, r) => res(r || [])));
  results.monthly = await new Promise(res => db.all('SELECT * FROM users ORDER BY monthly DESC LIMIT 10', (e, r) => res(r || [])));

  function build(rows, type) {
    if (!rows || !rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => {
      const ms = type === "total" ? r.total : type === "weekly" ? r.weekly : r.monthly;
      return `**${i + 1}.** <@${r.id}> — ${formatTime(ms)}`;
    }).join('\n');
  }

  let multiplierFieldValue = "";
  if (multiplierActive) {
    if (!mentionSent) {
      multiplierFieldValue = `✅ مضاعفة مفعلة x${multiplierValue}\n@everyone`;
      mentionSent = true;
    } else {
      multiplierFieldValue = `✅ مضاعفة مفعلة x${multiplierValue}`;
    }
  } else {
    multiplierFieldValue = "❌ مضاعفة متوقفة";
    mentionSent = false;
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 قائمة المتصدرين بالتواجد الصوتي")
    .setColor("Gold")
    .addFields(
      { name: "💯 التوب الكلي", value: build(results.total, "total") },
      { name: "📅 التوب الشهري", value: build(results.monthly, "monthly") },
      { name: "📆 التوب الأسبوعي", value: build(results.weekly, "weekly") },
      { name: "⚡ حالة المضاعفة", value: multiplierFieldValue }
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
  db.run(`UPDATE users SET ${type} = ${type} + ? WHERE id = ?`, [ms, userId], sendTop);
}

// ================= مضاعفة النقاط =================
let multiplierActive = false;
let multiplierValue = 3;

// ================= أوامر السلاش =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const owners = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',').map(id => id.trim()) : [];
  const multiUsers = process.env.MULTI_USERS ? process.env.MULTI_USERS.split(',').map(id => id.trim()) : [];

  if (interaction.commandName === 'addtime') {
    if (!owners.includes(interaction.user.id)) {
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });
    }
    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const minutes = interaction.options.getInteger('minutes');
    addTime(user.id, type, minutes);
    return interaction.reply({ content: `✅ تمت إضافة ${minutes} دقيقة (${type}) لـ ${user.tag}`, ephemeral: true });
  }

  if (interaction.commandName === 'rank') {
    db.all('SELECT id, total FROM users ORDER BY total DESC', [], (err, rows) => {
      if (err || !rows || !rows.length) return interaction.reply({ content: "❌ لا توجد بيانات", ephemeral: true });
      const rank = rows.findIndex(r => r.id === interaction.user.id) + 1;
      const userData = rows.find(r => r.id === interaction.user.id);
      const timeStr = formatTime(userData ? userData.total : 0);
      interaction.reply({ content: `🏅 ترتيبك: **${rank || '-'}**\n⏱️ إجمالي وقتك: **${timeStr}**`, ephemeral: true });
    });
  }

  if (interaction.commandName === 'multiplier') {
    if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });
    multiplierActive = true;
    interaction.reply({ content: `✅ تم تفعيل مضاعفة النقاط x${multiplierValue}`, ephemeral: true });
  }

  if (interaction.commandName === 'stopmultiplier') {
    if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });
    multiplierActive = false;
    interaction.reply({ content: "✅ تم إيقاف مضاعفة النقاط", ephemeral: true });
  }
});

// ================= عند تشغيل البوت =================
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

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
      .addIntegerOption(o => o.setName('minutes').setDescription('الدقائق').setRequired(true)),
    new SlashCommandBuilder().setName('rank').setDescription('يعرض ترتيبك بالتواجد الصوتي'),
    new SlashCommandBuilder().setName('multiplier').setDescription('تفعيل مضاعفة النقاط (محمي)'),
    new SlashCommandBuilder().setName('stopmultiplier').setDescription('إيقاف مضاعفة النقاط (محمي)')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ تمت مزامنة الأوامر");
  } catch (error) {
    console.error(error);
  }

  sendTop();
});

// ================= إضافة الوقت كل دقيقة =================
setInterval(async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const voiceStates = guild.voiceStates.cache;

    let increment = 60 * 1000;
    if (multiplierActive) increment *= multiplierValue;

    voiceStates.forEach(vs => {
      if (!vs.channelId || vs.member.user.bot) return;
      db.run(`INSERT OR IGNORE INTO users(id,total,weekly,monthly) VALUES(?,0,0,0)`, [vs.id]);
      db.run(`UPDATE users SET total = total + ?, weekly = weekly + ?, monthly = monthly + ? WHERE id = ?`, [increment, increment, increment, vs.id]);
    });
  } catch (e) {
    console.error("خطأ في تحديث الوقت:", e);
  }
}, 60 * 1000);

// ================= تحديث التوب كل دقيقة =================
setInterval(() => {
  sendTop();
}, 60 * 1000);

// ================= تصفيرات =================
cron.schedule('0 0 * * 0', () => {
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير أسبوعي");
});

cron.schedule('0 0 1 * *', () => {
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير شهري");
});

client.login(process.env.TOKEN);
