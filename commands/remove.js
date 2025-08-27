const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { logHistory } = require('../utils/share_and_history.js');
const { selectWorld } = require('../utils/world_selection.js');

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
    
    await interaction.deferReply({ ephemeral: true });

    const selectionResult = await selectWorld(interaction, worldName, 'remove');

    if (!selectionResult) {
      return;
    }

    const { world, followUpInteraction } = selectionResult;

    // Safeguard: Re-fetch the world from the database to ensure data is not stale.
    const freshWorld = await db.getWorldById(world.id);
    if (!freshWorld) {
        const content = 'The selected world could not be found. It may have been removed.';
        if (followUpInteraction.isMessageComponent()) {
            await followUpInteraction.update({ content, components: [] });
        } else {
            await followUpInteraction.editReply({ content });
        }
        return;
    }

    const isAdmin = interaction.user.id === process.env.OWNER_ID;
    const isOwner = freshWorld.added_by_username === interaction.user.username;

    if (!isAdmin && !isOwner) {
      const content = 'You do not have permission to remove this world.';
      if (followUpInteraction.isMessageComponent()) {
        await followUpInteraction.update({ content, components: [] });
      } else {
        await followUpInteraction.editReply({ content });
      }
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`remove_confirm_${freshWorld.id}`)
        .setLabel('Confirm Remove')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`remove_cancel_${freshWorld.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const content = `⚠️ Are you sure you want to remove **${freshWorld.name.toUpperCase()}** from the tracking list?`;
    if (followUpInteraction.isMessageComponent()) {
      await followUpInteraction.update({ content, components: [confirmRow] });
    } else {
      await followUpInteraction.editReply({ content, components: [confirmRow] });
    }
  },

  // Handle button interactions for this command
  async handleButton(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'remove');
    if (cooldown.onCooldown) {
      return interaction.reply({
        content: `Please wait ${cooldown.timeLeft} seconds before using this button again.`,
        ephemeral: true
      });
    }

    const [action, worldIdString] = params;
    const worldId = parseInt(worldIdString, 10);

    if (action === 'confirm') {
      if (isNaN(worldId)) {
        return interaction.update({ content: 'Invalid World ID provided.', components: [], ephemeral: true });
      }
      
      const world = await db.getWorldById(worldId);

      if (!world) {
        return interaction.update({ content: 'World not found.', components: [], ephemeral: true });
      }

      const isAdmin = interaction.user.id === process.env.OWNER_ID;
      const isOwner = world.added_by_username === interaction.user.username;

      if (!isAdmin && !isOwner) {
        return interaction.update({ content: 'You do not have permission to remove this world.', components: [], ephemeral: true });
      }

      const success = await db.removeWorld(worldId);

      if (!success) {
        return interaction.update({ content: 'An error occurred while removing the world.', components: [], ephemeral: true });
      }

      require('./search.js').invalidateSearchCache(); // Invalidate search cache
      await logHistory(world.id, interaction.user.id, 'remove', `Removed world ${world.name}`);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('list_view_1')
            .setLabel('View Worlds')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('addworld_show')
            .setLabel('Add New World')
            .setStyle(ButtonStyle.Success)
        );

      await interaction.update({
        content: `✅ World **${world.name.toUpperCase()}** has been removed from the tracking list.`,
        components: [row]
      });

    } else if (action === 'cancel') {
      await interaction.update({
        content: '✅ Removal cancelled.',
        components: [],
        ephemeral: true
      });
    } else {
      console.error(`Unknown action in remove.js handleButton: ${action}`);
      await interaction.reply({
        content: 'An unknown error occurred. Please try again.',
        ephemeral: true
      });
    }
  }
};
