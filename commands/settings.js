const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const db = require('../database.js'); // Or path to your database module
const logger = require('../utils/logger.js'); // Or path to your logger

// --- Helper Function to Generate Settings Reply Components (Synchronous) ---
function generateSettingsReplyComponents(userPrefs, interactionUserId) {
    // interactionUserId is available for future logging/use if needed

    // Provide default values if userPrefs is null or some fields are missing
    const timezoneOffset = userPrefs?.timezone_offset ?? 0.0;
    const viewMode = userPrefs?.view_mode ?? 'pc';
    const reminderEnabled = userPrefs?.reminder_enabled ?? false;
    const reminderTimeUtc = userPrefs?.reminder_time_utc ?? null;
    
    // In a real scenario, you might fetch the username separately if needed, or pass it
    // For now, let's assume we don't need to display username in the title here, or handle it if interaction is available
    // const userName = interactionUser ? interactionUser.username : 'User'; // Example if interactionUser was passed

    let reminderDisplayValue = 'Disabled';
    if (reminderEnabled) {
        if (reminderTimeUtc) {
            const [utcHour, utcMinute] = reminderTimeUtc.split(':').map(Number);
            const utcTotalMinutes = utcHour * 60 + utcMinute;
            const offsetMinutes = (timezoneOffset ?? 0) * 60;
            let localTotalMinutes = utcTotalMinutes + offsetMinutes;
            localTotalMinutes = (localTotalMinutes % 1440 + 1440) % 1440; // Normalize
            const displayLocalHour = Math.floor(localTotalMinutes / 60);
            const displayLocalMinute = localTotalMinutes % 60;
            const formattedLocalTime = `${String(displayLocalHour).padStart(2, '0')}:${String(displayLocalMinute).padStart(2, '0')}`;
            reminderDisplayValue = `Enabled (${formattedLocalTime})`;
        } else {
            reminderDisplayValue = `Enabled (Time Not Set)`;
        }
    }

    const settingsEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Your Settings`) // Title can be generic or fetch username if needed
        .setDescription('Manage your preferences for the bot.')
        .addFields(
            { name: '🌍 Timezone Offset', value: `GMT${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset.toFixed(1)}`, inline: true },
            { name: '🖥️ View Mode', value: viewMode === 'pc' ? 'PC Mode' : 'Phone Mode', inline: true },
            { name: '⏰ Reminders', value: reminderDisplayValue, inline: true }
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
                .setLabel('Manage Reminders')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false) // Enabled for Phase 2
        );

    return {
        embeds: [settingsEmbed],
        components: [row1, row2],
        flags: 1 << 6 // Ephemeral
    };
}

// --- Helper Function to Generate Settings Reply (Asynchronous: Fetches Prefs) ---
async function getSettingsReplyOptions(userId) {
    const userPrefs = await db.getUserPreferences(userId);
    return generateSettingsReplyComponents(userPrefs, userId);
}

// --- Helper Function to Generate Reminder Management View ---
async function getManageRemindersViewOptions(userId) {
    const userPrefs = await db.getUserPreferences(userId);
    const reminderEnabled = userPrefs?.reminder_enabled ?? false;
    // const reminderTimeUtc = userPrefs?.reminder_time_utc ?? null; // Original direct use

    let displayReminderTime = 'Not Set';
    if (userPrefs?.reminder_time_utc) {
        const [utcHour, utcMinute] = userPrefs.reminder_time_utc.split(':').map(Number);
        const utcTotalMinutes = utcHour * 60 + utcMinute;
        const offsetMinutes = (userPrefs.timezone_offset ?? 0) * 60; // Default offset to 0 if not set
        let localTotalMinutes = utcTotalMinutes + offsetMinutes;
        localTotalMinutes = (localTotalMinutes % 1440 + 1440) % 1440; // Normalize
        const displayLocalHour = Math.floor(localTotalMinutes / 60);
        const displayLocalMinute = localTotalMinutes % 60;
        displayReminderTime = `${String(displayLocalHour).padStart(2, '0')}:${String(displayLocalMinute).padStart(2, '0')}`; // Removed " Local"
    }

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('Manage Reminders')
        .setDescription('Configure your reminder settings.')
        .addFields({
            name: '⏰ Current Status',
            // Display the reminder time in UTC in the embed field for clarity, or use displayReminderTime if preferred
            value: reminderEnabled ? `Enabled (UTC Time: ${userPrefs.reminder_time_utc || 'Not Set'})` : 'Disabled'
        });

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('settings_button_remindertoggle')
                .setLabel(`Toggle Reminders (Currently: ${reminderEnabled ? 'ON' : 'OFF'})`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('settings_button_remindersettime')
                .setLabel(`Set Reminder Time (Currently: ${displayReminderTime})`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(false) // Enabled for Phase 3
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('settings_button_backtomain')
                .setLabel('Back to Main Settings')
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
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
            // await interaction.deferUpdate(); // Defer update for all button actions that will refresh the message

            switch (action) {
                case 'settimezone':
                    // Modal is shown, actual update happens in handleModal
                    const modal = new ModalBuilder()
                        .setCustomId('settings_modal_settimezone')
                        .setTitle('Set Your Timezone Offset');

                    const timezoneInput = new TextInputBuilder()
                        .setCustomId('timezone_offset_input')
                        .setLabel('Enter UTC Offset (e.g., -7, 5.5, +2)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('-5.0'); // Example placeholder

                    const row = new ActionRowBuilder().addComponents(timezoneInput);
                    modal.addComponents(row);
                    await interaction.showModal(modal);
                    // No immediate update to the original message here, modal submission will handle it.
                    // However, deferUpdate() was called, so we should not reply further here.
                    return; 

                case 'toggleviewmode':
                    logger.debug(`[settings.js] toggleviewmode: Initial interaction state - replied: ${interaction.replied}, deferred: ${interaction.deferred}`);
                    
                    // Perform database operations before deferring
                    const initialUserPrefs = await db.getUserPreferences(interaction.user.id);
                    const currentViewMode = initialUserPrefs?.view_mode ?? 'pc';
                    const newViewMode = currentViewMode === 'pc' ? 'phone' : 'pc';
                    const updateSuccess = await db.updateUserViewMode(interaction.user.id, newViewMode);

                    if (updateSuccess) {
                        logger.info(`User ${interaction.user.id} toggled view mode to ${newViewMode}`);
                        const updatedUserPrefs = await db.getUserPreferences(interaction.user.id); // Re-fetch fresh preferences

                        await interaction.deferUpdate(); // Defer update specifically for this case

                        const replyOptions = generateSettingsReplyComponents(updatedUserPrefs, interaction.user.id); // Synchronous call
                        try {
                            await interaction.editReply(replyOptions); // Use editReply
                        } catch (updateError) {
                            logger.error(`[settings.js] toggleviewmode: Error during interaction.editReply():`, updateError);
                            // Attempt to send a followUp since the original update failed.
                            await interaction.followUp({ content: `Your view mode was updated to ${newViewMode}, but the settings message could not be refreshed. Error: ${updateError.message}`, flags: 1 << 6 }).catch(followUpError => {
                                logger.error('[settings.js] toggleviewmode: Error sending followUp after updateError:', followUpError);
                            });
                        }
                    } else {
                        logger.error(`Failed to update view mode for user ${interaction.user.id}`);
                        // Ensure this followUp is safe. Since deferUpdate() hasn't been called yet in this path,
                        // we need to consider if the interaction has been replied to by the initial command.
                        // However, the original logic for this block assumed deferUpdate was already called.
                        // For button interactions, there's always an initial reply (the message with the button).
                        // So, followUp should be appropriate. If deferUpdate was intended to be called even on failure,
                        // this logic might need adjustment, but per current instructions, defer is only on success.
                        // The original check (interaction.deferred || interaction.replied) is still largely relevant
                        // as interaction.replied will be true from the original command's reply.
                        if (interaction.deferred || interaction.replied) {
                             await interaction.followUp({ content: 'Failed to update your view mode. Please try again.', flags: 1 << 6 });
                        } else {
                             // This case should ideally not be reached for button interactions.
                             // If deferUpdate() failed, the main catch block would handle it.
                             // However, as a safeguard:
                             logger.warn('[settings.js] toggleviewmode: Attempting to reply in else block, interaction not deferred/replied.');
                             await interaction.reply({ content: 'Failed to update your view mode and could not send a follow-up. Please try again.', flags: 1 << 6 });
                        }
                    }
                    break;

                case 'managereminders':
                    // Reply with the new "Manage Reminders" view as an ephemeral message
                    await interaction.reply(await getManageRemindersViewOptions(interaction.user.id));
                    return; // Return to prevent falling through or further processing

                case 'remindertoggle':
                    const currentUserPrefsToggle = await db.getUserPreferences(interaction.user.id);
                    const newReminderState = !currentUserPrefsToggle.reminder_enabled;
                    // Pass existing time; updateUserReminderSettings handles nulling it if newReminderState is false.
                    await db.updateUserReminderSettings(interaction.user.id, newReminderState, currentUserPrefsToggle.reminder_time_utc);

                    await interaction.deferUpdate();
                    await interaction.editReply(await getManageRemindersViewOptions(interaction.user.id));
                    break;

                case 'remindersettime':
                    const reminderTimeModal = new ModalBuilder()
                        .setCustomId('settings_modal_remindertime')
                        .setTitle('Set Reminder Time (Your Local)');

                    const timeInput = new TextInputBuilder()
                        .setCustomId('reminder_time_input')
                        .setLabel("Enter time (HH:MM, 24-hour format)")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder("e.g., 09:30 or 17:00");

                    const timeActionRow = new ActionRowBuilder().addComponents(timeInput);
                    reminderTimeModal.addComponents(timeActionRow);
                    await interaction.showModal(reminderTimeModal);
                    return; // Modal shown, no further action here

                case 'backtomain':
                    await interaction.deferUpdate();
                    const mainSettingsOptions = await getSettingsReplyOptions(interaction.user.id);
                    await interaction.editReply(mainSettingsOptions);
                    break;
                
                default:
                    logger.warn(`[settings.js] Unknown button action: ${action}`);
                    // This default case might be for buttons on the main settings message or the reminder management message.
                    // If the interaction is already replied or deferred (e.g., a button on the main settings after deferUpdate), use followUp.
                    // If it's a button on an ephemeral message that hasn't been deferred yet (like 'managereminders' previously),
                    // a new reply might be considered, but followUp is safer for generic unknown actions on existing messages.
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({ content: 'Unknown button action.', flags: 1 << 6 });
                    } else {
                        // If the interaction hasn't been acknowledged yet, reply. This is less likely for button interactions.
                        await interaction.reply({ content: 'Unknown button action.', flags: 1 << 6 });
                    }
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling button ${action}:`, error);
            // Generic error handling. If deferred or replied, must use followUp.
            if (interaction.deferred || interaction.replied) {
                 await interaction.followUp({ content: 'An error occurred processing this action.', flags: 1 << 6 });
            } else {
                 // This might occur if interaction.reply() itself failed in one of the new cases before defer/reply
                 await interaction.reply({ content: 'An error occurred processing this action.', flags: 1 << 6 });
            }
        }
    },

    async handleModal(interaction, params) {
        const modalId = params[0]; // 'settimezone'
        
        try {
            await interaction.deferUpdate(); // Defer the modal submission interaction first

            if (modalId === 'settimezone') {
                const selectedOffsetString = interaction.fields.getTextInputValue('timezone_offset_input');
                const newOffset = parseFloat(selectedOffsetString);

                if (isNaN(newOffset) || newOffset < -12.0 || newOffset > 14.0) {
                    await interaction.followUp({ content: '❌ Invalid timezone offset. Please enter a number between -12 and +14 (e.g., -7, 5.5, +2).', flags: 1 << 6 });
                    return;
                }
                
                const updateSuccess = await db.updateUserTimezone(interaction.user.id, newOffset);
                if (updateSuccess) {
                    logger.info(`User ${interaction.user.id} set timezone offset to ${newOffset}`);
                    const updatedUserPrefs = await db.getUserPreferences(interaction.user.id);
                    const replyOptions = generateSettingsReplyComponents(updatedUserPrefs, interaction.user.id);
                    await interaction.editReply(replyOptions); // Edit the original message
                } else {
                    logger.error(`Failed to update timezone for user ${interaction.user.id}`);
                    await interaction.followUp({ content: 'Failed to update your timezone. Please try again.', flags: 1 << 6 });
                }
            } else if (modalId === 'remindertime') {
                const timeInputStr = interaction.fields.getTextInputValue('reminder_time_input');
                const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

                if (!timeRegex.test(timeInputStr)) {
                    await interaction.followUp({ content: '❌ Invalid time format. Please use HH:MM (e.g., 09:30 or 23:00).', flags: 1 << 6 });
                    return;
                }

                const [hourStr, minuteStr] = timeInputStr.split(':');
                const localHour = parseInt(hourStr);
                const localMinute = parseInt(minuteStr);

                const userPrefs = await db.getUserPreferences(interaction.user.id);
                const timezoneOffset = userPrefs.timezone_offset; // e.g., -5.0, 5.5

                // Calculate total minutes from midnight for local time
                const localTotalMinutes = localHour * 60 + localMinute;

                // Calculate total minutes from midnight in UTC
                const timezoneOffsetMinutes = timezoneOffset * 60;
                let utcTotalMinutes = localTotalMinutes - timezoneOffsetMinutes;

                // Normalize utcTotalMinutes to be within a 24-hour day (0 to 1439 minutes)
                utcTotalMinutes = (utcTotalMinutes % 1440 + 1440) % 1440;

                // Calculate final UTC hour and minute
                const finalUtcHour = Math.floor(utcTotalMinutes / 60);
                const finalUtcMinute = utcTotalMinutes % 60;

                const reminderTimeUtc = `${String(finalUtcHour).padStart(2, '0')}:${String(finalUtcMinute).padStart(2, '0')}`;

                const reminderUpdateSuccess = await db.updateUserReminderSettings(interaction.user.id, true, reminderTimeUtc);

                if (reminderUpdateSuccess) {
                    logger.info(`User ${interaction.user.id} set reminder time to ${timeInputStr} local (${localHour}:${localMinute}), ${reminderTimeUtc} UTC. Offset: ${timezoneOffset}`);
                    await interaction.editReply(await getManageRemindersViewOptions(interaction.user.id));
                } else {
                    logger.error(`Failed to update reminder time for user ${interaction.user.id}`);
                    await interaction.followUp({ content: 'Failed to update reminder time. Please try again.', flags: 1 << 6 });
                }
            } else {
                logger.warn(`[settings.js] Unknown modal action part: ${modalId}`);
                await interaction.followUp({ content: 'Unknown modal submission.', flags: 1 << 6 });
            }
        } catch (error) {
            logger.error(`[settings.js] Error handling modal ${interaction.customId}:`, error);
            // deferUpdate() was called, so we must use followUp for errors if not already handled.
            // The check for interaction.replied is a safeguard, but after deferUpdate, it should be deferred.
            if (interaction.deferred || interaction.replied) {
                 await interaction.followUp({ content: 'An error occurred processing this form.', flags: 1 << 6 });
            } else {
                 // This path should ideally not be hit if deferUpdate() is successful at the start.
                 await interaction.reply({ content: 'An error occurred processing this form and initial deferral failed.', flags: 1 << 6 });
            }
        }
    },
    getSettingsReplyOptions // Export the helper function
};
