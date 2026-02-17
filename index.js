require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= إعداداتك =================
const ROOM_ID = "1461062092642717964"; // روم إرسال التوب
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

// رولات كل ترتيب للكلي، الأسبوعي، الشهري
const ROLE_TOTAL = ["ROLE_TOTAL_1","ROLE_TOTAL_2","ROLE_TOTAL_3","ROLE_TOTAL_4","ROLE_TOTAL_5"]; 
const ROLE_WEEKLY = ["ROLE_WEEKLY_1","ROLE_WEEKLY_2","ROLE_WEEKLY_3"];
const ROLE_MONTHLY = ["ROLE_MONTHLY_1","ROLE_MONTHLY_2"];

const db = new sqlite3.Database("./voice.sqlite");

// ================= إنشاء جدول المستخدمين =================
db.run(`
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  weekly INTEGER DEFAULT 0,
  monthly INTEGER DEFAULT 0
)
`);

let voiceTimes = {};
let multiplier = 1;

// ================= تتبع الصوت =================
client.on("voiceStateUpdate", (oldState, newState) => {
  const userId = newState.id;

  if (!oldState.channelId && newState.channelId) voiceTimes[userId] = Date.now();

  if (oldState.channelId && !newState.channelId) {
    if (!voiceTimes[userId]) return;
    const duration = Math.floor((Date.now() - voiceTimes[userId]) / 60000) * multiplier;
    delete voiceTimes[userId];

    db.get(`SELECT * FROM users WHERE userId = ?`, [userId], (err, row) => {
      if (!row) {
        db.run(`INSERT INTO users (userId, total, weekly, monthly) VALUES (?, ?, ?, ?)`,
          [userId, duration, duration, duration]);
      } else {
        db.run(`UPDATE users SET total = total + ?, weekly = weekly + ?, monthly = monthly + ? WHERE userId = ?`,
          [duration, duration, duration, userId]);
      }
    });
  }
});

// ================= إرسال التوب =================
async function sendLeaderboard() {
  const channel = client.channels.cache.get(ROOM_ID);
  if (!channel) return;

  const guild = client.guilds.cache.get(GUILD_ID);

  const types = [
    { name: "🏆 التوب الكلي", dbCol: "total", roles: ROLE_TOTAL, limit: 10 },
    { name: "🔥 التوب الأسبوعي", dbCol: "weekly", roles: ROLE_WEEKLY, limit: 10 },
    { name: "📅 التوب الشهري", dbCol: "monthly", roles: ROLE_MONTHLY, limit: 10 },
  ];

  for (const type of types) {
    db.all(`SELECT * FROM users ORDER BY ${type.dbCol} DESC LIMIT ${type.limit}`, async (err, rows) => {
      const desc = rows.map((u,i) => `**${i+1}.** <@${u.userId}> — ${u[type.dbCol]} دقيقة`).join("\n") || "لا يوجد بيانات";
      const embed = new EmbedBuilder().setTitle(type.name).setDescription(desc).setColor("Gold");
      await channel.send({ embeds: [embed] });

      // توزيع الرولات حسب ترتيب محدد
      if (rows.length && type.roles.length) {
        // شيل جميع رولات هذا النوع
        guild.members.cache.forEach(m => {
          type.roles.forEach(rid => { if (m.roles.cache.has(rid)) m.roles.remove(rid).catch(()=>{}); });
        });
        // أعط الرول للأوائل حسب ترتيبهم
        rows.forEach(async (u,i) => {
          if (type.roles[i]) {
            const member = await guild.members.fetch(u.userId).catch(()=>null);
            if (member) member.roles.add(type.roles[i]).catch(()=>{});
          }
        });
      }
    });
  }
}

// ================= سلاش كوماند =================
const commands = [
  new SlashCommandBuilder().setName("leaderboard").setDescription("إرسال التوب الآن"),
  new SlashCommandBuilder().setName("rank").setDescription("معرفة ترتيب عضو").addUserOption(opt=>opt.setName("user").setDescription("العضو").setRequired(true)),
  new SlashCommandBuilder().setName("multiply").setDescription("تشغيل مضاعفة النقاط").addIntegerOption(opt=>opt.setName("number").setDescription("الرقم").setRequired(true)),
  new SlashCommandBuilder().setName("multiplyoff").setDescription("إيقاف المضاعفة")
].map(cmd=>cmd.toJSON());

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  // تحديث التوب كل 15 دقيقة
  setInterval(sendLeaderboard, 15*60*1000);
  sendLeaderboard();
});

// ================= التفاعل مع السلاش =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "leaderboard") {
    await sendLeaderboard();
    return interaction.reply({ content: "✅ تم الإرسال", ephemeral: true });
  }

  if (interaction.commandName === "rank") {
    const user = interaction.options.getUser("user");
    db.get(`SELECT * FROM users WHERE userId = ?`, [user.id], (err,row)=>{
      if (!row) return interaction.reply("لا يوجد بيانات");
      const embed = new EmbedBuilder()
        .setTitle(`📊 ترتيب ${user.username}`)
        .setDescription(`
الكلي: ${row.total} دقيقة
الأسبوعي: ${row.weekly} دقيقة
الشهري: ${row.monthly} دقيقة
        `);
      interaction.reply({ embeds:[embed] });
    });
  }

  if (interaction.commandName === "multiply") {
    multiplier = interaction.options.getInteger("number");
    interaction.reply(`✅ تم تشغيل المضاعفة ×${multiplier}`);
  }

  if (interaction.commandName === "multiplyoff") {
    multiplier = 1;
    interaction.reply("✅ تم إيقاف المضاعفة");
  }
});

// ================= تصفير أسبوعي وشهري =================
cron.schedule("0 0 * * 0", () => db.run(`UPDATE users SET weekly = 0`));
cron.schedule("0 0 1 * *", () => db.run(`UPDATE users SET monthly = 0`));

client.login(TOKEN);
