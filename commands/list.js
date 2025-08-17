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
 * @param {'remove'|'info'} type
 */
async function showSimpleModal(interaction, type) {
    const modalConfig = {
        remove: { id: 'list_modal_remove', title: 'Remove World', label: 'World Name or Custom ID to Remove', placeholder: 'Case-insensitive world name or ID' },
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

async function fetchAndPrepareWorlds(filters, page) {
    const dbResult = await db.getFilteredWorlds(filters, page, CONSTANTS.PAGE_SIZE);
    const { worlds, total } = dbResult;

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

    return { worlds, total };
}

function buildReply(interaction, worlds, totalWorlds, page, viewMode, timezoneOffset, targetUsername) {
    const totalPages = Math.max(1, Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));

    if (worlds.length === 0) {
        let emptyMsg = `No worlds found.`;
        if (targetUsername) {
            emptyMsg = `No worlds found for user \`${targetUsername}\`.`;
        } else {
            emptyMsg = "The list is empty. Use `/addworld` or the button below to add a world!";
        }

        const emptyRow = new ActionRowBuilder();
        emptyRow.addComponents(
            new ButtonBuilder().setCustomId('list_button_add').setLabel('➕ Add World').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('list_button_filtershow').setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary)
        );

        return { content: emptyMsg, components: [emptyRow], flags: MessageFlags.Ephemeral };
    }

    const { data, config } = utils.formatWorldsToTable(worlds, viewMode, 'public', timezoneOffset, targetUsername);
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

    const isOwnList = targetUsername ? targetUsername.toLowerCase() === interaction.user.username.toLowerCase() : true;
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
    return { content: finalContent, components, flags: MessageFlags.Ephemeral };
}

async function exportWorlds(interaction, filters, sortBy) {
    logger.info(`[list.js] Exporting worlds with filters: ${JSON.stringify(filters)} and sort: ${sortBy}`);

    const { worlds } = await db.getFilteredWorlds(filters, 1, 1000, { sortBy });

    if (!worlds || worlds.length === 0) {
        await interaction.editReply({ content: '❌ No worlds match your export filters.', components: [] });
        return;
    }
    if (worlds.length >= 1000) {
        await interaction.editReply({ content: '⚠️ Your export request matched over 1000 worlds. Please use more specific filters to reduce the result size.', components: [] });
        return;
    }

    let exportText = "```\n";
    worlds.forEach(world => {
        const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
        const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
        const line = `(${lockChar}) ${world.name.toUpperCase()} ${world.days_owned}${customIdPart}\n`;
        exportText += line;
    });
    exportText += "```";

    if (exportText.length <= 2000) {
        await interaction.editReply({ content: exportText, components: [] });
    } else {
        const messages = [];
        let currentMessage = "```\n";
        const lines = exportText.substring(4, exportText.length - 4).split('\n');

        for (const line of lines) {
            if (currentMessage.length + line.length + 4 > 2000) {
                currentMessage += "```";
                messages.push(currentMessage);
                currentMessage = "```\n";
            }
            currentMessage += line + "\n";
        }
        currentMessage += "```";
        messages.push(currentMessage);

        await interaction.editReply({ content: messages[0], components: [] });
        for (let i = 1; i < messages.length; i++) {
            await interaction.followUp({ content: messages[i], ephemeral: true });
        }
    }
}

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

    try {
        const { worlds, total } = await fetchAndPrepareWorlds(effectiveFilters, page);
        const replyOptions = buildReply(interaction, worlds, total, page, viewMode, timezoneOffset, effectiveTargetUsername);
        await interaction.editReply(replyOptions);
    } catch (error) {
        logger.error(`[list.js] Error fetching or building worlds list:`, error?.stack || error);
        const errorContent = { content: '❌ Sorry, I couldn\'t fetch the worlds list.', components: [], flags: MessageFlags.Ephemeral };
        await interaction.editReply(errorContent);
    }
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
        const cooldown = utils.checkCooldown(interaction.user.id, 'list');
        if (cooldown.onCooldown) {
            await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds before using this command again.`, flags: MessageFlags.Ephemeral });
            return;
        }
        logger.info(`[list.js] Entered execute function for /list, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
        const targetUser = interaction.options.getUser('user');
        const username = targetUser ? targetUser.username : null;
        const filters = username ? { added_by_username: username } : {};
        await showWorldsList(interaction, 1, filters, username);
    },

    async handleButton(interaction, params) {
        const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); return; }

        const [action, ...args] = params;
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || {};
        const targetUsername = userActiveFilters?.added_by_username;

        // Export button logic
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
        if (cooldown.onCooldown) { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); return; }

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
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const locktypeInput = (interaction.fields.getTextInputValue('export_locktype') || '').toUpperCase();
            const locktype = locktypeInput === 'M' ? 'mainlock' : (locktypeInput === 'O' ? 'outlock' : undefined);

            const daysOwnedInput = interaction.fields.getTextInputValue('export_daysowned');
            const daysOwned = daysOwnedInput ? parseInt(daysOwnedInput, 10) : undefined;

            const filters = {
                prefix: interaction.fields.getTextInputValue('export_prefix') || undefined,
                locktype: locktype,
                expiryday: interaction.fields.getTextInputValue('export_expiryday') || undefined,
                daysowned: isNaN(daysOwned) ? undefined : daysOwned,
            };
            logger.info(`[list.js] Export filters: ${JSON.stringify(filters)}`);

            await exportWorlds(interaction, filters, 'default');
            return;
        }

        const identifier = interaction.fields.getTextInputValue('identifier');
        if (!identifier) {
            logger.error(`[list.js] Modal action '${action}' submitted without an 'identifier' field.`);
            return interaction.reply({ content: 'There was an error processing this form. The required field was missing.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const world = await db.findWorldByIdentifier(identifier);

        if (!world) {
            return interaction.editReply({ content: `❌ World \`${identifier}\` not found.` });
        }

        switch (action) {
            case 'remove': {
                // For security, only the user who added the world can remove it.
                if (world.added_by_username && world.added_by_username.toLowerCase() !== interaction.user.username.toLowerCase()) {
                    return interaction.editReply({ content: '❌ You can only remove worlds that you have added.' });
                }
                const success = await db.removeWorld(world.id);
                if (success) {
                    await interaction.editReply({ content: `✅ World **${world.name}** has been removed.` });
                } else {
                    await interaction.editReply({ content: `❌ Failed to remove world **${world.name}**.` });
                }
                break;
            }
            case 'info': {
                await showWorldInfo(interaction, world);
                break;
            }
            default:
                logger.warn(`[list.js] Unknown modal action: ${action}`);
                await interaction.editReply({ content: 'Unknown action.' });
                break;
        }
    }
};
