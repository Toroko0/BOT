const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    InteractionType,
} = require('discord.js');
const { table, getBorderCharacters } = require('table');
const db = require('../database.js');
const logger = require('../utils/logger.js');

const ITEMS_PER_PAGE_MARKET = 5;

function createPaginationRow(currentPage, totalPages, baseCustomId) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`${baseCustomId}_prev_${currentPage - 1}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`${baseCustomId}_next_${currentPage + 1}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages)
        );
}

function formatListingsForEmbed(listings, title, currentPage, totalPages, client) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xDAA520);

    if (!listings || listings.length === 0) {
        embed.setDescription('No listings found.');
    } else {
        listings.forEach(l => {
            const sellerName = l.seller_display_name || 'Unknown Seller';
            let fieldName = `🏷️ ID: ${l.listing_id} | 🔒 ${l.world_name} - ${l.price_dl} DLs`;
            if (l.lock_type) fieldName += ` [${l.lock_type.toUpperCase()}]`;

            let fieldValue = `Seller: ${sellerName}`;
            if (l.listing_note) fieldValue += `\nNote: ${l.listing_note}`;
            fieldValue += `\nListed: <t:${Math.floor(new Date(l.listed_on_date).getTime() / 1000)}:R>`;

            embed.addFields({ name: fieldName, value: fieldValue });
        });
    }

    const iconURL = client.user?.displayAvatarURL();
    if (totalPages > 0) {
        embed.setFooter({ text: `Page ${currentPage} of ${totalPages} • World Watcher Market`, iconURL });
    } else {
         embed.setFooter({ text: `World Watcher Market`, iconURL });
    }
    return embed;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('Interact with the player marketplace.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List a world from your Locks for sale.')
                .addStringOption(o => o.setName('worldname').setDescription('Name of the world from your Locks. Case-insensitive.').setRequired(true))
                .addIntegerOption(o => o.setName('price').setDescription('Price in Diamond Locks (DLs).').setRequired(true).setMinValue(1))
                .addStringOption(o => o.setName('note').setDescription('Optional note for the listing (max 200 chars).').setRequired(false).setMaxLength(200))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('browse')
                .setDescription('Browse worlds on the marketplace.')
                .addIntegerOption(o => o.setName('min_price').setDescription('Minimum price in DLs.').setRequired(false).setMinValue(1))
                .addIntegerOption(o => o.setName('max_price').setDescription('Maximum price in DLs.').setRequired(false).setMinValue(1))
                .addStringOption(o => o.setName('seller').setDescription('Filter by seller (Discord ID or Bot Username).').setRequired(false))
                .addIntegerOption(o => o.setName('page').setDescription('Page number to view.').setRequired(false).setMinValue(1))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('mylistings')
                .setDescription('View and manage your active marketplace listings.')
                .addIntegerOption(o => o.setName('page').setDescription('Page number to view.').setRequired(false).setMinValue(1))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('buy')
                .setDescription('Buy a world from the marketplace.')
                .addIntegerOption(o => o.setName('listing_id').setDescription('The ID of the listing you want to buy.').setRequired(true))
        ),

    async execute(interaction) {
        if (interaction.options?.getSubcommand() === 'mylistings' ||
            interaction.customId?.includes('mylisting') || // This check might need adjustment if 'mylisting' is part of a longer string not at the start
            interaction.options?.getSubcommand() === 'buy' ||
            interaction.customId?.startsWith('market_confirmbuy') || // Updated
            interaction.customId?.startsWith('market_cancelbuy')) { // Updated
             await db.addUser(interaction.user.id, interaction.user.username);
        }

        if (interaction.isChatInputCommand()) {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'list') await handleMarketList(interaction);
            else if (subcommand === 'browse') await handleMarketBrowse(interaction, interaction.options.getInteger('page') || 1);
            else if (subcommand === 'mylistings') await handleMyListings(interaction, interaction.options.getInteger('page') || 1);
            else if (subcommand === 'buy') await handleMarketBuy(interaction);

        } else if (interaction.isButton()) {
            const [context, command, operation, value, pageStr] = interaction.customId.split('_'); // Updated split character

            if (context !== 'market') return;

            const page = parseInt(pageStr) || 1;
            const listingId = parseInt(value) || parseInt(operation);

            if (command === 'browse') {
                await handleMarketBrowse(interaction, parseInt(operation), true);
            } else if (command === 'mylistingpage') {
                await handleMyListings(interaction, parseInt(operation), true);
            } else if (command === 'mylistingaction') {
                if (operation === 'cancel') await showCancelConfirmation(interaction, value);
                else if (operation === 'adjust') await showAdjustPriceModal(interaction, value);
            } else if (command === 'confirmcancel') {
                 if (operation === 'yes') await processCancelListing(interaction, listingId, page);
                 else await interaction.update({ content: 'Cancellation aborted.', components: [], ephemeral: true });
            } else if (command === 'confirmbuy') {
                await processMarketPurchaseButton(interaction, listingId);
            } else if (command === 'cancelbuy') {
                await interaction.update({ content: 'Purchase cancelled.', embeds: [], components: [], ephemeral: true });
            } else if (interaction.customId === 'market_messageSellerModalButton') { // Button to OPEN the modal - Updated
                const modal = new ModalBuilder()
                    .setCustomId('market_messageSellerSubmitModal') // Updated
                    .setTitle('Message Seller');
                const listingIdInput = new TextInputBuilder()
                    .setCustomId('listing_id_input')
                    .setLabel('Listing ID to Message About')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Enter the numeric ID of the listing');
                const messageContentInput = new TextInputBuilder()
                    .setCustomId('message_content_input')
                    .setLabel('Your Message to the Seller')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Type your message here...');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(listingIdInput),
                    new ActionRowBuilder().addComponents(messageContentInput)
                );
                await interaction.showModal(modal);
            }

        } else if (interaction.type === InteractionType.ModalSubmit) {
            const customIdParts = interaction.customId.split('_'); // Updated split character
            const context = customIdParts[0];
            const command = customIdParts[1];
            const operation = customIdParts[2]; // Might be undefined if not present
            const listingIdStrFromCustomId = customIdParts[3]; // Might be undefined

            if (context === 'market' && command === 'mylistingmodal' && operation === 'submitadjust') {
                await handleAdjustPriceModalSubmit(interaction, parseInt(listingIdStrFromCustomId));
            } else if (interaction.customId === 'market_messageSellerSubmitModal') { // Updated
                await interaction.deferReply({ ephemeral: true });
                const listingIdStr = interaction.fields.getTextInputValue('listing_id_input');
                const messageContent = interaction.fields.getTextInputValue('message_content_input');
                const listingId = parseInt(listingIdStr);

                if (isNaN(listingId)) {
                    await interaction.editReply({ content: '❌ Invalid Listing ID. Please enter a numeric ID.', ephemeral: true });
                    return;
                }

                try {
                    const listing = await db.getMarketListingById(listingId);
                    if (!listing) {
                        await interaction.editReply({ content: `❌ Listing with ID **${listingId}** not found.`, ephemeral: true });
                        return;
                    }

                    if (listing.seller_user_id === interaction.user.id) {
                        await interaction.editReply({ content: '❌ You cannot message yourself about your own listing.', ephemeral: true });
                        return;
                    }

                    const buyerDisplayName = interaction.user.displayName || interaction.user.username;
                    const buyerDiscordTag = interaction.user.tag;
                    // Use seller_display_name from listing if available, otherwise try to fetch tag (though less reliable without direct user object)
                    const sellerGreetingName = listing.seller_display_name || `Seller (ID: ${listing.seller_user_id})`;


                    const dmMessageContent = `Hello, ${sellerGreetingName}!\n\nUser **${buyerDisplayName}** (*${buyerDiscordTag}*) is interested in your marketplace listing:\nWorld: **${listing.world_name}**\nPrice: **${listing.price_dl}** DL(s)\nNote: ${listing.listing_note || 'N/A'}\nListing ID: **${listing.listing_id}**\n\nTheir message:\n>>> ${messageContent}`;

                    const sellerDiscordUser = await interaction.client.users.fetch(listing.seller_user_id).catch(() => null);

                    if (!sellerDiscordUser) {
                        await interaction.editReply({ content: '⚠️ Could not find the seller\'s Discord account. They might have left shared servers or their account was deleted. Your message was not sent.', ephemeral: true });
                        return;
                    }

                    let dmFailed = false;
                    await sellerDiscordUser.send(dmMessageContent).catch(async (dmError) => {
                        logger.warn(`[MarketCmd] Failed to DM seller ${listing.seller_user_id} for listing ${listingId}: ${dmError.message}`);
                        dmFailed = true;
                        let replyMessage = '⚠️ Your message could not be directly DMed to the seller. They might have DMs disabled or have blocked the bot.';
                        // Optionally, log the message to a channel if DMs fail, as a fallback.
                        // For now, just inform the buyer.
                        // const fallbackChannel = interaction.client.channels.cache.get('YOUR_FALLBACK_CHANNEL_ID');
                        // if (fallbackChannel) {
                        //    fallbackChannel.send(`Market Message (DM Failed for Listing ${listingId}):\nFrom: ${buyerDiscordTag} (${interaction.user.id})\nTo Seller: ${sellerDiscordUser.tag} (${listing.seller_user_id})\nMessage: ${messageContent}`);
                        //    replyMessage += "\nThe message has been forwarded to bot staff."
                        // }
                        await interaction.editReply({ content: replyMessage, ephemeral: true });
                    });

                    if (!dmFailed) {
                        await interaction.editReply({ content: '✅ Your message has been sent to the seller!', ephemeral: true });
                    }

                } catch (error) {
                    logger.error(`[MarketCmd] Error processing message seller modal for listing ${listingId}:`, error);
                    await interaction.editReply({ content: '❌ An unexpected error occurred while trying to send your message.', ephemeral: true });
                }
            }
        } else if (interaction.isStringSelectMenu()) {
             if (interaction.customId === 'market_mylisting_selectaction') { // Updated
                const [action, listingIdStr] = interaction.values[0].split('_'); // Updated split character
                const listingId = parseInt(listingIdStr);
                if (action === 'cancel') await showCancelConfirmation(interaction, listingId, 1); // Default page 1 for mylistings, origin 'mylisting'
                else if (action === 'adjust') await showAdjustPriceModal(interaction, listingId);
             } else if (interaction.customId.startsWith('market_select_removeBrowseListing')) {
                const currentPage = parseInt(interaction.customId.split('_')[4]); // market_select_removeBrowseListing_PAGE
                const listingIdToRemove = parseInt(interaction.values[0]);

                // It's good practice to defer update quickly for select menus
                // await interaction.deferUpdate({ ephemeral: true }); // No, showCancelConfirmation will .reply

                const listing = await db.getMarketListingById(listingIdToRemove);
                if (!listing) {
                    await interaction.reply({ content: '❌ Error: That listing could not be found. It might have been removed already.', ephemeral: true });
                    return;
                }
                if (listing.seller_user_id !== interaction.user.id) {
                    await interaction.reply({ content: '❌ Error: You are not the seller of this listing.', ephemeral: true });
                    return;
                }
                // pageToRefresh for browse view is currentPage
                await showCancelConfirmation(interaction, listingIdToRemove, currentPage, 'browse');
             }
        }
    },
};

