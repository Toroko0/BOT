const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const { table } = require('table');
const CONSTANTS = require('../utils/constants.js');
const logger = require('../utils/logger.js');

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
    leaderboard.forEach((user, index) => {
        tableData.push([`#${(page - 1) * CONSTANTS.PAGE_SIZE + index + 1}`, user.added_by_username, user.world_count]);
    });

    const tableOutput = '```\n' + table(tableData) + '\n```';

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

    const finalContent = `${tableOutput}\nPage ${page} of ${totalPages}`;
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
    }
};
