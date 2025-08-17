// list.js

// Imports
const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, MessageFlags
} = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const logger = require('../utils/logger.js');
const { table } = require('table');
const { showWorldInfo } = require('./info.js');
const { showAddWorldModal } = require('../commands/addworld.js');
const CONSTANTS = require('../utils/constants.js');
const { DateTime } = require('luxon');

// --- Helper Functions for Modals ---

/**
 * Shows a simple modal with a single text input field.
 * @param {import('discord.js').Interaction} interaction
 * @param {'remove'|'share'|'unshare'|'info'} type
 */
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
        .setCustomId('identifier')
        .setLabel(config.label)
        .setPlaceholder(config.placeholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await interaction.showModal(modal);
}

/**
 * Shows a modal for filtering the world list.
 * @param {import('discord.js').Interaction} interaction
 */
async function showListFilterModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('list_modal_filterapply')
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

/**
 * Shows a modal for exporting worlds.
 * @param {import('discord.js').Interaction} interaction
 */
async function showExportModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('list_modal_export')
        .setTitle('Export Worlds');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('export_prefix')
                .setLabel('Prefix (Optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('export_locktype')
                .setLabel('Lock Type (Optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('export_expiryday')
                .setLabel('Expiry Day (Optional)')
                .setPlaceholder('e.g., Monday')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('export_daysowned')
                .setLabel('Days Owned (Optional)')
                .setPlaceholder('0-180')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
        )
    );

    await interaction.showModal(modal);
}

// --- Core List Display Function ---

/**
 * Displays a paginated list of worlds.
 * @param {import('discord.js').Interaction} interaction
 * @param {number} page
 * @param {object} [currentFilters=null]
 * @param {string} [targetUsername=null]
 */
