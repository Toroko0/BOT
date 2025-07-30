const { SlashCommandBuilder } = require('discord.js');
const db = require('../database.js');
const CONSTANTS = require('../utils/constants.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export')
        .setDescription('Export a list of worlds.')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The type of export to perform.')
                .setRequired(true)
                .addChoices(
                    { name: 'Current Page', value: 'current' },
                    { name: '180 Days', value: '180' },
                    { name: '179 Days', value: '179' },
                )),
    async execute(interaction) {
        const exportType = interaction.options.getString('type');
        const userActiveFilters = interaction.client.activeListFilters?.[interaction.user.id] || null;

        let worlds = [];
        let title = '';

        switch (exportType) {
            case 'current':
                const page = 1; // Assuming we export the first page
                const result = await db.getFilteredWorlds(userActiveFilters, page, CONSTANTS.PAGE_SIZE);
                worlds = result.worlds;
                title = 'Current Page Export';
                break;
            case '180':
                worlds = await db.getAllFilteredWorlds(interaction.user.id, { daysOwned: 180 });
                title = '180 Day Worlds Export';
                break;
            case '179':
                worlds = await db.getAllFilteredWorlds(interaction.user.id, { daysOwned: 179 });
                title = '179 Day Worlds Export';
                break;
        }

        if (worlds.length === 0) {
            await interaction.reply({ content: 'No worlds found to export for the selected type.', ephemeral: true });
            return;
        }

        let exportText = `**${title}**\n\`\`\`\n`;
        worlds.forEach(world => {
            const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
            const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
            exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}\n`;
        });
        exportText += '```';

        if (exportText.length > 2000) {
            let cutOff = exportText.lastIndexOf('\n', 1990);
            if (cutOff === -1) cutOff = 1990;
            exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
        }

        await interaction.reply({ content: exportText, ephemeral: true });
    },
};
