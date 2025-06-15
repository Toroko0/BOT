// market.js

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, InteractionType, StringSelectMenuOptionBuilder
} = require('discord.js');
const { table, getBorderCharacters } = require('table');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const utils = require('../utils.js');
const CONSTANTS = require('../utils/constants.js');

const ITEMS_PER_PAGE = CONSTANTS.PAGE_SIZE_MARKET || 5;

// --- Helper Functions ---
function encodeMarketOptions(options) {
    if (!options || Object.keys(options).length === 0) return 'e30';
    return Buffer.from(JSON.stringify(options)).toString('base64url');
}

function decodeMarketOptions(encodedString) {
    if (!encodedString || encodedString === 'e30') return {};
    try {
        return JSON.parse(Buffer.from(encodedString, 'base64url').toString('utf8'));
    } catch (e) {
        logger.error('[market.js] Failed to decode market options:', e);
        return {};
    }
}

// --- Subcommand Handlers ---
async function handleMarketList(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const worldName = interaction.options.getString('worldname');
    const priceDl = interaction.options.getInteger('price');
    const note = interaction.options.getString('note') || null;

    const lockedWorld = await db.getLockedWorldForListing(interaction.user.id, worldName.toUpperCase());
    if (!lockedWorld) {
        return interaction.editReply({ content: `❌ World "**${worldName}**" not found in your Locks list.` });
    }

    const alreadyListed = await db.isWorldListed(lockedWorld.id);
    if (alreadyListed) {
        return interaction.editReply({ content: `❌ World **${lockedWorld.world_name}** is already listed.` });
    }

    const result = await db.createMarketListing(interaction.user.id, lockedWorld.id, priceDl, note);
    if (result.success) {
        return interaction.editReply({ content: `✅ **${lockedWorld.world_name}** listed for **${priceDl}** DL(s). Listing ID: **${result.listingId}**` });
    } else {
        logger.error(`[market.js] Failed to create listing: ${result.error}`);
        return interaction.editReply({ content: `❌ Error listing world: ${result.error === 'already_listed' ? 'Already listed.' : 'Database error.'}` });
    }
}

async function handleMarketBrowse(interaction, page = 1, browseOptions = {}) {
    const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
    if (isUpdate) {
        if (!interaction.deferred) await interaction.deferUpdate();
    } else {
        await interaction.deferReply(); // Browse is public
    }

    const dbOptions = { ...browseOptions, page, pageSize: ITEMS_PER_PAGE };
    let { listings, total } = await db.getMarketListings(dbOptions);
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1;
    page = Math.max(1, Math.min(page, totalPages));

    const embed = new EmbedBuilder().setColor(0xDAA520).setTitle('🛒 World Watcher Marketplace');
    const components = [];
    const encodedOpts = encodeMarketOptions(browseOptions);

    if (total === 0) {
        embed.setDescription('No listings found.');
    } else {
        listings.forEach(l => {
            embed.addFields({
                name: `ID: ${l.listing_id} | ${l.world_name} - ${l.price_dl} DLs`,
                value: `Seller: ${l.seller_display_name}\nNote: *${l.listing_note || 'None'}*\nListed: <t:${Math.floor(new Date(l.listed_on_date).getTime() / 1000)}:R>`
            });
        });
        embed.setFooter({ text: `Page ${page} of ${totalPages}` });
        
        const actionRow = new ActionRowBuilder();
        const userListingsOnPage = listings.filter(l => l.seller_user_id === interaction.user.id);
        if(userListingsOnPage.length > 0) {
            const selectOptions = userListingsOnPage.map(l => new StringSelectMenuOptionBuilder().setLabel(`Remove My Listing: ${l.world_name}`).setValue(l.listing_id.toString()));
            actionRow.addComponents(new StringSelectMenuBuilder().setCustomId(`market_select_remove_${encodedOpts}`).setPlaceholder('🗑️ Remove one of your listings...').addOptions(selectOptions));
        }
        components.push(actionRow);
    }
    
    if (totalPages > 1) {
        components.unshift(utils.createPaginationRow(page, totalPages, `market_button_browse_${encodedOpts}`));
    }
    
    // Add "Message Seller" button regardless of listings
    const msgSellerRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('market_button_messageseller').setLabel('✉️ Message a Seller').setStyle(ButtonStyle.Success));
    components.push(msgSellerRow);

    await interaction.editReply({ embeds: [embed], components });
}

