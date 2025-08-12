const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const CONSTANTS = require('../utils/constants.js');
const logger = require('../utils/logger.js');
const { table } = require('table');

async function showWorldsList(interaction, page = 1, filters = {}, listOwnerUsername = null) {
    const isUpdate = interaction.isMessageComponent();
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        try { await interaction.deferUpdate(); } catch (e) { logger.error(`[list.js] Defer update failed: ${e.message}`); return; }
    }

    const userId = interaction.user.id;
    const userPrefs = await db.getUserPreferences(userId);

    const effectiveFilters = filters && Object.keys(filters).length > 0 ? filters : { added_by_username: interaction.user.username };
    const effectiveListOwner = listOwnerUsername || interaction.user.username;

    const { worlds, total } = await db.getFilteredWorlds(effectiveFilters, page, CONSTANTS.PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(total / CONSTANTS.PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));

    if (total === 0) {
        const content = effectiveListOwner === interaction.user.username
            ? "You haven't added any worlds yet. Use `/addworld` to start tracking."
            : `User **${effectiveListOwner}** has not added any worlds.`;
        const opts = { content, components: [], flags: 1 << 6 };
        if (isUpdate) await interaction.editReply(opts); else await interaction.reply(opts);
        return;
    }

    const { data: tableData, config: tableConfig } = utils.formatWorldsToTable(worlds, userPrefs.view_mode, 'private', userPrefs.timezone_offset, effectiveListOwner);
    const tableOutput = '```\n' + table(tableData, tableConfig) + '\n```';

    const components = [];
    const paginationRow = new ActionRowBuilder();
    paginationRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`list_button_page_${safePage - 1}_${effectiveListOwner}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(safePage === 1),
        new ButtonBuilder()
            .setCustomId(`list_button_page_${safePage + 1}_${effectiveListOwner}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(safePage === totalPages)
    );
    components.push(paginationRow);

    const finalContent = `${tableOutput}\nPage ${safePage} of ${totalPages}`;
    const finalOpts = { content: finalContent, components, flags: 1 << 6 };
    if (isUpdate) await interaction.editReply(finalOpts); else await interaction.reply(finalOpts);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Displays a list of tracked worlds.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose list you want to see.')
        .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    if (targetUser) {
        await showWorldsList(interaction, 1, { added_by_username: targetUser.username }, targetUser.username);
    } else {
        await showWorldsList(interaction, 1, { added_by_username: interaction.user.username }, interaction.user.username);
    }
  },

  async handleButton(interaction, params) {
    const [action, pageStr, listOwnerUsername] = params;
    if (action === 'page') {
        const page = parseInt(pageStr, 10) || 1;
        await showWorldsList(interaction, page, { added_by_username: listOwnerUsername }, listOwnerUsername);
    }
  },
  showWorldsList, // Export for use in other commands like leaderboard
};
