const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType,
} = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

const MESSAGES_PER_PAGE = 5; // Number of messages per page in the mailbox

// Helper function to create pagination buttons for mailbox
function createMailboxPaginationRow(currentPage, totalPages, viewType) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`mailbox:page:prev:${currentPage - 1}:${viewType}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`mailbox:page:next:${currentPage + 1}:${viewType}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages)
        );
}

// Helper function to format messages for mailbox embed
function formatMailboxEmbed(messages, title, currentPage, totalPages, client) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x4A90E2); // A pleasant blue

    if (!messages || messages.length === 0) {
        embed.setDescription('Your mailbox is empty or no messages match your criteria.');
    } else {
        messages.forEach(msg => {
            const readStatusIcon = msg.is_read ? '📨 (Read)' : '📩 (Unread)';
            const senderDisplayName = msg.sender_display_name || 'Unknown Sender';
            let messagePreview = msg.message_content.substring(0, 150); // Show a preview
            if (msg.message_content.length > 150) messagePreview += '...';

            embed.addFields({
                name: `${readStatusIcon} From: ${senderDisplayName} (ID: ${msg.id})`,
                value: `> ${messagePreview}\n*Sent: <t:${Math.floor(new Date(msg.sent_at).getTime() / 1000)}:R>*`
            });
        });
    }

    const iconURL = client.user?.displayAvatarURL();
    if (totalPages > 0) {
        embed.setFooter({ text: `Page ${currentPage} of ${totalPages} • Your Mailbox`, iconURL });
    } else {
        embed.setFooter({ text: `Your Mailbox`, iconURL });
    }
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mailbox')
        .setDescription('View and manage your direct messages within the bot.')
        .addStringOption(option =>
            option.setName('view_type')
                .setDescription('Filter messages to view.')
                .setRequired(false)
                .addChoices(
                    { name: '📬 All Messages', value: 'all' },
                    { name: '📩 Unread Only', value: 'unread' }
                ))
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number to view.')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction) {
        await db.addUser(interaction.user.id, interaction.user.username); // Ensure user exists

        if (interaction.isChatInputCommand()) {
            const viewType = interaction.options.getString('view_type') || 'all';
            const page = interaction.options.getInteger('page') || 1;
            await displayMailbox(interaction, viewType, page);
        } else if (interaction.isButton()) {
            const [context, action, operation, value, viewTypeOrPage] = interaction.customId.split(':');
            // mailbox:page:next:2:all (page navigation)
            // mailbox:confirmdelete:yes:MSG_ID:PAGE:VIEWTYPE (delete confirmation)
            if (context !== 'mailbox') return;

            if (action === 'page') {
                const newPage = parseInt(value);
                const viewType = viewTypeOrPage || 'all';
                await displayMailbox(interaction, viewType, newPage, true);
            } else if (action === 'confirmdelete') {
                const messageId = parseInt(operation); // operation is message_id
                const pageToRefresh = parseInt(value); // value is page
                const viewTypeForRefresh = viewTypeOrPage || 'all';
                if (interaction.customId.startsWith('mailbox:confirmdelete:yes')) {
                    await processDeleteMessage(interaction, messageId, pageToRefresh, viewTypeForRefresh);
                } else { // "no"
                    await interaction.update({ content: 'Deletion cancelled.', components: [], ephemeral: true });
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'mailbox:actionselect') {
                const [action, messageIdStr, currentPageStr, currentStatusStr, viewType] = interaction.values[0].split(':');
                const messageId = parseInt(messageIdStr);
                const currentPage = parseInt(currentPageStr);
                const isRead = currentStatusStr === 'read';

                if (action === 'toggleRead') {
                    await processToggleRead(interaction, messageId, isRead, currentPage, viewType);
                } else if (action === 'reply') {
                    // Fetch original sender ID to prefill or pass to modal.
                    // This requires getting the message details first.
                    const message = await db.getMessageById(messageId, interaction.user.id);
                    if (!message) return interaction.reply({ content: 'Error: Could not find message to reply to.', ephemeral: true });
                    await showReplyModal(interaction, messageId, message.sender_user_id, currentPage, viewType);
                } else if (action === 'delete') {
                    await showDeleteConfirmation(interaction, messageId, currentPage, viewType);
                }
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId.startsWith('mailbox:replymodal:')) {
                const [, , originalMessageIdStr, originalSenderId, currentPageStr, viewType] = interaction.customId.split(':');
                const originalMessageId = parseInt(originalMessageIdStr);
                await processReplyModal(interaction, originalMessageId, originalSenderId, currentPageStr, viewType);
            }
        }
    },
};

