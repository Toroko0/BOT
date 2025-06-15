// list.js

// Imports
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, MessageFlags
} = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const { showWorldInfo } = require('./info.js');
const CONSTANTS = require('../utils/constants.js');
const { showLockedWorldsList } = require('./lock.js');
const { showTeamList } = require('./team.js'); // Added from new file for better team integration
const { showAddWorldModal } = require('./addworld.js'); // Import for Add World button
const { handleMarketBrowse } = require('./market.js'); // Import for Market Browse button

// --- Refactored Modal Definitions ---

// Helper for simple, single-input modals
async function showSimpleModal(interaction, type) {
    const modalConfig = {
        remove: { id: 'list_modal_remove', title: 'Remove World', label: 'World Name or Custom ID to Remove', placeholder: 'Case-insensitive world name or ID' },
        share: { id: 'list_modal_share', title: 'Share World', label: 'World Name or Custom ID', placeholder: 'World to make public in this server' },
        unshare: { id: 'list_modal_unshare', title: 'Unshare World', label: 'World Name or Custom ID', placeholder: 'World to make private from this server' },
        info: { id: 'list_modal_info', title: 'Get World Info', label: 'World Name or Custom ID', placeholder: 'Enter a world name or ID' }
    };

    const config = modalConfig[type];
    if (!config) {
        logger.error(`[list.js] Invalid type passed to showSimpleModal: ${type}`);
        return;
    }

    const modal = new ModalBuilder().setCustomId(config.id).setTitle(config.title);
    const textInput = new TextInputBuilder()
        .setCustomId('identifier') // Using a generic ID for simplicity
        .setLabel(config.label)
        .setPlaceholder(config.placeholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await interaction.showModal(modal);
}

// Modal for locking a world (multiple inputs)
async function showLockWorldModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('list_modal_lockworldsubmit')
        .setTitle('Lock World from Active List');
    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('identifier').setLabel('World Name or Custom ID to Lock').setPlaceholder('Enter the world name or its custom ID').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('lock_type').setLabel('Lock Type (main/out, optional)').setPlaceholder('Defaults to "main"').setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('note').setLabel('Optional Note').setStyle(TextInputStyle.Paragraph).setRequired(false)
        )
    );
    await interaction.showModal(modal);
}

// Modal for filtering the list (multiple inputs)
async function showListFilterModal(interaction, currentListType) {
  const modal = new ModalBuilder()
    .setCustomId(`list_modal_filterapply_${currentListType}`)
    .setTitle('Filter Worlds List');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_prefix').setLabel('World Name Prefix (Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_name_length_min').setLabel('Min Name Length (Optional, Number)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_name_length_max').setLabel('Max Name Length (Optional, Number)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_expiry_day').setLabel('Day of Expiry (e.g., Monday, Optional)').setPlaceholder('Full day name, case-insensitive').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_days_owned').setLabel('Days Owned (0-180, Optional)').setPlaceholder('0 = 180 days left, 179 = 1 day left').setStyle(TextInputStyle.Short).setRequired(false))
  );
  await interaction.showModal(modal);
}