async function handleMyListings(interaction, page = 1) {
    const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
    if (isUpdate) {
        if (!interaction.deferred) await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }

    const { listings, total } = await db.getMarketListings({ seller_user_id: interaction.user.id, page, pageSize: ITEMS_PER_PAGE });
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1;

    const embed = new EmbedBuilder().setTitle('Your Marketplace Listings').setColor(0xDAA520);
    const components = [];

    if (total === 0) {
        embed.setDescription('You have no active listings.');
    } else {
        listings.forEach(l => {
            embed.addFields({ name: `ID: ${l.listing_id} | ${l.world_name} - ${l.price_dl} DLs`, value: `Listed: <t:${Math.floor(new Date(l.listed_on_date).getTime() / 1000)}:R>` });
        });
        embed.setFooter({ text: `Page ${page} of ${totalPages}` });

        const selectOptions = listings.map(l => new StringSelectMenuOptionBuilder().setLabel(`Manage: ${l.world_name}`).setValue(l.listing_id.toString()));
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('market_select_manage').setPlaceholder('Select a listing to manage...').addOptions(selectOptions)));
    }
    if (totalPages > 1) {
        components.push(utils.createPaginationRow(page, totalPages, 'market_button_mylistings'));
    }

    await interaction.editReply({ embeds: [embed], components, ephemeral: true });
}

