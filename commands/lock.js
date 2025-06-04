const { SlashCommandBuilder } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Manages your locked worlds.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Adds a world to your locked list.')
        .addStringOption(option =>
          option.setName('worldname')
            .setDescription('The name of the world to lock.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('lock_type')
            .setDescription('Type of lock (main/out). Defaults to main.')
            .addChoices(
              { name: 'Main Lock', value: 'main' },
              { name: 'Out Lock', value: 'out' }
            )
            .setRequired(false))
        .addStringOption(option =>
          option.setName('note')
            .setDescription('An optional note for this locked world.')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View your locked worlds list.'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Removes a world from your locked list.')
        .addStringOption(option =>
          option.setName('worldname')
            .setDescription('The exact name of the locked world to remove.')
            .setRequired(true))),
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      // ADD SUBCOMMAND (from previous task)
      const worldNameInput = interaction.options.getString('worldname');
      const lockTypeInput = interaction.options.getString('lock_type') || 'main';
      const noteInput = interaction.options.getString('note') || null;

      // Validate world name (e.g., no spaces)
      if (worldNameInput.includes(' ')) {
        await interaction.reply({ content: '❌ World names cannot contain spaces.', ephemeral: true });
        return;
      }
      const worldName = worldNameInput.toUpperCase().trim();

      try {
        const result = await db.addLockedWorld(interaction.user.id, worldName, lockTypeInput, noteInput);

        if (result.success) {
          await interaction.reply({
            content: `✅ World **${worldName}** (Type: ${lockTypeInput}, Note: ${noteInput ? noteInput : 'N/A'}) added to your Locks list.`,
            ephemeral: true
          });
        } else {
          // Check for specific message content if db.addLockedWorld provides it
          if (result.message && (result.message.toLowerCase().includes('already') || result.message.toLowerCase().includes('in your locked list'))) {
            await interaction.reply({ content: `❌ World **${worldName}** is already in your Locks list.`, ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ An error occurred while adding the world to your locks. Please try again.', ephemeral: true });
          }
        }
      } catch (error) {
        logger.error(`[LockCommand - Add] Error executing /lock add for user ${interaction.user.id} with world ${worldName}:`, error);
        // Check if interaction has already been replied to or deferred
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred. Please try again later.', ephemeral: true });
        } else {
            // If already replied/deferred, try to follow up if possible, or just log
            // For ephemeral messages, a followUp is also ephemeral
            await interaction.followUp({ content: '❌ An unexpected error occurred. Please try again later.', ephemeral: true }).catch(e => logger.error(`[LockCommand - Add] Error sending follow-up after initial error for ${interaction.user.id}:`, e));
        }
      }
    } else if (subcommand === 'view') {
      await showLockedWorldsList(interaction, 1, {});
    } else if (subcommand === 'remove') {
      const worldNameInput = interaction.options.getString('worldname').trim();
      const worldNameUpper = worldNameInput.toUpperCase(); // DB stores world_name in uppercase

      try {
        // findLockedWorldByName should return the world object including its id
        const world = await db.findLockedWorldByName(interaction.user.id, worldNameUpper);

        if (!world) {
          await interaction.reply({ content: `❌ World "**${worldNameInput}**" not found in your Locks list.`, ephemeral: true });
          return;
        }

        // Using world.world_name (which is already uppercased from DB) for the button ID.
        // This assumes world_name is not excessively long to break 100 char customId limit after encoding.
        // Using world.id would be safer if db.removeLockedWorld could take an ID.
        const worldNameToEncode = world.world_name;
        const encodedWorldName = Buffer.from(worldNameToEncode).toString('base64url');

        if (`lock_btn_rmconfirm_${encodedWorldName}`.length > 100) {
            logger.error(`[LockCommand - RemoveSubcommand] Encoded world name for custom ID is too long: ${worldNameToEncode}`);
            await interaction.reply({ content: '❌ Could not create removal confirmation due to world name length. Please contact support or try a shorter name if possible.', ephemeral: true });
            return;
        }

        const confirmButton = new ButtonBuilder()
          .setCustomId(`lock_btn_rmconfirm_${encodedWorldName}`) // Using encoded world_name
          .setLabel('Confirm Remove')
          .setStyle(ButtonStyle.Danger);
        const cancelButton = new ButtonBuilder()
          .setCustomId('lock_btn_rmcancel_0') // _0 is a placeholder, not used by cancel logic
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.reply({
          content: `⚠️ Are you sure you want to remove **${world.world_name}** from your Locks list? This action cannot be undone.`,
          components: [row],
          ephemeral: true
        });

      } catch (error) {
        logger.error(`[LockCommand - RemoveSubcommand] Error during remove confirmation for world ${worldNameInput} by user ${interaction.user.id}:`, error);
        // Check if interaction has already been replied to or deferred
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred while trying to find the world for removal.', ephemeral: true });
        } else {
            await interaction.followUp({ content: '❌ An unexpected error occurred while trying to find the world for removal.', ephemeral: true }).catch(e => logger.error(`[LockCommand - RemoveSubcommand] Error sending follow-up after initial error for ${interaction.user.id}:`, e));
        }
      }
    }
    // Future subcommands like 'update' would go here with else if (subcommand === '...')
  }
};

