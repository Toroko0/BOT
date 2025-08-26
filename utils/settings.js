const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database.js');

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

    const buttonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('settings_viewmode')
            .setLabel('Toggle View Mode')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('settings_timezone')
            .setLabel('Set Timezone')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('list_view_private_1') // Use the 'list' command handler
            .setLabel('Back to List')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [buttonsRow], flags: 1 << 6 };
}

module.exports = { getSettingsReplyOptions };
