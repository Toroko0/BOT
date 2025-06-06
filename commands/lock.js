const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js'); // Ensure all needed discord.js parts are here
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table'); // Added for table display
const CONSTANTS = require('../utils/constants'); // Assuming constants.js exists and has PAGE_SIZE

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
        await interaction.reply({ content: '❌ World names cannot contain spaces.', flags: 1 << 6 });
        return;
      }
      const worldName = worldNameInput.toUpperCase().trim();

      try {
        const result = await db.addLockedWorld(interaction.user.id, worldName, lockTypeInput, noteInput);

        if (result.success) {
          await interaction.reply({
            content: `✅ World **${worldName}** (Type: ${lockTypeInput}, Note: ${noteInput ? noteInput : 'N/A'}) added to your Locks list.`,
            flags: 1 << 6
          });
        } else {
          // Check for specific message content if db.addLockedWorld provides it
          if (result.message && (result.message.toLowerCase().includes('already') || result.message.toLowerCase().includes('in your locked list'))) {
            await interaction.reply({ content: `❌ World **${worldName}** is already in your Locks list.`, flags: 1 << 6 });
          } else {
            await interaction.reply({ content: '❌ An error occurred while adding the world to your locks. Please try again.', flags: 1 << 6 });
          }
        }
      } catch (error) {
        logger.error(`[LockCommand - Add] Error executing /lock add for user ${interaction.user.id} with world ${worldName}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred. Please try again later.', flags: 1 << 6 });
        } else {
            await interaction.followUp({ content: '❌ An unexpected error occurred. Please try again later.', flags: 1 << 6 }).catch(e => logger.error(`[LockCommand - Add] Error sending follow-up after initial error for ${interaction.user.id}:`, e));
        }
      }
    } else if (subcommand === 'view') {
      await showLockedWorldsList(interaction, 1, {});
    } else if (subcommand === 'remove') {
      const worldNameInput = interaction.options.getString('worldname').trim();
      const worldNameUpper = worldNameInput.toUpperCase();

      try {
        const world = await db.findLockedWorldByName(interaction.user.id, worldNameUpper);

        if (!world) {
          await interaction.reply({ content: `❌ World "**${worldNameInput}**" not found in your Locks list.`, flags: 1 << 6 });
          return;
        }
        const worldNameToEncode = world.world_name;
        const encodedWorldName = Buffer.from(worldNameToEncode).toString('base64url');

        if (`lock_btn_rmconfirm_${encodedWorldName}`.length > 100) {
            logger.error(`[LockCommand - RemoveSubcommand] Encoded world name for custom ID is too long: ${worldNameToEncode}`);
            await interaction.reply({ content: '❌ Could not create removal confirmation due to world name length. Please contact support or try a shorter name if possible.', flags: 1 << 6 });
            return;
        }

        const confirmButton = new ButtonBuilder()
          .setCustomId(`lock_btn_rmconfirm_${encodedWorldName}`)
          .setLabel('Confirm Remove')
          .setStyle(ButtonStyle.Danger);
        const cancelButton = new ButtonBuilder()
          .setCustomId('lock_btn_rmcancel_0')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.reply({
          content: `⚠️ Are you sure you want to remove **${world.world_name}** from your Locks list? This action cannot be undone.`,
          components: [row],
          flags: 1 << 6
        });

      } catch (error) {
        logger.error(`[LockCommand - RemoveSubcommand] Error during remove confirmation for world ${worldNameInput} by user ${interaction.user.id}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected error occurred while trying to find the world for removal.', flags: 1 << 6 });
        } else {
            await interaction.followUp({ content: '❌ An unexpected error occurred while trying to find the world for removal.', flags: 1 << 6 }).catch(e => logger.error(`[LockCommand - RemoveSubcommand] Error sending follow-up after initial error for ${interaction.user.id}:`, e));
        }
      }
    }
    // Future subcommands like 'update' would go here with else if (subcommand === '...')
  }
};

// const CONSTANTS = require('../utils/constants'); // This was the duplicate, removed. It's already at the top.
// const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
// The discord.js components are already destructured at the top of the file.

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

