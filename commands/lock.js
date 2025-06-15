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
    .setCustomId('lock_mod_main_filter_apply') // Changed 'modal' to 'mod' for consistency
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

function truncateString(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    // Keep 3 for "..."
    return str.substring(0, maxLength - 3) + '...';
}

async function showLockedWorldsList(interaction, page = 1, currentFilters = {}) {
  const ephemeralFlag = true;
  const PAGE_SIZE_LOCKED = CONSTANTS.PAGE_SIZE || 10;

  let viewMode = 'pc';
  try {
    const userPrefs = await db.getUserPreferences(interaction.user.id);
    if (userPrefs && userPrefs.view_mode) {
        viewMode = userPrefs.view_mode;
    }
  } catch (e) {
    logger.warn(`[LockCommand - ShowLockedWorlds] Failed to get user preferences for ${interaction.user.id}: ${e.message}`);
  }

  try {
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate({ ephemeral: ephemeralFlag });
      }
    } else {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: ephemeralFlag });
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
          new ButtonBuilder().setCustomId(`lock_btn_fclr_1`).setLabel('Clear Filters').setStyle(ButtonStyle.Danger)
        ));
      }
      await interaction.editReply({ content, embeds: [], components, ephemeral: ephemeralFlag });
      return;
    }

    // --- Table-Based Display ---
    let headers;
    const data = []; // Initialize data array
    let currentTableConfig;

    if (viewMode === 'phone') {
        headers = ['WORLD', 'TYPE', 'NOTE'];
        data.push(headers); // Add headers first

        worlds.forEach(world => {
            const worldName = truncateString(world.world_name, 15);
            const lockType = world.lock_type;
            const noteText = truncateString(world.note || 'N/A', 20);
            data.push([worldName, lockType, noteText]);
        });

        currentTableConfig = {
            columns: [
                { alignment: 'left', width: 15, wrapWord: true }, // WORLD
                { alignment: 'left', width: 7 },  // TYPE
                { alignment: 'left', width: 20, wrapWord: true }  // NOTE
            ],
            border: getBorderCharacters('compact'),
            header: { alignment: 'center', content: '🔒 Locks (Phone)' }
        };
    } else { // PC Mode
        headers = ['WORLD', 'TYPE', 'LOCKED ON', 'NOTE'];
        data.push(headers); // Add headers first

        worlds.forEach(world => {
            const worldName = world.world_name;
            const lockType = world.lock_type;
            const lockedOnDate = world.locked_on_date ? new Date(world.locked_on_date).toLocaleDateString('en-CA') : 'N/A';
            const noteText = world.note || 'N/A';
            data.push([worldName, lockType, lockedOnDate, noteText]);
        });

        currentTableConfig = {
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
    }

    let tableOutput = `\`\`\`\n${table(data, currentTableConfig)}\n\`\`\``;
    const footerText = `\n📊 Total locked worlds: ${total} | Page ${page}/${totalPages}`;

    // Ensure headers is defined for the join operation in truncation logic
    const currentHeadersString = headers.join(" | ");
    if (tableOutput.length + footerText.length > 1990) { // Adjusted for footer and potential truncation message
        const availableLength = 1950 - footerText.length - "\n... (Table truncated) ...```".length;
        let cutOff = tableOutput.lastIndexOf('\n', availableLength);
        if (cutOff === -1 || cutOff < currentHeadersString.length) cutOff = availableLength; // Ensure header is not cut awkwardly
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

    if (Object.keys(currentFilters).length > 0) {
      filterActionRow.addComponents(
        new ButtonBuilder().setCustomId(`lock_btn_fclr`).setLabel('Clear All Filters').setStyle(ButtonStyle.Danger) // Simplified customId for clear
      );
    }
    allActionRows.push(filterActionRow);

    // Add StringSelectMenu for removing worlds if worlds are present
    if (worlds && worlds.length > 0) {
        const removeWorldOptions = worlds.map(world => {
            const label = truncateString(`${world.world_name} (${world.lock_type})`, 100); // Max label length is 100
            const description = truncateString(world.note || 'No note', 100); // Max description length is 100
            // world.id is not available, using encoded world_name as planned.
            const encodedWorldName = Buffer.from(world.world_name).toString('base64url');
            return {
                label: label,
                description: description,
                value: `remove:${encodedWorldName}`
            };
        });

        const removeWorldSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('lock_sel_removeworldaction')
            .setPlaceholder('Select a world to remove...')
            .addOptions(removeWorldOptions);

        allActionRows.push(new ActionRowBuilder().addComponents(removeWorldSelectMenu));
    }

    await interaction.editReply({ content: finalContent, embeds: [], components: allActionRows, ephemeral: ephemeralFlag });

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
    // const currentFilters = decodeFilters(actionSpecificData); // Not needed for main_filter_show or export_names if data is page

    if (actionName === 'main_filter_show') {
        await showLockFilterModal(interaction);
    } else if (actionName === 'export_names') {
        await interaction.deferReply({ ephemeral: true });
        const pageToExport = parseInt(actionSpecificData, 10); // Here actionSpecificData is the page number from lock_btn_export_names_PAGE_filters
        const encodedFiltersForExport = customIdParts[4] || ''; // Filters are the 5th part of customId
        const filtersForExport = decodeFilters(encodedFiltersForExport);

        const { worlds: worldsForExport } = await db.getLockedWorlds(interaction.user.id, pageToExport, CONSTANTS.PAGE_SIZE, filtersForExport);

        if (!worldsForExport || worldsForExport.length === 0) {
            await interaction.editReply({ content: 'No names to export on this page with the current filters.', ephemeral: true });
            return;
        }

        let exportText = "```\n";
        worldsForExport.forEach(world => {
            exportText += `${world.world_name.toUpperCase()} (${world.lock_type})\n`;
        });
        exportText += "```";

        if (exportText.length > 2000) {
            let cutOff = exportText.lastIndexOf('\n', 1990);
            if (cutOff === -1) cutOff = 1990; // Should not happen with ```
            exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
        }
        await interaction.editReply({ content: exportText, ephemeral: true });

    // } else if (actionName === 'flen') { // Old individual filter button logic - commented out/removed
    //   // ...
    } else if (actionName === 'fclr') {
      // CustomId for clear is now just `lock_btn_fclr`
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
      await interaction.followUp({ content: 'Invalid page number provided.', ephemeral: true });
    }
    return;
  } else if (modalType === 'main_filter_apply') { // This modalType comes from lock_mod_main_filter_apply
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
  }
  // Commenting out old individual filter modal handlers:
  // if (modalType === 'flen') { ... }
  // else if (modalType === 'fprfx') { ... }
  // else if (modalType === 'fnote') { ... }

  // If an old modal type that's no longer handled is submitted, it might fall through.
  // Or, explicitly acknowledge and ask user to use new filter button if necessary.
  logger.warn(`[LockCommand - ModalSubmit] Unhandled or deprecated modal type: ${modalType}`);
  // await showLockedWorldsList(interaction, 1, currentFilters); // Or reshow with old filters if any
}

