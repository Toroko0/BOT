const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const logger = require('../utils/logger.js');
const db = require('../database.js');
const { table, getBorderCharacters } = require('table');
const { DateTime } = require('luxon');
let CONSTANTS;
try {
    CONSTANTS = require('../utils/constants.js');
} catch (err) {
    logger.warn('[Admin] utils/constants.js not found, using default PAGE_SIZE=5.');
    CONSTANTS = { PAGE_SIZE: 5 };
}

// Helper function to re-display user stats
async function showUserStatsView(interaction, targetUserId, targetUser) {
    logger.info(`[Admin User Stats] Re-fetching stats for user ${targetUser.tag} (ID: ${targetUserId}) by admin ${interaction.user.tag}`);
    try {
        const userPrefs = await db.getUserPreferences(targetUserId);
        const worldCount = await db.getWorldCount(targetUserId);
        const lockStats = await db.getWorldLockStats(targetUserId);
        const { timezone_offset = 0.0, view_mode = 'pc', reminder_enabled = false, reminder_time_utc = null } = userPrefs || {};

        const embed = new EmbedBuilder()
            .setTitle(`Admin Stats for ${targetUser.username} (ID: ${targetUserId})`)
            .setColor(0x0099FF)
            .addFields(
                { name: 'Total Worlds', value: String(worldCount), inline: true },
                { name: 'Mainlocks', value: String(lockStats.mainlock), inline: true },
                { name: 'Outlocks', value: String(lockStats.outlock), inline: true },
                { name: 'Timezone Offset', value: `GMT${timezone_offset >= 0 ? '+' : ''}${timezone_offset.toFixed(1)}`, inline: true },
                { name: 'View Mode', value: view_mode, inline: true },
                { name: 'Reminders', value: reminder_enabled ? `Enabled (${reminder_time_utc || 'Time Not Set'} UTC)` : 'Disabled', inline: true }
            )
            .setTimestamp();
        const viewListButton = new ButtonBuilder().setCustomId(`admin_button_viewuserworlds_${targetUserId}`).setLabel("View User's World List").setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(viewListButton);
        await interaction.editReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    } catch (dbError) {
        logger.error(`[Admin User Stats] Error fetching data for user ${targetUserId}:`, dbError);
        await interaction.editReply({ content: 'An error occurred while fetching user data from the database.', components: [], flags: MessageFlags.Ephemeral });
    }
}

