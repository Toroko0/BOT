const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('last')
        .setDescription('Shows the last 10 activities.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('added')
                .setDescription('Shows the last 10 worlds added.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('removed')
                .setDescription('Shows the last 10 worlds removed.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edited')
                .setDescription('Shows the last 10 worlds edited.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('Shows the last 10 messages sent.')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const action = subcommand.charAt(0).toUpperCase() + subcommand.slice(1);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const history = await db.getHistory(subcommand, 10);

        if (!history || history.length === 0) {
            await interaction.editReply({ content: `No recent activity found for **${subcommand}**.` });
            return;
        }

        const title = subcommand === 'message' ? `Last 10 Messages Sent` : `Last 10 Worlds ${action}`;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0x0099ff)
            .setTimestamp();

        let description = '';
        for (const item of history) {
            const timestamp = new Date(item.timestamp).getTime() / 1000;
            const detail = item.details.length > 50 ? item.details.substring(0, 47) + '...' : item.details;
            description += `**${detail}** - <t:${Math.floor(timestamp)}:R> by <@${item.user_id}>\n`;
        }
        embed.setDescription(description);

        await interaction.editReply({ embeds: [embed] });
    }
};
