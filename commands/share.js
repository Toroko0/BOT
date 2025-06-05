const { SlashCommandBuilder } = require('discord.js');
const db = require('../database.js');
const { logHistory } = require('../utils/share_and_history.js');
const logger = require('../utils/logger.js'); // Added logger
const { invalidateSearchCache } = require('./search.js'); // For cache invalidation
const CONSTANTS = require('../utils/constants.js'); // For autocomplete limit

module.exports = {
  data: new SlashCommandBuilder()
    .setName('share')
    .setDescription('Make one of your tracked worlds public in this server')
    .addStringOption(option =>
      option.setName('world') // Changed name for consistency
        .setDescription('Name or Note of the world to share')
        .setRequired(true)
        .setAutocomplete(true)), // Added autocomplete

  async execute(interaction) {
     const replyOpts = { flags: 1 << 6 }; // Ephemeral

    if (!interaction.guildId) {
      await interaction.reply({ ...replyOpts, content: '❌ Sharing is only available inside servers.' });
      return;
    }

    const worldIdentifier = interaction.options.getString('world');
    const userId = interaction.user.id;

    // Add user silently (handled by interaction handler)
    // await db.addUser(interaction.user.id, interaction.user.username);

    try {
      // Use find function to get world by name or custom ID owned by user
      const world = await db.findWorldByIdentifier(userId, worldIdentifier, null); // Don't check public initially

      if (!world || world.user_id !== userId) {
        await interaction.reply({ ...replyOpts, content: `❌ World "**${worldIdentifier}**" not found in your list.` });
        return;
      }

      // Check if it's already public *in this specific guild*
      if (world.is_public && world.guild_id === interaction.guildId) {
        await interaction.reply({ ...replyOpts, content: `🌐 World **${world.name.toUpperCase()}** is already public in this server.` });
        return;
      }

      // Check for duplicate public world name in *this* guild before sharing
      const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId);
      if (existingPublic && existingPublic.id !== world.id) { // Ensure it's not the same world ID
        await interaction.reply({ ...replyOpts, content: `❌ A different public world named **${world.name.toUpperCase()}** already exists here.` });
        return;
      }

      // Update visibility and set the specific guild ID
      const success = await db.updateWorldVisibility(world.id, userId, true, interaction.guildId);

      if (success) {
          await logHistory(world.id, userId, 'share', `Shared world ${world.name.toUpperCase()} in guild ${interaction.guildId}`);
          invalidateSearchCache(); // Invalidate cache
          await interaction.reply({ ...replyOpts, content: `✅ World **${world.name.toUpperCase()}** is now public in this server!` });
      } else {
           await interaction.reply({ ...replyOpts, content: `❌ Failed to share **${world.name.toUpperCase()}**.` });
      }

    } catch (error) {
      logger.error(`[share.js] Error sharing world "${worldIdentifier}":`, error?.stack || error);
      await interaction.reply({ ...replyOpts, content: '❌ Sorry, an error occurred. Please try again.' });
    }
  },

   // Add autocomplete handler
   async autocomplete(interaction) {
        if (!interaction.isAutocomplete()) return;
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

        if (focusedOption.name === 'world') {
            try {
                // Fetch only user's worlds for sharing suggestion
                const dbResult = await db.getWorlds(interaction.user.id, 1, 50); // Limit results
                const query = focusedOption.value.toLowerCase();
                choices = dbResult.worlds
                     // Suggest worlds that are private OR public in a DIFFERENT guild
                    .filter(w => !w.is_public || w.guild_id !== interaction.guildId)
                    .filter(w =>
                        w.name.toLowerCase().includes(query) ||
                        (w.note && w.note.toLowerCase().includes(query))
                    )
                    .slice(0, CONSTANTS.MAX_SELECT_OPTIONS)
                    .map(w => ({
                        name: w.note ? `${w.name.toUpperCase()} (${w.note.toUpperCase()})` : w.name.toUpperCase(),
                        value: w.note || w.name
                    }));
            } catch (e) {
                 logger.error("[share.js] Autocomplete DB error:", e);
            }
        }
         try {
            await interaction.respond(choices);
        } catch (e) {
             logger.warn("[share.js] Autocomplete respond error:", e.message);
        }
    }
};