// Function to display the admin's own world list
async function showAdminOwnListView(interaction, page) {
    logger.info(`[Admin Own List] Admin ${interaction.user.tag} viewing their own worlds, page ${page}`);
    try {
        const adminId = interaction.user.id;
        const adminPrefs = await db.getUserPreferences(adminId);
        const viewMode = adminPrefs.view_mode || 'pc';
        const timezoneOffset = adminPrefs.timezone_offset || 0.0;
        const pageSize = CONSTANTS.PAGE_SIZE;

        const dbResult = await db.getWorlds(adminId, page, pageSize);
        let worlds = dbResult.worlds || [];
        const totalWorlds = dbResult.total || 0;
        let totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / pageSize) : 1;
        page = Math.max(1, Math.min(page, totalPages));

        if (totalWorlds === 0) {
            await interaction.editReply({ content: 'You have no worlds in your list.', components: [], flags: MessageFlags.Ephemeral });
            return;
        }
        if (worlds.length === 0 && page > 1 && totalWorlds > 0) {
            page = totalPages;
            const newDbResult = await db.getWorlds(adminId, page, pageSize);
            worlds = newDbResult.worlds || [];
        }
        if (worlds.length === 0 && totalWorlds > 0) {
            await interaction.editReply({ content: 'No worlds on this page.', components: [], flags: MessageFlags.Ephemeral });
            return;
        }

        const headers = viewMode === 'pc' ? ['World Name', 'Custom ID', 'Days Left', 'Expires On', 'Lock Type'] : ['World', 'ID', 'Left', 'Expires', 'Lock'];
        const tableData = [headers];
        const now = DateTime.utc();
        for (const world of worlds) {
            const expiryDate = DateTime.fromISO(world.expiry_date, { zone: 'utc' });
            const adminLocalExpiry = expiryDate.plus({ hours: timezoneOffset });
            const daysLeft = Math.ceil(expiryDate.diff(now, 'days').days);
            if (viewMode === 'pc') {
                tableData.push([world.name, world.custom_id || '-', `${daysLeft}d`, adminLocalExpiry.toFormat('dd MMM yyyy'), world.lock_type]);
            } else {
                tableData.push([world.name, world.custom_id || '-', `${daysLeft}d`, adminLocalExpiry.toFormat('ddMMMyy'), world.lock_type.substring(0,1).toUpperCase()]);
            }
        }
        const tableConfig = { border: getBorderCharacters('ramac'), header: { alignment: 'center', content: `Your Worlds (Admin Access - Page ${page}/${totalPages})` }, columns: viewMode === 'pc' ? { 0: { width: 15 }, 1: { width: 10 }, 2: { width: 8, alignment: 'right' }, 3: { width: 12 }, 4: { width: 9 } } : { 0: { width: 12 }, 1: { width: 8 }, 2: { width: 5, alignment: 'right' }, 3: { width: 9 }, 4: { width: 4 } } };
        let tableOutput = table(tableData, tableConfig);
        if (tableOutput.length > 1900) {
            let cutOff = tableOutput.lastIndexOf('\n', 1870);
            if (cutOff === -1) cutOff = 1870;
            tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...';
            logger.warn(`[Admin Own List] Table output for page ${page} was truncated.`);
        }
        const components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`admin_button_adminownlistprev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1), new ButtonBuilder().setCustomId(`admin_adminownlistpage_${page}_${totalPages}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId(`admin_button_adminownlistnext_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages))];
        await interaction.editReply({ content: `Displaying your worlds (Page ${page}/${totalPages}):\n\`\`\`\n${tableOutput}\n\`\`\`\n📊 Total worlds: ${totalWorlds}`, components, flags: MessageFlags.Ephemeral });
    } catch (error) {
        logger.error(`[Admin Own List] Error displaying admin's own worlds list (page ${page}):`, error);
        await interaction.editReply({ content: "An error occurred while displaying your world list.", components: [], flags: MessageFlags.Ephemeral });
    }
}

