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
const { showAddWorldModal } = require('../commands/addworld.js');
const CONSTANTS = require('../utils/constants.js');
const { DateTime, Duration } = require('luxon');

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
async function showWorldsList(interaction, page = 1, currentFilters = null, targetUsername = null) {
    interaction.client.activeListFilters = interaction.client.activeListFilters || {};
    if (currentFilters) {
        interaction.client.activeListFilters[interaction.user.id] = currentFilters;
    } else {
        delete interaction.client.activeListFilters[interaction.user.id];
    }

    const userPreferences = await db.getUserPreferences(interaction.user.id);
    const viewMode = userPreferences.view_mode || 'pc';
    const timezoneOffset = userPreferences.timezone_offset || 0.0;

    logger.info(`[list.js] showWorldsList called - Page: ${page}, Filters: ${JSON.stringify(currentFilters)}, Target: ${targetUsername}`);

    const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch (e) { logger.error(`[list.js] Defer update failed: ${e.message}`); return; }
    }

    let dbResult = { worlds: [], total: 0 };
    try {
        dbResult = await db.getFilteredWorlds(currentFilters, page, CONSTANTS.PAGE_SIZE);
    } catch (error) {
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

    const nowUtc = DateTime.utc().startOf('day');
    worlds.forEach(world => {
        const expiryDateUtc = DateTime.fromISO(world.expiry_date, { zone: 'utc' }).startOf('day');
        const diff = expiryDateUtc.diff(nowUtc, 'days').toObject();
        world.daysLeft = Math.floor(diff.days);
        world.daysOwned = 180 - world.daysLeft;
        if (world.daysLeft <= 0) {
            world.daysLeft = 'EXP';
            world.daysOwned = 180;
        }
    });

    if (worlds.length > 0) {
        worlds.sort((a, b) => {
            const daysOwnedA = a.daysOwned;
            const daysOwnedB = b.daysOwned;
            if (daysOwnedA !== daysOwnedB) return daysOwnedB - daysOwnedA;
            const nameLengthDiff = a.name.length - b.name.length;
            if (nameLengthDiff !== 0) return nameLengthDiff;
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
    }

    if (worlds.length === 0) {
        let emptyMsg = `No worlds found.`;
        if (currentFilters && Object.keys(currentFilters).length > 0) emptyMsg = `No worlds match your filters. Try adjusting them.`;
        else emptyMsg = "The list is empty. Use `/addworld` or the button below to add a world!";
        
        const emptyRow = new ActionRowBuilder();
        emptyRow.addComponents(new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add World').setStyle(ButtonStyle.Success));
        emptyRow.addComponents(new ButtonBuilder().setCustomId(`list_button_filtershow`).setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary));

        const opts = { content: emptyMsg, components: [emptyRow], flags: MessageFlags.Ephemeral };
        await interaction.editReply(opts);
        return;
    }
    
    const { data, config } = utils.formatWorldsToTable(worlds, viewMode, 'public', timezoneOffset, targetUsername);
    let tableOutput = '```\n' + table(data, config) + '\n```';
    const footer = `\n📊 Total worlds: ${totalWorlds}`;

    if ((tableOutput + footer).length > 2000) {
        const availableLength = 2000 - footer.length - 30;
        let cutOff = tableOutput.lastIndexOf('\n', availableLength);
        if (cutOff === -1) cutOff = availableLength;
        tableOutput = tableOutput.substring(0, cutOff) + "\n... (list truncated)```";
    }

    const components = [];
    components.push(utils.createPaginationRow(`list_button_page`, page, totalPages));
    
    const isOwnList = !targetUsername || targetUsername.toLowerCase() === interaction.user.username.toLowerCase();
    const actionRow1 = new ActionRowBuilder();
    actionRow1.addComponents(
        new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add').setStyle(ButtonStyle.Success).setDisabled(!isOwnList),
        new ButtonBuilder().setCustomId('list_button_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger).setDisabled(!isOwnList),
        new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`list_button_export`).setLabel('📄 Export').setStyle(ButtonStyle.Secondary)
    );
    components.push(actionRow1);

    const actionRow2 = new ActionRowBuilder();
    actionRow2.addComponents(
        new ButtonBuilder().setCustomId(`list_button_filtershow`).setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('settings_button_show').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary)
    );
    if (actionRow2.components.length > 0) components.push(actionRow2);
    
    if (viewMode === 'pc' && worlds.length > 0) {
        const selectOptions = worlds.slice(0, 25).map(world => utils.createWorldSelectOption(world, timezoneOffset));
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions)));
    }
  
    const finalContent = tableOutput + footer;
    const finalOpts = { content: finalContent, components, flags: MessageFlags.Ephemeral };
    await interaction.editReply(finalOpts);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('View the tracked Growtopia worlds.')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('Filter the list by a specific user.')
                .setRequired(false)),
    async execute(interaction) {
        logger.info(`[list.js] Entered execute function for /list, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const username = interaction.options.getString('user');
        const filters = username ? { added_by_username: username } : {};
        await showWorldsList(interaction, 1, filters, username);
    },
    async handleButton(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); return; }

        const [action, ...args] = params;
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || {};
        const targetUsername = userActiveFilters?.added_by_username;

        if (action === 'export') {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('list_button_export_179')
                        .setLabel('Export 179 Days')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('list_button_export_180')
                        .setLabel('Export 180 Days')
                        .setStyle(ButtonStyle.Primary)
                );

            await interaction.editReply({
                content: 'Please choose which worlds to export:',
                components: [row],
                ephemeral: true
            });
            return;
        }

        if (action.startsWith('export_')) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
            const parts = action.split('_');
            const daysOwned = parts[parts.length - (parts.includes('no_user') ? 2 : 1)];
            const includeUser = !parts.includes('no_user');

            const exportFilters = { ...userActiveFilters, daysOwned: parseInt(daysOwned) };

            const { worlds: allMatchingWorlds } = await db.getFilteredWorlds(exportFilters, 1, 10000);

            if (!allMatchingWorlds || allMatchingWorlds.length === 0) {
                await interaction.editReply({ content: 'No names to export for the current filters.', ephemeral: true });
                return;
            }

            let exportText = "```\n";
            allMatchingWorlds.forEach(world => {
                const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                if (includeUser) {
                    exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}, ${world.added_by_username}\n`;
                } else {
                    exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}\n`;
                }
            });
            exportText += "```";

            if (exportText.length > 2000) {
                let cutOff = exportText.lastIndexOf('\n', 1990);
                if (cutOff === -1) cutOff = 1990;
                exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`list_button_export_${daysOwned}_no_user`)
                        .setLabel('Export without user')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.editReply({ content: exportText, components: [row], ephemeral: true });
            return;
        }

        if (action === 'page') {
            const direction = args[0];
            let currentPage = parseInt(args[1]);
            if (direction === 'prev') {
                currentPage--;
            } else if (direction === 'next') {
                currentPage++;
            }
            await showWorldsList(interaction, currentPage, userActiveFilters, targetUsername);
            return;
        }

        switch (action) {
            case 'remove':
            case 'info':
                await showSimpleModal(interaction, action);
                break;
            case 'add':
                await showAddWorldModal(interaction);
                break;
            case 'filtershow': {
                await showListFilterModal(interaction);
                break;
            }
            case 'settings': {
                const { getSettingsReplyOptions } = require('../utils/settings.js');
                const replyOptions = await getSettingsReplyOptions(interaction.user.id);
                await interaction.update(replyOptions);
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
        const [action] = params;

        if (action === 'filterapply') {
            await interaction.deferUpdate();
            const filters = utils.parseFilterModal(interaction);
            logger.info(`[list.js] Applying filters: ${JSON.stringify(filters)}`);
            const targetUsername = filters.added_by_username;
            await showWorldsList(interaction, 1, filters, targetUsername);
            return;
        }
        
        const identifier = interaction.fields.getTextInputValue('identifier');
        if (!identifier) {
            logger.error(`[list.js] Modal action '${action}' submitted without an 'identifier' field.`);
            return interaction.reply({ content: 'There was an error processing this form. The required field was missing.', flags: MessageFlags.Ephemeral });
        }

        if (action !== 'remove') await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const world = await db.findWorldByIdentifier(identifier);
        
        switch (action) {
            case 'remove': {
                if (!world) {
                    return interaction.reply({ content: `❌ World "**${identifier}**" not found.`, flags: MessageFlags.Ephemeral });
                }
                const confirmId = `remove_button_confirm_${world.id}`;
                const cancelId = `remove_button_cancel`;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`, components: [row], flags: MessageFlags.Ephemeral });
                break;
            }
            case 'info': {
                if (!world) return interaction.editReply({ content: `❌ World "**${identifier}**" not found.` });
                await showWorldInfo(interaction, world);
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