async function showLockFilterModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('lock_modal_main_filter_apply')
    .setTitle('Filter Locked Worlds');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('lock_filter_prefix')
        .setLabel('World Prefix (Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('lock_filter_min_len')
        .setLabel('Min Name Length (Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('e.g., 3')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('lock_filter_max_len')
        .setLabel('Max Name Length (Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('e.g., 10')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('lock_filter_type')
        .setLabel('Lock Type (main/out, Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('main or out')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('lock_filter_note')
        .setLabel('Note Contains (Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    )
  );
  await interaction.showModal(modal);
}

async function showRemoveLockedWorldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('lock_modal_remove_submit')
    .setTitle('Remove Locked World');

  const worldNameInput = new TextInputBuilder()
    .setCustomId('worldname_to_remove')
    .setLabel('Name of Locked World to Remove')
    .setPlaceholder('Case-sensitive exact world name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(worldNameInput));
  await interaction.showModal(modal);
}

async function showLockedWorldsList(interaction, page = 1, currentFilters = {}) {
  // const ephemeralFlag = true; // No longer needed directly for defer/reply
  const PAGE_SIZE_LOCKED = CONSTANTS.PAGE_SIZE || 10;

  try {
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate(); // ephemeralFlag removed
      }
    } else {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 1 << 6 }); // ephemeralFlag replaced
      }
    }

    const { worlds, total } = await db.getLockedWorlds(interaction.user.id, page, PAGE_SIZE_LOCKED, currentFilters);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_LOCKED));
    page = Math.max(1, Math.min(page, totalPages));
    const encodedCurrentFilters = encodeFilters(currentFilters);

    if (total === 0) {
      let content = "You have no locked worlds. Use `/lock add` to add some!";
      const components = [];
      if (Object.keys(currentFilters).length > 0) {
        content = "No locked worlds match your current filters.";
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lock_btn_fclr_1`).setLabel('Clear Filters').setStyle(ButtonStyle.Danger) // This customId might need review if it implies data like page
        ));
      }
      await interaction.editReply({ content, embeds: [], components }); // ephemeralFlag removed
      return;
    }

    // --- Table-Based Display ---
    const headers = ['WORLD', 'TYPE', 'LOCKED ON', 'NOTE'];
    const data = [headers];

    worlds.forEach(world => {
      const worldName = world.world_name;
      const lockType = world.lock_type;
      const lockedOnDate = world.locked_on_date ? new Date(world.locked_on_date).toLocaleDateString('en-CA') : 'N/A';
      const noteText = world.note || 'N/A';
      data.push([worldName, lockType, lockedOnDate, noteText]);
    });

    const tableConfig = {
      columns: [
        { alignment: 'left', width: 20, wrapWord: true }, // WORLD
        { alignment: 'left', width: 8 },  // TYPE
        { alignment: 'left', width: 12 }, // LOCKED ON
        { alignment: 'left', width: 25, wrapWord: true }  // NOTE
      ],
      border: getBorderCharacters('norc'),
      header: {
        alignment: 'center',
        content: '🔒 YOUR LOCKED WORLDS'
      }
    };

    let tableOutput = `\`\`\`\n${table(data, tableConfig)}\n\`\`\``;
    const footerText = `\n📊 Total locked worlds: ${total} | Page ${page}/${totalPages}`;

    if (tableOutput.length + footerText.length > 1990) { // Adjusted for footer and potential truncation message
        const availableLength = 1950 - footerText.length - "\n... (Table truncated) ...```".length;
        let cutOff = tableOutput.lastIndexOf('\n', availableLength);
        if (cutOff === -1 || cutOff < headers.join(" | ").length) cutOff = availableLength; // Ensure header is not cut awkwardly
        tableOutput = tableOutput.substring(0, cutOff) + "\n... (Table truncated) ...```";
    }

    const finalContent = `${tableOutput}${footerText}`;

    // --- Action Rows (Buttons & Select Menus) ---
    const allActionRows = [];
    const paginationRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(`lock_pgn_p_${page}_${encodedCurrentFilters}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId('lock_pgn_i').setLabel(`${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`lock_pgn_n_${page}_${encodedCurrentFilters}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
        new ButtonBuilder().setCustomId(`lock_pgn_g_${encodedCurrentFilters}`).setLabel('Go To Page').setStyle(ButtonStyle.Secondary)
      );
    allActionRows.push(paginationRow);

    // Unified Filter Button Row
    const filterActionRow = new ActionRowBuilder();
    filterActionRow.addComponents(
        new ButtonBuilder().setCustomId('lock_btn_main_filter_show').setLabel('🔍 Filter List').setStyle(ButtonStyle.Secondary)
    );
    // Add Export Names button
    filterActionRow.addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_export_names_${page}_${encodedCurrentFilters}`).setLabel('📄 Export Page Names').setStyle(ButtonStyle.Success)
    );
    // Add Remove World button
    filterActionRow.addComponents(
        new ButtonBuilder().setCustomId('lock_btn_remove_show_modal').setLabel('🗑️ Remove World').setStyle(ButtonStyle.Danger)
    );

    if (Object.keys(currentFilters).length > 0) {
      filterActionRow.addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_fclr`).setLabel('Clear All Filters').setStyle(ButtonStyle.Danger) // Simplified customId for clear
      );
    }
    allActionRows.push(filterActionRow);

    await interaction.editReply({ content: finalContent, embeds: [], components }); // ephemeralFlag removed

  } catch (error) {
    logger.error(`[LockCommand - ShowLockedWorlds] Error displaying locked worlds for user ${interaction.user.id}:`, error);
    const errorMessage = '❌ An error occurred while displaying your locked worlds. Please try again.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errorMessage, embeds: [], components: [] }).catch(e => logger.error(`[LockCommand - ShowLockedWorlds] Error sending error editReply for ${interaction.user.id}:`, e));
    } else {
      await interaction.reply({ content: errorMessage, flags: 1 << 6 }).catch(e => logger.error(`[LockCommand - ShowLockedWorlds] Error sending error reply for ${interaction.user.id}:`, e));
    }
  }
}

// Interaction Handlers
async function handleButtonCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'pgn'/'btn', 2: action_name_part1, 3: action_name_part2/data, ...]
  const typeOfAction = customIdParts[1]; // 'pgn' or 'btn'
  let derivedAction = customIdParts[2]; // Default to the first part after pgn/btn
  let actionArgs = customIdParts.slice(3); // Default args start after derivedAction

  // Derive composite actions for 'btn' type
  if (typeOfAction === 'btn') {
    if (customIdParts[2] === 'export' && customIdParts[3] === 'names') {
      derivedAction = 'export_names';
      actionArgs = customIdParts.slice(4); // page, encodedFilters
    } else if (customIdParts[2] === 'main' && customIdParts[3] === 'filter' && customIdParts[4] === 'show') {
      derivedAction = 'main_filter_show';
      actionArgs = customIdParts.slice(5); // Should be empty
    } else if (customIdParts[2] === 'remove' && customIdParts[3] === 'show' && customIdParts[4] === 'modal') {
      derivedAction = 'remove_show_modal';
      actionArgs = customIdParts.slice(5); // Should be empty
    }
    // Simple btn actions like 'fclr', 'rmconfirm', 'rmcancel' will have derivedAction = customIdParts[2]
    // and actionArgs = customIdParts.slice(3) which is correct for them.
    // For 'fclr', actionArgs will be empty or contain '1' which is fine.
    // For 'rmconfirm', actionArgs[0] will be the encodedWorldName.
  }
  // For 'pgn' type, derivedAction is already correct (p, n, g) and actionArgs contains [page, encodedFilters] or [encodedFilters] for 'g'.

  logger.debug(`[LockCommand - Button] Handling: typeOfAction=${typeOfAction}, derivedAction=${derivedAction}, actionArgs=${actionArgs.join(',')}, rawParts=${customIdParts.join('_')}`);

  if (typeOfAction === 'pgn') {
    const currentPage = parseInt(actionArgs[0], 10); // For 'p', 'n'
    const encodedFilters = actionName === 'g' ? actionArgs[0] || '' : actionArgs[1] || ''; // For 'g', page is from modal
    const currentFilters = decodeFilters(encodedFilters);
    let newPage = currentPage;

    if (derivedAction === 'p') newPage = Math.max(1, currentPage - 1);
    if (derivedAction === 'n') newPage = currentPage + 1;
    if (derivedAction === 'g') {
      const goToModal = new ModalBuilder()
        .setCustomId(`lock_mod_gotopg_${encodedFilters}`)
        .setTitle('Go to Page')
        .addComponents( /* ... TextInput ... */ new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('page_number').setLabel('Enter Page Number').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('E.g., 5')));
      await interaction.showModal(goToModal);
      return;
    }
    await showLockedWorldsList(interaction, newPage, currentFilters);

  } else if (typeOfAction === 'btn') {
    switch (derivedAction) {
      case 'main_filter_show':
        await showLockFilterModal(interaction);
        break;
      case 'remove_show_modal': // New case
        await showRemoveLockedWorldModal(interaction);
        break;
      case 'export_names': {
        await interaction.deferReply({ flags: 1 << 6 });
        const pageToExport = parseInt(actionArgs[0], 10);
        const encodedFiltersForExport = actionArgs[1] || '';
        const filtersForExport = decodeFilters(encodedFiltersForExport);

        const { worlds: worldsForExport } = await db.getLockedWorlds(interaction.user.id, pageToExport, CONSTANTS.PAGE_SIZE, filtersForExport);

        if (!worldsForExport || worldsForExport.length === 0) {
          await interaction.editReply({ content: 'No names to export on this page with the current filters.'});
          return;
        }
        let exportText = "```\n";
        worldsForExport.forEach(world => {
          exportText += `${world.world_name.toUpperCase()} (${world.lock_type})\n`;
        });
        exportText += "```";
        if (exportText.length > 2000) {
          let cutOff = exportText.lastIndexOf('\n', 1990);
          if (cutOff === -1) cutOff = 1990;
          exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
        }
        await interaction.editReply({ content: exportText }); // Ephemeral inherited
        break;
      }
      case 'fclr':
        await showLockedWorldsList(interaction, 1, {}); // Page 1, empty filters
        break;
      case 'rmconfirm': {
        const encodedWorldNameToRemove = actionArgs[0]; // Data is at first position in actionArgs
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
        break;
      }
      case 'rmcancel':
        await interaction.update({ content: '❌ Removal of locked world cancelled.', components: [] });
        break;
      default:
        logger.warn(`[LockCommand - Button] Unknown 'btn' derivedAction: ${derivedAction}`);
        await interaction.reply({content: 'Unknown button action.', flags: 1 << 6});
    }
  } else {
    logger.warn(`[LockCommand - Button] Unknown actionType: ${typeOfAction}`);
    await interaction.reply({content: 'Unknown button type.', flags: 1 << 6});
  }
}

