const { SlashCommandBuilder } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Manage the user whitelist.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a user to the whitelist.')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the user to add.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a user from the whitelist.')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the user to remove.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all users on the whitelist.')),
    async execute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const username = interaction.options.getString('username');

        if (subcommand === 'add') {
            const result = await db.addToWhitelist(username);
            await interaction.reply({ content: result.message, ephemeral: true });
        } else if (subcommand === 'remove') {
            const result = await db.removeFromWhitelist(username);
            await interaction.reply({ content: result.message, ephemeral: true });
        } else if (subcommand === 'list') {
            const whitelist = await db.getWhitelist();
            if (whitelist.length === 0) {
                return interaction.reply({ content: 'The whitelist is empty.', ephemeral: true });
            }
            const usernames = whitelist.map(u => u.username).join('\n');
            await interaction.reply({ content: `**Whitelist:**\n${usernames}`, ephemeral: true });
        }
    },
};
