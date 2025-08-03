const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { logHistory } = require('../utils/share_and_history.js');
const { invalidateSearchCache, performSearch } = require('./search.js'); // Assuming search.js exports this
const logger = require('../utils/logger.js'); // Added logger

// Function to show the Add World Modal
async function showAddWorldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('addworld_modal_submit') // Correct prefix and action
    .setTitle('Add New World');

  const worldNameInput = new TextInputBuilder()
    .setCustomId('worldName')
    .setLabel("World Name (no spaces allowed)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. ABC123')
    .setRequired(true)
    .setMaxLength(24); // Max length based on potential DB constraints

  const daysOwnedInput = new TextInputBuilder()
    .setCustomId('daysOwned')
    .setLabel("Days Already Owned (1-180)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('1 to 180')
    .setRequired(true)
    .setValue('1'); // Default to 1

  const lockTypeInput = new TextInputBuilder()
    .setCustomId('lockType')
    .setLabel("Lock Type (M/O)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('M for Main Lock, O for Out Lock')
    .setRequired(true)
    .setValue('M') // Default to M
    .setMaxLength(1); // Expect M or O

  const customIdInput = new TextInputBuilder()
    .setCustomId('customId')
    .setLabel("Custom ID (Optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(24); // Optional length constraint

  const firstActionRow = new ActionRowBuilder().addComponents(worldNameInput);
  const secondActionRow = new ActionRowBuilder().addComponents(daysOwnedInput);
  const thirdActionRow = new ActionRowBuilder().addComponents(lockTypeInput);
  const fourthActionRow = new ActionRowBuilder().addComponents(customIdInput);

  modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);
  await interaction.showModal(modal);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addworld')
    .setDescription('Add a Growtopia world to your tracking list')
    .addStringOption(option =>
      option.setName('world')
        .setDescription('The name of the world (no spaces)')
        .setRequired(false) // Make optional to allow modal use
        .setMaxLength(24)) // Added max length
    .addIntegerOption(option =>
      option.setName('days')
        .setDescription('Days already owned (1-180)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(180))
    .addStringOption(option =>
      option.setName('locktype')
        .setDescription('Lock type (Main/Out)')
        .setRequired(false)
        .addChoices(
          { name: 'Main Lock (M)', value: 'mainlock' },
          { name: 'Out Lock (O)', value: 'outlock' }
        ))
    .addStringOption(option =>
      option.setName('custom_id')
        .setDescription('Custom ID for the world (optional, unique per user)')
        .setRequired(false)
        .setMaxLength(24)),
  showAddWorldModal, // Add this line to export the function
  async execute(interaction) {
    logger.info('[addworld.js] Executing addworld command');
    const worldName = interaction.options.getString('world');
    const daysOwned = interaction.options.getInteger('days');
    const lockType = interaction.options.getString('locktype');
    const customId = interaction.options.getString('custom_id');
    const replyOpts = { flags: 1 << 6 }; // Ephemeral

    // If options are provided via slash command, add directly
    if (worldName) {
      const cooldown = utils.checkCooldown(interaction.user.id, 'addworld_cmd', 3);
      if (cooldown.onCooldown) {
        await interaction.reply({ ...replyOpts, content: `⏱️ Please wait ${cooldown.timeLeft} seconds.` });
        return;
      }

      // Add the world
      logger.info('[addworld.js] Calling db.addWorld');
      const result = await db.addWorld(
        worldName,
        daysOwned || 1, // Default to 1 if not provided
        lockType || 'mainlock', // Default to mainlock if not provided
        customId,
        interaction.user.username
      );
      logger.info('[addworld.js] db.addWorld returned', result);

      if (result.success) {
        invalidateSearchCache();
        await interaction.reply({ ...replyOpts, content: `✅ ${result.message}` }); // Use message from DB function
      } else {
        logger.error('[addworld.js] Add world via slash failed:', result.message);
        if (result.message.includes('is already being tracked by')) {
            await interaction.reply({ ...replyOpts, content: `❌ This world is already being tracked. ${result.message}` });
            await performSearch(interaction, { prefix: worldName });
        } else {
            await interaction.reply({ ...replyOpts, content: `❌ ${result.message || 'Failed to add world.'}` }); // Show specific error
        }
      }
    } else {
      // If no world name provided in slash command, show the modal
      await showAddWorldModal(interaction);
    }
  },

  async handleButton(interaction, params) {
    // Structure: addworld_button_action
    const action = params[0];

    if (action === 'show') { // Assuming button ID is addworld_button_show
        const cooldown = utils.checkCooldown(interaction.user.id, 'addworld_button', 3);
        if (cooldown.onCooldown) {
            await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: 1 << 6 });
            return;
        }
        await showAddWorldModal(interaction);
    } else {
         logger.warn(`[addworld.js] Received unknown button action: ${action}`);
         await interaction.reply({ content: 'Unknown action for this button.', flags: 1 << 6 });
    }
  },

  async handleModal(interaction, params) {
     // Structure: addworld_modal_action
     const action = params[0];
     const replyOpts = { flags: 1 << 6 }; // Ephemeral

     if (action === 'submit') { // Assuming modal ID is addworld_modal_submit
        const worldName = interaction.fields.getTextInputValue('worldName').trim();
        const daysOwnedStr = interaction.fields.getTextInputValue('daysOwned').trim();
        const lockTypeStr = interaction.fields.getTextInputValue('lockType').trim().toUpperCase();
        const customId = interaction.fields.getTextInputValue('customId').trim();

        // --- Input Validation ---
        const daysOwned = parseInt(daysOwnedStr);
        if (isNaN(daysOwned) || daysOwned < 1 || daysOwned > 180) {
            await interaction.reply({ ...replyOpts, content: "❌ Invalid Days Owned (must be 1-180)." }); return;
        }
        if (worldName.includes(' ')) {
             await interaction.reply({ ...replyOpts, content: '❌ World names cannot contain spaces.' }); return;
        }
        if (lockTypeStr !== 'M' && lockTypeStr !== 'O') {
            await interaction.reply({ ...replyOpts, content: "❌ Invalid Lock Type (must be M or O)." }); return;
        }
        // Optional: Validate custom ID format/length if needed
        // --- End Validation ---

        // Add user silently first (handled by interaction handler already)
        // await db.addUser(interaction.user.id, interaction.user.username);

        const normalizedLockType = lockTypeStr === 'O' ? 'outlock' : 'mainlock';

        try {
          const result = await db.addWorld(
            worldName,
            daysOwned, // Use validated number
            normalizedLockType,
            customId || null, // Pass null if empty
            interaction.user.username
          );

          if (result.success) {
            invalidateSearchCache();
            const row = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('list_button_view_1')
                  .setLabel('View Worlds')
                  .setStyle(ButtonStyle.Primary)
              );
            await interaction.reply({ ...replyOpts, content: `✅ ${result.message}`, components: [row] });
          } else {
            // This case might be redundant if db.addWorld throws errors for all failures
            logger.error('[addworld.js] Add world via modal failed (result.success false):', result.message);
            if (result.message.includes('is already being tracked by')) {
                await interaction.reply({ ...replyOpts, content: `❌ This world is already being tracked. ${result.message}` });
                await performSearch(interaction, { prefix: worldName });
            } else {
                await interaction.reply({ ...replyOpts, content: `❌ ${result.message || 'Failed to add world.'}` });
            }
          }
        } catch (error) {
          logger.error('[addworld.js] Error during addWorld via modal:', error);
          if (error.message && error.message.includes('SQLITE_CONSTRAINT: UNIQUE constraint failed: worlds.name')) {
            await interaction.reply({ ...replyOpts, content: "❌ A world with this name already exists. Please choose a different name." });
          } else {
            await interaction.reply({ ...replyOpts, content: '❌ An unexpected error occurred while adding the world. Please try again later.' });
          }
        }
     } else {
         logger.warn(`[addworld.js] Received unknown modal action: ${action}`);
         await interaction.reply({ content: 'Unknown form action.', flags: 1 << 6 });
     }
  },
};