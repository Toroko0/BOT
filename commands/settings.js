const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, InteractionType } = require('discord.js');
const db = require('../database.js'); // Or path to your database module
const logger = require('../utils/logger.js'); // Or path to your logger

// --- Helper Function to Generate Settings Reply ---
// (Simulated preferences will be passed for now)
async function getSettingsReplyOptions(interactionUser, currentViewMode = 'pc', currentTimezoneOffset = 0.0, currentReminderEnabled = false, currentReminderTime = null) {
    // In a real scenario, these would be fetched via:
    // const userPrefs = await db.getUserPreferences(interactionUser.id);
    // For now, we use the passed-in or default values.
    const userPrefs = {
        timezone_offset: currentTimezoneOffset,
        view_mode: currentViewMode,
        reminder_enabled: currentReminderEnabled,
        reminder_time_utc: currentReminderTime
    };

    const settingsEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`${interactionUser.username}'s Settings`)
        .setDescription('Manage your preferences for the bot.')
        .addFields(
            { name: '🌍 Timezone Offset', value: `GMT${userPrefs.timezone_offset >= 0 ? '+' : ''}${userPrefs.timezone_offset.toFixed(1)}`, inline: true },
            { name: '🖥️ View Mode', value: userPrefs.view_mode === 'pc' ? 'PC Mode' : 'Phone Mode', inline: true },
            { name: '⏰ Reminders', value: userPrefs.reminder_enabled ? `Enabled (${userPrefs.reminder_time_utc || 'Not Set'})` : 'Disabled', inline: true }
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
                .setLabel(userPrefs.view_mode === 'pc' ? 'Switch to Phone Mode' : 'Switch to PC Mode')
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
        // Simulate fetching preferences (replace with actual db call in Phase 2)
        const simulatedPrefs = { viewMode: 'pc', timezoneOffset: 0.0, reminderEnabled: false, reminderTime: null }; 
        
        const replyOptions = await getSettingsReplyOptions(
            interaction.user, 
            simulatedPrefs.viewMode, 
            simulatedPrefs.timezoneOffset,
            simulatedPrefs.reminderEnabled,
            simulatedPrefs.reminderTime
        );
        await interaction.reply(replyOptions);
    },

    async handleButton(interaction, params) {
        const action = params[0];
        const replyOptsEphemeral = { flags: 1 << 6 };

        // Simulate fetching current preferences (replace with db calls in Phase 2)
        // For now, we'll use some defaults and modify them based on actions.
        // This is a very simplified mock for demonstration.
        let currentViewMode = 'pc'; 
        let currentTimezoneOffset = 0.0;
        // In a real scenario: const userPrefs = await db.getUserPreferences(interaction.user.id);
        // currentViewMode = userPrefs.view_mode; 
        // currentTimezoneOffset = userPrefs.timezone_offset;

        try {
            switch (action) {
                case 'settimezone':
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
                    break;

                case 'toggleviewmode':
                    await interaction.deferUpdate();
                    // Simulate fetching and updating view mode
                    // currentViewMode = (await db.getUserPreference(interaction.user.id, 'view_mode')) || 'pc'; // Example
                    const newViewMode = currentViewMode === 'pc' ? 'phone' : 'pc';
                    // await db.setUserPreference(interaction.user.id, 'view_mode', newViewMode); // Example
                    logger.info(`User ${interaction.user.id} toggled view mode to ${newViewMode} (simulated)`);
                    
                    const updatedReplyOptionsToggle = await getSettingsReplyOptions(interaction.user, newViewMode, currentTimezoneOffset);
                    await interaction.editReply(updatedReplyOptionsToggle);
                    break;

                case 'managereminders':
                    await interaction.reply({ content: "Reminder management will be available in a future update!", ...replyOptsEphemeral });
                    break;
                
                default:
                    logger.warn(`[settings.js] Unknown button action: ${action}`);
                    await interaction.reply({ content: 'Unknown button action.', ...replyOptsEphemeral });
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling button ${action}:`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred processing this action.', ...replyOptsEphemeral });
            } else {
                await interaction.followUp({ content: 'An error occurred processing this action.', ...replyOptsEphemeral });
            }
        }
    },

    async handleModal(interaction, params) {
        const modalId = params[0]; // In this case, it's 'settimezone' from 'settings_modal_settimezone'
        const replyOptsEphemeral = { flags: 1 << 6 };

        // Simulate fetching current preferences (replace with db calls in Phase 2)
        let currentViewMode = 'pc'; 
        // currentViewMode = (await db.getUserPreference(interaction.user.id, 'view_mode')) || 'pc'; // Example

        try {
            if (modalId === 'settimezone') { // Matches the 'action' part of 'settings_modal_settimezone'
                await interaction.deferUpdate();
                const selectedOffsetString = interaction.fields.getStringValue('timezone_offset_select');
                const newOffset = parseFloat(selectedOffsetString);

                if (isNaN(newOffset) || newOffset < -12.0 || newOffset > 14.0) {
                    await interaction.followUp({ content: '❌ Invalid timezone offset selected. Please choose a valid offset.', ...replyOptsEphemeral });
                    return;
                }
                
                // Simulate saving the new offset
                // await db.setUserPreference(interaction.user.id, 'timezone_offset', newOffset); // Example
                logger.info(`User ${interaction.user.id} set timezone offset to ${newOffset} (simulated)`);

                const updatedReplyOptionsModal = await getSettingsReplyOptions(interaction.user, currentViewMode, newOffset);
                await interaction.editReply(updatedReplyOptionsModal);
            } else {
                logger.warn(`[settings.js] Unknown modal action part: ${modalId}`);
                await interaction.reply({ content: 'Unknown modal submission.', ...replyOptsEphemeral });
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling modal ${interaction.customId}:`, error);
             if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred processing this form.', ...replyOptsEphemeral });
            } else {
                await interaction.followUp({ content: 'An error occurred processing this form.', ...replyOptsEphemeral });
            }
        }
    }
};
