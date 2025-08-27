const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { logHistory } = require('../utils/share_and_history.js');
const logger = require('../utils/logger.js'); // Assuming logger is available

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a world from your tracking list')
    .addStringOption(option => 
      option.setName('world')
        .setDescription('The name of the world to remove')
        .setRequired(true)
        .setAutocomplete(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const worldName = interaction.options.getString('world');
    const isAdmin = interaction.user.id === process.env.OWNER_ID;

    const filter = { prefix: worldName };
    if (!isAdmin) {
        filter.added_by_username = interaction.user.username;
    }

    const { worlds } = await db.getFilteredWorlds(filter);

    if (worlds.length === 0) {
        const content = isAdmin ? `No worlds found starting with **${worldName}**.` : `World starting with **${worldName}** not found in your tracking list.`;
        return interaction.editReply({ content });
    }

    if (worlds.length === 1) {
        const world = worlds[0];
        // Permission check is implicitly handled by the filter for non-admins.
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
        return interaction.editReply({
            content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}** (Owner: ${world.added_by_username})?`,
            components: [confirmRow]
        });
    }

    const options = worlds.map(world => ({
        label: `ID: ${world.id}, ${world.name}`,
        description: `Owner: ${world.added_by_username}`,
        value: world.id.toString()
    })).slice(0, 25);

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('remove_select_world')
            .setPlaceholder('Select a world to remove')
            .addOptions(options)
    );

    await interaction.editReply({
        content: `Found multiple worlds starting with **${worldName}**. Please select one to remove.`,
        components: [selectRow]
    });
  },

  async handleSelectMenu(interaction, params) {
    const worldId = parseInt(interaction.values[0], 10);
    const world = await db.getWorldById(worldId);

    if (!world) {
        return interaction.update({ content: 'This world seems to have been removed already.', components: [] });
    }

    const isAdmin = interaction.user.id === process.env.OWNER_ID;
    if (!isAdmin && world.added_by_username !== interaction.user.username) {
        return interaction.update({ content: 'You do not have permission to remove this world.', components: [] });
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

    await interaction.update({
        content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`,
        components: [confirmRow]
    });
  },

  async handleButton(interaction, params) {
    // Custom ID: remove_button_action_worldId
    const [action, worldIdString] = params;
    const worldId = parseInt(worldIdString, 10);

    if (action === 'confirm') {
      if (isNaN(worldId)) {
        return interaction.update({ content: 'Invalid World ID provided.', components: [] });
      }
      
      const world = await db.getWorldById(worldId);
      if (!world) {
        return interaction.update({ content: 'World not found.', components: [] });
      }

      const isAdmin = interaction.user.id === process.env.OWNER_ID;
      const isOwner = world.added_by_username === interaction.user.username;

      if (!isAdmin && !isOwner) {
        return interaction.update({ content: 'You do not have permission to remove this world.', components: [] });
      }

      const success = await db.removeWorld(worldId);
      if (!success) {
        return interaction.update({ content: 'An error occurred while removing the world.', components: [] });
      }

      try {
        require('./search.js').invalidateSearchCache();
      } catch (e) {
        logger.error('[remove.js] Failed to invalidate search cache.', e);
      }
      await logHistory(world.id, interaction.user.id, 'remove', `Removed world ${world.name}`);

      await interaction.update({
        content: `✅ World **${world.name.toUpperCase()}** has been removed.`,
        components: []
      });

    } else if (action === 'cancel') {
      await interaction.update({
        content: '✅ Removal cancelled.',
        components: []
      });
    } else {
      logger.error(`Unknown button action in remove.js: ${action}`);
      await interaction.update({ content: 'An unknown error occurred.', components: [] });
    }
  }
};
