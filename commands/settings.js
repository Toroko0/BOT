const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, InteractionType } = require('discord.js');
const db = require('../database.js'); // Or path to your database module
const logger = require('../utils/logger.js'); // Or path to your logger

// --- Helper Function to Generate Settings Reply ---
async function getSettingsReplyOptions(userId) {
    const userPrefs = await db.getUserPreferences(userId);

    // Provide default values if userPrefs is null or some fields are missing
    const timezoneOffset = userPrefs?.timezone_offset ?? 0.0;
    const viewMode = userPrefs?.view_mode ?? 'pc';
    const reminderEnabled = userPrefs?.reminder_enabled ?? false;
    const reminderTimeUtc = userPrefs?.reminder_time_utc ?? null;
    
    // In a real scenario, you might fetch the username separately if needed, or pass it
    // For now, let's assume we don't need to display username in the title here, or handle it if interaction is available
    // const userName = interactionUser ? interactionUser.username : 'User'; // Example if interactionUser was passed

    const settingsEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Your Settings`) // Title can be generic or fetch username if needed
        .setDescription('Manage your preferences for the bot.')
        .addFields(
            { name: '🌍 Timezone Offset', value: `GMT${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset.toFixed(1)}`, inline: true },
            { name: '🖥️ View Mode', value: viewMode === 'pc' ? 'PC Mode' : 'Phone Mode', inline: true },
            { name: '⏰ Reminders', value: reminderEnabled ? `Enabled (${reminderTimeUtc || 'Not Set'})` : 'Disabled', inline: true }
        )
        .setFooter({ text: 'Use the buttons below to change your settings.' });

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('settings_button_settimezone')
                .setLabel('Set Timezone')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('settings_button_toggleviewmode')
                .setLabel(viewMode === 'pc' ? 'Switch to Phone Mode' : 'Switch to PC Mode')
                .setStyle(ButtonStyle.Primary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('settings_button_managereminders')
                .setLabel('Manage Reminders (Soon™)')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true) // Disabled until Phase 2
        );

    return {
        embeds: [settingsEmbed],
        components: [row1, row2],
        flags: 1 << 6 // Ephemeral
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Access and manage your bot preferences.'),

    async execute(interaction) {
        const replyOptions = await getSettingsReplyOptions(interaction.user.id);
        await interaction.reply(replyOptions);
    },

    async handleButton(interaction, params) {
        const action = params[0];
        const replyOptsEphemeral = { flags: 1 << 6 }; // For error messages or non-update replies

        try {
            await interaction.deferUpdate(); // Defer update for all button actions that will refresh the message

            switch (action) {
                case 'settimezone':
                    // Modal is shown, actual update happens in handleModal
                    const modal = new ModalBuilder()
                        .setCustomId('settings_modal_settimezone')
                        .setTitle('Set Your Timezone Offset');

                    const timezoneOptions = [];
                    for (let i = -12; i <= 14; i += 0.5) {
                        if (i > 12 && (i !== 12.75 && i !== 13 && i !== 13.75 && i !== 14)) continue; // Skip invalid .75 except for specific ones if needed.
                        const offsetString = i.toFixed(1);
                        const label = `GMT${i >= 0 ? '+' : ''}${offsetString}`;
                        timezoneOptions.push(
                            new StringSelectMenuOptionBuilder()
                                .setLabel(label)
                                .setValue(offsetString)
                        );
                        if (timezoneOptions.length >= 25) break; // Max options for select menu
                    }
                    
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('timezone_offset_select')
                        .setPlaceholder('Choose your GMT offset (e.g., GMT+5.5)')
                        .addOptions(timezoneOptions);
                    
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    modal.addComponents(row);
                    await interaction.showModal(modal);
                    // No immediate update to the original message here, modal submission will handle it.
                    // However, deferUpdate() was called, so we should not reply further here.
                    return; 

                case 'toggleviewmode':
                    const userPrefs = await db.getUserPreferences(interaction.user.id);
                    const currentViewMode = userPrefs?.view_mode ?? 'pc';
                    const newViewMode = currentViewMode === 'pc' ? 'phone' : 'pc';
                    
                    const updateSuccess = await db.updateUserViewMode(interaction.user.id, newViewMode);
                    if (updateSuccess) {
                        logger.info(`User ${interaction.user.id} toggled view mode to ${newViewMode}`);
                        const replyOptions = await getSettingsReplyOptions(interaction.user.id);
                        await interaction.update(replyOptions);
                    } else {
                        logger.error(`Failed to update view mode for user ${interaction.user.id}`);
                        // interaction.update() was already called via deferUpdate()
                        // We can use followUp for ephemeral error messages if deferUpdate was used.
                        await interaction.followUp({ content: 'Failed to update your view mode. Please try again.', flags: 1 << 6 });
                    }
                    break;

                case 'managereminders':
                    // Since we deferred, we use followUp for the ephemeral message
                    await interaction.followUp({ content: "Reminder management will be available in a future update!", flags: 1 << 6 });
                    break;
                
                default:
                    logger.warn(`[settings.js] Unknown button action: ${action}`);
                    // interaction.update() was already called via deferUpdate()
                    await interaction.followUp({ content: 'Unknown button action.', flags: 1 << 6 });
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling button ${action}:`, error);
            // If deferUpdate() was used, we must use followUp for errors.
            if (interaction.deferred || interaction.replied) { // replied might be true if deferUpdate failed and a reply was sent
                 await interaction.followUp({ content: 'An error occurred processing this action.', flags: 1 << 6 });
            } else {
                 await interaction.reply({ content: 'An error occurred processing this action.', flags: 1 << 6 });
            }
        }
    },

    async handleModal(interaction, params) {
        const modalId = params[0]; // 'settimezone'
        
        try {
            await interaction.deferUpdate(); // Defer update for all modal submissions that will refresh the message

            if (modalId === 'settimezone') {
                const selectedOffsetString = interaction.fields.getStringValue('timezone_offset_select');
                const newOffset = parseFloat(selectedOffsetString);

                if (isNaN(newOffset) || newOffset < -12.0 || newOffset > 14.0) {
                    await interaction.followUp({ content: '❌ Invalid timezone offset selected. Please choose a valid offset.', flags: 1 << 6 });
                    return;
                }
                
                const updateSuccess = await db.updateUserTimezone(interaction.user.id, newOffset);
                if (updateSuccess) {
                    logger.info(`User ${interaction.user.id} set timezone offset to ${newOffset}`);
                    const replyOptions = await getSettingsReplyOptions(interaction.user.id);
                    await interaction.update(replyOptions);
                } else {
                    logger.error(`Failed to update timezone for user ${interaction.user.id}`);
                    await interaction.followUp({ content: 'Failed to update your timezone. Please try again.', flags: 1 << 6 });
                }
            } else {
                logger.warn(`[settings.js] Unknown modal action part: ${modalId}`);
                await interaction.followUp({ content: 'Unknown modal submission.', flags: 1 << 6 });
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling modal ${interaction.customId}:`, error);
            if (interaction.deferred || interaction.replied) {
                 await interaction.followUp({ content: 'An error occurred processing this form.', flags: 1 << 6 });
            } else {
                 await interaction.reply({ content: 'An error occurred processing this form.', flags: 1 << 6 });
            }
        }
    },
    getSettingsReplyOptions // Export the helper function
};