async function displayMailbox(interaction, viewType = 'all', page = 1, isButtonOrSelect = false) {
    const userId = interaction.user.id;
    const unreadOnly = viewType === 'unread';
    const replyMethod = isButtonOrSelect ? interaction.update.bind(interaction) : interaction.reply.bind(interaction);

    try {
        let { messages, total } = await db.getReceivedMessages(userId, { page, pageSize: MESSAGES_PER_PAGE, unreadOnly });
        const totalPages = Math.ceil(total / MESSAGES_PER_PAGE) || 1;
        if (page > totalPages && totalPages > 0) { // Adjust page if out of bounds
            page = totalPages;
            const result = await db.getReceivedMessages(userId, { page, pageSize: MESSAGES_PER_PAGE, unreadOnly });
            messages = result.messages; total = result.total;
        }

        const embedTitle = unreadOnly ? '📬 Your Unread Messages' : '📬 Your Mailbox - All Messages';
        const embed = formatMailboxEmbed(messages, embedTitle, page, totalPages, interaction.client);
        const components = [];

        if (messages.length > 0) {
            const selectOptions = messages.map(msg => ({
                label: `${msg.is_read ? '📨' : '📩'} From: ${msg.sender_display_name} (ID: ${msg.id})`,
                description: `${msg.message_content.substring(0, 40)}... Sent <t:${Math.floor(new Date(msg.sent_at).getTime() / 1000)}:R>`,
                value: `toggleRead:${msg.id}:${page}:${msg.is_read ? 'read' : 'unread'}:${viewType}` // action:messageId:currentPage:currentStatus:viewType
            }));
             selectOptions.push(...messages.map(msg => ({ // Add reply and delete options separately for clarity if needed, or combine
                label: `↪️ Reply to ID: ${msg.id}`,
                value: `reply:${msg.id}:${page}:NA:${viewType}` // NA for currentStatus
            })));
            selectOptions.push(...messages.map(msg => ({
                label: `🗑️ Delete ID: ${msg.id}`,
                value: `delete:${msg.id}:${page}:NA:${viewType}`
            })));


            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('mailbox:actionselect')
                    .setPlaceholder('Select a message to manage...')
                    .addOptions(selectOptions.slice(0,25)) // Max 25 options
            ));
        }
        if (totalPages > 1) {
            components.push(createMailboxPaginationRow(page, totalPages, viewType));
        }
        await replyMethod({ embeds: [embed], components, ephemeral: true });

    } catch (error) {
        logger.error(`[MailboxCmd] Error displaying mailbox for user ${userId}:`, error);
        await replyMethod({ content: '❌ Error fetching your messages.', ephemeral: true, embeds: [], components: [] });
    }
}

async function processToggleRead(interaction, messageId, isRead, currentPage, viewType) {
    const success = isRead
        ? await db.markMessageAsUnread(messageId, interaction.user.id)
        : await db.markMessageAsRead(messageId, interaction.user.id);

    if (success) {
        await interaction.update({ content: `Message ID ${messageId} marked as ${isRead ? 'unread' : 'read'}. Refreshing...`, components: [], ephemeral:true });
    } else {
        await interaction.update({ content: `Failed to update read status for message ID ${messageId}.`, components: [], ephemeral:true });
    }
    await displayMailbox(interaction, viewType, currentPage, true);
}

async function showDeleteConfirmation(interaction, messageId, currentPage, viewType) {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`mailbox:confirmdelete:yes:${messageId}:${currentPage}:${viewType}`).setLabel('✅ Yes, Delete').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`mailbox:confirmdelete:no:${messageId}:${currentPage}:${viewType}`).setLabel('❌ No, Keep').setStyle(ButtonStyle.Secondary)
        );
    await interaction.reply({ content: `Are you sure you want to delete message ID **${messageId}**? This cannot be undone.`, components: [row], ephemeral: true });
}

async function processDeleteMessage(interaction, messageId, currentPage, viewType) {
    const result = await db.deleteMessage(messageId, interaction.user.id);
    if (result.success) {
        await interaction.update({ content: `🗑️ Message ID ${messageId} deleted. Refreshing mailbox...`, components: [] });
    } else {
        await interaction.update({ content: `❌ Failed to delete message ID ${messageId}. Error: ${result.error}`, components: [] });
    }
    await displayMailbox(interaction, viewType, currentPage, true);
}

async function showReplyModal(interaction, originalMessageId, originalSenderId, currentPage, viewType) {
    const modal = new ModalBuilder()
        .setCustomId(`mailbox:replymodal:${originalMessageId}:${originalSenderId}:${currentPage}:${viewType}`)
        .setTitle(`Replying to Message ID: ${originalMessageId}`);
    const replyContentInput = new TextInputBuilder()
        .setCustomId('reply_content')
        .setLabel("Your Reply (max 1000 characters)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder().addComponents(replyContentInput));
    await interaction.showModal(modal);
}

async function processReplyModal(interaction, originalMessageId, originalSenderId, currentPageStr, viewType) {
    const replyContent = interaction.fields.getTextInputValue('reply_content');
    const senderUserId = interaction.user.id;
    const currentPage = parseInt(currentPageStr);

    try {
        const sendResult = await db.sendMessage(senderUserId, originalSenderId, replyContent, originalMessageId);
        if (sendResult.success) {
            await interaction.reply({ content: `✅ Reply sent to message ID ${originalMessageId}! (New message ID: ${sendResult.messageId})`, ephemeral: true });

            const recipientNotificationPref = await db.getUserForNotification(originalSenderId);
            if (recipientNotificationPref && recipientNotificationPref.notify_on_new_message) {
                try {
                    const discordUserToDm = await interaction.client.users.fetch(originalSenderId);
                    const senderUser = await db.getUser(senderUserId); // Get sender's display name
                    const senderDisplayName = senderUser?.bot_username || senderUser?.username || interaction.user.username;
                    await discordUserToDm.send(`↪️ You have a new reply in your bot mailbox from **${senderDisplayName}** (to your message ID ${originalMessageId}). Use \`/mailbox\` to view.`);
                } catch (dmError) {
                    logger.warn(`[MailboxCmd] Failed to send DM notification for reply to ${originalSenderId}: ${dmError.message}`);
                }
            }
        } else {
            await interaction.reply({ content: '❌ Failed to send reply. Database error.', ephemeral: true });
        }
    } catch (error) {
        logger.error(`[MailboxCmd] Exception sending reply from ${senderUserId} to ${originalSenderId}:`, error);
        await interaction.reply({ content: '❌ An unexpected error occurred while sending your reply.', ephemeral: true });
    }
    // No automatic refresh of mailbox here as it's a reply, not directly affecting the current user's mailbox view.
}
