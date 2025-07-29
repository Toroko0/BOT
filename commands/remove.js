const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { logHistory } = require('../utils/share_and_history.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a Growtopia world from your tracking list')
    .addStringOption(option => 
      option.setName('world')
        .setDescription('The name of the world to remove')
        .setRequired(true)
        .setAutocomplete(true)),

  async execute(interaction) {
    const worldName = interaction.options.getString('world');
    
    // Get the world by name
    const world = await db.getWorldByName(worldName);
    
    if (!world) {
      await interaction.reply({ 
        content: `World **${worldName}** not found in the tracking list.`,
        flags: 1 << 6
      });
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`remove_button_confirm_${world.id}`)
        .setLabel('Confirm Remove')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`remove_button_cancel_${world.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}** from your tracking list?`,
      components: [confirmRow],
      flags: 1 << 6
    });
  },

  // Handle button interactions for this command
  async handleButton(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'remove');
    if (cooldown.onCooldown) {
      await interaction.reply({
        content: `Please wait ${cooldown.timeLeft} seconds before using this button again.`,
        flags: 1 << 6
      });
      return;
    }

    const [action, worldIdString] = params;
    const worldId = parseInt(worldIdString, 10);

    if (action === 'confirm') {
      if (isNaN(worldId)) {
        await interaction.reply({
          content: 'Invalid World ID provided.',
          flags: 1 << 6
        });
        return;
      }
      
      const world = await db.getWorldById(worldId);

      if (!world) {
        await interaction.reply({
          content: 'World not found.',
          flags: 1 << 6
        });
        return;
      }

      const success = await db.removeWorld(worldId);

      if (!success) {
        await interaction.reply({
          content: 'An error occurred while removing the world.',
          flags: 1 << 6
        });
        return;
      }

      require('./search.js').invalidateSearchCache(); // Invalidate search cache

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('list_button_view_1')
            .setLabel('View Worlds')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('addworld_button_show')
            .setLabel('Add New World')
            .setStyle(ButtonStyle.Success)
        );

      await interaction.update({ // Changed from interaction.reply to interaction.update
        content: `✅ World **${world.name.toUpperCase()}** has been removed from the tracking list.`,
        components: [row],
        flags: 1 << 6
      });

    } else if (action === 'cancel') {
      await interaction.update({
        content: '✅ Removal cancelled.',
        components: [], // Clear components
        flags: 1 << 6
      });
    } else {
      // Handle unknown action
      console.error(`Unknown action in remove.js handleButton: ${action}`);
      await interaction.reply({
        content: 'An unknown error occurred. Please try again.',
        flags: 1 << 6
      });
    }
  }
};
