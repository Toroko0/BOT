const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database.js');
const { table } = require('table');
const CONSTANTS = require('../utils/constants.js');
const logger = require('../utils/logger.js');
const { showWorldsList } = require('./list.js');

async function showLeaderboard(interaction, page = 1) {
    const isUpdate = interaction.isMessageComponent();
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch (e) { logger.error(`[leaderboard.js] Defer update failed: ${e.message}`); return; }
    }

    const { leaderboard, total } = await db.getLeaderboard(page, CONSTANTS.PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(total / CONSTANTS.PAGE_SIZE));
    page = Math.max(1, Math.min(page, totalPages));

    if (leaderboard.length === 0) {
        const opts = { content: 'No users have added any worlds yet.', components: [], flags: 1 << 6 };
        if (isUpdate) await interaction.editReply(opts); else await interaction.reply(opts);
        return;
    }

    const tableData = [['Rank', 'User', 'Worlds Added']];
    const selectMenuOptions = [];
    leaderboard.forEach((user, index) => {
        tableData.push([`#${(page - 1) * CONSTANTS.PAGE_SIZE + index + 1}`, user.added_by_username, user.world_count]);
        selectMenuOptions.push({
            label: user.added_by_username,
            value: user.added_by_username,
        });
    });

    const tableOutput = '```\n' + table(tableData) + '\n```';

    const stats = await db.getWorldLockStats();
    const totalWorlds = await db.getWorldCount();
    const statsOutput = `\n**Global Stats**\nTotal Worlds: ${totalWorlds}\nMainlocks: ${stats.mainlock}\nOutlocks: ${stats.outlock}`;

    const components = [];
    const navigationRow = new ActionRowBuilder();
    navigationRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`leaderboard_button_page_${page - 1}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 1),
        new ButtonBuilder()
            .setCustomId(`leaderboard_button_page_${page + 1}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages)
    );
    components.push(navigationRow);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('leaderboard_select_user')
        .setPlaceholder('View user stats')
        .addOptions(selectMenuOptions);

    components.push(new ActionRowBuilder().addComponents(selectMenu));

    const finalContent = `${tableOutput}\nPage ${page} of ${totalPages}${statsOutput}`;
    const finalOpts = { content: finalContent, components, flags: 1 << 6 };
    if (isUpdate) await interaction.editReply(finalOpts); else await interaction.reply(finalOpts);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the leaderboard of users who have added the most worlds.'),
    async execute(interaction) {
        await showLeaderboard(interaction, 1);
    },
    async handleButton(interaction, params) {
        const [action, pageStr] = params;
        if (action === 'page') {
            await showLeaderboard(interaction, parseInt(pageStr) || 1);
        }
    },
    async handleSelectMenu(interaction, params) {
        const username = interaction.values[0];
        const stats = await db.getUserStats(username);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`📊 Stats for ${username}`)
            .addFields(
                { name: '🌍 Total Worlds', value: stats.totalWorlds.toString(), inline: true },
                { name: '🧲 Mainlocks', value: stats.mainlock.toString(), inline: true },
                { name: '👑 Outlocks', value: stats.outlock.toString(), inline: true }
            );

        await interaction.reply({ embeds: [embed], flags: 1 << 6 });

        const filters = { added_by_username: username };
        await showWorldsList(interaction, 1, filters, username);
    }
};
