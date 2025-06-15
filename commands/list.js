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
        const errorContent = { content: '❌ Sorry, I couldn\'t fetch the worlds list.', components: [], ephemeral: true };
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

        const opts = { content: emptyMsg, components: emptyRow.components.length > 0 ? [emptyRow] : [], ephemeral: true };
        if (isUpdate) await interaction.editReply(opts); else if (!interaction.replied) await interaction.reply(opts); else await interaction.followUp(opts);
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
    components.push(utils.createPaginationRow(page, totalPages, `list_button_page_${type}`, !!currentFilters));
    
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
    if (userTeam && type === 'private') {
        actionRow2.addComponents(new ButtonBuilder().setCustomId('list_button_viewteam').setLabel('🏢 Team Worlds').setStyle(ButtonStyle.Secondary));
    }
    if (actionRow2.components.length > 0) components.push(actionRow2);
    
    // Select Menu
    if (viewMode === 'pc' && worlds.length > 0 && type === 'private') {
        const selectOptions = worlds.slice(0, 25).map(world => utils.createWorldSelectOption(world, timezoneOffset));
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions)));
    }
  
    const finalContent = `${tableOutput}\n📊 Total ${type} worlds: ${totalWorlds}`;
    const finalOpts = { content: finalContent, components, ephemeral: true };
    if (isUpdate) await interaction.editReply(finalOpts); else if (!interaction.replied) await interaction.reply(finalOpts); else await interaction.followUp(finalOpts);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('View your tracked Growtopia worlds or public worlds in this server.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        await showWorldsList(interaction, 'private', 1, null);
    },
    async handleButton(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); return; }

        const [action, ...args] = params;
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || null;

        switch (action) {
            case 'page': {
                const [type, pageStr] = args;
                await showWorldsList(interaction, type, parseInt(pageStr) || 1, userActiveFilters);
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
                await interaction.reply({ content: "Please use the `/addworld` command to add a new world.", ephemeral: true });
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
                await interaction.deferReply({ ephemeral: true });
                const [type, pageStr] = args;
                const page = parseInt(pageStr) || 1;
                const filtersForDb = { ...userActiveFilters, guildId: type === 'public' ? interaction.guildId : null };
                const userIdForDb = type === 'private' ? interaction.user.id : null;
                const { worlds } = await db.getFilteredWorlds(userIdForDb, filtersForDb, page, CONSTANTS.PAGE_SIZE);
                if (worlds.length === 0) { await interaction.editReply({ content: 'No names to export on this page.' }); return; }

                // CRITICAL: Retained the detailed export format from the original file
                let exportText = "```\n" + worlds.map(world => {
                    const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                    const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                    return `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}`;
                }).join('\n') + "\n```";
                
                await interaction.editReply({ content: exportText.substring(0, 2000) });
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
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); return; }

        const [action] = params;
        if (action === 'info') {
            if (!interaction.values || interaction.values.length === 0) return;
            const worldId = parseInt(interaction.values[0]);
            const world = await db.getWorldById(worldId);
            if (!world || (world.user_id !== interaction.user.id && !world.is_public)) {
                return interaction.reply({ content: '❌ World not found or you lack permission.', ephemeral: true });
            }
            await showWorldInfo(interaction, world);
        }
    },
    async handleModal(interaction, params) {
        // Using original's robust modal handling logic, adapted for new modal structure
        const [action, type] = params; // e.g., 'filterapply', 'private'

        if (action === 'filterapply') {
            await interaction.deferUpdate();
            const filters = utils.parseFilterModal(interaction);
            logger.info(`[list.js] Applying filters: ${JSON.stringify(filters)} for list type ${type}`);
            await showWorldsList(interaction, type, 1, filters);
            return;
        }
        
        const identifier = interaction.fields.getTextInputValue('identifier');
        if (!identifier) {
            logger.error(`[list.js] Modal action '${action}' submitted without an 'identifier' field.`);
            return interaction.reply({ content: 'There was an error processing this form. The required field was missing.', ephemeral: true });
        }

        // Defer for actions that need DB lookups
        if (action !== 'remove') await interaction.deferReply({ ephemeral: true });

        const world = await db.findWorldByIdentifier(interaction.user.id, identifier, interaction.guildId);
        
        switch (action) {
            case 'remove': {
                // CRITICAL: Retained the remove confirmation flow from the original file
                if (!world || world.user_id !== interaction.user.id) {
                    return interaction.reply({ content: `❌ World "**${identifier}**" not found in your list.`, ephemeral: true });
                }
                const confirmId = `remove_button_confirm_${world.id}`;
                const cancelId = `remove_button_cancel`;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}** from your list?`, components: [row], ephemeral: true });
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
                await interaction.deferReply({ ephemeral: true }); // Modal was submitted, need new reply
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
                await interaction.reply({ content: 'This action is not recognized.', ephemeral: true });
                break;
        }
    },
    showWorldsList
};
