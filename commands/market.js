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
                .setCustomId(`${baseCustomId}:prev:${currentPage - 1}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`${baseCustomId}:next:${currentPage + 1}`)
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
            interaction.customId?.includes('mylisting') ||
            interaction.options?.getSubcommand() === 'buy' ||
            interaction.customId?.startsWith('market:confirmbuy') ||
            interaction.customId?.startsWith('market:cancelbuy')) {
             await db.addUser(interaction.user.id, interaction.user.username);
        }

        if (interaction.isChatInputCommand()) {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'list') await handleMarketList(interaction);
            else if (subcommand === 'browse') await handleMarketBrowse(interaction, interaction.options.getInteger('page') || 1);
            else if (subcommand === 'mylistings') await handleMyListings(interaction, interaction.options.getInteger('page') || 1);
            else if (subcommand === 'buy') await handleMarketBuy(interaction);

        } else if (interaction.isButton()) {
            const [context, command, operation, value, pageStr] = interaction.customId.split(':');

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
            }

        } else if (interaction.type === InteractionType.ModalSubmit) {
            const [context, command, operation, listingIdStr] = interaction.customId.split(':');
            if (context === 'market' && command === 'mylistingmodal' && operation === 'submitadjust') {
                await handleAdjustPriceModalSubmit(interaction, parseInt(listingIdStr));
            }
        } else if (interaction.isStringSelectMenu()) {
             if (interaction.customId === 'market:mylisting:selectaction') {
                const [action, listingIdStr] = interaction.values[0].split(':'); // No page needed here from value
                const listingId = parseInt(listingIdStr);
                if (action === 'cancel') await showCancelConfirmation(interaction, listingId);
                else if (action === 'adjust') await showAdjustPriceModal(interaction, listingId);
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
        const components = total > ITEMS_PER_PAGE_MARKET ? [createPaginationRow(page, totalPages, 'market:browse')] : [];

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
                new StringSelectMenuBuilder().setCustomId('market:mylisting:selectaction').setPlaceholder('Select a listing to manage...').addOptions(selectOptions)
            ));
        }
        if (total > ITEMS_PER_PAGE_MARKET) {
            components.push(createPaginationRow(page, totalPages, 'market:mylistingpage'));
        }
        await replyMethod({ embeds: [embed], components, ephemeral: true });
    } catch (error) {
        logger.error(`[MarketCmd] Error fetching my listings for ${userId}:`, error);
        await replyMethod({ content: '❌ Error fetching your listings.', ephemeral: true, embeds:[], components:[] });
    }
}

async function showCancelConfirmation(interaction, listingId) {
    // interaction here is StringSelectInteraction or ButtonInteraction
    const confirmRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(`market:confirmcancel:yes:${listingId}:1`).setLabel('✅ Yes, Cancel It').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`market:confirmcancel:no:${listingId}:1`).setLabel('❌ No, Keep It').setStyle(ButtonStyle.Secondary)
        );
    // If from select menu, need to use .reply() for the first response to the select menu.
    // If select menu itself was ephemeral, this needs to be a new message.
    // Assuming select menu interaction is deferred or replied to, then followUp.
    // For simplicity, let's assume we always reply to the select menu interaction first.
    if (interaction.isStringSelectMenu()) {
        await interaction.reply({ content: `Manage Listing ID **${listingId}**. Are you sure you want to cancel it?`, components: [confirmRow], ephemeral: true });
    } else { // If triggered by another button (future)
        await interaction.update({ content: `Are you sure you want to cancel listing ID **${listingId}**?`, components: [confirmRow], ephemeral: true });
    }
}

async function processCancelListing(interaction, listingId, pageToRefresh) {
    const result = await db.cancelMarketListing(listingId, interaction.user.id);
    if (result.success) {
        await interaction.update({ content: `✅ Listing ID **${listingId}** has been cancelled. Refreshing your listings...`, components: [] });
        await handleMyListings(interaction, pageToRefresh, true);
    } else {
        let errorMsg = '❌ Error cancelling listing.';
        if (result.error === 'not_found') errorMsg = '❌ Listing not found.';
        else if (result.error === 'not_owner') errorMsg = '❌ You do not own this listing.';
        await interaction.update({ content: errorMsg, components: [] });
    }
}

async function showAdjustPriceModal(interaction, listingId) {
    const modal = new ModalBuilder().setCustomId(`market:mylistingmodal:submitadjust:${listingId}`).setTitle('Adjust Listing Price');
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
                new ButtonBuilder().setCustomId(`market:confirmbuy:yes:${listingId}`).setLabel('✅ Confirm Purchase').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`market:cancelbuy:no:${listingId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
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
