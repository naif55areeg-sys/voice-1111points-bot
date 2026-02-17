let multiplierActive = false;
let multiplierValue = 2; // مضاعفة النقاط

// ================= السلاش كوماند =================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // إضافة وقت - موجود مسبقاً
  if (interaction.commandName === 'addtime') {
    if (interaction.user.id !== process.env.OWNER_ID)
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const minutes = interaction.options.getInteger('minutes');

    addTime(user.id, type, minutes);

    return interaction.reply({
      content: `✅ تمت إضافة ${minutes} دقيقة (${type}) لـ ${user.tag}`,
      ephemeral: true
    });
  }

  // ================= رتبي /rank =================
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

  // ================= تفعيل المضاعفة /multiplier =================
  if (interaction.commandName === 'multiplier') {
    if (!process.env.MULTI_USERS.split(',').includes(interaction.user.id))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    multiplierActive = true;
    interaction.reply({ content: `✅ تم تفعيل مضاعفة النقاط x${multiplierValue}`, ephemeral: true });
  }

  // ================= إيقاف المضاعفة /stopmultiplier =================
  if (interaction.commandName === 'stopmultiplier') {
    if (!process.env.MULTI_USERS.split(',').includes(interaction.user.id))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    multiplierActive = false;
    interaction.reply({ content: "✅ تم إيقاف مضاعفة النقاط", ephemeral: true });
  }
});

// ================= تسجيل أوامر جديدة =================
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
});

// ================= تحديث الوقت مع المضاعفة =================
setInterval(async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const members = guild.members.cache.filter(m => m.voice.channelId);
  let increment = 10 * 60 * 1000;
  if (multiplierActive) increment *= multiplierValue;

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