const CONSTANTS = require('../utils/constants'); // Assuming constants.js exists and has PAGE_SIZE
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Filter Encoding/Decoding Utilities
function encodeFilters(filters) {
  try {
    if (Object.keys(filters).length === 0) return '';
    return Buffer.from(JSON.stringify(filters)).toString('base64url');
  } catch (e) {
    logger.error('[LockCommand - EncodeFilters] Failed to encode filters:', { error: e, filters });
    return '';
  }
}

function decodeFilters(encodedString) {
  try {
    if (!encodedString || encodedString.trim() === '') return {};
    return JSON.parse(Buffer.from(encodedString, 'base64url').toString('utf8'));
  } catch (e) {
    logger.error('[LockCommand - DecodeFilters] Failed to decode filters:', { error: e, encodedString });
    return {}; // Return empty object on error to prevent crashes
  }
}


async function showLockedWorldsList(interaction, page = 1, currentFilters = {}) {
  const ephemeralFlag = true;
  const PAGE_SIZE_LOCKED = CONSTANTS.PAGE_SIZE || 10; // Use constant or default

  try {
    // Defer reply/update
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate({ ephemeral: ephemeralFlag });
      }
    } else { // For initial slash command
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: ephemeralFlag });
      }
    }

    const userPrefs = await db.getUserPreferences(interaction.user.id);
    // const viewMode = userPrefs?.view_mode || 'pc'; // pc or phone
    // const timezoneOffset = userPrefs?.timezone_offset || 0; // For date formatting if needed

    const { worlds, total } = await db.getLockedWorlds(interaction.user.id, page, PAGE_SIZE_LOCKED, currentFilters);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_LOCKED));
    page = Math.max(1, Math.min(page, totalPages)); // Ensure page is within bounds

    const encodedCurrentFilters = encodeFilters(currentFilters);

    // Empty List Handling
    if (total === 0) {
      let content = "You have no locked worlds. Use `/lock add` to add some!";
      const components = [];
      if (Object.keys(currentFilters).length > 0) {
        content = "No locked worlds match your current filters.";
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lock_btn_fclr_1`).setLabel('Clear Filters').setStyle(ButtonStyle.Danger)
        ));
      }
      await interaction.editReply({ content, embeds: [], components, ephemeral: ephemeralFlag });
      return;
    }

    // --- Embed Formatting (Simplified for brevity, expand as needed) ---
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('Your Locked Worlds')
      .setFooter({ text: `Total: ${total} | Page ${page}/${totalPages}` });

    // Example: PC View (adapt for phone view using userPrefs.view_mode)
    // This is a simplified representation. Actual formatting would be more detailed.
    let description = '';
    if (userPrefs?.view_mode === 'phone') {
        embed.setTitle('Your Locked Worlds (Phone)');
        worlds.forEach(world => {
            const noteDisplay = world.note ? ` (${world.note.substring(0, 20)}${world.note.length > 20 ? '...' : ''})` : '';
            const lockTypeDisplay = world.lock_type === 'main' ? 'M' : 'O';
            const lockedDate = world.locked_on_date ? new Date(world.locked_on_date).toLocaleDateString('en-CA') : 'N/A';
            description += `\`${lockTypeDisplay}\` **${world.world_name}**${noteDisplay} - Locked: ${lockedDate}\n`;
        });
    } else { // PC View
        embed.addFields(
            { name: 'WORLD NAME', value: worlds.map(w => w.world_name).join('\n') || 'N/A', inline: true },
            { name: 'TYPE', value: worlds.map(w => w.lock_type).join('\n') || 'N/A', inline: true },
            { name: 'NOTE', value: worlds.map(w => w.note ? w.note.substring(0,30) + (w.note.length > 30 ? '...' : '') : 'N/A').join('\n') || 'N/A', inline: true },
            { name: 'LOCKED ON', value: worlds.map(w => new Date(w.locked_on_date).toLocaleDateString('en-CA')).join('\n') || 'N/A', inline: true }
        );
    }
    if (description) embed.setDescription(description);


    // --- Action Rows (Buttons & Select Menus) ---
    const allActionRows = [];

    // Pagination Row
    const paginationRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(`lock_pgn_p_${page}_${encodedCurrentFilters}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId('lock_pgn_i').setLabel(`${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`lock_pgn_n_${page}_${encodedCurrentFilters}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
        new ButtonBuilder().setCustomId(`lock_pgn_g_${encodedCurrentFilters}`).setLabel('Go To Page').setStyle(ButtonStyle.Secondary)
      );
    allActionRows.push(paginationRow);

    // Filter Row 1
    const filterRow1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_flen_${encodedCurrentFilters}`).setLabel('Filter: Length').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lock_btn_fprfx_${encodedCurrentFilters}`).setLabel('Filter: Prefix').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lock_btn_ftype_${encodedCurrentFilters}`).setLabel('Filter: Type').setStyle(ButtonStyle.Secondary)
      );
    allActionRows.push(filterRow1);

    // Filter Row 2
    const filterRow2 = new ActionRowBuilder();
    filterRow2.addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_fnote_${encodedCurrentFilters}`).setLabel('Filter: Note').setStyle(ButtonStyle.Secondary)
    );
    if (Object.keys(currentFilters).length > 0) {
      filterRow2.addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_fclr_1`).setLabel('Clear All Filters').setStyle(ButtonStyle.Danger)
      );
    }
    allActionRows.push(filterRow2);


    await interaction.editReply({ embeds: [embed], components: allActionRows, ephemeral: ephemeralFlag });

  } catch (error) {
    logger.error(`[LockCommand - ShowLockedWorlds] Error displaying locked worlds for user ${interaction.user.id}:`, error);
    const errorMessage = '❌ An error occurred while displaying your locked worlds. Please try again.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errorMessage, embeds: [], components: [], ephemeral: ephemeralFlag }).catch(e => logger.error(`[LockCommand - ShowLockedWorlds] Error sending error editReply for ${interaction.user.id}:`, e));
    } else {
      // This case should ideally not happen if deferral is handled correctly
      await interaction.reply({ content: errorMessage, ephemeral: ephemeralFlag }).catch(e => logger.error(`[LockCommand - ShowLockedWorlds] Error sending error reply for ${interaction.user.id}:`, e));
    }
  }
}