async function showWorldsList(interaction, page = 1, currentFilters = null, targetUsername = null) {
    const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch (e) { logger.error(`[list.js] Defer update failed: ${e.message}`); return; }
    } else if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.user.id;
    const userPreferences = await db.getUserPreferences(userId);
    const viewMode = userPreferences.view_mode || 'pc';
    const timezoneOffset = userPreferences.timezone_offset || 0.0;

    interaction.client.activeListFilters = interaction.client.activeListFilters || {};
    if (currentFilters) {
        interaction.client.activeListFilters[userId] = currentFilters;
    } else {
        delete interaction.client.activeListFilters[userId];
    }
    const effectiveFilters = currentFilters || interaction.client.activeListFilters[userId] || {};
    const effectiveTargetUsername = targetUsername || effectiveFilters.added_by_username;

    logger.info(`[list.js] showWorldsList called - Page: ${page}, Filters: ${JSON.stringify(effectiveFilters)}, Target: ${effectiveTargetUsername}`);

    let dbResult = { worlds: [], total: 0 };
    try {
        dbResult = await db.getFilteredWorlds(effectiveFilters, page, CONSTANTS.PAGE_SIZE);
    } catch (error) {
        logger.error(`[list.js] Error fetching worlds:`, error?.stack || error);
        const errorContent = { content: '❌ Sorry, I couldn\'t fetch the worlds list.', components: [], flags: MessageFlags.Ephemeral };
        if (isUpdate) {
            await interaction.editReply(errorContent);
        } else {
            await interaction.reply(errorContent);
        }
        return;
    }

    const worlds = dbResult.worlds || [];
    const totalWorlds = dbResult.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));

    const nowUtc = DateTime.utc().startOf('day');
    worlds.forEach(world => {
        const expiryDateUtc = DateTime.fromISO(world.expiry_date, { zone: 'utc' }).startOf('day');
        const diff = expiryDateUtc.diff(nowUtc, 'days').toObject();
        world.daysLeft = Math.floor(diff.days);
        world.daysOwned = 180 - world.daysLeft;

        if (world.daysLeft <= 0) {
            world.daysLeft = 'EXP';
            world.daysOwned = 180;
        } else if (world.daysLeft > 180) {
            world.daysLeft = 180;
            world.daysOwned = 0;
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
        if (effectiveFilters && Object.keys(effectiveFilters).length > 0) {
            emptyMsg = `No worlds match your filters. Try adjusting them.`;
        } else {
            emptyMsg = "The list is empty. Use `/addworld` or the button below to add a world!";
        }

        const emptyRow = new ActionRowBuilder();
        emptyRow.addComponents(
            new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add World').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('list_button_filtershow').setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary)
        );

        const opts = { content: emptyMsg, components: [emptyRow], flags: MessageFlags.Ephemeral };
        await interaction.editReply(opts);
        return;
    }

    const { data, config } = utils.formatWorldsToTable(worlds, viewMode, 'public', timezoneOffset, effectiveTargetUsername);
    let tableOutput = '```\n' + table(data, config) + '\n```';
    const footer = `\n📊 Total worlds: ${totalWorlds} | Page ${safePage} of ${totalPages}`;

    if ((tableOutput + footer).length > 2000) {
        const availableLength = 2000 - footer.length - 30;
        let cutOff = tableOutput.lastIndexOf('\n', availableLength);
        if (cutOff === -1) cutOff = availableLength;
        tableOutput = tableOutput.substring(0, cutOff) + "\n... (list truncated)```";
    }

    const components = [];
    components.push(utils.createPaginationRow(`list_button_page`, safePage, totalPages));

    const isOwnList = effectiveTargetUsername ? effectiveTargetUsername.toLowerCase() === interaction.user.username.toLowerCase() : true;
    const actionRow1 = new ActionRowBuilder();
    actionRow1.addComponents(
        new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add').setStyle(ButtonStyle.Success).setDisabled(!isOwnList),
        new ButtonBuilder().setCustomId('list_button_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger).setDisabled(!isOwnList),
        new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('list_button_export').setLabel('📄 Export').setStyle(ButtonStyle.Secondary)
    );
    components.push(actionRow1);

    const actionRow2 = new ActionRowBuilder();
    actionRow2.addComponents(
        new ButtonBuilder().setCustomId('list_button_filtershow').setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('settings_button_show').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary)
    );
    components.push(actionRow2);

    if (viewMode === 'pc' && worlds.length > 0) {
        const selectOptions = worlds.slice(0, 25).map(world => utils.createWorldSelectOption(world, timezoneOffset));
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions)));
    }

    const finalContent = tableOutput + footer;
    const finalOpts = { content: finalContent, components, ephemeral: true };
    await interaction.editReply(finalOpts);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('View the tracked Growtopia worlds.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Filter the list by a specific user.')
                .setRequired(false)),

    async execute(interaction) {
        logger.info(`[list.js] Entered execute function for /list, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
        const targetUser = interaction.options.getUser('user');
        const username = targetUser ? targetUser.username : null;
        const filters = username ? { added_by_username: username } : {};
        await showWorldsList(interaction, 1, filters, username);
    },

    async handleButton(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); return; }

        const [action, ...args] = params;
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || {};
        const targetUsername = userActiveFilters?.added_by_username;

        // Export button logic → open modal
        if (action === 'export') {
            await showExportModal(interaction);
            return;
        }

        // Page navigation logic
        if (action === 'page') {
            const direction = args[0];
            let currentPage = parseInt(args[1], 10);
            if (direction === 'prev') currentPage--;
            else if (direction === 'next') currentPage++;
            await showWorldsList(interaction, currentPage, userActiveFilters, targetUsername);
            return;
        }

        // All other button actions
        switch (action) {
            case 'remove':
            case 'info':
                await showSimpleModal(interaction, action);
                break;
            case 'add':
                await showAddWorldModal(interaction);
                break;
            case 'filtershow':
                await showListFilterModal(interaction);
                break;
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
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); return; }

        const [action] = params;
        if (action === 'info') {
            await interaction.deferUpdate();
            if (!interaction.values || interaction.values.length === 0) return;
            const worldId = parseInt(interaction.values[0], 10);
            const world = await db.getWorldById(worldId);
            if (!world) {
                return interaction.editReply({ content: '❌ World not found.' });
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

        if (action === 'export') {
            await interaction.deferReply({ ephemeral: true });

            const filters = {
                prefix: interaction.fields.getTextInputValue('export_prefix') || undefined,
                locktype: interaction.fields.getTextInputValue('export_locktype') || undefined,
                expiryday: interaction.fields.getTextInputValue('export_expiryday') || undefined,
                daysowned: interaction.fields.getTextInputValue('export_daysowned') || undefined
            };

            const { worlds } = await db.getFilteredWorlds(filters, 1, 10000);

            if (!worlds || worlds.length === 0) {
                await interaction.editReply({ content: '❌ No worlds match your export filters.' });
                return;
            }

            let exportText = "```\n";
            worlds.forEach(world => {
                const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}\n`;
            });
            exportText += "```";

            if (exportText.length > 2000) {
                let cutOff = exportText.lastIndexOf('\n', 1990);
                if (cutOff === -1) cutOff = 1990;
                exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
            }

            await interaction.editReply({ content: exportText });
            return;
        }

        const identifier = interaction.fields.getTextInputValue('identifier');
        if (!identifier) {
            logger.error(`[list.js] Modal action '${action}' submitted without an 'identifier' field.`);
            return interaction.reply({ content: 'There was an error processing this form. The required field was missing.', flags: MessageFlags.Ephemeral });
        }

        if (action !== 'remove') await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const world = await db.findWorldByIdentifier(identifier);
    }
};