async function handleMarketBuy(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const listingId = interaction.options.getInteger('listing_id');
    const listing = await db.getMarketListingById(listingId);

    if (!listing) return interaction.editReply({ content: '❌ Listing not found.' });
    if (listing.seller_user_id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot buy your own listing.' });

    const buyerBalance = await db.getUserDiamondLocksBalance(interaction.user.id);
    if (buyerBalance < listing.price_dl) {
        return interaction.editReply({ content: `❌ Insufficient funds. You need ${listing.price_dl} DLs, but you have ${buyerBalance} DLs.` });
    }

    const embed = new EmbedBuilder().setTitle('🛒 Confirm Purchase').setColor(0x00FF00)
        .setDescription(`Buy **${listing.world_name}** for **${listing.price_dl}** DLs from **${listing.seller_display_name}**?`);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`market_button_confirmbuy_yes_${listingId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`market_button_confirmbuy_no_${listingId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
}


// --- Interaction Handlers ---
module.exports = {
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('Interact with the player marketplace.')
        .addSubcommand(sub => sub.setName('list').setDescription('List a world from your Locks for sale.').addStringOption(o => o.setName('worldname').setDescription('Name of the world.').setRequired(true)).addIntegerOption(o => o.setName('price').setDescription('Price in DLs.').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('note').setDescription('Optional note.').setMaxLength(200)))
        .addSubcommand(sub => sub.setName('browse').setDescription('Browse worlds on the market.')
            .addIntegerOption(o => o.setName('min_price').setMinValue(1).setDescription('Minimum price to filter by.'))
            .addIntegerOption(o => o.setName('max_price').setMinValue(1).setDescription('Maximum price to filter by.'))
            .addUserOption(o => o.setName('seller').setDescription('Filter listings by a specific seller.'))
            .addIntegerOption(o => o.setName('page').setMinValue(1)))
        .addSubcommand(sub => sub.setName('mylistings').setDescription('View and manage your active listings.').addIntegerOption(o => o.setName('page').setMinValue(1)))
        .addSubcommand(sub => sub.setName('buy').setDescription('Buy a world from the market.').addIntegerOption(o => o.setName('listing_id').setRequired(true))),
    async execute(interaction) {
        await db.addUser(interaction.user.id, interaction.user.username);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'list') await handleMarketList(interaction);
        else if (subcommand === 'browse') {
            const browseOptions = {
                min_price: interaction.options.getInteger('min_price'),
                max_price: interaction.options.getInteger('max_price'),
                seller_user_id: interaction.options.getUser('seller')?.id,
            };
            Object.keys(browseOptions).forEach(key => browseOptions[key] == null && delete browseOptions[key]);
            await handleMarketBrowse(interaction, interaction.options.getInteger('page') || 1, browseOptions);
        }
        else if (subcommand === 'mylistings') await handleMyListings(interaction, interaction.options.getInteger('page') || 1);
        else if (subcommand === 'buy') await handleMarketBuy(interaction);
    },
    async handleInteraction(interaction) {
        const [context, command, ...args] = interaction.customId.split('_');
        if (context !== 'market') return;

        if (interaction.isButton()) {
            const operation = command;
            switch(operation) {
                case 'button': {
                    const [subCommand, ...btnArgs] = args;
                    if (subCommand === 'browse') await handleMarketBrowse(interaction, parseInt(btnArgs[1]), decodeMarketOptions(btnArgs[0]));
                    else if (subCommand === 'mylistings') await handleMyListings(interaction, parseInt(btnArgs[0]));
                    else if (subCommand === 'confirmbuy') {
                        const [confirm, listingId] = btnArgs;
                        if(confirm === 'no') return interaction.update({ content: 'Purchase cancelled.', components: [], embeds: [] });
                        
                        await interaction.deferUpdate();
                        const listing = await db.getMarketListingById(parseInt(listingId));
                        if (!listing) return interaction.editReply({ content: '❌ This listing is no longer available.', components:[], embeds:[] });
                        const result = await db.processMarketPurchase(interaction.user.id, listing.seller_user_id, listing.listing_id, listing.locked_world_id, listing.price_dl, interaction.user.username, listing.seller_display_name, listing.world_name);
                        if (result.success) {
                            await interaction.editReply({ content: `✅ Congratulations! You have purchased **${result.worldName}**.`, components:[], embeds:[] });
                            const sellerUser = await interaction.client.users.fetch(listing.seller_user_id).catch(() => null);
                            if (sellerUser) sellerUser.send(`🔔 Your listing for **${result.worldName}** has been sold to **${interaction.user.username}** for **${listing.price_dl}** DLs!`).catch(e => logger.warn('Failed to DM seller', e));
                        } else {
                            await interaction.editReply({ content: `❌ Purchase Failed: ${result.error}`, components:[], embeds:[] });
                        }
                    }
                    else if (subCommand === 'messageseller') {
                        const modal = new ModalBuilder().setCustomId('market_modal_sendmessage').setTitle('Message a Seller');
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('listing_id').setLabel('Listing ID').setStyle(TextInputStyle.Short).setRequired(true)),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message_content').setLabel('Your Message').setStyle(TextInputStyle.Paragraph).setRequired(true))
                        );
                        await interaction.showModal(modal);
                    }
                    break;
                }
                case 'confirmcancel': {
                    const [confirm, listingId, origin, page, encodedOptions] = args;
                    if(confirm === 'no') return interaction.update({ content: 'Cancellation aborted.', components: [] });
                    await interaction.deferUpdate();
                    const result = await db.cancelMarketListing(parseInt(listingId), interaction.user.id);
                    if(result.success) {
                        await interaction.editReply({ content: `✅ Listing ${listingId} cancelled. Refreshing list...`, components: [] });
                        if(origin === 'browse') await handleMarketBrowse(interaction, parseInt(page), decodeMarketOptions(encodedOptions));
                        else await handleMyListings(interaction, parseInt(page));
                    } else {
                        await interaction.editReply({ content: `❌ Failed to cancel: ${result.error}`, components: [] });
                    }
                    break;
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            const [operation, ...selectArgs] = args;
            const listingId = parseInt(interaction.values[0]);
            switch(operation) {
                case 'select': {
                    const [subCommand, ...selectSubArgs] = selectArgs;
                    if(subCommand === 'manage') {
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`market_button_confirmcancel_yes_${listingId}_mylistings_1`).setLabel('🗑️ Cancel Listing').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`market_modal_adjustprice_${listingId}`).setLabel('✏️ Adjust Price').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`market_button_confirmcancel_no_${listingId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
                        );
                        await interaction.reply({ content: `Managing Listing ID **${listingId}**.`, components: [row], ephemeral: true });
                    } else if (subCommand === 'remove') {
                        const [encodedOptions] = selectSubArgs;
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`market_button_confirmcancel_yes_${listingId}_browse_1_${encodedOptions}`).setLabel('✅ Yes, Cancel It').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`market_button_confirmcancel_no_${listingId}`).setLabel('❌ No, Keep It').setStyle(ButtonStyle.Secondary)
                        );
                        await interaction.reply({ content: `Are you sure you want to cancel your listing **ID ${listingId}**?`, components: [row], ephemeral: true });
                    }
                    break;
                }
            }
        } else if (interaction.isModalSubmit()) {
            const [operation, subCommand, ...modalArgs] = args;
             if (operation === 'modal') {
                if (subCommand === 'sendmessage') {
                    await interaction.deferReply({ ephemeral: true });
                    const listingId = parseInt(interaction.fields.getTextInputValue('listing_id'));
                    const content = interaction.fields.getTextInputValue('message_content');
                    if(isNaN(listingId)) return interaction.editReply('Invalid listing ID.');
                    const listing = await db.getMarketListingById(listingId);
                    if(!listing) return interaction.editReply('Listing not found.');
                    if(listing.seller_user_id === interaction.user.id) return interaction.editReply('You cannot message yourself.');
                    
                    const seller = await interaction.client.users.fetch(listing.seller_user_id).catch(() => null);
                    if(!seller) return interaction.editReply('Could not find seller.');

                    const dmContent = `Message from ${interaction.user.tag} regarding your listing for **${listing.world_name}** (ID: ${listingId}):\n\n>>> ${content}`;
                    await seller.send(dmContent).then(() => {
                        interaction.editReply('✅ Message sent!');
                    }).catch(() => {
                        interaction.editReply('⚠️ Could not DM the seller. They may have DMs disabled.');
                    });
                } else if (subCommand === 'adjustprice') {
                    const listingId = parseInt(modalArgs[0]);
                    const newPrice = parseInt(interaction.fields.getTextInputValue('new_price'));
                    if(isNaN(newPrice) || newPrice <= 0) return interaction.reply({ content: 'Invalid price.', ephemeral: true });
                    const result = await db.updateMarketListingPrice(listingId, interaction.user.id, newPrice);
                    if(result.success) {
                        await interaction.reply({ content: `✅ Price for listing ${listingId} updated to ${newPrice} DLs.`, ephemeral: true });
                        // Could follow-up with a refreshed mylistings view here.
                    } else {
                        await interaction.reply({ content: `❌ Failed to update price: ${result.error}`, ephemeral: true });
                    }
                }
            }
        }
    }
};
