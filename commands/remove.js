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
    
    // Get the world by name for the current user
    const world = await db.getWorldByName(worldName, interaction.user.id);
    
    if (!world) {
      await interaction.reply({ 
        content: `World **${worldName}** not found in your tracking list.`, 
        flags: 1 << 6
      });
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`remove_confirm_${world.id}`)
        .setLabel('Confirm Remove')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('remove_cancel')
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

    // Get the world ID from the button parameters
    const worldId = params[0];
    if (!worldId) {
      await interaction.reply({ 
        content: 'World ID not provided.', 
        flags: 1 << 6
      });
      return;
    }
    
    // Get the world by ID
    const world = await db.getWorldById(worldId);
    
    // Check if world exists and belongs to the user
    if (!world || world.user_id !== interaction.user.id) {
      await interaction.reply({ 
        content: 'World not found or you do not have permission to remove it.', 
        flags: 1 << 6
      });
      return;
    }
    
    // Remove the world from the database
    const success = await db.removeWorld(worldId, interaction.user.id);
    
    if (!success) {
      await interaction.reply({ 
        content: 'An error occurred while removing the world.', 
        flags: 1 << 6
      });
      return;
    }

    // Log the remove action
    await logHistory(worldId, interaction.user.id, 'remove', `Removed world ${world.name}`);

    // Create response with buttons
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('list_private')
          .setLabel('View My Worlds')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('addWorld_button')
          .setLabel('Add New World')
          .setStyle(ButtonStyle.Success)
      );
    
    await interaction.reply({
      content: `✅ World **${world.name}** has been removed from your tracking list.`,
      components: [row],
      flags: 1 << 6
    });
  }
};