async function showLeaderboardView(interaction, page) {
    logger.info(`[Admin Leaderboard] Admin ${interaction.user.tag} viewing leaderboard, page ${page}`);
    try {
        const leaderboardPageSize = 5;
        const dbResult = await db.getWorldsLeaderboard({ page: page, pageSize: leaderboardPageSize });
        const entries = dbResult.leaderboardEntries || [];
        const totalEntries = dbResult.total || 0;
        const totalPages = totalEntries > 0 ? Math.ceil(totalEntries / leaderboardPageSize) : 1;
        page = Math.max(1, Math.min(page, totalPages));
        if (totalEntries === 0) {
            await interaction.editReply({ content: 'No users with worlds found for the leaderboard.', components: [], flags: MessageFlags.Ephemeral });
            return;
        }
        const embed = new EmbedBuilder().setTitle('🏆 Worlds Leaderboard').setColor(0xFFD700).setFooter({ text: `Page ${page}/${totalPages} - Admin View` });
        if (entries.length === 0 && totalEntries > 0) { embed.setDescription('No entries on this page.'); }
        else { let description = ''; entries.forEach((entry, index) => { const rank = (page - 1) * leaderboardPageSize + index + 1; description += `${rank}. ${entry.username} (ID: ${entry.user_id})\n   Worlds: ${entry.world_count}\n`; }); embed.setDescription(description.trim() || 'No users found.');}
        const components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`admin_button_leaderboardprev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1), new ButtonBuilder().setCustomId(`admin_leaderboardpage_${page}_${totalPages}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId(`admin_button_leaderboardnext_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('admin_button_backtoallworlds_1').setLabel('⬅️ Back to All Worlds').setStyle(ButtonStyle.Secondary))];
        await interaction.editReply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    } catch (error) {
        logger.error(`[Admin Leaderboard] Error displaying leaderboard (page ${page}):`, error);
        await interaction.editReply({ content: 'An error occurred while displaying the leaderboard.', components: [], flags: MessageFlags.Ephemeral });
    }
}

async function showAllWorldsAdminView(interaction, page) {
    logger.info(`[Admin All Worlds List] Admin ${interaction.user.tag} viewing all worlds, page ${page}`);
    try {
        const adminListPageSize = CONSTANTS.PAGE_SIZE_ADMIN_LIST || 5; // Use constant or default
        const adminPrefs = await db.getUserPreferences(interaction.user.id);
        const viewMode = adminPrefs.view_mode || 'pc';
        const timezoneOffset = adminPrefs.timezone_offset || 0.0;

        const dbResult = await db.getAllWorldsPaged({ page: page, pageSize: adminListPageSize });
        const worlds = dbResult.worlds || [];
        const totalWorlds = dbResult.total || 0;
        const totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / adminListPageSize) : 1;
        page = Math.max(1, Math.min(page, totalPages));

        if (totalWorlds === 0) {
            await interaction.editReply({ content: 'No worlds found in the database.', components: [], flags: MessageFlags.Ephemeral });
            return;
        }
        if (worlds.length === 0 && totalWorlds > 0 && page > 1) { // If current page is empty but worlds exist, go to last page
            page = totalPages;
            const newDbResult = await db.getAllWorldsPaged({ page: page, pageSize: adminListPageSize });
            worlds = newDbResult.worlds || [];
        }
         if (worlds.length === 0 && totalWorlds > 0) { // Still no worlds (e.g. page 1 is empty but total > 0 somehow)
            await interaction.editReply({ content: 'No worlds on this page.', components: [], flags: MessageFlags.Ephemeral });
            return;
         }


        const tableData = [];
        const now = DateTime.utc(); // Use Luxon for current UTC time

        if (viewMode === 'pc') {
            tableData.push(['WORLD', 'OWNER', 'OWNED', 'LEFT', 'EXPIRES ON', 'LOCK']);
            for (const world of worlds) {
                const expiryDate = DateTime.fromISO(world.expiry_date, { zone: 'utc' });
                const days_left = Math.ceil(expiryDate.diff(now, 'days').days);
                const days_owned = days_left > 0 ? Math.max(0, 180 - days_left) : 180;
                const userLocalExpiry = expiryDate.plus({ hours: timezoneOffset });
                const displayExpiryDate = `${userLocalExpiry.month}/${userLocalExpiry.day}/${userLocalExpiry.year} (${userLocalExpiry.toFormat('ccc')})`;

                let lockTypeDisplay = (world.lock_type || 'MAIN').toUpperCase();
                if (lockTypeDisplay === 'MAINLOCK') lockTypeDisplay = 'MAIN';
                if (lockTypeDisplay === 'OUTLOCK') lockTypeDisplay = 'OUT';

                tableData.push([
                    world.name, // Already uppercase from DB or should be
                    world.owner_username.substring(0, 15),
                    days_owned.toString(),
                    days_left > 0 ? days_left.toString() : 'EXP',
                    displayExpiryDate,
                    lockTypeDisplay
                ]);
            }
        } else { // Mobile Mode
            tableData.push(['WORLD (OWNER)', 'OWNED', 'LEFT']);
            for (const world of worlds) {
                const expiryDate = DateTime.fromISO(world.expiry_date, { zone: 'utc' });
                const days_left = Math.ceil(expiryDate.diff(now, 'days').days);
                const days_owned = days_left > 0 ? Math.max(0, 180 - days_left) : 180;

                let lockTypeChar = (world.lock_type || 'M').charAt(0).toUpperCase();
                if (world.lock_type && world.lock_type.toLowerCase() === 'mainlock') lockTypeChar = 'M';
                if (world.lock_type && world.lock_type.toLowerCase() === 'outlock') lockTypeChar = 'O';

                tableData.push([
                    `(${lockTypeChar}) ${world.name} (${world.owner_username.substring(0,5)})`,
                    days_owned.toString(),
                    days_left > 0 ? days_left.toString() : 'EXP'
                ]);
            }
        }

        const tableConfig = {
            border: getBorderCharacters('norc'), // Ensure this is norc
            header: {
                alignment: 'center',
                content: `All Worlds (Admin View - Page ${page}/${totalPages})`
            },
            columns: viewMode === 'pc' ?
              { 0: { width: 15 }, 1: { width: 15 }, 2: { width: 6, alignment: 'right' }, 3: { width: 5, alignment: 'right' }, 4: { width: 16 }, 5: {width: 6} } :
              { 0: { width: 25 }, 1: { width: 6, alignment: 'right' }, 2: { width: 5, alignment: 'right' } }
        };

        let tableOutput = table(tableData, tableConfig);
        if (tableOutput.length > 1900) {
            let cutOff = tableOutput.lastIndexOf('\n', 1870);
            if (cutOff === -1) cutOff = 1870; // Fallback if no newline found
            tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...';
            logger.warn(`[Admin All Worlds List] Table output for page ${page} was truncated.`);
        }

        const components = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`admin_button_allworldsprev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
                new ButtonBuilder().setCustomId(`admin_page_display_all_${page}_${totalPages}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`admin_button_allworldsnext_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages)
            )
        ];
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admin_button_dbstats').setLabel('📊 DB Stats').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admin_button_leaderboard_1').setLabel('🏆 Leaderboard').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admin_button_filteruserinput').setLabel('🔍 View User Worlds').setStyle(ButtonStyle.Primary)
        );
        components.push(actionRow);

        await interaction.editReply({ content: `Displaying all worlds (Page ${page}/${totalPages}):\n\`\`\`\n${tableOutput}\n\`\`\`\n📊 Total worlds in database: ${totalWorlds}`, components, flags: MessageFlags.Ephemeral });
    } catch (error) {
        logger.error(`[Admin All Worlds List] Error displaying all worlds list (page ${page}):`, error);
        await interaction.editReply({ content: 'An error occurred while fetching or displaying the all worlds list.', components: [], flags: MessageFlags.Ephemeral });
    }
}