async function handleSelectMenuCommand(interaction, customIdParts) {
  // customIdParts: [0: 'lock', 1: 'sel', 2: select_type, 3: encodedFilters]
  // const selectType = customIdParts[2];
  // const encodedFilters = customIdParts[3] || ''; // Not used if customId is simple like 'lock_sel_removeworldaction'
  // let currentFilters = decodeFilters(encodedFilters); // Not needed for this action

  logger.debug(`[LockCommand - SelectMenu] Handling select menu: ${interaction.customId}`);

  if (interaction.customId === 'lock_sel_removeworldaction') {
    const selectedValue = interaction.values[0];
    const [action, encodedWorldName] = selectedValue.split(':');

    if (action === 'remove') {
      const worldNameToRemove = Buffer.from(encodedWorldName, 'base64url').toString('utf8');

      // Prepare confirmation buttons
      const confirmButton = new ButtonBuilder()
        .setCustomId(`lock_btn_rmconfirm_${encodedWorldName}`)
        .setLabel('✅ Yes, Remove')
        .setStyle(ButtonStyle.Danger);
      const cancelButton = new ButtonBuilder()
        .setCustomId('lock_btn_rmcancel_0') // Placeholder, not used by cancel logic
        .setLabel('❌ No, Cancel')
        .setStyle(ButtonStyle.Secondary);
      const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

      await interaction.reply({
        content: `⚠️ Are you sure you want to remove **${worldNameToRemove}** from your Locks list? This action cannot be undone.`,
        components: [row],
        ephemeral: true
      });
    }
  } else {
    // Fallback for other select menus, or if 'ftype' was intended to be handled differently.
    // Based on previous state, 'ftype' was deprecated.
    logger.info(`[LockCommand - SelectMenu] Received unhandled select menu ID: ${interaction.customId}`);
    await interaction.reply({ content: "This selection is not currently handled.", ephemeral: true });
  }
}

module.exports.handleButtonCommand = handleButtonCommand;
module.exports.handleModalSubmitCommand = handleModalSubmitCommand;
module.exports.handleSelectMenuCommand = handleSelectMenuCommand;
module.exports.showLockedWorldsList = showLockedWorldsList; // Exporting the function
