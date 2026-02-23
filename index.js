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

// قاعدة البيانات بالمسار الدائم في Railway
const db = new sqlite3.Database('/data/voice.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, total INTEGER DEFAULT 0, weekly INTEGER DEFAULT 0, monthly INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);
});

// ================= أدوات التنسيق والبيانات =================
function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h || 0}h ${m || 0}m`;
}

function getConfig(key) {
  return new Promise(resolve => {
    db.get(`SELECT value FROM config WHERE key = ?`, [key], (err, row) => resolve(row ? row.value : null));
  });
}

function setConfig(key, value) {
  db.run(`INSERT OR REPLACE INTO config(key,value) VALUES(?,?)`, [key, value]);
}

let multiplierActive = false;
let multiplierValue = 3;
let mentionSent = false;

// ================= وظيفة تحديث التوب الحالي =================
async function sendTop() {
  const channelId = process.env.CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const results = {};
  results.total = await new Promise(res => db.all('SELECT * FROM users ORDER BY total DESC LIMIT 10', (e, r) => res(r || [])));
  results.weekly = await new Promise(res => db.all('SELECT * FROM users ORDER BY weekly DESC LIMIT 10', (e, r) => res(r || [])));
  results.monthly = await new Promise(res => db.all('SELECT * FROM users ORDER BY monthly DESC LIMIT 10', (e, r) => res(r || [])));

  function build(rows, type) {
    if (!rows || !rows.length) return "لا يوجد بيانات حالياً";
    return rows.map((r, i) => {
      const ms = type === "total" ? r.total : type === "weekly" ? r.weekly : r.monthly;
      return `**${i + 1}.** <@${r.id}> — ${formatTime(ms)}`;
    }).join('\n');
  }

  let multiplierText = multiplierActive ? `✅ مضاعفة مفعلة x${multiplierValue}${!mentionSent ? "\n@everyone" : ""}` : "❌ مضاعفة متوقفة";
  if (multiplierActive) mentionSent = true;

  const embed = new EmbedBuilder()
    .setTitle("🏆 قائمة المتصدرين بالتواجد الصوتي")
    .setColor("Gold")
    .addFields(
      { name: "💯 التوب الكلي", value: build(results.total, "total") },
      { name: "📅 التوب الشهري", value: build(results.monthly, "monthly") },
      { name: "📆 التوب الأسبوعي", value: build(results.weekly, "weekly") },
      { name: "⚡ حالة المضاعفة", value: multiplierText }
    )
    .setFooter({ text: "Voice System By Nay 👑" });

  let messageId = await getConfig("topMessageId");
  if (messageId) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) return msg.edit({ embeds: [embed] });
  }
  const newMsg = await channel.send({ embeds: [embed] });
  setConfig("topMessageId", newMsg.id);
}

// ================= وظيفة إرسال لوحة الشرف (التكريم) =================
async function sendHonorRoll(type) { 
  const channelId = process.env.CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const rows = await new Promise(res => db.all(`SELECT * FROM users WHERE ${type} > 0 ORDER BY ${type} DESC LIMIT 5`, (e, r) => res(r || [])));
  if (rows.length === 0) return console.log(`No data to record for ${type} honor roll.`);

  const title = type === 'weekly' ? "🌟 نجوم الأسبوع الماضي" : "💎 أساطير الشهر الماضي";
  const configKey = type === 'weekly' ? "lastWeeklyMsgId" : "lastMonthlyMsgId";

  const list = rows.map((r, i) => `**#${i + 1}** <@${r.id}> — ${formatTime(r[type])}`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(list)
    .setColor(type === 'weekly' ? "#3498db" : "#9b59b6")
    .setTimestamp()
    .setFooter({ text: "لوحة الشرف الدائمة" });

  let oldId = await getConfig(configKey);
  if (oldId) {
    const oldMsg = await channel.messages.fetch(oldId).catch(() => null);
    if (oldMsg) return oldMsg.edit({ embeds: [embed] });
  }
  const newMsg = await channel.send({ embeds: [embed] });
  setConfig(configKey, newMsg.id);
}

// ================= التعامل مع الأوامر =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const owners = (process.env.OWNER_IDS || "").split(',').map(id => id.trim());
  const multiUsers = (process.env.MULTI_USERS || "").split(',').map(id => id.trim());

  if (interaction.commandName === 'rank') {
    db.get('SELECT * FROM users WHERE id = ?', [interaction.user.id], (err, row) => {
      if (!row) return interaction.reply({ content: "❌ ليس لديك بيانات بعد، ادخل الرومات الصوتية أولاً!", ephemeral: true });
      interaction.reply({ 
        content: `🏅 ترتيبك الكلي ومجموع وقتك:\n⏱️ الوقت: **${formatTime(row.total)}**`, 
        ephemeral: true 
      });
    });
  }

  // أمر التجربة الجديد لرؤية لوحة الشرف فوراً
  if (interaction.commandName === 'test_honor') {
    if (!owners.includes(interaction.user.id)) return interaction.reply({ content: "❌ للأونر فقط", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    await sendHonorRoll('weekly');
    await sendHonorRoll('monthly');
    await interaction.editReply({ content: "✅ تم تحديث/إرسال لوحات الشرف بنجاح أسفل التوب الرئيسي." });
  }

  if (interaction.commandName === 'multiplier') {
    if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌ لا تملك صلاحية", ephemeral: true });
    multiplierActive = true; mentionSent = false;
    await interaction.reply({ content: "✅ تم تفعيل المضاعفة", ephemeral: true });
    sendTop();
  }

  if (interaction.commandName === 'stopmultiplier') {
    if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌ لا تملك صلاحية", ephemeral: true });
    multiplierActive = false;
    await interaction.reply({ content: "✅ تم إيقاف المضاعفة", ephemeral: true });
    sendTop();
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const commands = [
    new SlashCommandBuilder().setName('rank').setDescription('عرض وقتك وتواجدك'),
    new SlashCommandBuilder().setName('multiplier').setDescription('تفعيل مضاعفة النقاط'),
    new SlashCommandBuilder().setName('stopmultiplier').setDescription('إيقاف مضاعفة النقاط'),
    new SlashCommandBuilder().setName('test_honor').setDescription('تجربة إرسال لوحة الشرف (للأونر)')
  ];
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ Commands registered.");
  } catch (e) { console.error(e); }
  sendTop();
});

// ================= نظام احتساب الوقت والجدولة =================
setInterval(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return;
  const voiceStates = guild.voiceStates.cache;
  let increment = 60000 * (multiplierActive ? multiplierValue : 1);

  voiceStates.forEach(vs => {
    if (!vs.channelId || vs.member.user.bot) return;
    db.run(`INSERT OR IGNORE INTO users(id) VALUES(?)`, [vs.id]);
    db.run(`UPDATE users SET total = total + ?, weekly = weekly + ?, monthly = monthly + ? WHERE id = ?`, [increment, increment, increment, vs.id]);
  });
}, 60000);

setInterval(() => sendTop(), 60000); // تحديث التوب كل دقيقة

// الجدولة التلقائية للتصفيير والتكريم
cron.schedule('0 0 * * 0', async () => {
  await sendHonorRoll('weekly'); 
  db.run(`UPDATE users SET weekly = 0`);
  console.log("🔄 Weekly reset and honor roll updated.");
});

cron.schedule('0 0 1 * *', async () => {
  await sendHonorRoll('monthly');
  db.run(`UPDATE users SET monthly = 0`);
  console.log("🔄 Monthly reset and honor roll updated.");
});

client.login(process.env.TOKEN);