async function showUserWorldsListAdminView(interaction, targetUserId, page) {
    logger.info(`[Admin World List] Admin ${interaction.user.tag} viewing worlds for user ID ${targetUserId}, page ${page}`);
    try {
        const adminPrefs = await db.getUserPreferences(interaction.user.id);
        const viewMode = adminPrefs.view_mode || 'pc';
        const timezoneOffset = adminPrefs.timezone_offset || 0.0;
        const dbResult = await db.getWorlds(targetUserId, page, CONSTANTS.PAGE_SIZE);
        let worlds = dbResult.worlds || [];
        const totalWorlds = dbResult.total || 0;
        let totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE) : 1;
        page = Math.max(1, Math.min(page, totalPages));

        const components = [];
        const backToUserStatsButton = new ButtonBuilder().setCustomId(`admin_button_backtouserstats_${targetUserId}`).setLabel('⬅️ Back to User Stats').setStyle(ButtonStyle.Secondary);

        if (worlds.length === 0 && page > 1 && totalWorlds > 0) {
             page = totalPages; // Reset to last valid page
             const newDbResult = await db.getWorlds(targetUserId, page, CONSTANTS.PAGE_SIZE);
             worlds = newDbResult.worlds || [];
        }

        if (totalWorlds === 0 || worlds.length === 0) {
            const row = new ActionRowBuilder().addComponents(backToUserStatsButton);
            await interaction.editReply({ content: `User ID: ${targetUserId}\nThis user has no worlds.`, components: [row], flags: MessageFlags.Ephemeral });
            return;
        }

        const headers = viewMode === 'pc' ? ['World Name', 'Custom ID', 'Days Left', 'Expires On', 'Lock Type'] : ['World', 'ID', 'Left', 'Expires', 'Lock'];
        const tableData = [headers];
        const now = DateTime.utc();
        for (const world of worlds) {
            const expiryDate = DateTime.fromISO(world.expiry_date, { zone: 'utc' });
            const userLocalExpiry = expiryDate.plus({ hours: timezoneOffset });
            const daysLeft = Math.ceil(expiryDate.diff(now, 'days').days);
            if (viewMode === 'pc') {
                tableData.push([world.name, world.custom_id || '-', `${daysLeft}d`, userLocalExpiry.toFormat('dd MMM yyyy'), world.lock_type]);
            } else {
                tableData.push([world.name, world.custom_id || '-', `${daysLeft}d`, userLocalExpiry.toFormat('ddMMMyy'), world.lock_type.substring(0,1).toUpperCase()]);
            }
        }
        const tableConfig = { border: getBorderCharacters('ramac'), header: { alignment: 'center', content: `Worlds for User ID: ${targetUserId} (Admin View - Page ${page}/${totalPages})` }, columns: viewMode === 'pc' ? { 0: { width: 15 }, 1: { width: 10 }, 2: { width: 8, alignment: 'right' }, 3: { width: 12 }, 4: { width: 9 } } : { 0: { width: 12 }, 1: { width: 8 }, 2: { width: 5, alignment: 'right' }, 3: { width: 9 }, 4: { width: 4 } } };
        const tableOutput = table(tableData, tableConfig);
        const paginationRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`admin_button_userlistprev_${targetUserId}_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1), new ButtonBuilder().setCustomId(`admin_page_display_${page}_${totalPages}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true), new ButtonBuilder().setCustomId(`admin_button_userlistnext_${targetUserId}_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages));
        components.push(paginationRow);

        const backToAdminListButton = new ButtonBuilder().setCustomId('admin_button_showadminownlist_1').setLabel(' लौटें मेरी सूची में (Back to My List)').setStyle(ButtonStyle.Success);
        const bottomActionRow = new ActionRowBuilder().addComponents(backToUserStatsButton, backToAdminListButton);
        components.push(bottomActionRow);

        await interaction.editReply({ content: `\`\`\`\n${tableOutput}\n\`\`\`\n📊 Total worlds for user: ${totalWorlds}`, components, flags: MessageFlags.Ephemeral });
    } catch (error) {
        logger.error(`[Admin World List] Error displaying world list for user ${targetUserId}:`, error);
        await interaction.editReply({ content: 'An error occurred while fetching or displaying the world list.', components: [], flags: MessageFlags.Ephemeral });
    }
}

