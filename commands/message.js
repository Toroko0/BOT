const { SlashCommandBuilder } = require('@discordjs/builders');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const utils = require('../utils.js'); // Added utils import

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Send a direct message to another user within the bot.')
        .addStringOption(option =>
            option.setName('recipient')
                .setDescription('The user to send a message to (Discord ID, @mention, or their Bot Username).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('content')
                .setDescription('The content of your message (max 1000 characters).')
                .setRequired(true)
                .setMaxLength(1000)), // Max length for message content

    async execute(interaction) {
        const commandCooldownKey = `message_cmd_${interaction.user.id}`;
        const COOLDOWN_DURATION_SECONDS = 5 * 60; // 5 minutes
        const cooldown = utils.checkCooldown(interaction.user.id, commandCooldownKey, COOLDOWN_DURATION_SECONDS);
        if (cooldown.onCooldown) {
            return interaction.reply({ content: `⏱️ This command is on cooldown. Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true });
        }

        const senderUserId = interaction.user.id;
        const senderUsername = interaction.user.username; // Discord username of the sender

        // Ensure sender is in the database
        await db.addUser(senderUserId, senderUsername);
        const senderBotUser = await db.getUser(senderUserId); // To get sender's bot_username if set

        const recipientArg = interaction.options.getString('recipient');
        const messageContent = interaction.options.getString('content');

        let recipientUserRecord = null;

        // 1. Resolve recipient
        const mentionMatch = recipientArg.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
            const recipientDiscordId = mentionMatch[1];
            recipientUserRecord = await db.getUser(recipientDiscordId);
            if (recipientUserRecord) await db.addUser(recipientDiscordId, recipientUserRecord.username); // Ensure they are in DB
        } else {
            recipientUserRecord = await db.getUserByBotUsername(recipientArg);
            if (!recipientUserRecord) {
                // Try as direct Discord ID if not a bot username
                const potentialDiscordId = recipientArg.match(/^\d{17,19}$/);
                if (potentialDiscordId) {
                    recipientUserRecord = await db.getUser(recipientArg);
                     if (recipientUserRecord) await db.addUser(recipientArg, recipientUserRecord.username); // Ensure they are in DB
                }
            }
        }

        if (!recipientUserRecord || !recipientUserRecord.id) {
            return interaction.reply({ content: '❌ Recipient not found. Please use their Discord ID, @mention, or exact Bot Username.', ephemeral: true });
        }

        const recipientUserId = recipientUserRecord.id;
        const recipientDisplayUsername = recipientUserRecord.bot_username || recipientUserRecord.username; // Prefer bot username

        if (recipientUserId === senderUserId) {
            return interaction.reply({ content: '❌ You cannot send a message to yourself.', ephemeral: true });
        }

        // 2. Send the message via DB
        try {
            const result = await db.sendMessage(senderUserId, recipientUserId, messageContent);

            if (result.success) {
                await interaction.reply({ content: `✅ Message sent to **${recipientDisplayUsername}**!`, ephemeral: true });

                // 3. Notify recipient via Discord DM if their preference is set
                const recipientNotificationPref = await db.getUserForNotification(recipientUserId);
                if (recipientNotificationPref && recipientNotificationPref.notify_on_new_message) {
                    try {
                        const discordUserToDm = await interaction.client.users.fetch(recipientUserId);
                        const senderDisplayName = senderBotUser?.bot_username || senderUsername;
                        await discordUserToDm.send(`🔔 You have received a new message in your bot mailbox from **${senderDisplayName}**.\nUse the \`/mailbox\` command to view it.`);
                        logger.info(`[MessageCmd] Sent DM notification to ${recipientUserId} for new message ${result.messageId}`);
                    } catch (dmError) {
                        logger.warn(`[MessageCmd] Failed to send DM notification to ${recipientUserId} for message ${result.messageId}: ${dmError.message}`);
                        // Don't fail the whole command if DM fails, but log it.
                        // interaction.followUp({ content: "(Note: Could not send a DM notification to the recipient.)", ephemeral: true }); // Optional
                    }
                } else {
                    logger.info(`[MessageCmd] User ${recipientUserId} has DM notifications turned off for new messages.`);
                }

            } else {
                logger.error(`[MessageCmd] Failed to send message from ${senderUserId} to ${recipientUserId}: ${result.error}`);
                await interaction.reply({ content: '❌ There was a database error sending your message. Please try again later.', ephemeral: true });
            }
        } catch (error) {
            logger.error(`[MessageCmd] Exception sending message from ${senderUserId} to ${recipientUserId}:`, error);
            await interaction.reply({ content: '❌ An unexpected error occurred while sending your message.', ephemeral: true });
        }
    },
};
