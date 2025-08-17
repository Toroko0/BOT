const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database.js');

async function getSettingsReplyOptions(userId) {
    const userPrefs = await db.getUserPreferences(userId);
    const timezoneOffset = userPrefs.timezone_offset || 0.0;
    const viewMode = userPrefs.view_mode || 'pc';
    const notificationsEnabled = userPrefs.notifications_enabled;
    const notificationInterval = userPrefs.notification_interval;

    let notificationStatus = 'Off';
    if (notificationsEnabled) {
        notificationStatus = `Every ${notificationInterval} hours`;
    }

    const embed = {
        color: 0x0099ff,
        title: 'Your Settings',
        fields: [
            { name: 'View Mode', value: viewMode === 'pc' ? '🖥️ PC' : '📱 Phone', inline: true },
            { name: 'Timezone', value: `UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset}`, inline: true },
            { name: 'Notifications', value: notificationStatus, inline: true },
        ],
    };

    const buttonsRow = new ActionRowBuilder().addComponents(
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
    );

    const notificationMenu = new StringSelectMenuBuilder()
        .setCustomId('settings_select_notifications')
        .setPlaceholder('Change Notification Frequency')
        .addOptions([
            {
                label: 'Every 6 hours',
                value: '6',
                default: notificationInterval === 6,
            },
            {
                label: 'Every 12 hours',
                value: '12',
                default: notificationInterval === 12,
            },
            {
                label: 'Every 24 hours',
                value: '24',
                default: notificationInterval === 24,
            },
            {
                label: 'Off',
                value: '0',
                default: !notificationsEnabled,
            },
        ]);

    const notificationRow = new ActionRowBuilder().addComponents(notificationMenu);

    return { embeds: [embed], components: [buttonsRow, notificationRow], flags: 1 << 6 };
}

module.exports = { getSettingsReplyOptions };
