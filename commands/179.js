// commands/179.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const CONSTANTS = require('../utils/constants.js');

async function show179WorldsList(interaction, page = 1) {
    logger.info(`[179.js] show179WorldsList called - Page: ${page}, Guild: ${interaction.guildId || 'DM'}, Component: ${interaction.isMessageComponent()}`);

    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // --- Database Fetching ---
    let dbResult = { worlds: [], total: 0 };
    try {
        // Call the actual database function to get worlds with 1 day left until expiry
        logger.info(`[179.js] Calling db.getWorldsByDaysLeft with userId: ${userId}, daysLeft: 1, guildId: ${guildId}, page: ${page}, pageSize: ${CONSTANTS.PAGE_SIZE}`);
        dbResult = await db.getWorldsByDaysLeft(userId, 1, guildId, page, CONSTANTS.PAGE_SIZE);
        logger.debug(`[179.js] db.getWorldsByDaysLeft returned ${dbResult.worlds.length} worlds and total ${dbResult.total}.`);
        
    } catch (error) {
        logger.error(`[179.js] Error calling db.getWorldsByDaysLeft:`, error?.stack || error);
        const errorContent = '❌ Sorry, I encountered an error fetching the 179-day worlds list from the database.';
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorContent, components: [], embeds: [] });
        } else {
            await interaction.reply({ content: errorContent, components: [], embeds: [], flags: 1 << 6 });
        }
        return;
    }
    
    let worlds = dbResult.worlds || [];
    const totalWorlds = dbResult.total || 0;
    const totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE) : 1;
    page = Math.max(1, Math.min(page, totalPages));

    // Client-side sort for display consistency
    worlds.sort((a, b) => {
        const lengthDiff = a.name.length - b.name.length;
        if (lengthDiff !== 0) return lengthDiff; // Shorter names first
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); // Alphabetical (case-insensitive)
    });

    if (worlds.length === 0) {
        let emptyMsg = guildId ? '🌐 No public worlds found that are 179 days old in this server.' : '🔒 You have no worlds that are 179 days old.';
        if (totalWorlds > 0 && page > 1) emptyMsg = `Gomen 🙏, no 179-day worlds on Page ${page}/${totalPages}.`;
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: emptyMsg, components: [] });
        } else {
            await interaction.reply({ content: emptyMsg, components: [], flags: 1 << 6});
        }
        return;
    }

    let userPrefs = await db.getUserPreferences(interaction.user.id);
    if (!userPrefs) userPrefs = { timezone_offset: 0.0, view_mode: 'pc' };
    const viewMode = userPrefs.view_mode || 'pc';
    const timezoneOffset = userPrefs.timezone_offset || 0.0;

    let headers;
    let data;
    let tableOutput = '';
    let config;

    if (viewMode === 'pc') {
        headers = ['WORLD', 'OWNED', 'LEFT', 'EXPIRES ON', 'LOCK'];
        if (guildId) headers.push('ADDED BY');
        data = [headers];

        worlds.forEach(world => {
            const expiryDateUTC = new Date(world.expiry_date);
            if (isNaN(expiryDateUTC.getTime())) return;
            const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
            const expiryUserLocal = new Date(expiryDateUTC.getTime() + timezoneOffset * 3600000);
            const expiryDatePart = new Date(Date.UTC(expiryUserLocal.getUTCFullYear(), expiryUserLocal.getUTCMonth(), expiryUserLocal.getUTCDate()));
            const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
            const daysLeft = Math.ceil((expiryDatePart.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
            const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(0, 180 - daysLeft);
            const dayOfWeek = expiryUserLocal.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
            const expiryStr = `${expiryUserLocal.toLocaleDateString('en-US', { timeZone: 'UTC' })} (${dayOfWeek})`;
            const lockTypeShort = world.lock_type.substring(0, 4).toUpperCase();
            const row = [world.name.toUpperCase(), displayedDaysOwned.toString(), daysLeft <= 0 ? 'EXP' : daysLeft.toString(), expiryStr, lockTypeShort];
            if (guildId) row.push(world.added_by_tag || 'Unknown');
            data.push(row);
        });
        
        config = {
            columns: [{ alignment: 'left', width: 15, wrapWord: true }, { alignment: 'right', width: 5 }, { alignment: 'right', width: 5 }, { alignment: 'left', width: 18 }, { alignment: 'center', width: 5 }],
            border: getBorderCharacters('norc'),
            header: { alignment: 'center', content: (guildId ? '🌐 PUBLIC 179-DAY WORLDS' : '🔒 YOUR 179-DAY WORLDS') }
        };
        if (guildId) config.columns.push({ alignment: 'left', width: 15, wrapWord: true });

    } else { // phone viewMode
        headers = ['WORLD', 'OWNED'];
        data = [headers];
        worlds.forEach(world => {
            const expiryDateUTC = new Date(world.expiry_date);
            if (isNaN(expiryDateUTC.getTime())) return;
            const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
            const expiryUserLocal = new Date(expiryDateUTC.getTime() + timezoneOffset * 3600000);
            const expiryDatePart = new Date(Date.UTC(expiryUserLocal.getUTCFullYear(), expiryUserLocal.getUTCMonth(), expiryUserLocal.getUTCDate()));
            const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
            const daysLeft = Math.ceil((expiryDatePart.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
            const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(0, 180 - daysLeft);
            const worldDisplay = `(${world.lock_type.charAt(0).toUpperCase()}) ${world.name.toUpperCase()}`;
            data.push([worldDisplay, displayedDaysOwned.toString()]);
        });
        config = {
            columns: [{ alignment: 'left', width: 18, wrapWord: true }, { alignment: 'right', width: 5 }],
            border: getBorderCharacters('norc'),
            header: { alignment: 'center', content: (guildId ? '🌐 179D PUBLIC (Phone)' : '🔒 179D YOURS (Phone)') }
        };
    }

    if (data.length <= 1) {
        const emptyMsg = `Gomen 🙏, no valid 179-day worlds to display for Page ${page}/${totalPages} (View: ${viewMode}).`;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: emptyMsg, components: [] });
        } else {
            await interaction.reply({ content: emptyMsg, components: [], flags: 1 << 6});
        }
        return;
    }
    
    try { 
        tableOutput = `\`\`\`
${table(data, config)}
\`\`\``;
        if (tableOutput.length > 1990) { 
            let cutOff = tableOutput.lastIndexOf('\n', 1950); 
            if (cutOff === -1) cutOff = 1950; 
            tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...```'; 
        }
    }
    catch (tableError) { logger.error('[179.js] Table generation failed:', tableError); tableOutput = 'Error generating table.'; }

    const components = [];
    const navRowComponents = [
        new ButtonBuilder().setCustomId(`179_button_prev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId(`179_button_page_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`179_button_next_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
    ];
    if (navRowComponents.length > 0) components.push(new ActionRowBuilder().addComponents(navRowComponents));

    // NEW: Add Names export button
    const exportRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('179_button_names_export') // Custom ID for the new button
                .setLabel('📄 Names Export')
                .setStyle(ButtonStyle.Secondary)
        );
    components.push(exportRow);


    const finalContent = `${tableOutput}
📊 Total 179-day worlds: ${totalWorlds}`;
    const finalOpts = { content: finalContent, components: components, embeds: [] };

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(finalOpts);
    } else {
        logger.warn('[179.js] show179WorldsList attempting to reply without prior deferral.');
        await interaction.reply({ ...finalOpts, flags: 1 << 6 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('179')
        .setDescription('Lists worlds 179 days old, sorted by name length then alphabetically.'),
    async execute(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                 await interaction.deferReply({ flags: 1 << 6 });
            }
        } catch (deferError) {
            logger.error("[179.js] Failed to defer reply in /179 execute:", deferError);
            try { await interaction.followUp({ content: "Error preparing your list. Please try again.", flags: 1 << 6 }); } catch {}
            return;
        }
        await show179WorldsList(interaction, 1);
    },

    async handleButton(interaction, params) {
        // Parse the full customId to reliably determine the action
        const customIdParts = interaction.customId.split('_');
        const commandPrefix = customIdParts[0]; // '179'
        const buttonCategory = customIdParts[1]; // 'button'
        const mainAction = customIdParts[2]; // 'prev', 'next', 'names'
        const subAction = customIdParts[3]; // page number or 'export'

        let effectiveAction;
        if (mainAction === 'names' && subAction === 'export') {
            effectiveAction = 'names_export';
        } else {
            // For 'prev', 'next', 'page' buttons
            effectiveAction = mainAction;
        }

        const currentPage = parseInt(subAction) || 1; // Used for pagination buttons

        logger.info(`[179.js] Button Clicked: effectiveAction=${effectiveAction}, page=${currentPage}, customId=${interaction.customId}`);

        try {
            // Acknowledge the interaction based on the action
            // Pagination buttons (prev, next, page) will edit the original message, so deferUpdate.
            // Names export button will send a new ephemeral message, so deferReply.
            if (effectiveAction !== 'names_export' && !interaction.deferred && !interaction.replied) {
                 await interaction.deferUpdate();
            } else if (effectiveAction === 'names_export' && !interaction.deferred && !interaction.replied) {
                 await interaction.deferReply({ ephemeral: true });
            }
        } catch (deferError) {
            logger.error(`[179.js] Failed to acknowledge interaction for action ${effectiveAction}:`, deferError);
            try {
                // Try to send a follow-up if deferral failed
                await interaction.followUp({ content: "Error processing action. Please try again.", flags: 1 << 6 });
            } catch (followUpError) {
                logger.error(`[179.js] Failed to send followUp after deferral error:`, followUpError);
            }
            return; 
        }
        
        switch(effectiveAction) {
            case 'prev':
                await show179WorldsList(interaction, Math.max(1, currentPage - 1));
                break;
            case 'next':
                await show179WorldsList(interaction, currentPage + 1);
                break;
            case 'page':
                logger.debug('[179.js] Page button clicked, interaction already acknowledged.');
                // No further action needed as deferUpdate already happened
                break;
            case 'names_export':
                logger.info(`[179.js] Names Export button clicked by ${interaction.user.tag}`);
                
                const userId = interaction.user.id;
                const guildId = interaction.guildId; // Can be null in DMs

                let allWorlds;
                try {
                    // Fetch ALL 179-day worlds for the user/guild using the new function
                    allWorlds = await db.getAllWorldsByDaysLeft(userId, 1, guildId);
                    logger.debug(`[179.js] Fetched ${allWorlds.length} worlds for names export.`);
                } catch (error) {
                    logger.error(`[179.js] Error fetching all 179-day worlds for export:`, error?.stack || error);
                    await interaction.editReply({ content: '❌ Sorry, I could not fetch the world names for export.', ephemeral: true });
                    return;
                }

                if (allWorlds.length === 0) {
                    const noWorldsMessage = guildId ? '🌐 No public 179-day worlds found in this server to export names.' : '🔒 You have no 179-day worlds to export names.';
                    await interaction.editReply({ content: noWorldsMessage, ephemeral: true });
                    return;
                }

                // Apply the sorting logic (name length then alphabetical)
                allWorlds.sort((a, b) => {
                    const lengthDiff = a.name.length - b.name.length;
                    if (lengthDiff !== 0) return lengthDiff; // Shorter names first
                    return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); // Alphabetical (case-insensitive)
                });

                let exportText = "```\n";
                allWorlds.forEach(world => {
                    const lockChar = world.lock_type.charAt(0).toUpperCase();
                    const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                    exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}\n`;
                });
                exportText += "```";

                // Check Discord's character limit for messages (2000 characters)
                if (exportText.length > 2000) {
                    const truncationMessage = `\n... (Output truncated due to Discord's character limit. Total worlds: ${allWorlds.length})`;
                    exportText = exportText.substring(0, 2000 - (truncationMessage.length + 3)) + truncationMessage + "```";
                }

                // Edit the deferred reply (which was deferred as ephemeral)
                await interaction.editReply({ content: exportText, ephemeral: true });
                break;
            default:
                logger.warn(`[179.js] Unknown 179 button action: ${effectiveAction}`);
                // If deferUpdate was successful, just editReply
                await interaction.editReply({ content: 'Unknown button action.', components: [] });
        }
    },
    show179WorldsList // Export the function
};