// New exported function
async function displayAdminAllWorldsView(interaction, page = 1) {
    logger.info(`[Admin] Owner (from list command) requested to display all worlds view, page ${page}. Interaction ID: ${interaction.id}`);
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }
        await showAllWorldsAdminView(interaction, page);
    } catch (error) {
        logger.error(`[Admin] Error in displayAdminAllWorldsView (called from list command) for interaction ${interaction.id}:`, error);
        const errorReply = { content: 'Sorry, an error occurred while trying to display the all worlds list.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(errorReply).catch(e => logger.error("[Admin] Failed to editReply in displayAdminAllWorldsView error handler",e));
        } else {
            await interaction.reply(errorReply).catch(e => logger.error("[Admin] Failed to reply in displayAdminAllWorldsView error handler",e));
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands for bot management.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription("Get information about a specific user's bot data.")
                .addUserOption(option =>
                    option.setName('targetuser')
                        .setDescription('The user to inspect.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all worlds from all users.')),
    displayAdminAllWorldsView, // Exported function

    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;
        const subcommand = interaction.options.getSubcommand();
        logger.info(`[Admin] Received /admin command, subcommand: ${subcommand} from user ${interaction.user.id}`);
        const botOwnerId = process.env.BOT_OWNER_ID;
        if (!botOwnerId || interaction.user.id !== botOwnerId) {
             logger.warn(`[Admin] Unauthorized attempt to use /admin by user ${interaction.user.id}`);
             await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
             return;
        }
        logger.info(`[Admin] User ${interaction.user.id} is authorized bot owner.`);
        if (subcommand === 'user') {
            const targetUser = interaction.options.getUser('targetuser');
            const targetUserId = targetUser.id;
            logger.info(`[Admin User] Fetching stats for user ${targetUser.tag} (ID: ${targetUserId}) by admin ${interaction.user.tag}`);
            try {
                if (!interaction.deferred && !interaction.replied) { // Should be initially replied by slash command
                    await interaction.deferReply({ephemeral: true});
                }
                const userPrefs = await db.getUserPreferences(targetUserId);
                const worldCount = await db.getWorldCount(targetUserId);
                const lockStats = await db.getWorldLockStats(targetUserId);
                const { timezone_offset = 0.0, view_mode = 'pc', reminder_enabled = false, reminder_time_utc = null } = userPrefs || {};
                const embed = new EmbedBuilder().setTitle(`Admin Stats for ${targetUser.username} (ID: ${targetUserId})`).setColor(0x0099FF)
                    .addFields(
                        { name: 'Total Worlds', value: String(worldCount), inline: true }, { name: 'Mainlocks', value: String(lockStats.mainlock), inline: true }, { name: 'Outlocks', value: String(lockStats.outlock), inline: true },
                        { name: 'Timezone Offset', value: `GMT${timezone_offset >= 0 ? '+' : ''}${timezone_offset.toFixed(1)}`, inline: true }, { name: 'View Mode', value: view_mode, inline: true }, { name: 'Reminders', value: reminder_enabled ? `Enabled (${reminder_time_utc || 'Time Not Set'} UTC)` : 'Disabled', inline: true }
                    ).setTimestamp();
                const viewListButton = new ButtonBuilder().setCustomId(`admin_button_viewuserworlds_${targetUserId}`).setLabel("View User's World List").setStyle(ButtonStyle.Primary);
                const row = new ActionRowBuilder().addComponents(viewListButton);
        await interaction.editReply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
            } catch (dbError) {
                logger.error(`[Admin User] Error fetching data for user ${targetUser.id}:`, dbError);
                const errReply = { content: 'An error occurred while fetching user data.', ephemeral: true };
                if(interaction.deferred || interaction.replied) await interaction.editReply(errReply).catch(e => {}); else await interaction.reply(errReply).catch(e => {});
            }
        } else if (subcommand === 'list') {
            if (!interaction.deferred && !interaction.replied) {
                 await interaction.deferReply({ ephemeral: true });
            }
            await showAllWorldsAdminView(interaction, 1);
        } else {
            await interaction.reply({ content: 'Unknown admin subcommand.', ephemeral: true });
        }
    },

    async handleButton(interaction) {
        if (!interaction.isButton()) return;
        const botOwnerId = process.env.BOT_OWNER_ID;
        if (!botOwnerId || interaction.user.id !== botOwnerId) {
            logger.warn(`[Admin Button] Unauthorized button interaction by user ${interaction.user.id}`);
            await interaction.reply({ content: '❌ You do not have permission to use this admin function.', ephemeral: true });
            return;
        }
        const [actionType, actionName, ...params] = interaction.customId.split('_');
        if (actionType !== 'admin' || actionName !== 'button') return;

        const operation = params[0];
        const targetUserIdOrPage = params[1]; // This can be targetUserId or page for allworlds/leaderboard/adminownlist
        const pageForUserList = params[2] ? parseInt(params[2], 10) : 1;

        logger.info(`[Admin Button] Admin ${interaction.user.tag} triggered operation: ${operation}, param1: ${targetUserIdOrPage}, param2: ${pageForUserList}`);

        try {
            if (operation === 'viewuserworlds') {
                await interaction.deferUpdate({ ephemeral: true });
                await showUserWorldsListAdminView(interaction, targetUserIdOrPage, 1);
            } else if (operation === 'userlistprev') {
                await interaction.deferUpdate({ ephemeral: true });
                await showUserWorldsListAdminView(interaction, targetUserIdOrPage, Math.max(1, pageForUserList - 1));
            } else if (operation === 'userlistnext') {
                await interaction.deferUpdate({ ephemeral: true });
                await showUserWorldsListAdminView(interaction, targetUserIdOrPage, pageForUserList + 1);
            } else if (operation === 'backtouserstats') {
                await interaction.deferUpdate({ ephemeral: true });
                const targetUser = await interaction.client.users.fetch(targetUserIdOrPage);
                await showUserStatsView(interaction, targetUserIdOrPage, targetUser);
            } else if (operation === 'allworldsprev') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showAllWorldsAdminView(interaction, Math.max(1, currentPage - 1));
            } else if (operation === 'allworldsnext') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showAllWorldsAdminView(interaction, currentPage + 1);
            } else if (operation === 'dbstats') {
                await interaction.deferUpdate({ ephemeral: true });
                try {
                    const overallStats = await db.getOverallWorldStats();
                    const totalUsersWithWorlds = await db.getTotalUsersWithWorlds();
                    const statsEmbed = new EmbedBuilder().setTitle('📊 Database Statistics').setColor(0x3498DB)
                        .addFields(
                            { name: 'Total Worlds Tracked', value: String(overallStats.total_worlds), inline: true }, { name: 'Total Mainlocks', value: String(overallStats.total_mainlocks), inline: true }, { name: 'Total Outlocks', value: String(overallStats.total_outlocks), inline: true },
                            { name: 'Users with Tracked Worlds', value: String(totalUsersWithWorlds), inline: true }
                        ).setTimestamp().setFooter({ text: 'Admin View' });
                    await interaction.followUp({ embeds: [statsEmbed], ephemeral: true });
                } catch (error) {
                    logger.error('[Admin DB Stats] Error fetching or displaying DB stats:', error);
                    await interaction.followUp({ content: 'An error occurred while fetching database statistics.', ephemeral: true });
                }
            } else if (operation === 'leaderboard') {
                await interaction.deferUpdate({ ephemeral: true });
                await showLeaderboardView(interaction, parseInt(targetUserIdOrPage, 10) || 1);
            } else if (operation === 'leaderboardprev') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showLeaderboardView(interaction, Math.max(1, currentPage - 1));
            } else if (operation === 'leaderboardnext') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showLeaderboardView(interaction, currentPage + 1);
            } else if (operation === 'backtoallworlds') {
                await interaction.deferUpdate({ ephemeral: true });
                await showAllWorldsAdminView(interaction, parseInt(targetUserIdOrPage, 10) || 1);
            } else if (operation === 'showadminownlist') {
                await interaction.deferUpdate({ ephemeral: true });
                await showAdminOwnListView(interaction, parseInt(targetUserIdOrPage, 10) || 1); // targetUserIdOrPage here is page
            } else if (operation === 'adminownlistprev') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showAdminOwnListView(interaction, Math.max(1, currentPage - 1));
            } else if (operation === 'adminownlistnext') {
                const currentPage = parseInt(targetUserIdOrPage, 10);
                await interaction.deferUpdate({ ephemeral: true });
                await showAdminOwnListView(interaction, currentPage + 1);
            } else if (operation === 'filteruserinput') {
                const modal = new ModalBuilder().setCustomId('admin_modal_filterusersubmit').setTitle("View Specific User's Worlds");
                const userIdInput = new TextInputBuilder().setCustomId('target_user_id_input').setLabel("Enter User ID").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("e.g., 123456789012345678");
                modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));
                await interaction.showModal(modal);
            } else {
                 logger.warn(`[Admin Button] Unknown admin button operation: ${operation}`);
                 await interaction.reply({ content: 'Unknown admin button action.', ephemeral: true });
            }
        } catch (error) {
            logger.error(`[Admin Button] Error handling button ${interaction.customId}:`, error);
            const errReply = { content: 'An error occurred while processing this admin action.', ephemeral: true };
            if (interaction.replied || interaction.deferred) await interaction.followUp(errReply).catch(e => {}); else await interaction.reply(errReply).catch(e => {});
        }
    },

    async handleModal(interaction) {
        if (!interaction.isModalSubmit()) return;
        const botOwnerId = process.env.BOT_OWNER_ID;
        if (!botOwnerId || interaction.user.id !== botOwnerId) {
            logger.warn(`[Admin Modal] Unauthorized modal submission by user ${interaction.user.id}`);
            await interaction.reply({ content: '❌ You do not have permission to use this admin function.', ephemeral: true });
            return;
        }
        const [actionType, modalName, operation, ...params] = interaction.customId.split('_');
        if (actionType !== 'admin' || modalName !== 'modal') {
             logger.debug(`[Admin Modal] Modal ${interaction.customId} not for admin command.`);
             return;
        }
        logger.info(`[Admin Modal] Admin ${interaction.user.tag} submitted modal: ${interaction.customId}, operation: ${operation}`);
        try {
            if (operation === 'filterusersubmit') {
                await interaction.deferUpdate({ ephemeral: true });
                const targetUserId = interaction.fields.getTextInputValue('target_user_id_input').trim();
                if (!/^\d{17,19}$/.test(targetUserId)) {
                    await interaction.followUp({ content: '❌ Invalid User ID format. Please provide a valid Discord User ID.', ephemeral: true });
                    return;
                }
                await showUserWorldsListAdminView(interaction, targetUserId, 1);
            } else {
                logger.warn(`[Admin Modal] Unknown admin modal operation: ${operation}`);
                await interaction.reply({ content: 'Unknown admin modal action.', ephemeral: true });
            }
        } catch (error) {
            logger.error(`[Admin Modal] Error handling modal ${interaction.customId}:`, error);
            const errReply = { content: 'An error occurred while processing this modal submission.', ephemeral: true };
            if (interaction.replied || interaction.deferred) await interaction.followUp(errReply).catch(e => {}); else await interaction.reply(errReply).catch(e => {});
        }
    },
    // New exported function
    async displayAdminAllWorldsView(interaction, page = 1) {
        logger.info(`[Admin] Owner (from list command) requested to display all worlds view, page ${page}. Interaction ID: ${interaction.id}`);
        try {
            // It's crucial that the interaction is ephemeral if the original interaction was ephemeral.
            // The button click that leads here is on an ephemeral message from /list.
            // Deferring the button click before calling showAllWorldsAdminView.
            // showAllWorldsAdminView will then use editReply.
            if (!interaction.deferred && !interaction.replied) { // Check if already deferred/replied
                 await interaction.deferReply({ ephemeral: true });
            }
            await showAllWorldsAdminView(interaction, page);
        } catch (error) {
            logger.error(`[Admin] Error in displayAdminAllWorldsView (called from list command) for interaction ${interaction.id}:`, error);
            const errorReplyContent = 'Sorry, an error occurred while trying to display the all worlds list.';
            if (interaction.replied || interaction.deferred) { // Use followUp if already replied or deferred
                await interaction.followUp({ content: errorReplyContent, ephemeral: true }).catch(e => logger.error("[Admin] Failed to send followUp in displayAdminAllWorldsView error handler", e));
            } else { // Use reply if not yet replied or deferred
                await interaction.reply({ content: errorReplyContent, ephemeral: true }).catch(e => logger.error("[Admin] Failed to send reply in displayAdminAllWorldsView error handler", e));
            }
        }
    }
};
