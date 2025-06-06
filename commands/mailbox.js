const {
    SlashCommandBuilder,
    EmbedBuilder, // Will be removed if not used by individual message blocks
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    // StringSelectMenuBuilder, // Removed
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType,
} = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

const MESSAGES_PER_PAGE_NEW = 3; // New messages per page

// Helper function to create pagination buttons for mailbox
function createMailboxPaginationRow(currentPage, totalPages) { // viewType removed
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`mailbox:page:prev:${currentPage - 1}`) // viewType removed
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`mailbox:page:next:${currentPage + 1}`) // viewType removed
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages),
            new ButtonBuilder() // Added Go To Page button
                .setCustomId(`mailbox:page:goto:${currentPage}`) // currentPage can be a placeholder here
                .setLabel('Go To')
                .setStyle(ButtonStyle.Secondary)
        );
}

// formatMailboxEmbed function will be removed

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mailbox')
        .setDescription('View and manage your direct messages within the bot.'),
        // Removed view_type and page options

    async execute(interaction) {
        await db.addUser(interaction.user.id, interaction.user.username); // Ensure user exists

        if (interaction.isChatInputCommand()) {
            // const viewType = interaction.options.getString('view_type') || 'all'; // Removed
            // const page = interaction.options.getInteger('page') || 1; // Removed
            await displayMailbox(interaction, 1); // Always page 1, viewType effectively 'all'
        } else if (interaction.isButton()) {
            const [context, action, operation, value, viewTypeOrPage] = interaction.customId.split(':');
            // mailbox:page:next:2 (page navigation) - viewType removed
            // mailbox:confirmdelete:yes:MSG_ID:PAGE (delete confirmation) - viewType removed
            // mailbox:replybutton:MSG_ID:PAGE (new)
            // mailbox:deletebutton:MSG_ID:PAGE (new)
            if (context !== 'mailbox') return;

            const page = parseInt(value); // For page operations, value is newPage
                                         // For message actions, operation is msgId, value is page

            if (action === 'page') {
                if (operation === 'prev' || operation === 'next') {
                    const newPage = parseInt(value); // value is the target page
                    await displayMailbox(interaction, newPage, true);
                } else if (operation === 'goto') {
                    // Show modal for page input - to be handled in handleModalSubmitCommand
                    const goToModal = new ModalBuilder()
                        .setCustomId('mailbox:gotopagemodal')
                        .setTitle('Go to Page')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('page_number')
                                    .setLabel('Enter Page Number')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                                    .setPlaceholder('E.g., 5')
                            )
                        );
                    await interaction.showModal(goToModal);
                }
            } else if (action === 'confirmdelete') {
                const messageId = parseInt(operation);
                const pageToRefresh = parseInt(value);
                // viewTypeForRefresh removed
                if (interaction.customId.startsWith('mailbox:confirmdelete:yes')) {
                    await processDeleteMessage(interaction, messageId, pageToRefresh);
                } else { // "no"
                    await interaction.update({ content: 'Deletion cancelled.', components: [], ephemeral: true });
                }
            } else if (action === 'replybutton') {
                const messageId = parseInt(operation);
                const currentPage = parseInt(value);
                const message = await db.getMessageById(messageId, interaction.user.id);
                if (!message) return interaction.reply({ content: 'Error: Could not find message to reply to.', ephemeral: true });
                await showReplyModal(interaction, messageId, message.sender_user_id, currentPage);
            } else if (action === 'deletebutton') {
                const messageId = parseInt(operation);
                const currentPage = parseInt(value);
                await showDeleteConfirmation(interaction, messageId, currentPage);
            }
        } else if (interaction.isStringSelectMenu()) {
            // StringSelectMenu is being removed
             logger.warn(`[MailboxCmd] Received unexpected StringSelectMenu interaction: ${interaction.customId}`);
             await interaction.reply({content: "This action is no longer supported.", ephemeral: true});
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId.startsWith('mailbox:replymodal:')) {
                const [, , originalMessageIdStr, originalSenderId, currentPageStr] = interaction.customId.split(':'); // viewType removed
                const originalMessageId = parseInt(originalMessageIdStr);
                await processReplyModal(interaction, originalMessageId, originalSenderId, currentPageStr);
            } else if (interaction.customId === 'mailbox:gotopagemodal') {
                const pageNumberStr = interaction.fields.getTextInputValue('page_number');
                const pageNumber = parseInt(pageNumberStr);
                if (!isNaN(pageNumber) && pageNumber > 0) {
                    await displayMailbox(interaction, pageNumber, true);
                } else {
                    await interaction.followUp({ content: 'Invalid page number provided.', ephemeral: true }); // Or editReply if deferred
                }
            }
        }
    },
};