// Interaction Handlers
async function handleButtonCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'pgn'/'btn', 2: action_name, 3: data, 4: more_data/encodedFilters]
  const actionType = customIdParts[1]; // 'pgn' or 'btn'
  const actionName = customIdParts[2]; // e.g., 'p', 'n', 'g', 'flen', 'fprfx', 'ftype', 'fnote', 'fclr', 'rmconfirm', 'rmcancel'

  logger.debug(`[LockCommand - Button] Handling button: ${customIdParts.join('_')}`);

  if (actionType === 'pgn') { // Pagination for 'view'
    const currentPage = parseInt(customIdParts[3], 10);
    const encodedFilters = customIdParts[4] || '';
    const currentFilters = decodeFilters(encodedFilters);
    let newPage = currentPage;

    if (actionName === 'p') newPage = Math.max(1, currentPage - 1);
    if (actionName === 'n') newPage = currentPage + 1; // showLockedWorldsList will cap it at totalPages
    if (actionName === 'g') {
      const goToModal = new ModalBuilder()
        .setCustomId(`lock_mod_gotopg_${encodedFilters}`) // encodedFilters is at customIdParts[4] for pgn_g
        .setTitle('Go to Page')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('page_number')
              .setLabel('Enter Page Number')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('E.g., 5')
          )
        );
      await interaction.showModal(goToModal);
      return; // Modal submission will handle list update for 'g'
    }
    // For 'p' and 'n', directly show the list
    await showLockedWorldsList(interaction, newPage, currentFilters);

  } else if (actionType === 'btn') {
    // For buttons like lock_btn_flen_encodedFilters, encodedFilters is at index 3
    // For lock_btn_rmconfirm_encodedWorldName, encodedWorldName is at index 3
    // For lock_btn_rmcancel_0, '0' is at index 3
    const actionSpecificData = customIdParts[3] || '';
    const currentFilters = decodeFilters(actionSpecificData); // This will be empty for rmconfirm/rmcancel if data is not filter string

    if (actionName === 'flen') {
      const lenModal = new ModalBuilder()
        .setCustomId(`lock_mod_flen_${actionSpecificData}`) // actionSpecificData here is encodedFilters
        .setTitle('Filter by World Name Length')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('min_length').setLabel('Minimum Length (Optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g., 3')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('max_length').setLabel('Maximum Length (Optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g., 10')
          )
        );
      await interaction.showModal(lenModal);
    } else if (actionName === 'fprfx') {
      const prefixModal = new ModalBuilder()
        .setCustomId(`lock_mod_fprfx_${actionSpecificData}`) // actionSpecificData here is encodedFilters
        .setTitle('Filter by World Name Prefix')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('prefix_text').setLabel('World Name Prefix (e.g., MYWORLD)').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
      await interaction.showModal(prefixModal);
    } else if (actionName === 'ftype') {
      const typeSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`lock_sel_ftype_${actionSpecificData}`) // actionSpecificData here is encodedFilters
        .setPlaceholder('Select a lock type to filter by')
        .addOptions([
          { label: 'Main Lock', value: 'main', description: 'Filter by Main locks' },
          { label: 'Out Lock', value: 'out', description: 'Filter by Out locks' },
          { label: 'Any Lock Type (Clear)', value: 'any', description: 'Show all lock types' },
        ]);
      const row = new ActionRowBuilder().addComponents(typeSelectMenu);
      // Check if interaction has been replied to or deferred. If so, use followUp.
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Select a lock type:', components: [row], ephemeral: true });
      } else {
        await interaction.reply({ content: 'Select a lock type:', components: [row], ephemeral: true });
      }
    } else if (actionName === 'fnote') {
      const noteModal = new ModalBuilder()
        .setCustomId(`lock_mod_fnote_${actionSpecificData}`) // actionSpecificData here is encodedFilters
        .setTitle('Filter by Note Content')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('note_text').setLabel('Text to find in note (case-insensitive)').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
      await interaction.showModal(noteModal);
    } else if (actionName === 'fclr') {
      // The customId for clear is `lock_btn_fclr_1` (data is '1')
      await showLockedWorldsList(interaction, 1, {}); // Page 1, empty filters
    } else if (actionName === 'rmconfirm') {
      const encodedWorldNameToRemove = actionSpecificData; // This is the encoded world name
      try {
        const decodedWorldName = Buffer.from(encodedWorldNameToRemove, 'base64url').toString('utf8');
        const success = await db.removeLockedWorld(interaction.user.id, decodedWorldName);
        if (success) {
          await interaction.update({ content: `✅ World **${decodedWorldName}** removed from your Locks list.`, components: [] });
        } else {
          await interaction.update({ content: `❌ Could not remove world **${decodedWorldName}**. It might have already been removed or a database error occurred.`, components: [] });
        }
      } catch (error) {
        logger.error(`[LockCommand - ButtonRmConfirm] Error removing world (Encoded: ${encodedWorldNameToRemove}):`, error);
        await interaction.update({ content: '❌ An error occurred during removal. The name might be corrupted or an issue happened.', components: [] });
      }
    } else if (actionName === 'rmcancel') {
      await interaction.update({ content: '❌ Removal of locked world cancelled.', components: [] });
    }
  }
}

