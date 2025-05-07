const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
// Require database.js AFTER it has initialized and exported knex
const db = require('../database.js');
const logger = require('../utils/logger.js');

module.exports = {
  // --- FIX: Ensure data property exists and is correct ---
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Shows statistics about tracked worlds (yours or public in this server)')
    .addStringOption(option => // Optional argument to choose context
        option.setName('context')
            .setDescription('Whose stats to view (default: yours)')
            .setRequired(false)
            .addChoices(
                { name: 'My Worlds', value: 'private' },
                { name: 'Public Worlds (This Server)', value: 'public' }
            )),
  // --- End FIX ---

  async execute(interaction) {
    const userId = interaction.user.id;
    // Determine context: check interaction type first (button might pass context), then slash option
    let contextOption = 'private'; // Default
    if (interaction.isButton()) {
         // Assuming button ID format stats_button_view_TYPE
         const customIdParts = interaction.customId.split('_');
         if (customIdParts[0] === 'stats' && customIdParts[1] === 'button' && customIdParts[2] === 'view' && customIdParts[3]) {
              contextOption = customIdParts[3]; // 'private' or 'public'
         }
    } else if (interaction.isChatInputCommand()) {
         contextOption = interaction.options.getString('context') || 'private';
    }

    const replyOpts = { flags: 1 << 6 }; // Ephemeral

    let worlds = [];
    let titleContext = 'Your';
    let statsSource = `<@${userId}>`;
    let embedColor = 0x0099FF; // Blue for private

    try {
         // Defer reply early if it's a command execution
         if (interaction.isChatInputCommand() || interaction.isButton()) {
              if (!interaction.deferred && !interaction.replied) {
                 await interaction.deferReply(replyOpts);
              } else if (interaction.isButton() && !interaction.deferred) {
                  // Defer update if it's a button click that wasn't deferred yet
                  await interaction.deferUpdate(replyOpts);
              }
         }


        if (contextOption === 'public') {
            const guildId = interaction.guildId;
            if (!guildId) {
                 const errorMsg = { ...replyOpts, content: '❌ Public stats can only be viewed within a server.' };
                 if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg); else await interaction.reply(errorMsg);
                 return;
            }
            // Fetch ALL public worlds for stats calculation
            const publicResult = await db.getPublicWorldsByGuild(guildId, 1, 99999); // Fetch large number
            worlds = publicResult.worlds || [];
            titleContext = 'Public';
            statsSource = `Server: ${interaction.guild.name}`;
            embedColor = 0x00ccff; // Lighter blue for public
        } else { // context === 'private'
            // Fetch ALL user worlds for stats
            const userResult = await db.getWorlds(userId, 1, 99999); // Fetch large number
            worlds = userResult.worlds || [];
        }

        const totalWorldCount = worlds.length;

        if (totalWorldCount === 0) {
             const errorMsg = { ...replyOpts, content: `📊 No ${contextOption} worlds found to calculate stats.` };
             if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg); else await interaction.reply(errorMsg);
             return;
        }

        // --- Calculate Stats (as before) ---
        const lengthCounts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, 'Buy/Sell': 0, 'Other': 0 };
        const lockCounts = { mainlock: 0, outlock: 0 };
        let expiringSoonCount = 0;
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

        for (const world of worlds) {
            const name = world.name.toUpperCase();
            if (name.startsWith('BUY') || name.startsWith('SELL')) { lengthCounts['Buy/Sell']++; }
            else { const len = name.length; if (len === 1) lengthCounts['1']++; else if (len === 2) lengthCounts['2']++; else if (len === 3) lengthCounts['3']++; else if (len === 4) lengthCounts['4']++; else if (len === 5) lengthCounts['5']++; else lengthCounts['Other']++; }
            if (world.lock_type === 'mainlock') lockCounts.mainlock++; else if (world.lock_type === 'outlock') lockCounts.outlock++;
            const expiryDate = new Date(world.expiry_date);
            if (expiryDate <= sevenDaysFromNow && expiryDate >= new Date()) { expiringSoonCount++; }
        }
        // --- End Calculate Stats ---

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`📊 ${titleContext} World Statistics`)
            .setDescription(`Stats Source: ${statsSource}`)
            .addFields(
                { name: '🌐 Total Worlds', value: `${totalWorldCount}`, inline: true },
                { name: '⏳ Expiring Soon', value: `${expiringSoonCount} (in 7d)`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '🔠 Name Lengths', value: `**1:** ${lengthCounts['1']} | **2:** ${lengthCounts['2']} | **3:** ${lengthCounts['3']}\n**4:** ${lengthCounts['4']} | **5:** ${lengthCounts['5']} | **Other:** ${lengthCounts['Other']}` , inline: false },
                { name: '🏷️ Special Prefixes', value: `**Buy/Sell:** ${lengthCounts['Buy/Sell']}`, inline: true },
                { name: '🔑 Lock Types', value: `**Main:** ${lockCounts.mainlock}\n**Out:** ${lockCounts.outlock}`, inline: true }
            )
            .setTimestamp();

         // Edit the deferred reply/update
         await interaction.editReply({ embeds: [embed], components: [] });

    } catch (error) {
        logger.error(`[stats.js] Error fetching stats for context ${contextOption}:`, error);
        const errorMsg = { ...replyOpts, content: '❌ An error occurred while fetching stats.', components: [] };
        try {
             if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg);
             else await interaction.reply(errorMsg); // Fallback if defer failed
        } catch (e) { logger.error("[stats.js] Failed to send error reply:", e);}
    }
  },

  // handleButton needs to call execute correctly
  async handleButton(interaction, params) {
       // Structure: stats_button_action_type
       const action = params[0]; // Should be 'view'
       const contextType = params[1]; // 'private' or 'public'
       const replyOpts = { flags: 1 << 6 };

       if (action === 'view') {
           // We need to call execute, but since execute checks interaction type,
           // and this *is* a button interaction, execute should deferUpdate.
           // Execute will then use the contextType from the customId.
           await this.execute(interaction);
       } else {
           logger.warn(`[stats.js] Received unknown button action: ${action}`);
           await interaction.reply({ ...replyOpts, content: 'Unknown stats action.' });
       }
  }
};