async function handleModalSubmitCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'mod', 2: modal_type, (3: potentially encodedFilters, not used by main_filter_apply)]
  const modalType = customIdParts[2];
  // const encodedFilters = customIdParts[3] || ''; // Not strictly needed if main_filter_apply clears all
  // let currentFilters = decodeFilters(encodedFilters); // Old filters not needed, modal provides all new ones

  logger.debug(`[LockCommand - ModalSubmit] Handling modal: ${customIdParts.join('_')}`);

  if (modalType === 'gotopg') {
    const encodedFiltersForGoto = customIdParts[3] || ''; // goto still uses existing filters
    const currentFiltersForGoto = decodeFilters(encodedFiltersForGoto);
    const pageNumberStr = interaction.fields.getTextInputValue('page_number');
    const pageNumber = parseInt(pageNumberStr, 10);
    if (!isNaN(pageNumber) && pageNumber > 0) {
      await showLockedWorldsList(interaction, pageNumber, currentFiltersForGoto);
    } else {
      await interaction.followUp({ content: 'Invalid page number provided.', flags: 1 << 6 });
    }
    return;
  } else if (modalType === 'main_filter_apply') {
    await interaction.deferUpdate();
    const newFilters = {};

    const prefix = interaction.fields.getTextInputValue('lock_filter_prefix')?.trim();
    if (prefix) newFilters.prefix = prefix;

    const minLenStr = interaction.fields.getTextInputValue('lock_filter_min_len')?.trim();
    if (minLenStr) {
        const minLen = parseInt(minLenStr);
        if (!isNaN(minLen) && minLen > 0) {
            if (!newFilters.nameLength) newFilters.nameLength = {};
            newFilters.nameLength.min = minLen;
        }
    }
    const maxLenStr = interaction.fields.getTextInputValue('lock_filter_max_len')?.trim();
    if (maxLenStr) {
        const maxLen = parseInt(maxLenStr);
        if (!isNaN(maxLen) && maxLen > 0) {
            if (!newFilters.nameLength) newFilters.nameLength = {};
            newFilters.nameLength.max = maxLen;
        }
    }

    const lockType = interaction.fields.getTextInputValue('lock_filter_type')?.trim().toLowerCase();
    if (lockType && (lockType === 'main' || lockType === 'out')) {
        newFilters.lockType = lockType;
    }

    const note = interaction.fields.getTextInputValue('lock_filter_note')?.trim();
    if (note) newFilters.note = note;

    logger.info(`[LockCommand - ModalSubmit] Applying new filters: ${JSON.stringify(newFilters)}`);
    await showLockedWorldsList(interaction, 1, newFilters);
    return;
  } else if (modalType === 'remove' && customIdParts.length > 3 && customIdParts[3] === 'submit') { // Corrected structure
    await interaction.deferUpdate();
    const worldNameToRemove = interaction.fields.getTextInputValue('worldname_to_remove').trim();

    if (!worldNameToRemove) {
        await interaction.editReply({ content: '❌ World name cannot be empty.', flags: 1 << 6 });
        return;
    }

    const success = await db.removeLockedWorld(interaction.user.id, worldNameToRemove.toUpperCase());

    if (success) {
        await interaction.editReply({ content: `✅ World "**${worldNameToRemove}**" removed from your locked list. Refreshing list...`, flags: 1 << 6 });
    } else {
        await interaction.editReply({ content: `❌ Could not remove world "**${worldNameToRemove}**". It might not exist in your locked list or an error occurred.`, flags: 1 << 6 });
    }
    // Refresh the list view
    await showLockedWorldsList(interaction, 1, {}); // Refresh to page 1, no filters
    return;
  }
  // Fallthrough for unhandled modal types
  logger.warn(`[LockCommand - ModalSubmit] Unhandled or deprecated modal type: ${modalType}, full customId: ${customIdParts.join('_')}`);
}

