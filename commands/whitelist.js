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
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to add.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a user from the whitelist.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to remove.')
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
        const user = interaction.options.getUser('user');

        if (subcommand === 'add') {
            if (!user) {
                return interaction.reply({ content: 'You must specify a user to add.', ephemeral: true });
            }
            try {
                await db.addToWhitelist(user.id, user.username);
                await interaction.reply({ content: `**${user.username}** has been added to the whitelist.`, ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
            }
        } else if (subcommand === 'remove') {
            if (!user) {
                return interaction.reply({ content: 'You must specify a user to remove.', ephemeral: true });
            }
            try {
                await db.removeFromWhitelist(user.id);
                await interaction.reply({ content: `**${user.username}** has been removed from the whitelist.`, ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
            }
        } else if (subcommand === 'list') {
            const whitelist = await db.getWhitelistedUsers();
            if (whitelist.length === 0) {
                return interaction.reply({ content: 'The whitelist is empty.', ephemeral: true });
            }
            const usernames = whitelist.map(u => u.username).join('\n');
            await interaction.reply({ content: `**Whitelist:**\n${usernames}`, ephemeral: true });
        }
    },
};
