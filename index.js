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

// ================= قاعدة البيانات =================
const db = new sqlite3.Database('./voice.db');

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

  const results = {};
  results.total = await new Promise(res => db.all('SELECT * FROM users ORDER BY total DESC LIMIT 10', (e, r) => res(r || [])));
  results.weekly = await new Promise(res => db.all('SELECT * FROM users ORDER BY weekly DESC LIMIT 10', (e, r) => res(r || [])));
  results.monthly = await new Promise(res => db.all('SELECT * FROM users ORDER BY monthly DESC LIMIT 10', (e, r) => res(r || [])));

  function build(rows, type) {
    if (!rows.length) return "لا يوجد بيانات";
    return rows.map((r, i) => {
      const ms = type === "total" ? r.total : type === "weekly" ? r.weekly : r.monthly;
      return `**${i + 1}.** <@${r.id}> — ${formatTime(ms)}`;
    }).join('\n');
  }

  // ================= حالة المضاعفة + منشن ذكي =================
  let multiplierFieldValue = "";
  if (multiplierActive) {
    if (!mentionSent) {
      multiplierFieldValue = `✅ مضاعفة مفعلة x${multiplierValue}\n@everyone`;
      mentionSent = true; // منشن يتم مرة واحدة فقط
    } else {
      multiplierFieldValue = `✅ مضاعفة مفعلة x${multiplierValue}`;
    }
  } else {
    multiplierFieldValue = "❌ مضاعفة متوقفة";
    mentionSent = false; // إعادة تعيين عند إيقاف المضاعفة
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
let multiplierValue = 3; // كل دقيقة تصبح 3 دقائق عند تفعيل المضاعفة

// ================= أوامر السلاش =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addtime') {
   const owners = process.env.OWNER_IDS.split(',').map(id => id.trim());

if (!owners.includes(interaction.user.id)) {
  return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });
}

    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const minutes = interaction.options.getInteger('minutes');

    addTime(user.id, type, minutes);

    return interaction.reply({
      content: `✅ تمت إضافة ${minutes} دقيقة (${type}) لـ ${user.tag}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === 'rank') {
    const userId = interaction.user.id;
    db.all('SELECT id, total FROM users ORDER BY total DESC', [], (err, rows) => {
      if (err || !rows.length)
        return interaction.reply({ content: "❌ لا توجد بيانات", ephemeral: true });

      const rank = rows.findIndex(r => r.id === userId) + 1;
      const userData = rows.find(r => r.id === userId);
      const timeStr = formatTime(userData ? userData.total : 0);

      interaction.reply({
        content: `🏅 ترتيبك: **${rank || '-'}**\n⏱️ إجمالي وقتك: **${timeStr}**`,
        ephemeral: true
      });
    });
  }

  if (interaction.commandName === 'multiplier') {
    if (!process.env.MULTI_USERS.split(',').includes(interaction.user.id))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    multiplierActive = true;
    interaction.reply({ content: `✅ تم تفعيل مضاعفة النقاط x${multiplierValue}`, ephemeral: true });
  }

  if (interaction.commandName === 'stopmultiplier') {
    if (!process.env.MULTI_USERS.split(',').includes(interaction.user.id))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

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
      .addIntegerOption(o => o.setName('minutes').setDescription('الدقائق').setRequired(true))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('يعرض ترتيبك بالتواجد الصوتي')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('multiplier')
      .setDescription('تفعيل مضاعفة النقاط (محمي)')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('stopmultiplier')
      .setDescription('إيقاف مضاعفة النقاط (محمي)')
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  // إرسال التوب لأول مرة
  sendTop();
});

// ================= إضافة الوقت كل دقيقة =================
setInterval(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const members = guild.members.cache.filter(m => m.voice.channelId);

  let increment = 1 * 60 * 1000; // دقيقة واحدة
  if (multiplierActive) increment *= multiplierValue; // 3 دقائق عند المضاعفة

  members.forEach(member => {
    db.run(`INSERT OR IGNORE INTO users(id,total,weekly,monthly) VALUES(?,0,0,0)`, [member.id]);
    db.run(`
      UPDATE users
      SET total = total + ?, weekly = weekly + ?, monthly = monthly + ?
      WHERE id = ?
    `, [increment, increment, increment, member.id]);
  });
}, 1 * 60 * 1000); // كل دقيقة

// ================= تحديث التوب كل 5 دقائق =================
setInterval(() => {
  sendTop();
}, 1 * 60 * 1000); // كل 5 دقائق

// ================= تصفيرات =================
cron.schedule('0 0 * * 0', () => { // الأسبوعي كل أحد
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 تصفير أسبوعي");
});

cron.schedule('0 0 1 * *', () => { // الشهري بداية الشهر
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 تصفير شهري");
});

// ================= تشغيل البوت =================
client.login(process.env.TOKEN);

