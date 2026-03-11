require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent 
  ]
});

// وبعدها يكمل باقي كود قاعدة البيانات والأنظمة...

// ================= قاعدة البيانات =================
const db = new sqlite3.Database('/data/voice.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, total INTEGER DEFAULT 0, weekly INTEGER DEFAULT 0, monthly INTEGER DEFAULT 0)`);
  db.run(`ALTER TABLE users ADD COLUMN win_streak INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column name")) console.error("Error updating table:", err.message);
  });
  db.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS duels (id INTEGER PRIMARY KEY AUTOINCREMENT, user1 TEXT, user2 TEXT, score1 INTEGER DEFAULT 0, score2 INTEGER DEFAULT 0, end_time INTEGER, channel_id TEXT, status TEXT DEFAULT 'pending')`);
  db.run(`CREATE TABLE IF NOT EXISTS revenge (loser_id TEXT PRIMARY KEY, last_defeated_by TEXT)`);
});

// ================= أدوات التنسيق =================
function formatTime(ms) {
  const isNegative = ms < 0;
  const absMs = Math.abs(ms);
  const h = Math.floor(absMs / 3600000);
  const m = Math.floor((absMs % 3600000) / 60000);
  return `${isNegative ? '-' : ''}${h || 0}h ${m || 0}m`;
}

