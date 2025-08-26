const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { logHistory } = require('../utils/share_and_history.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Send a message to all users of the bot.')
        .addStringOption(option =>
            option.setName('content')
                .setDescription('The message to send.')
                .setRequired(true)),
    async execute(interaction) {
        const content = interaction.options.getString('content');
        const sender = interaction.user;

        await interaction.reply({ content: 'Sending message to all users...', flags: MessageFlags.Ephemeral });

        const users = await db.getAllUsers();
        if (!users || users.length === 0) {
            await interaction.editReply({ content: 'No users found to send a message to.' });
            return;
        }

        let successCount = 0;
        let failCount = 0;

        const message = `**Announcement from ${sender.tag}:**\n\n${content}`;

        for (const user of users) {
            try {
                const targetUser = await interaction.client.users.fetch(user.id);
                await targetUser.send(message);
                successCount++;
            } catch (error) {
                logger.warn(`[message.js] Failed to send message to user ${user.id}. They may have DMs disabled. Error: ${error.message}`);
                failCount++;
            }
        }

        await interaction.editReply({ content: `Message sent to ${successCount} user(s). Failed to send to ${failCount} user(s).` });

        if (successCount > 0) {
            await logHistory(null, sender.id, 'message', content);
        }
    }
};