// --- LIST SUBCOMMAND ---
async function handleMarketList(interaction) {
    const userId = interaction.user.id;
    await db.addUser(userId, interaction.user.username);

    const worldNameInput = interaction.options.getString('worldname');
    const priceDl = interaction.options.getInteger('price');
    const note = interaction.options.getString('note') || null;
    const worldNameUpper = worldNameInput.toUpperCase();

    try {
        const lockedWorld = await db.getLockedWorldForListing(userId, worldNameUpper);
        if (!lockedWorld) {
            return interaction.reply({ content: `❌ World **${worldNameInput}** (case-insensitive) not found in your Locks list.`, ephemeral: true });
        }
        const alreadyListed = await db.isWorldListed(lockedWorld.id);
        if (alreadyListed) {
            return interaction.reply({ content: `❌ World **${lockedWorld.world_name}** is already listed.`, ephemeral: true });
        }
        const result = await db.createMarketListing(userId, lockedWorld.id, priceDl, note);
        if (result.success) {
            return interaction.reply({ content: `✅ **${lockedWorld.world_name}** listed for **${priceDl}** DL(s). ${result.listingId ? `Listing ID: **${result.listingId}**` : ''}`, ephemeral: true });
        } else {
            logger.error(`[MarketCmd] Failed to create listing for ${userId}, world ${lockedWorld.id}: ${result.error}`);
            return interaction.reply({ content: `❌ Error listing world: ${result.error === 'already_listed' ? 'Already listed (concurrently?).' : 'Database error.'}`, ephemeral: true });
        }
    } catch (error) {
        logger.error(`[MarketCmd] Exception listing world for ${userId}:`, error);
        return interaction.reply({ content: '❌ Unexpected error listing world.', ephemeral: true });
    }
}