async function displayMailbox(interaction, page = 1, isButtonOrSelect = false) {
    const userId = interaction.user.id;
    // const unreadOnly = viewType === 'unread'; // Removed, always fetch all
    const replyMethod = isButtonOrSelect ? interaction.update.bind(interaction) : interaction.reply.bind(interaction);

    try {
        let { messages, total } = await db.getReceivedMessages(userId, { page, pageSize: MESSAGES_PER_PAGE_NEW }); // No unreadOnly, new page size
        const totalPages = Math.ceil(total / MESSAGES_PER_PAGE_NEW) || 1;

        if (page > totalPages && totalPages > 0) { // Adjust page if out of bounds
            page = totalPages;
            const result = await db.getReceivedMessages(userId, { page, pageSize: MESSAGES_PER_PAGE_NEW });
            messages = result.messages; total = result.total;
        }

        if (!messages || messages.length === 0) {
            await replyMethod({ content: 'Your mailbox is empty.', embeds: [], components: [], ephemeral: true });
            return;
        }

        const messageContents = [];
        const actionRows = [];

        for (const msg of messages) {
            const readStatusIcon = msg.is_read ? '📨 (Read)' : '📩 (Unread)'; // Read status still shown
            const senderDisplayName = msg.sender_display_name || 'Unknown Sender';
            let messagePreview = msg.message_content.substring(0, 200);
            if (msg.message_content.length > 200) messagePreview += '...';

            messageContents.push(
                `**${readStatusIcon} From: ${senderDisplayName} (ID: ${msg.id})**\n` +
                `> ${messagePreview}\n` +
                `*Sent: <t:${Math.floor(new Date(msg.sent_at).getTime() / 1000)}:R>*\n---`
            );

            actionRows.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`mailbox:replybutton:${msg.id}:${page}`).setLabel('↪️ Reply').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`mailbox:deletebutton:${msg.id}:${page}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger)
                )
            );
        }

        const finalContent = `**📬 Your Mailbox - Page ${page}/${totalPages}**\n\n` + messageContents.join('\n');

        // Pagination row
        if (totalPages > 0) { // Always add pagination if there are messages, even if only 1 page (for goto)
            actionRows.push(createMailboxPaginationRow(page, totalPages));
        }

        // Ensure not too many action rows (max 5)
        // If messageContents.length is 3, actionRows will have 3 for messages + 1 for pagination = 4. This is fine.
        // If MESSAGES_PER_PAGE_NEW is 4, then 4 message rows + 1 pagination row = 5. Fine.
        // If MESSAGES_PER_PAGE_NEW is 5, then 5 message rows. Pagination row cannot be added.
        // Current MESSAGES_PER_PAGE_NEW = 3, so this is fine.

        await replyMethod({ content: finalContent, embeds: [], components: actionRows.slice(0,5) , ephemeral: true });

    } catch (error) {
        logger.error(`[MailboxCmd] Error displaying mailbox for user ${userId}:`, error);
        await replyMethod({ content: '❌ Error fetching your messages.', ephemeral: true, embeds: [], components: [] });
    }
}

// processToggleRead function will be removed

async function showDeleteConfirmation(interaction, messageId, currentPage) { // viewType removed
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`mailbox:confirmdelete:yes:${messageId}:${currentPage}`).setLabel('✅ Yes, Delete').setStyle(ButtonStyle.Danger), // viewType removed
            new ButtonBuilder().setCustomId(`mailbox:confirmdelete:no:${messageId}:${currentPage}`).setLabel('❌ No, Keep').setStyle(ButtonStyle.Secondary) // viewType removed
        );
    // Use reply for select menu, update for button
    if (interaction.isMessageComponent()) { // from deletebutton
         await interaction.update({ content: `Are you sure you want to delete message ID **${messageId}**? This cannot be undone.`, components: [row], ephemeral: true });
    } else { // Should not happen if select menu is removed
         await interaction.reply({ content: `Are you sure you want to delete message ID **${messageId}**? This cannot be undone.`, components: [row], ephemeral: true });
    }
}

async function processDeleteMessage(interaction, messageId, currentPage) { // viewType removed
    const result = await db.deleteMessage(messageId, interaction.user.id);
    if (result.success) {
        await interaction.update({ content: `🗑️ Message ID ${messageId} deleted. Refreshing mailbox...`, components: [] });
    } else {
        await interaction.update({ content: `❌ Failed to delete message ID ${messageId}. Error: ${result.error}`, components: [] });
    }
    await displayMailbox(interaction, currentPage, true); // viewType removed
}

async function showReplyModal(interaction, originalMessageId, originalSenderId, currentPage) { // viewType removed
    const modal = new ModalBuilder()
        .setCustomId(`mailbox:replymodal:${originalMessageId}:${originalSenderId}:${currentPage}`) // viewType removed
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

async function processReplyModal(interaction, originalMessageId, originalSenderId, currentPageStr) { // viewType removed
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