async function handleModalSubmitCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'mod', 2: modal_type, 3: encodedFilters]
  const modalType = customIdParts[2];
  const encodedFilters = customIdParts[3] || '';
  let currentFilters = decodeFilters(encodedFilters);

  logger.debug(`[LockCommand - ModalSubmit] Handling modal: ${customIdParts.join('_')}`);

  if (modalType === 'gotopg') {
    const pageNumberStr = interaction.fields.getTextInputValue('page_number');
    const pageNumber = parseInt(pageNumberStr, 10);
    if (!isNaN(pageNumber) && pageNumber > 0) {
      // showLockedWorldsList will handle capping the page number if it's too high
      await showLockedWorldsList(interaction, pageNumber, currentFilters);
    } else {
      await interaction.followUp({ content: 'Invalid page number provided.', ephemeral: true });
    }
    return; // Early return as we don't modify filters here
  }

  // For other modals, we are setting filters
  if (modalType === 'flen') {
    const minLengthStr = interaction.fields.getTextInputValue('min_length');
    const maxLengthStr = interaction.fields.getTextInputValue('max_length');
    const minLength = minLengthStr ? parseInt(minLengthStr, 10) : null;
    const maxLength = maxLengthStr ? parseInt(maxLengthStr, 10) : null;

    currentFilters.nameLength = {};
    if (minLength !== null && !isNaN(minLength)) currentFilters.nameLength.min = minLength;
    if (maxLength !== null && !isNaN(maxLength)) currentFilters.nameLength.max = maxLength;
    if (Object.keys(currentFilters.nameLength).length === 0) delete currentFilters.nameLength;

  } else if (modalType === 'fprfx') {
    const prefix = interaction.fields.getTextInputValue('prefix_text');
    if (prefix && prefix.trim() !== '') {
      currentFilters.prefix = prefix.trim();
    } else {
      delete currentFilters.prefix; // Remove if empty
    }
  } else if (modalType === 'fnote') {
    const noteText = interaction.fields.getTextInputValue('note_text');
    if (noteText && noteText.trim() !== '') {
      currentFilters.note = noteText.trim();
    } else {
      delete currentFilters.note; // Remove if empty
    }
  }

  await showLockedWorldsList(interaction, 1, currentFilters); // Go to page 1 with new filters
}

async function handleSelectMenuCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'sel', 2: select_type, 3: encodedFilters]
  const selectType = customIdParts[2];
  const encodedFilters = customIdParts[3] || '';
  let currentFilters = decodeFilters(encodedFilters);

  logger.debug(`[LockCommand - SelectMenu] Handling select menu: ${customIdParts.join('_')}`);

  if (selectType === 'ftype') {
    const selectedValue = interaction.values[0]; // Get the selected value from the menu
    if (selectedValue === 'any') {
      delete currentFilters.lockType; // Clear the lockType filter
    } else {
      currentFilters.lockType = selectedValue; // Set it to 'main' or 'out'
    }
  }

  await showLockedWorldsList(interaction, 1, currentFilters); // Go to page 1 with new filters
}

module.exports.handleButtonCommand = handleButtonCommand;
module.exports.handleModalSubmitCommand = handleModalSubmitCommand;
module.exports.handleSelectMenuCommand = handleSelectMenuCommand;
module.exports.showLockedWorldsList = showLockedWorldsList; // Exporting the function