// --- BROWSE SUBCOMMAND ---
async function handleMarketBrowse(interaction, page = 1, isButtonOrSelect = false) {
    // Retrieve options. If from button, options might not be available directly in interaction.
    // This simplified version assumes options are re-evaluated or not needed for simple page navigation.
    // For robust filter preservation with pagination, options would need to be passed in customId or stored.
    const minPrice = interaction.isChatInputCommand() ? interaction.options.getInteger('min_price') : null;
    const maxPrice = interaction.isChatInputCommand() ? interaction.options.getInteger('max_price') : null;
    const sellerArg = interaction.isChatInputCommand() ? interaction.options.getString('seller') : null;

    const dbOptions = { page, pageSize: ITEMS_PER_PAGE_MARKET };
    if (minPrice !== null) dbOptions.min_price = minPrice;
    if (maxPrice !== null) dbOptions.max_price = maxPrice;

    const replyMethod = isButtonOrSelect ? interaction.update.bind(interaction) : interaction.reply.bind(interaction);

    if (sellerArg) {
        const isDiscordId = /^\d{17,19}$/.test(sellerArg);
        if (isDiscordId) {
            dbOptions.seller_user_id = sellerArg;
        } else {
            const sellerUser = await db.getUserByBotUsername(sellerArg);
            if (sellerUser) {
                dbOptions.seller_user_id = sellerUser.id;
            } else {
                return replyMethod({ content: `❌ Seller with bot username "${sellerArg}" not found.`, ephemeral: true, embeds: [], components: [] });
            }
        }
    }

    try {
        let { listings, total } = await db.getMarketListings(dbOptions);
        const totalPages = Math.ceil(total / ITEMS_PER_PAGE_MARKET) || 1;

        if (page > totalPages && totalPages > 0) {
            dbOptions.page = totalPages; page = totalPages;
            const result = await db.getMarketListings(dbOptions);
            listings = result.listings; total = result.total;
        }

        if (!listings || listings.length === 0) {
            const emptyContent = `Page ${page}/${totalPages}\nNo listings found on the market.\nWorld Watcher Market`;
            await replyMethod({ content: emptyContent, components: [], ephemeral: false });
            return;
        }

        const headers = ['ID', 'WORLD', 'PRICE (DLs)', 'SELLER', 'NOTE', 'LOCK TYPE', 'LISTED'];
        const data = [headers];

        listings.forEach(l => {
            data.push([
                l.listing_id.toString(),
                l.world_name,
                l.price_dl.toString(),
                l.seller_display_name || 'Unknown',
                l.listing_note || '-',
                l.lock_type || 'N/A',
                new Date(l.listed_on_date).toLocaleDateString()
            ]);
        });

        const config = {
            columns: [
                { alignment: 'right', width: 5 }, // ID
                { alignment: 'left', width: 15, wrapWord: true }, // WORLD
                { alignment: 'right', width: 10 }, // PRICE (DLs)
                { alignment: 'left', width: 15, wrapWord: true }, // SELLER
                { alignment: 'left', width: 20, wrapWord: true }, // NOTE
                { alignment: 'center', width: 10 }, // LOCK TYPE
                { alignment: 'left', width: 10 }  // LISTED
            ],
            border: getBorderCharacters('norc'),
            header: {
                alignment: 'center',
                content: 'Marketplace Listings',
            }
        };

        let tableOutput = '```\n' + table(data, config) + '\n```';
        if (tableOutput.length > 1900) { // Check if too long for Discord message, leave room for page info
            let cutOff = tableOutput.lastIndexOf('\n', 1850);
            if (cutOff === -1) cutOff = 1850;
            tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...```';
        }

        const finalContent = `Page ${page}/${totalPages}\n${tableOutput}\nWorld Watcher Market`;
        const components = []; // Initialize components array

        // Pagination Row
        if (total > ITEMS_PER_PAGE_MARKET) {
            components.push(createPaginationRow(page, totalPages, 'market_browse'));
        }

        // "Message Seller" Button & "Remove My Listing" Select Menu
        if (listings && listings.length > 0) {
            const actionRow = new ActionRowBuilder();
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('market_messageSellerModalButton')
                    .setLabel('✉️ Message Seller')
                    .setStyle(ButtonStyle.Success)
            );

            const userListingsOnPage = listings.filter(l => l.seller_user_id === interaction.user.id);
            if (userListingsOnPage.length > 0) {
                const selectOptions = userListingsOnPage.map(l => ({
                    label: `ID: ${l.listing_id} - ${l.world_name.substring(0, 40)} (${l.price_dl} DLs)`,
                    description: `Your listing. Note: ${l.listing_note ? l.listing_note.substring(0,30) : 'N/A'}`,
                    value: l.listing_id.toString(),
                }));

                // Ensure select menu options don't exceed 25
                if (selectOptions.length > 25) {
                    selectOptions.splice(25); // Max 25 options
                }

                if (selectOptions.length > 0) { // Only add select menu if there are valid options
                    const removeListingSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`market_select_removeBrowseListing_${page}`)
                        .setPlaceholder('🗑️ Remove one of your listings on this page...')
                        .addOptions(selectOptions);
                    actionRow.addComponents(removeListingSelectMenu); // Add to the same row if space, or new row
                }
            }
             // Add the actionRow to components if it has any components
            if (actionRow.components.length > 0) {
                components.push(actionRow);
            }
        }

        await replyMethod({ content: finalContent, components, ephemeral: false });

    } catch (error) {
        logger.error('[MarketCmd] Error browsing market:', error);
        await replyMethod({ content: '❌ Error fetching market listings.', ephemeral: true, components: [] });
    }
}

// --- MYLISTINGS SUBCOMMAND & MANAGEMENT ---
async function handleMyListings(interaction, page = 1, isButtonOrSelectOrModal = false) {
    const userId = interaction.user.id;
    const options = { seller_user_id: userId, page, pageSize: ITEMS_PER_PAGE_MARKET };
    const replyMethod = isButtonOrSelectOrModal ? interaction.update.bind(interaction) : interaction.reply.bind(interaction);

    try {
        let { listings, total } = await db.getMarketListings(options);
        const totalPages = Math.ceil(total / ITEMS_PER_PAGE_MARKET) || 1;

        if (page > totalPages && totalPages > 0) {
            options.page = totalPages; page = totalPages;
            const result = await db.getMarketListings(options);
            listings = result.listings; total = result.total;
        }

        const embed = formatListingsForEmbed(listings, 'Your Marketplace Listings', page, totalPages, interaction.client);
        const components = [];

        if (listings.length > 0) {
            const selectOptions = listings.map(l => ({
                label: `ID: ${l.listing_id} - ${l.world_name} (${l.price_dl} DLs)`,
                description: l.listing_note ? `Note: ${l.listing_note.substring(0,40)}` : `Listed: ${new Date(l.listed_on_date).toLocaleDateString()}`,
                value: `manage:${l.listing_id}` // Action decided by subsequent ephemeral message with buttons
            }));
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('market_mylisting_selectaction').setPlaceholder('Select a listing to manage...').addOptions(selectOptions) // Updated
            ));
        }
        if (total > ITEMS_PER_PAGE_MARKET) {
            components.push(createPaginationRow(page, totalPages, 'market_mylistingpage')); // Updated
        }
        await replyMethod({ embeds: [embed], components, ephemeral: true });
    } catch (error) {
        logger.error(`[MarketCmd] Error fetching my listings for ${userId}:`, error);
        await replyMethod({ content: '❌ Error fetching your listings.', ephemeral: true, embeds:[], components:[] });
    }
}

async function showCancelConfirmation(interaction, listingId, pageToRefresh = 1, origin = 'mylisting') {
    // interaction here is StringSelectInteraction or ButtonInteraction
    let yesCustomId, noCustomId;
    if (origin === 'browse') {
        yesCustomId = `market_confirmcancelbrowse_yes_${listingId}_${pageToRefresh}`;
        noCustomId = `market_confirmcancelbrowse_no_${listingId}_${pageToRefresh}`;
    } else { // Default for 'mylisting' or any other origin
        yesCustomId = `market_confirmcancel_yes_${listingId}_${pageToRefresh}`;
        noCustomId = `market_confirmcancel_no_${listingId}_${pageToRefresh}`;
    }

    const confirmRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(yesCustomId).setLabel('✅ Yes, Cancel It').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(noCustomId).setLabel('❌ No, Keep It').setStyle(ButtonStyle.Secondary)
        );

    const content = `Are you sure you want to cancel listing ID **${listingId}**? This action cannot be undone.`;

    // For both select menu and button interactions that call this,
    // if they haven't been replied to or deferred, they should be.
    // showCancelConfirmation is now mostly called after a select menu choice, which needs a reply.
    // Or by mylistingaction button which also needs a reply.
    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content, components: [confirmRow], ephemeral: true });
    } else {
        // If the interaction that led here was deferred (e.g. a button that called deferUpdate)
        // or already replied (less likely for this flow now), use editReply or followUp.
        // Since the select menu for browse will be the first interaction for this flow,
        // and mylistingaction button also is usually a first reply.
        // This path implies something already happened.
        // To be safe, if it was deferred, edit the original deferred response.
        // If it was replied (e.g. original select menu for mylistings which is ephemeral), use followUp.
        // For browse select menu, it will use the if block above.
        // For mylistings select menu, it will use the if block.
        // For mylistings 'cancel' button (if it directly calls this), it will use the if block.
        // This 'else' might be for more complex chained interactions not currently in use.
        logger.warn(`[showCancelConfirmation] Interaction ${interaction.id} was already replied or deferred. Attempting followUp.`);
        await interaction.followUp({ content, components: [confirmRow], ephemeral: true });
    }
}


async function processCancelListing(interaction, listingId, pageToRefresh) {
    // This function is for cancelling from 'mylistings' view
    await interaction.deferUpdate(); // Defer the button interaction that led here
    const result = await db.cancelMarketListing(listingId, interaction.user.id);
    if (result.success) {
        await interaction.update({ content: `✅ Listing ID **${listingId}** has been cancelled. Refreshing your listings...`, components: [] });
        await handleMyListings(interaction, pageToRefresh, true);
    } else {
        let errorMsg = '❌ Error cancelling listing.';
        if (result.error === 'not_found') errorMsg = '❌ Listing not found.';
        else if (result.error === 'not_owner') errorMsg = '❌ You do not own this listing.';
        await interaction.editReply({ content: errorMsg, components: [] }); // Use editReply due to deferUpdate
    }
}

async function processCancelBrowseListing(interaction, listingId, pageToRefresh) {
    // This function is for cancelling from 'browse' view
    await interaction.deferUpdate(); // Defer the button interaction that led here
    const result = await db.cancelMarketListing(listingId, interaction.user.id);
    if (result.success) {
        // Let handleMarketBrowse do the reply/update.
        // Send a temporary confirmation before refreshing.
        await interaction.editReply({ content: `✅ Listing ID **${listingId}** cancelled. Refreshing browse view...`, components: []});
        await handleMarketBrowse(interaction, pageToRefresh, true);
    } else {
        let errorMsg = '❌ Error cancelling listing from browse view.';
        if (result.error === 'not_found') errorMsg = '❌ Listing not found (already removed?).';
        else if (result.error === 'not_owner') errorMsg = '❌ You do not own this listing (or rights changed).';
        await interaction.editReply({ content: errorMsg, components: [] }); // Use editReply due to deferUpdate
    }
}


async function showAdjustPriceModal(interaction, listingId) {
    const modal = new ModalBuilder().setCustomId(`market_mylistingmodal_submitadjust_${listingId}`).setTitle('Adjust Listing Price'); // Updated
    const newPriceInput = new TextInputBuilder().setCustomId('new_price_dl').setLabel("New Price in Diamond Locks (DLs)").setStyle(TextInputStyle.Short).setPlaceholder("Enter a positive number").setRequired(true).setMinLength(1);
    modal.addComponents(new ActionRowBuilder().addComponents(newPriceInput));
    await interaction.showModal(modal);
}

async function handleAdjustPriceModalSubmit(interaction, listingId) {
    const newPriceStr = interaction.fields.getTextInputValue('new_price_dl');
    const newPrice = parseInt(newPriceStr);

    if (isNaN(newPrice) || newPrice <= 0 || !Number.isInteger(newPrice)) {
        return interaction.reply({ content: '❌ Invalid price. Must be a positive whole number.', ephemeral: true });
    }
    try {
        const result = await db.updateMarketListingPrice(listingId, interaction.user.id, newPrice);
        let replyOptions = { ephemeral: true };
        if (result.success) {
            replyOptions.content = `✅ Price for listing ID **${listingId}** updated to **${newPrice}** DLs.`;
        } else {
            if (result.error === 'invalid_price') replyOptions.content = '❌ Invalid price format.';
            else if (result.error === 'not_found') replyOptions.content = '❌ Listing not found.';
            else if (result.error === 'not_owner') replyOptions.content = '❌ You do not own this listing.';
            else replyOptions.content = '❌ Error updating price.';
        }
        await interaction.reply(replyOptions);
        // To refresh mylistings, we can't directly call handleMyListings as it needs the original interaction context.
        // A follow-up is better.
        if (result.success) {
             await interaction.followUp({ content: "Your listings view will update next time you run `/market mylistings`.", ephemeral: true });
        }
    } catch (error) {
        logger.error(`[MarketCmd] Exception updating price for listing ${listingId}:`, error);
        await interaction.reply({ content: '❌ Unexpected error updating price.', ephemeral: true });
    }
}

// --- BUY SUBCOMMAND ---
async function handleMarketBuy(interaction) {
    const buyerUserId = interaction.user.id;
    await db.addUser(buyerUserId, interaction.user.username); // Ensure buyer exists

    const listingId = interaction.options.getInteger('listing_id');

    try {
        const listing = await db.getMarketListingById(listingId);
        if (!listing) {
            return interaction.reply({ content: '❌ Listing not found.', ephemeral: true });
        }
        if (listing.seller_user_id === buyerUserId) {
            return interaction.reply({ content: '❌ You cannot buy your own listing.', ephemeral: true });
        }

        const buyerBalance = await db.getUserDiamondLocksBalance(buyerUserId);
        if (buyerBalance < listing.price_dl) {
            return interaction.reply({ content: `❌ You have insufficient Diamond Locks. You need ${listing.price_dl} DLs, but you have ${buyerBalance} DLs.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🛒 Confirm Purchase')
            .setColor(0x00FF00) // Green
            .setDescription(`Are you sure you want to buy **${listing.world_name}** for **${listing.price_dl}** DLs from **${listing.seller_display_name}**?`)
            .addFields({ name: 'World Name', value: listing.world_name, inline: true }, { name: 'Price', value: `${listing.price_dl} DLs`, inline: true }, { name: 'Seller', value: listing.seller_display_name, inline: true });
        if (listing.listing_note) {
            embed.addFields({ name: 'Listing Note', value: listing.listing_note });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(`market_confirmbuy_yes_${listingId}`).setLabel('✅ Confirm Purchase').setStyle(ButtonStyle.Success), // Updated
                new ButtonBuilder().setCustomId(`market_cancelbuy_no_${listingId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger) // Updated
            );
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    } catch (error) {
        logger.error(`[MarketCmd] Error preparing to buy listing ${listingId}:`, error);
        await interaction.reply({ content: '❌ Error fetching listing details for purchase.', ephemeral: true });
    }
}

async function processMarketPurchaseButton(interaction, listingId) {
    // Re-fetch listing to ensure it's still available at the same price, etc.
    const listing = await db.getMarketListingById(listingId);
    const buyerUserId = interaction.user.id;
    const buyerUsername = interaction.user.username;


    if (!listing) {
        return interaction.update({ content: '❌ This listing is no longer available.', embeds: [], components: [], ephemeral: true });
    }
    if (listing.seller_user_id === buyerUserId) {
        return interaction.update({ content: '❌ You cannot buy your own listing.', embeds: [], components: [], ephemeral: true });
    }
    const buyerBalance = await db.getUserDiamondLocksBalance(buyerUserId);
    if (buyerBalance < listing.price_dl) {
        return interaction.update({ content: `❌ Your DL balance is too low. You need ${listing.price_dl} DLs, but have ${buyerBalance}.`, embeds: [], components: [], ephemeral: true });
    }

    try {
        // seller_display_name contains bot username or discord tag
        const result = await db.processMarketPurchase(buyerUserId, listing.seller_user_id, listing.listing_id, listing.locked_world_id, listing.price_dl, buyerUsername, listing.seller_display_name, listing.world_name);

        if (result.success) {
            await interaction.update({ content: `✅ Congratulations! You have purchased **${result.worldName}** for **${listing.price_dl}** DLs.`, embeds: [], components: [], ephemeral: true });

            // DM Seller (best effort)
            try {
                const sellerUser = await interaction.client.users.fetch(listing.seller_user_id);
                if (sellerUser) {
                    await sellerUser.send(`🔔 Your marketplace listing for **${result.worldName}** has been sold to **${buyerUsername}** for **${listing.price_dl}** DLs!`);
                }
            } catch (dmError) {
                logger.warn(`[MarketCmd] Failed to DM seller ${listing.seller_user_id} about purchase of listing ${listingId}:`, dmError.message);
            }
        } else {
            let errorMsg = '❌ Purchase failed.';
            if (result.error === 'insufficient_funds') errorMsg = '❌ You do not have enough Diamond Locks for this purchase.';
            else if (result.error === 'listing_not_found' || result.error === 'listing_not_found_during_delete') errorMsg = '❌ This listing is no longer available.';
            else if (result.error === 'world_transfer_failed') errorMsg = '❌ Failed to transfer world ownership. Please contact support.';
            else errorMsg = '❌ An unexpected database error occurred during purchase.';
            await interaction.update({ content: errorMsg, embeds: [], components: [], ephemeral: true });
        }
    } catch (error) { // Catch errors from processMarketPurchase if it throws directly
        logger.error(`[MarketCmd] Exception processing purchase for listing ${listingId}:`, error);
        await interaction.update({ content: '❌ An critical error occurred while processing your purchase.', embeds: [], components: [], ephemeral: true });
    }
}