async function handleSelectMenuCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'sel', 2: select_type, 3: encodedFilters]
  // const selectType = customIdParts[2];
  // const encodedFilters = customIdParts[3] || '';
  // let currentFilters = decodeFilters(encodedFilters);

  // logger.debug(`[LockCommand - SelectMenu] Handling select menu: ${customIdParts.join('_')}`);

  // if (selectType === 'ftype') { // This select menu is removed
  //   const selectedValue = interaction.values[0];
  //   if (selectedValue === 'any') {
  //     delete currentFilters.lockType;
  //   } else {
  //     currentFilters.lockType = selectedValue;
  //   }
  // }
  // await showLockedWorldsList(interaction, 1, currentFilters);
  logger.info(`[LockCommand - SelectMenu] Received select menu interaction, but 'ftype' (Filter by Type) is now part of the main filter modal: ${interaction.customId}`);
  await interaction.reply({content: "Filter by Type is now part of the main '🔍 Filter List' modal. Please use that button.", flags: 1 << 6 });
}

module.exports.handleButtonCommand = handleButtonCommand;
module.exports.handleModalSubmitCommand = handleModalSubmitCommand;
module.exports.handleSelectMenuCommand = handleSelectMenuCommand;
module.exports.showLockedWorldsList = showLockedWorldsList; // Exporting the function
