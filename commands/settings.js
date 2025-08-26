const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { showWorldsList } = require('./list.js');
const { getSettingsReplyOptions } = require('../utils/settings.js');

async function showTimezoneModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('settings_modal_timezone')
        .setTitle('Set Your Timezone Offset');

    const timezoneInput = new TextInputBuilder()
        .setCustomId('timezone_offset')
        .setLabel('UTC Offset (e.g., -5, 7.5, +2)')
        .setPlaceholder('Enter a number from -12 to +14')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(timezoneInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
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
        const [action] = params;
        const userId = interaction.user.id;

        switch (action) {
            case 'viewmode': {
                const currentPrefs = await db.getUserPreferences(userId);
                const newViewMode = currentPrefs.view_mode === 'pc' ? 'phone' : 'pc';
                await db.updateUserViewMode(userId, newViewMode);
                const replyOptions = await getSettingsReplyOptions(userId);
                await interaction.update(replyOptions);
                break;
            }
            case 'timezone':
                await showTimezoneModal(interaction);
                break;
            // 'back' action is now handled by the 'list' command.
            default:
                logger.warn(`[settings.js] Unknown button action received: ${action}`);
                break;
        }
    },
    async handleModal(interaction) {
        if (interaction.customId !== 'settings_modal_timezone') return;

        const timezoneOffsetStr = interaction.fields.getTextInputValue('timezone_offset');
        const timezoneOffset = parseFloat(timezoneOffsetStr);

        if (isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 14) {
            return interaction.reply({
                content: '❌ Invalid timezone offset. Please enter a number between -12 and +14.',
                ephemeral: true,
            });
        }

        const userId = interaction.user.id;
        await db.updateUserTimezone(userId, timezoneOffset);

        const replyOptions = await getSettingsReplyOptions(userId);
        await interaction.update(replyOptions);
    },
};
