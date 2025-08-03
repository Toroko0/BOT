const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { showWorldsList } = require('./list.js');

async function getSettingsReplyOptions(userId) {
    const userPrefs = await db.getUserPreferences(userId);
    const timezoneOffset = userPrefs.timezone_offset || 0.0;
    const viewMode = userPrefs.view_mode || 'pc';

    const embed = {
        color: 0x0099ff,
        title: 'Your Settings',
        fields: [
            { name: 'View Mode', value: viewMode === 'pc' ? '🖥️ PC' : '📱 Phone', inline: true },
            { name: 'Timezone', value: `UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset}`, inline: true },
        ],
    };

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('settings_button_viewmode')
                .setLabel('Toggle View Mode')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('settings_button_timezone')
                .setLabel('Set Timezone')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('settings_button_back')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Secondary)
        )
    ];

    return { embeds: [embed], components, flags: 1 << 6 };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage your personal settings.'),
    async execute(interaction) {
        const replyOptions = await getSettingsReplyOptions(interaction.user.id);
        await interaction.reply(replyOptions);
    },
    async handleButton(interaction, params) {
        const action = params[0];
        const userId = interaction.user.id;

        if (action === 'viewmode') {
            const currentPrefs = await db.getUserPreferences(userId);
            const newViewMode = currentPrefs.view_mode === 'pc' ? 'phone' : 'pc';
            await db.updateUserViewMode(userId, newViewMode);
            const replyOptions = await getSettingsReplyOptions(userId);
            await interaction.update(replyOptions);
        } else if (action === 'timezone') {
            // In a real scenario, you'd show a modal here to get the timezone.
            // For this example, we'll just cycle through a few timezones.
            const currentPrefs = await db.getUserPreferences(userId);
            const currentTimezone = currentPrefs.timezone_offset || 0.0;
            const newTimezone = (currentTimezone + 1) % 13;
            await db.updateUserTimezone(userId, newTimezone);
            const replyOptions = await getSettingsReplyOptions(userId);
            await interaction.update(replyOptions);
        } else if (action === 'back') {
            await showWorldsList(interaction, 1, { added_by_username: interaction.user.username }, interaction.user.username);
        }
    },
    getSettingsReplyOptions,
};