// --- Function to show Modal for Go To Page ---
// Ensure utils.encodeFilters is imported or defined
async function showListPageGotoModal(interaction, type, totalPages, currentFilters) {
    const encodedFilters = utils.encodeFilters(currentFilters || {});

    const modal = new ModalBuilder()
        // Example customId: list_modal_gotopage_private_10_e30
        // e30 is base64url for {} (empty filters)
        .setCustomId(`list_modal_gotopage_${type}_${totalPages}_${encodedFilters}`)
        .setTitle('Go To Page');
    const pageInput = new TextInputBuilder()
        .setCustomId('page_number')
        .setLabel(`Enter Page Number (1-${totalPages})`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Page number');
    modal.addComponents(new ActionRowBuilder().addComponents(pageInput));
    await interaction.showModal(modal);
}

// --- Core List Display Function ---
async function showWorldsList(interaction, type = 'private', page = 1, currentFilters = null) {
    // Retained filter management from original
    interaction.client.activeListFilters = interaction.client.activeListFilters || {};
    if (currentFilters) {
        interaction.client.activeListFilters[interaction.user.id] = currentFilters;
    } else {
        delete interaction.client.activeListFilters[interaction.user.id];
    }

    const userPrefs = await db.getUserPreferences(interaction.user.id);
    const viewMode = userPrefs.view_mode || 'pc';
    const timezoneOffset = userPrefs.timezone_offset || 0.0;
    const userTeam = await db.getUserTeam(interaction.user.id);

    logger.info(`[list.js] showWorldsList called - Type: ${type}, Page: ${page}, Filters: ${JSON.stringify(currentFilters)}`);

    const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch (e) { logger.error(`[list.js] Defer update failed: ${e.message}`); return; }
    }

    if (!interaction.guildId) type = 'private';

    let dbResult = { worlds: [], total: 0 };
    try {
        // Using the simplified, single database call from the new file
        const filtersForDb = { ...currentFilters, guildId: type === 'public' ? interaction.guildId : null };
        const userIdForDb = type === 'private' ? interaction.user.id : null;
        dbResult = await db.getFilteredWorlds(userIdForDb, filtersForDb, page, CONSTANTS.PAGE_SIZE);
    } catch (error) {
        // CRITICAL: Retained the robust error handling from the original file
        logger.error(`[list.js] Error fetching worlds:`, error?.stack || error);
        const errorContent = { content: '❌ Sorry, I couldn\'t fetch the worlds list.', components: [], flags: MessageFlags.Ephemeral };
        try {
            if (isUpdate) await interaction.editReply(errorContent); else await interaction.reply(errorContent);
        } catch (replyError) {
            logger.error(`[list.js] Failed to send DB error reply: ${replyError.message}`);
        }
        return;
    }

    const worlds = dbResult.worlds || [];
    const totalWorlds = dbResult.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE));
    page = Math.max(1, Math.min(page, totalPages));

    // CRITICAL: Retained the detailed sorting logic from the original file
    if (worlds.length > 0) {
        const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
        const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
        worlds.sort((a, b) => {
            const expiryDateA_UTC = new Date(a.expiry_date);
            const expiryDateB_UTC = new Date(b.expiry_date);
            const daysLeftA = Math.ceil((new Date(Date.UTC(expiryDateA_UTC.getUTCFullYear(), expiryDateA_UTC.getUTCMonth(), expiryDateA_UTC.getUTCDate())).getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
            const daysLeftB = Math.ceil((new Date(Date.UTC(expiryDateB_UTC.getUTCFullYear(), expiryDateB_UTC.getUTCMonth(), expiryDateB_UTC.getUTCDate())).getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
            const daysOwnedA = daysLeftA <= 0 ? 180 : Math.max(0, 180 - daysLeftA);
            const daysOwnedB = daysLeftB <= 0 ? 180 : Math.max(0, 180 - daysLeftB);
            if (daysOwnedA !== daysOwnedB) return daysOwnedB - daysOwnedA;
            const nameLengthDiff = a.name.length - b.name.length;
            if (nameLengthDiff !== 0) return nameLengthDiff;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
    }

    if (worlds.length === 0) {
        let emptyMsg = `No ${type} worlds found.`;
        if (currentFilters && Object.keys(currentFilters).length > 0) emptyMsg = `No ${type} worlds match your filters. Try adjusting them.`;
        else if (type === 'private') emptyMsg = "You haven't added any worlds yet. Use `/addworld` or the button below!";
        else if (interaction.guildId) emptyMsg = `There are no public worlds shared in this server yet.`;
        
        const emptyRow = new ActionRowBuilder();
        if (type === 'private') emptyRow.addComponents(new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add World').setStyle(ButtonStyle.Success));
        if (interaction.guildId) {
            const target = type === 'private' ? 'public' : 'private';
            emptyRow.addComponents(new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'} Worlds`).setStyle(ButtonStyle.Secondary));
        }
        emptyRow.addComponents(new ButtonBuilder().setCustomId(`list_button_filtershow_${type}`).setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary));
        if (userTeam && type === 'private') {
            emptyRow.addComponents(new ButtonBuilder().setCustomId('list_button_viewteam').setLabel('🏢 View Team Worlds').setStyle(ButtonStyle.Secondary));
        }

        const opts = { content: emptyMsg, components: emptyRow.components.length > 0 ? [emptyRow] : [], flags: MessageFlags.Ephemeral };
        await interaction.editReply(opts);
        return;
    }
    
    // Retained the detailed, original table generation and component building logic
    const { data, config } = utils.formatWorldsToTable(worlds, viewMode, type, timezoneOffset);
    let tableOutput = '```\n' + table(data, config) + '\n```';
    if (tableOutput.length > 1900) {
        tableOutput = tableOutput.substring(0, tableOutput.lastIndexOf('\n', 1900)) + '\n... (Table truncated) ...```';
    }

    const components = [];
    // Navigation Row (using a utility for cleaner code)
    components.push(utils.createPaginationRow(`list_button_page_${type}`, page, totalPages));
    
    // Action Row 1
    const actionRow1 = new ActionRowBuilder();
    if (type === 'private') {
        actionRow1.addComponents(
            new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('list_button_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('list_button_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary)
        );
    } else {
        actionRow1.addComponents(new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary));
    }
    actionRow1.addComponents(new ButtonBuilder().setCustomId(`list_button_export_${type}_${page}`).setLabel('📄 Export').setStyle(ButtonStyle.Secondary));
    components.push(actionRow1);

    // Action Row 2
    const actionRow2 = new ActionRowBuilder();
    if (interaction.guildId) {
        const target = type === 'private' ? 'public' : 'private';
        actionRow2.addComponents(
            new ButtonBuilder().setCustomId(`list_button_${type === 'private' ? 'share' : 'unshare'}`).setLabel(type === 'private' ? '🔗 Share' : '🔓 Unshare').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'} Worlds`).setStyle(ButtonStyle.Secondary)
        );
    }
    actionRow2.addComponents(
        new ButtonBuilder().setCustomId(`list_button_filtershow_${type}`).setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('list_button_settings').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('list_button_viewlocks').setLabel('🔐 View Locks').setStyle(ButtonStyle.Primary)
    );
    if (actionRow2.components.length > 0) components.push(actionRow2);

    // Action Row 3
    const actionRow3 = new ActionRowBuilder();
    if (userTeam && type === 'private') {
        actionRow3.addComponents(new ButtonBuilder().setCustomId('list_button_viewteam').setLabel('🏢 Team Worlds').setStyle(ButtonStyle.Secondary));
    }
    // Add Market button here
    actionRow3.addComponents(
        new ButtonBuilder()
            .setCustomId('list_button_marketbrowse')
            .setLabel('🛒 Market')
            .setStyle(ButtonStyle.Success)
    );
    if (actionRow3.components.length > 0) components.push(actionRow3);
    
    // Select Menu
    if (viewMode === 'pc' && worlds.length > 0 && type === 'private') {
        const selectOptions = worlds.slice(0, 25).map(world => utils.createWorldSelectOption(world, timezoneOffset));
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions)));
    }
  
    const finalContent = `${tableOutput}\n📊 Total ${type} worlds: ${totalWorlds}`;
    const finalOpts = { content: finalContent, components, flags: MessageFlags.Ephemeral };
    await interaction.editReply(finalOpts);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('View your tracked Growtopia worlds or public worlds in this server.'),
    async execute(interaction) {
        logger.info(`[list.js] Entered execute function for /list, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await showWorldsList(interaction, 'private', 1, null);
    },
    async handleButton(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); return; }

        const [action, ...args] = params;
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || null;

        switch (action) {
            case 'page': {
                // interaction.customId is like "list_button_page_private_1"
                // params = customId.split('_').slice(2) = ["page", "private", "1"]
                // action = params[0] = "page"
                // args = params.slice(1) = ["private", "1"]
                const type = args[0]; // "private"
                const pageStr = args[1]; // "1" (target page)
                await showWorldsList(interaction, type, parseInt(pageStr) || 1, userActiveFilters);
                break;
            }
            case 'goto': {
                // interaction.customId is like "list_button_goto_private_10" (10 is totalPages)
                // params = customId.split('_').slice(2) = ["goto", "private", "10"]
                // action = params[0] = "goto"
                // args = params.slice(1) = ["private", "10"]
                const type = args[0]; // "private"
                const totalPagesStr = args[1]; // "10"
                const totalPages = parseInt(totalPagesStr);
                // userActiveFilters is already defined above
                await showListPageGotoModal(interaction, type, totalPages, userActiveFilters);
                break;
            }
            case 'switch': {
                const [type, pageStr] = args;
                await showWorldsList(interaction, type, parseInt(pageStr) || 1, null); // Clear filters on switch
                break;
            }
            case 'remove':
            case 'info':
            case 'share':
            case 'unshare':
                await showSimpleModal(interaction, action);
                break;
            case 'lock':
                await showLockWorldModal(interaction);
                break;
            case 'add':
                // await interaction.reply({ content: "Please use the `/addworld` command to add a new world.", flags: MessageFlags.Ephemeral }); // Old behavior
                await showAddWorldModal(interaction); // New behavior
                break;
            case 'filtershow': {
                const [type] = args;
                await showListFilterModal(interaction, type);
                break;
            }
            case 'settings': {
                const { getSettingsReplyOptions } = require('./settings.js');
                const settingsReply = await getSettingsReplyOptions(interaction.user.id);
                await interaction.reply(settingsReply);
                break;
            }
            case 'viewlocks':
                await showLockedWorldsList(interaction, 1, {});
                break;
            case 'viewteam': {
                const userTeam = await db.getUserTeam(interaction.user.id);
                if (!userTeam) return interaction.reply({ content: "You're not in a team. Use `/team` to join or create one.", ephemeral: true });
                await showTeamList(interaction, 1, {}); // Assuming team list takes page and filters
                break;
            }
            case 'export': {
                // const [type, pageStr] = args; // pageStr is no longer directly used here
                const type = args[0];
                // userActiveFilters is already defined above
                const encodedFilters = utils.encodeFilters(userActiveFilters || {});

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`list_button_exportall_${type}_${encodedFilters}`)
                            .setLabel('Export All (Matching Filters)')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`list_button_exportmature_${type}_${encodedFilters}`)
                            .setLabel('Export Mature (180 Days, Filters)')
                            .setStyle(ButtonStyle.Secondary)
                    );
                await interaction.reply({
                    content: 'Choose what to export:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
                break;
            }
            case 'exportall': {
                await interaction.deferUpdate(); // Acknowledge the button click, will edit reply later
                const [type, encodedFilters] = args;
                const currentFilters = utils.decodeFilters(encodedFilters);
                const userIdForDb = type === 'private' ? interaction.user.id : null;
                const filtersForDb = { ...currentFilters, guildId: type === 'public' ? interaction.guildId : null };

                // Use getAllFilteredWorlds which fetches all, not paginated
                const worlds = await db.getAllFilteredWorlds(userIdForDb, filtersForDb);

                if (!worlds || worlds.length === 0) {
                    await interaction.editReply({ content: 'No names to export with the current filters.', components: [] });
                    return;
                }

                let exportText = "```\n" + worlds.map(world => {
                    let lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                    if (world.lock_type === 'mainlock') lockChar = 'M'; else if (world.lock_type === 'outlock') lockChar = 'O';
                    const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                    return `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}`;
                }).join('\n') + "\n```";
                
                await interaction.editReply({ content: exportText.substring(0, 2000), components: [] });
                break;
            }
            case 'exportmature': {
                await interaction.deferUpdate();
                const [type, encodedFilters] = args;
                const currentFilters = utils.decodeFilters(encodedFilters);
                const userIdForDb = type === 'private' ? interaction.user.id : null;

                // Add daysOwned: 180 to existing filters to fetch only mature worlds
                const filtersForDb = {
                    ...currentFilters,
                    guildId: type === 'public' ? interaction.guildId : null,
                    daysOwned: 180 // This existing filter option in db.getAllFilteredWorlds should correctly fetch expired/mature worlds
                };

                const worlds = await db.getAllFilteredWorlds(userIdForDb, filtersForDb);

                if (!worlds || worlds.length === 0) {
                    await interaction.editReply({ content: 'No mature (180 days) names to export with the current filters.', components: [] });
                    return;
                }

                let exportText = "```\n" + worlds.map(world => {
                    let lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                    if (world.lock_type === 'mainlock') lockChar = 'M'; else if (world.lock_type === 'outlock') lockChar = 'O';
                    const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                    return `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}`;
                }).join('\n') + "\n```";

                await interaction.editReply({ content: exportText.substring(0, 2000), components: [] });
                break;
            }
            case 'marketbrowse': {
                // handleMarketBrowse in market.js does its own deferReply or deferUpdate for the initial call.
                await handleMarketBrowse(interaction, 1, {}); // Show page 1, no filters/options
                break;
            }
            default:
                logger.warn(`[list.js] Unknown button action: ${action}`);
                if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                break;
        }
    },
    async handleSelectMenu(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_select');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); return; }

        const [action] = params;
        if (action === 'info') {
            if (!interaction.values || interaction.values.length === 0) return;
            const worldId = parseInt(interaction.values[0]);
            const world = await db.getWorldById(worldId);
            if (!world || (world.user_id !== interaction.user.id && !world.is_public)) {
                return interaction.reply({ content: '❌ World not found or you lack permission.', flags: MessageFlags.Ephemeral });
            }
            await showWorldInfo(interaction, world);
        }
    },
    async handleModal(interaction, params) {
        // Using original's robust modal handling logic, adapted for new modal structure
        // params for list_modal_filterapply_private -> params = ["filterapply", "private"]
        // params for list_modal_gotopage_private_10_e30 -> params = ["gotopage", "private", "10", "e30"]
        const action = params[0];
        const type = params[1];

        if (action === 'filterapply') {
            await interaction.deferUpdate();
            const filters = utils.parseFilterModal(interaction);
            logger.info(`[list.js] Applying filters: ${JSON.stringify(filters)} for list type ${type}`);
            await showWorldsList(interaction, type, 1, filters);
            return;
        } else if (action === 'gotopage') {
            // type is params[1] (e.g. "private")
            const totalPages = parseInt(params[2]);
            const encodedFiltersFromModalId = params[3]; // Can be undefined if not in customId
            const currentFilters = utils.decodeFilters(encodedFiltersFromModalId);

            const pageNumberStr = interaction.fields.getTextInputValue('page_number');
            const pageNumber = parseInt(pageNumberStr);

            if (isNaN(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
                await interaction.reply({ content: `Invalid page number. Please enter a number between 1 and ${totalPages}.`, ephemeral: true });
                return;
            }
            await interaction.deferUpdate();
            await showWorldsList(interaction, type, pageNumber, currentFilters);
            return;
        }

        // IMPORTANT: The following logic for 'identifier' is for other modals.
        // It should only execute if the action is NOT 'filterapply' or 'gotopage'.
        const identifier = interaction.fields.getTextInputValue('identifier');
        if (!identifier) {
            logger.error(`[list.js] Modal action '${action}' (type: ${type}) submitted without an 'identifier' field.`);
            return interaction.reply({ content: 'There was an error processing this form. The required field was missing.', ephemeral: true });
        }

        // Defer for actions that need DB lookups (original logic)
        // 'remove' does its own reply for confirmation, so it's not deferred here.
        if (action !== 'remove') await interaction.deferReply({ ephemeral: true });

        const world = await db.findWorldByIdentifier(interaction.user.id, identifier, interaction.guildId);
        
        // Switch for 'remove', 'share', 'unshare', 'info', 'lockworldsubmit' using 'action' and 'world'
        // ... (rest of existing modal handling logic) ...
        switch (action) {
            case 'remove': {
                // CRITICAL: Retained the remove confirmation flow from the original file
                if (!world || world.user_id !== interaction.user.id) {
                    return interaction.reply({ content: `❌ World "**${identifier}**" not found in your list.`, flags: MessageFlags.Ephemeral });
                }
                const confirmId = `remove_button_confirm_${world.id}`;
                const cancelId = `remove_button_cancel`;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}** from your list?`, components: [row], flags: MessageFlags.Ephemeral });
                break;
            }
            case 'share':
            case 'unshare': {
                if (!interaction.guildId) return interaction.editReply({ content: "Sharing/unsharing is only possible in a server." });
                if (!world || world.user_id !== interaction.user.id) return interaction.editReply({ content: `❌ World "**${identifier}**" not found in your list.` });
                
                const makePublic = action === 'share';
                if (makePublic && world.is_public && world.guild_id === interaction.guildId) {
                    return interaction.editReply({ content: `🌐 **${world.name.toUpperCase()}** is already public in this server.` });
                }
                if (!makePublic && !world.is_public) {
                    return interaction.editReply({ content: `🔒 **${world.name.toUpperCase()}** is already private.` });
                }

                const success = await db.updateWorldVisibility(world.id, interaction.user.id, makePublic, makePublic ? interaction.guildId : null);
                if (success) {
                    await require('./search.js').invalidateSearchCache();
                    await require('../utils/share_and_history.js').logHistory(world.id, interaction.user.id, action, `World ${world.name.toUpperCase()} ${action}d in guild ${interaction.guildId}`);
                }
                await interaction.editReply({ content: success ? `✅ World **${world.name}** is now ${makePublic ? 'public here' : 'private'}.` : `❌ Failed to update world visibility.` });
                break;
            }
            case 'info': {
                if (!world) return interaction.editReply({ content: `❌ World "**${identifier}**" not found or not accessible.` });
                await showWorldInfo(interaction, world);
                break;
            }
            case 'lockworldsubmit': {
                // await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Modal was submitted, need new reply
                const lockType = interaction.fields.getTextInputValue('lock_type')?.trim().toLowerCase() || 'main';
                const note = interaction.fields.getTextInputValue('note')?.trim() || null;
                
                // world lookup already done above
                if (!world || world.user_id !== interaction.user.id) return interaction.editReply({ content: `❌ World "${identifier}" not found in your active list.` });
                
                const alreadyLocked = await db.findLockedWorldByName(interaction.user.id, world.name);
                if (alreadyLocked) return interaction.editReply({ content: `❌ World **${world.name}** is already in your Locks list.` });
                
                const result = await db.moveWorldToLocks(interaction.user.id, world.id, lockType, note);
                await interaction.editReply({ content: result.success ? `✅ ${result.message}` : `❌ ${result.message}` });
                break;
            }
            default:
                logger.warn(`[list.js] Unhandled modal action: ${action}`);
                await interaction.reply({ content: 'This action is not recognized.', flags: MessageFlags.Ephemeral });
                break;
        }
    },
    showWorldsList
};
