const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with Growtopia Tracker commands'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('🌱 Growtopia Tracker Bot - Help Guide')
      .setDescription('Welcome! This bot helps you privately track your Growtopia worlds, expiration dates, and more.')
      .addFields(
        { name: '🌍 World Management', value: '`/addworld` - Add a world (Use options or modal)\n`/remove` - Remove a world\n`/list` - View and manage your worlds\n`/info` - Detailed info about a world\n`/share` - Make a world public in this server\n`/unshare` - Make a world private' },
        { name: '📊 Stats & Search', value: '`/stats` - Your world statistics\n`/search` - Search your worlds with filters' },
        //{ name: '⚙️ Admin', value: '`/sync` - Refresh slash commands (admin only)' }, // Removed sync as file missing
        { name: '🔑 Lock Types', value: '**M**ain Lock\n**O**ut Lock (Out-of-place)', inline: true },
        { name: '⏱️ World Expiration', value: 'Worlds expire 180 days after being added/last edited. Bot tracks days left.', inline: true },
        { name: '🌐 Sharing', value: 'Use `/share`, `/unshare` or buttons in `/list` / `/info`. Public worlds are visible via `/list` (public view).', inline: false },
        { name: '🔒 Privacy', value: 'Your world data is private by default. Only worlds you explicitly share become public *in the server where you share them*. Custom IDs are also private unless shared.', inline: false },
        { name: '💡 Tips', value: 'Use Custom IDs in `/addworld` or `/info` (edit button) for easier lookup! World names and Custom IDs are case-insensitive for commands.', inline: false }
      )
      .setFooter({ text: 'Use responsibly! Contact bot owner for issues.'});

    // Create button row with corrected custom IDs
    const row = new ActionRowBuilder()
      .addComponents(
        // Calls addworld.js handler
        new ButtonBuilder()
          .setCustomId('addworld_button_show') // Command: addworld, Type: button, Action: show
          .setLabel('➕ Add World')
          .setStyle(ButtonStyle.Success),
        // Calls list.js handler to show private list page 1
        new ButtonBuilder()
          // Using 'view' action here just for logical separation in list handler if needed, could also be just 'private_1'
          .setCustomId('list_button_view_private_1') // Command: list, Type: button, Action: view, Param1: private, Param2: 1
          .setLabel('View My Worlds')
          .setStyle(ButtonStyle.Primary),
         // Calls stats.js handler to show private stats
        new ButtonBuilder()
          .setCustomId('stats_button_view_private') // Command: stats, Type: button, Action: view, Param1: private
          .setLabel('📊 View Stats')
          .setStyle(ButtonStyle.Secondary)
      );

    // *** FIX AREA: Ensure no ```javascript inside this template literal ***
    // const helpText = `... your help text ...`; // Removed the large helpText variable as embed is used now
    // *** END FIX AREA ***

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: 1 << 6 // Ephemeral
    });
  }
};