async function getConfig(key) {
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

// ================= وظائف التوب ولوحة الشرف =================
async function sendTop() {
  const channelId = process.env.CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const getTop = (type) => new Promise(res => db.all(`SELECT * FROM users ORDER BY ${type} DESC LIMIT 10`, (e, r) => res(r || [])));
  const results = {
    total: await getTop('total'),
    weekly: await getTop('weekly'),
    monthly: await getTop('monthly')
  };

  function build(rows, type) {
    if (!rows || !rows.length) return "لا يوجد بيانات حالياً";
    return rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${formatTime(r[type])}`).join('\n');
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

async function sendHonorRoll(type) { 
  const channelId = process.env.CHANNEL_ID;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const rows = await new Promise(res => db.all(`SELECT * FROM users WHERE ${type} > 0 ORDER BY ${type} DESC LIMIT 5`, (e, r) => res(r || [])));
  if (rows.length === 0) return;

  const title = type === 'weekly' ? "🌟 نجوم الأسبوع الماضي" : "💎 أساطير الشهر الماضي";
  const configKey = type === 'weekly' ? "lastWeeklyMsgId" : "lastMonthlyMsgId";
  const list = rows.map((r, i) => `**#${i + 1}** <@${r.id}> — ${formatTime(r[type])}`).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(title).setDescription(list).setColor(type === 'weekly' ? "#3498db" : "#9b59b6")
    .setTimestamp().setFooter({ text: "لوحة الشرف الدائمة" });

  let oldId = await getConfig(configKey);
  if (oldId) {
    const oldMsg = await channel.messages.fetch(oldId).catch(() => null);
    if (oldMsg) return oldMsg.edit({ embeds: [embed] });
  }
  const newMsg = await channel.send({ embeds: [embed] });
  setConfig(configKey, newMsg.id);
}

// ================= إدارة الوقت =================
function modifyTime(userId, type, minutes, isAddition = true) {
  const ms = minutes * 60 * 1000;
  const operator = isAddition ? '+' : '-';
  db.run(`INSERT OR IGNORE INTO users(id) VALUES(?)`, [userId]);
  if (type === 'all') {
    db.run(`UPDATE users SET total = total ${operator} ?, weekly = weekly ${operator} ?, monthly = monthly ${operator} ? WHERE id = ?`, [ms, ms, ms, userId], () => sendTop());
  } else {
    db.run(`UPDATE users SET ${type} = ${type} ${operator} ? WHERE id = ?`, [ms, userId], () => sendTop());
  }
}

// ================= التفاعلات =================
client.on('interactionCreate', async interaction => {
  const owners = (process.env.OWNER_IDS || "").split(',').map(id => id.trim());
  const multiUsers = (process.env.MULTI_USERS || "").split(',').map(id => id.trim());

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'addtime') {
      if (!owners.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      modifyTime(interaction.options.getUser('user').id, interaction.options.getString('type'), interaction.options.getInteger('minutes'), true);
      return interaction.reply({ content: "✅ تمت الإضافة", ephemeral: true });
    }
    if (interaction.commandName === 'removetime') {
      if (!owners.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      modifyTime(interaction.options.getUser('user').id, interaction.options.getString('type'), interaction.options.getInteger('minutes'), false);
      return interaction.reply({ content: "📉 تم الخصم", ephemeral: true });
    }
    if (interaction.commandName === 'test_honor') {
      if (!owners.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      await sendHonorRoll('weekly'); await sendHonorRoll('monthly');
      return interaction.reply({ content: "✅ حدثت لوحات الشرف", ephemeral: true });
    }
    if (interaction.commandName === 'check_path') {
      if (!owners.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      return interaction.reply({ content: `📂 المسار: \`${db.filename}\``, ephemeral: true });
    }
    if (interaction.commandName === 'multiplier') {
      if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      multiplierActive = true; mentionSent = false;
      await interaction.reply({ content: "✅ فعلت المضاعفة", ephemeral: true });
      sendTop();
    }
    if (interaction.commandName === 'stopmultiplier') {
      if (!multiUsers.includes(interaction.user.id)) return interaction.reply({ content: "❌", ephemeral: true });
      multiplierActive = false;
      await interaction.reply({ content: "✅ أوقفت المضاعفة", ephemeral: true });
      sendTop();
    }
    if (interaction.commandName === 'rank') {
      const target = interaction.options.getUser('user') || interaction.user;
      db.get(`SELECT total, weekly, monthly, win_streak FROM users WHERE id = ?`, [target.id], (err, row) => {
        if (err) return console.error(err.message);
        const total = row ? row.total : 0;
        const weekly = row ? row.weekly : 0;
        const monthly = row ? row.monthly : 0;
        const streak = row ? row.win_streak || 0 : 0;

        const rankEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`📊 إحصائيات الصوت | ${target.username}`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '⏳ الوقت الإجمالي', value: `\`${formatTime(total)}\``, inline: false },
            { name: '📅 هذا الشهر', value: `\`${formatTime(monthly)}\``, inline: true },
            { name: '🗓️ هذا الأسبوع', value: `\`${formatTime(weekly)}\``, inline: true },
            { name: '🔥 سلسلة الانتصارات', value: `\`${streak}\` فوز متتالي`, inline: false },
          )
          .setFooter({ text: `طلب بواسطة: ${interaction.user.tag}`, icon_url: interaction.user.displayAvatarURL() })
          .setTimestamp();
        interaction.reply({ embeds: [rankEmbed] });
      });
    }
    if (interaction.commandName === 'duel') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      if (target.id === interaction.user.id) return interaction.reply({ content: "لا تتحدى نفسك!", ephemeral: true });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${interaction.user.id}_${target.id}_${hours}`).setLabel('موافقة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${target.id}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
      );
      await interaction.reply({ embeds: [new EmbedBuilder().setTitle("⚔️ تحدي جديد").setDescription(`<@${interaction.user.id}> تحدى <@${target.id}> لـ ${hours} ساعة.`).setColor("#3498db")], components: [row] });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('accept_')) {
      const [_, u1, u2, hours] = interaction.customId.split('_');
      if (interaction.user.id !== u2) return interaction.reply({ content: "التحدي ليس لك!", ephemeral: true });
      
      const end = Date.now() + (parseInt(hours) * 3600000);
      
      // تغيير اسم الروم عند القبول
      try {
        const user1 = await client.users.fetch(u1).catch(() => ({ username: 'Unknown' }));
        const user2 = interaction.user;
        const duelVoiceId = process.env.DUEL_VOICE_CH_ID;
        const duelChannel = await interaction.guild.channels.fetch(duelVoiceId).catch(() => null);
        if (duelChannel) {
          await duelChannel.setName(`⚔️ ${user1.username} VS ${user2.username}`).catch(() => null);
        }
      } catch (e) { console.error(e); }

      db.run(`INSERT INTO duels (user1, user2, end_time, channel_id, status) VALUES (?, ?, ?, ?, 'active')`, [u1, u2, end, interaction.channelId]);
      await interaction.update({ content: `✅ بدأ التحدي! ينتهي <t:${Math.floor(end/1000)}:R>`, embeds: [], components: [] });
    }
    if (interaction.customId.startsWith('reject_')) {
      const [_, u2] = interaction.customId.split('_');
      if (interaction.user.id !== u2) return interaction.reply({ content: "التحدي ليس لك!", ephemeral: true });
      await interaction.update({ content: "❌ تم رفض التحدي.", embeds: [], components: [] });
    }
  }
});

// ================= نظام القصيد الكشخة =================
client.on('messageCreate', async message => {
  // 1. التأكد أن الرسالة ليست من بوت
  if (message.author.bot) return;

  // 2. تحديد آيدي الروم يدوياً لضمان العمل (بدل الاعتماد على Variable ريلوي)
  const poetryChannelId = '1481115797496791040';

  if (message.channel.id === poetryChannelId) {
    console.log(`✅ رصدت قصيدة من ${message.author.username}`); // هذا بيظهر لك في ريلوي

    const poetryEmbed = new EmbedBuilder()
      .setAuthor({ 
        name: `🖋️ قـصـيد: ${message.author.username}`,
        iconURL: message.author.displayAvatarURL({ dynamic: true }) 
      })
      .setDescription(`${message.content}`)
      .setColor("#4169E1") 
      .setThumbnail('https://media.discordapp.net/attachments/1420578206863327276/1481112912780329100/pngegg.png')
      .setFooter({ text: '⚖️┃سـجالات-شـعرية', iconURL: message.guild.iconURL() })
      .setTimestamp();

    try {
      // حذف الرسالة الأصلية (تأكد أن رتبة البوت فوقك أو عنده Manage Messages)
      await message.delete().catch(() => console.log("⚠️ فشل الحذف - غالباً رتبة البوت تحتك أو ينقصه Manage Messages"));
      
      // إرسال الإمبد
      await message.channel.send({ embeds: [poetryEmbed] });
      console.log("✨ تم إرسال الإمبد بنجاح");
    } catch (err) {
      console.error("❌ خطأ في الإرسال:", err);
    }
  }
});

// ================= الأنظمة الدورية =================
setInterval(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return;
  let increment = 60000 * (multiplierActive ? multiplierValue : 1);
  guild.voiceStates.cache.forEach(vs => {
    if (!vs.channelId || vs.member.user.bot) return;
    const userId = vs.id;
    db.serialize(() => {
      db.run(`INSERT OR IGNORE INTO users(id) VALUES(?)`, [userId]);
      db.run(`UPDATE users SET total=total+?, weekly=weekly+?, monthly=monthly+? WHERE id=?`, [increment, increment, increment, userId]);
      db.run(`UPDATE duels SET score1=score1+? WHERE user1=? AND status='active'`, [increment, userId]);
      db.run(`UPDATE duels SET score2=score2+? WHERE user2=? AND status='active'`, [increment, userId]);
    });
  });
}, 60000);

setInterval(() => {
  db.all(`SELECT * FROM duels WHERE status='active' AND end_time <= ?`, [Date.now()], async (err, rows) => {
    if (!rows || rows.length === 0) return;
    for (const d of rows) {
      const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
      if (!guild) continue;
      const chan = await client.channels.fetch(d.channel_id).catch(() => null);
      
      // إعادة اسم الروم للأصل عند انتهاء أي تحدي
      const duelVoiceId = process.env.DUEL_VOICE_CH_ID;
      const duelChannel = await guild.channels.fetch(duelVoiceId).catch(() => null);
      if (duelChannel) {
      await duelChannel.setName('⚔️ 1v1 ⚔️').catch(() => null); // استبدل بالاسم الأصلي 
      }

      let winId = d.score1 > d.score2 ? d.user1 : (d.score2 > d.score1 ? d.user2 : null);
      let losId = winId === d.user1 ? d.user2 : d.user1;
      const roleId = process.env.LOSER_ROLE_ID;

      if (winId && chan) {
        db.get(`SELECT last_defeated_by FROM revenge WHERE loser_id=?`, [winId], async (e, r) => {
          let revText = (r && r.last_defeated_by === losId) ? `\n\n**🔥 رديت ثاري ياهطف <@${losId}>** 🤡` : "";
          db.run(`INSERT OR REPLACE INTO revenge (loser_id, last_defeated_by) VALUES (?, ?)`, [losId, winId]);
          db.run(`UPDATE users SET win_streak=win_streak+1 WHERE id=?`, [winId]);
          db.run(`UPDATE users SET win_streak=0 WHERE id=?`, [losId]);

          const wM = await guild.members.fetch(winId).catch(() => null);
          const lM = await guild.members.fetch(losId).catch(() => null);
          if (wM && roleId) await wM.roles.remove(roleId).catch(() => null);
          if (lM && roleId) await lM.roles.add(roleId).catch(() => null);

          chan.send({ content: revText ? `<@${losId}> ابللللع!` : `<@${losId}> هاردلك..`, embeds: [new EmbedBuilder().setTitle("🏆 نتيجة التحدي").setDescription(`الفائز: <@${winId}>\nالخاسر: <@${losId}> 🤡${revText}`).setColor("#f1c40f")] });
          setTimeout(async () => { const m = await guild.members.fetch(losId).catch(() => null); if (m && roleId) await m.roles.remove(roleId).catch(() => null); }, 24*60*60*1000);
        });
      } else if (chan) {
        chan.send("⚖️ تعادل التحدي!");
      }
      db.run(`UPDATE duels SET status='finished' WHERE id=?`, [d.id]);
    }
  });
}, 60000);

setInterval(() => sendTop(), 60000);

cron.schedule('0 0 * * 0', async () => { await sendHonorRoll('weekly'); db.run(`UPDATE users SET weekly = 0`); });
cron.schedule('0 0 1 * *', async () => { await sendHonorRoll('monthly'); db.run(`UPDATE users SET monthly = 0`); });

client.once('ready', async () => {
  const choices = [{ name: 'الكل', value: 'all' }, { name: 'كلي', value: 'total' }, { name: 'أسبوعي', value: 'weekly' }, { name: 'شهري', value: 'monthly' }];
  const commands = [
    new SlashCommandBuilder().setName('rank').setDescription('عرض وقتك الشخصي').addUserOption(o=>o.setName('user').setDescription('اختر العضو')),
    new SlashCommandBuilder().setName('check_path').setDescription('فحص تخزين البيانات'),
    new SlashCommandBuilder().setName('multiplier').setDescription('تفعيل مضاعفة الوقت'),
    new SlashCommandBuilder().setName('stopmultiplier').setDescription('إيقاف مضاعفة الوقت'),
    new SlashCommandBuilder().setName('test_honor').setDescription('تجربة إرسال لوحة الشرف'),
    new SlashCommandBuilder().setName('duel').setDescription('بدء تحدي ثنائي').addUserOption(o=>o.setName('user').setDescription('اختر العضو الخصم').setRequired(true)).addIntegerOption(o=>o.setName('hours').setDescription('عدد ساعات التحدي').setRequired(true)),
    new SlashCommandBuilder().setName('addtime').setDescription('إضافة وقت لعضو').addUserOption(o=>o.setName('user').setDescription('اختر العضو').setRequired(true)).addStringOption(o=>o.setName('type').setDescription('نوع التوب').setRequired(true).addChoices(...choices)).addIntegerOption(o=>o.setName('minutes').setDescription('الدقائق').setRequired(true)),
    new SlashCommandBuilder().setName('removetime').setDescription('خصم وقت من عضو').addUserOption(o=>o.setName('user').setDescription('اختر العضو').setRequired(true)).addStringOption(o=>o.setName('type').setDescription('نوع التوب').setRequired(true).addChoices(...choices)).addIntegerOption(o=>o.setName('minutes').setDescription('الدقائق').setRequired(true))
  ];
  try {
    await new REST({version:'10'}).setToken(process.env.TOKEN).put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {body:commands});
    console.log("Commands Loaded Successfully ✅");
    sendTop();
  } catch (err) { console.error(err); }
});

client.login(process.env.TOKEN);
