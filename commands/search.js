const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { table, getBorderCharacters } = require('table');
const logger = require('../utils/logger.js');
const CONSTANTS = require('../utils/constants.js');

// Cache for search results, mapping message ID to { filters, worlds }
const searchCache = new Map();

// Function to clear the search cache (e.g., when worlds are added/removed/edited)
function invalidateSearchCache() {
  logger.info("[search.js] Invalidating search cache.");
  searchCache.clear();
}

// Function to show the advanced search modal
async function showSearchModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('search_modal_submit') // Use the ID handled by search.js modal handler
    .setTitle('🔍 Advanced World Search');

  const prefixInput = new TextInputBuilder().setCustomId('prefix').setLabel('World Name Prefix (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  const lockTypeInput = new TextInputBuilder().setCustomId('lockType').setLabel('Lock Type (M/O) (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(1);
  const expiryDayInput = new TextInputBuilder().setCustomId('expiryDay').setLabel('Expiry Day (e.g., Monday) (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  // const expiringDaysInput = new TextInputBuilder().setCustomId('expiringDays').setLabel('Expiring Within Days (0-180) (opt.)').setStyle(TextInputStyle.Short).setRequired(false);
  const daysOwnedInput = new TextInputBuilder().setCustomId('search_days_owned').setLabel('Days Owned (0-180) (opt.)').setStyle(TextInputStyle.Short).setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prefixInput),
    new ActionRowBuilder().addComponents(lockTypeInput),
    new ActionRowBuilder().addComponents(expiryDayInput),
    // new ActionRowBuilder().addComponents(expiringDaysInput),
    new ActionRowBuilder().addComponents(daysOwnedInput)
  );

  await interaction.showModal(modal);
}

// Function to execute the search query against the database
async function performSearch(interaction, filters) {
  const isUpdate = interaction.deferred || interaction.replied;
  const replyOpts = { flags: 1 << 6 }; // Ephemeral

  // Ensure interaction is repliable or deferrable
  if (!isUpdate && !interaction.isRepliable()) {
      logger.warn("[search.js] Interaction not repliable in performSearch.");
      return;
  }

  // Defer if not already handled
  if (!isUpdate) {
    try { await interaction.deferReply(replyOpts); }
    catch (error) { logger.error("[search.js] Failed defer reply for search:", error); return; }
  } else if (interaction.isMessageComponent() && !interaction.deferred) {
      try { await interaction.deferUpdate(replyOpts); }
      catch (error) { logger.error("[search.js] Failed defer update for search component:", error); return; }
  }

  try {
      // Add guildId to filters if searching public worlds (currently defaults to private)
      if (filters.showPublic) filters.guildId = interaction.guildId;
      const worlds = await db.getFilteredWorlds(interaction.user.id, filters);
      // Display results (always treated as an update after deferral)
      await displaySearchResults(interaction, filters, worlds, 1, true);
  } catch (dbError) {
       logger.error("[search.js] Error performing search query:", dbError);
       const errorOptions = { ...replyOpts, content: "❌ An error occurred while searching.", components: [] };
       try {
           if (interaction.deferred || interaction.replied) await interaction.editReply(errorOptions);
           else await interaction.reply(errorOptions); // Fallback
       } catch (replyError) { logger.error("[search.js] Failed to send search error reply:", replyError); }
  }
}

// Function to display search results in a paginated table
async function displaySearchResults(interaction, filters, worlds, page = 1, isUpdate = false) {
  const PAGE_SIZE = CONSTANTS.PAGE_SIZE;
  const totalWorlds = worlds.length;
  const totalPages = Math.ceil(totalWorlds / PAGE_SIZE) || 1;
  page = Math.max(1, Math.min(page, totalPages));
  const replyOpts = { flags: 1 << 6, fetchReply: true };

  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const currentPageWorlds = worlds.slice(startIdx, endIdx);

   // Handle No Results
  if (totalWorlds === 0) {
    const noResultsOptions = { content: '📭 No worlds found matching your search criteria.', components: [], embeds: [], flags: 1 << 6 };
    try {
      if (isUpdate || interaction.deferred || interaction.replied) await interaction.editReply(noResultsOptions);
      else await interaction.reply(noResultsOptions);
    } catch (error) { logger.error("[search.js] Error displaying no search results:", error); }
    return;
  }

  // Build Table
  const headers = ['WORLD', 'OWNED', 'LEFT', 'EXPIRES', 'LOCK'];
  const data = [headers];
  currentPageWorlds.forEach(world => {
    if (!world || !world.expiry_date) { logger.warn("[search.js] Skipping invalid world in results:", world); return; }
    const expiryDate = new Date(world.expiry_date); if (isNaN(expiryDate.getTime())) { logger.warn(`[search.js] Skipping world with invalid date: ${world.name}`); return; }
    const today = new Date(); const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()); const expiryMidnight = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
    const daysLeft = Math.ceil((expiryMidnight - todayMidnight) / 86400000); const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(1, 180 - daysLeft);
    const displayDaysLeft = daysLeft <= 0 ? 'EXP' : daysLeft.toString(); const dayOfWeek = expiryDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }); const formattedExpiry = `${expiryDate.toLocaleDateString('en-US', { timeZone: 'UTC' })} (${dayOfWeek})`;
    const lockTypeDisplay = world.lock_type.charAt(0).toUpperCase();
    const row = [ world.name.toUpperCase(), displayedDaysOwned.toString(), displayDaysLeft, formattedExpiry, lockTypeDisplay ]; data.push(row);
  });

   if (data.length <= 1 && totalWorlds > 0) {
       const errorMsg = { content: ` Gomen 🙏, no valid worlds to display on Page ${page}/${totalPages} of search results.`, components: [], flags: 1 << 6 };
       try { if (isUpdate || interaction.deferred || interaction.replied) await interaction.editReply(errorMsg); else await interaction.reply(errorMsg); }
       catch (e) { logger.error("[search.js] Error sending invalid data message:", e); } return;
   }

  const columnAlignments = ['left', 'right', 'right', 'left', 'center'];
  const config = { columns: columnAlignments.reduce((acc, align, index) => { acc[index] = { alignment: align }; return acc; }, {}), border: getBorderCharacters('norc'), header: { alignment: 'center', content: '🔍 SEARCH RESULTS (Yours Only)' } };
  let tableOutput = '```\n' + table(data, config) + '\n```'; if (tableOutput.length > 1950) tableOutput = tableOutput.substring(0, 1950) + '...```';

  // Build Components
  const components = [];
  const navRow = new ActionRowBuilder();
  const actionRow = new ActionRowBuilder();

   navRow.addComponents(
     new ButtonBuilder().setCustomId(`search_button_prev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
     new ButtonBuilder().setCustomId(`search_button_page_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
     new ButtonBuilder().setCustomId(`search_button_next_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
     new ButtonBuilder().setCustomId(`search_button_refresh_${page}`).setLabel('🔄').setStyle(ButtonStyle.Success)
   );
   components.push(navRow);

  actionRow.addComponents(
    new ButtonBuilder().setCustomId('list_button_view_private_1').setLabel('Back to List').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('search_button_new').setLabel('New Search').setStyle(ButtonStyle.Secondary)
  );
  components.push(actionRow);

  // Prepare and Send Reply/Edit
  const finalReplyOptions = { content: `${tableOutput}\n📊 Found ${totalWorlds} world(s) | Page ${page}/${totalPages}`, components: components, embeds: [], flags: 1 << 6 }; // Ensure ephemeral

  let message;
  try {
    if (isUpdate || interaction.deferred || interaction.replied) { message = await interaction.editReply(finalReplyOptions); }
    else { logger.warn("[search.js] Attempting reply instead of editReply for search results."); message = await interaction.reply(finalReplyOptions); }

    // Cache results using message ID
    const messageId = interaction.message?.id || message?.id;
    if (messageId) {
      logger.debug(`[search.js] Caching search results under key: ${messageId}`);
      searchCache.set(messageId, { filters, worlds });
      setTimeout(() => { if (searchCache.delete(messageId)) { logger.debug(`[search.js] Cleared expired search cache for key: ${messageId}`); } }, CONSTANTS.SEARCH_CACHE_TTL_MINUTES * 60 * 1000);
    } else { logger.warn("[search.js] Could not get message ID to cache search results."); }

  } catch (error) {
    logger.error("[search.js] Error displaying search results / editing reply:", error?.stack || error);
     try { await interaction.followUp({ content: "❌ Sorry, I couldn't display the search results.", flags: 1 << 6 }); }
     catch (followUpError) { logger.error("[search.js] Failed search results error followUp:", followUpError); }
  }
}

// --- Module Exports ---
module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search your tracked worlds with filters')
    .addStringOption(option => option.setName('prefix').setDescription('Filter by world name prefix').setRequired(false))
    .addStringOption(option => option.setName('locktype').setDescription('Filter by lock type (M/O)').setRequired(false)
        .addChoices({ name: 'Main Lock (M)', value: 'mainlock' }, { name: 'Out Lock (O)', value: 'outlock' })
    )
    .addStringOption(option => option.setName('expiryday').setDescription('Filter by day of the week the world expires').setRequired(false)
        .addChoices( { name: 'Monday', value: 'monday' }, { name: 'Tuesday', value: 'tuesday' }, { name: 'Wednesday', value: 'wednesday' }, { name: 'Thursday', value: 'thursday' }, { name: 'Friday', value: 'friday' }, { name: 'Saturday', value: 'saturday' }, { name: 'Sunday', value: 'sunday' } ))
    // .addIntegerOption(option => option.setName('expiringdays').setDescription('Filter worlds expiring within this many days').setRequired(false).setMinValue(0).setMaxValue(180)),
    .addIntegerOption(option => option.setName('daysowned').setDescription('Filter by exact days owned (0-180)').setRequired(false).setMinValue(0).setMaxValue(180)),

  async execute(interaction) {
    const prefix = interaction.options.getString('prefix');
    const lockType = interaction.options.getString('locktype');
    const expiryDay = interaction.options.getString('expiryday');
    // const expiringDays = interaction.options.getInteger('expiringdays');
    const daysOwned = interaction.options.getInteger('daysowned');
    const hasFilters = prefix || lockType || expiryDay || daysOwned !== null;

    if (hasFilters) {
      const filters = { showPublic: false }; // Default to private search
      if (prefix) filters.prefix = prefix;
      if (lockType) filters.lockType = lockType;
      if (expiryDay) filters.expiryDay = expiryDay;
      // if (expiringDays !== null) filters.expiringDays = expiringDays;
      if (daysOwned !== null) filters.daysOwned = daysOwned;
      await performSearch(interaction, filters); // Handles deferral
    } else {
      await showSearchModal(interaction); // Show modal if no filters given
    }
  },

  async handleButton(interaction, params) {
    const action = params[0];
    const currentPage = parseInt(params[1] || '1');
    const replyOpts = { flags: 1 << 6 };
    const cooldown = utils.checkCooldown(interaction.user.id, 'search_btn', 1);
    if (cooldown.onCooldown) { await interaction.reply({ ...replyOpts, content: `⏱️ Wait ${cooldown.timeLeft}s.` }); return; }
    logger.debug(`[search.js] Button action: ${action}, page: ${currentPage}, customId: ${interaction.customId}`);

    if (action === 'new') { await showSearchModal(interaction); return; } // Show modal for new search

    const cacheKey = interaction.message?.id;
    if (!cacheKey) { logger.warn("[search.js] No message ID for cache key."); await interaction.reply({ ...replyOpts, content: "❌ Cannot retrieve search results." }); return; }
    const cachedData = searchCache.get(cacheKey);
    if (!cachedData) { logger.warn(`[search.js] Cache miss for key: ${cacheKey}`); await interaction.update({ content: "Search results expired. Please search again.", components: [], embeds: [], flags: 1 << 6 }); return; }

    const { filters, worlds } = cachedData;
    let targetPage = currentPage;

    if (action === 'prev') targetPage = Math.max(1, currentPage - 1);
    else if (action === 'next') targetPage = Math.min(Math.ceil(worlds.length / CONSTANTS.PAGE_SIZE) || 1, currentPage + 1);
    else if (action === 'refresh') { logger.info(`[search.js] Refreshing search: ${JSON.stringify(filters)}`); if (!interaction.deferred) await interaction.deferUpdate(); await performSearch(interaction, filters); return; }
    else if (action === 'page') { await interaction.deferUpdate(); return; }
    else { logger.warn(`[search.js] Unknown search button action: ${action}`); await interaction.reply({ ...replyOpts, content: "Unknown search action." }); return; }

    if (!interaction.deferred) await interaction.deferUpdate();
    await displaySearchResults(interaction, filters, worlds, targetPage, true);
  },

  async handleModal(interaction, params) {
      const action = params[0]; // Should be 'submit'
      const replyOpts = { flags: 1 << 6 };
      if (action === 'submit') {
          const prefix = interaction.fields.getTextInputValue('prefix');
          const lockTypeInput = interaction.fields.getTextInputValue('lockType');
          const expiryDay = interaction.fields.getTextInputValue('expiryDay');
          // const expiringDays = interaction.fields.getTextInputValue('expiringDays');
          const daysOwnedStr = interaction.fields.getTextInputValue('search_days_owned');

          let lockType = null; const lockTypeUpper = lockTypeInput?.trim().toUpperCase();
          if (lockTypeUpper === 'M') lockType = 'mainlock'; else if (lockTypeUpper === 'O') lockType = 'outlock'; else if (lockTypeUpper !== '') { await interaction.reply({ ...replyOpts, content: "❌ Invalid Lock Type (M/O or blank)." }); return; }

          const filters = { showPublic: false };
          if (prefix?.trim()) filters.prefix = prefix.trim();
          if (lockType) filters.lockType = lockType;

          if (expiryDay?.trim()) {
              const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
              const lowerDay = expiryDay.trim().toLowerCase();
              if (validDays.includes(lowerDay)) { filters.expiryDay = lowerDay; }
              else { await interaction.reply({ ...replyOpts, content: "❌ Invalid Expiry Day (use full name)." }); return; }
          }

          // if (expiringDays?.trim()) { const days = parseInt(expiringDays.trim()); if (!isNaN(days) && days >= 0 && days <= 180) { filters.expiringDays = days; } else { await interaction.reply({ ...replyOpts, content: "❌ Invalid 'Expiring Within Days' (0-180)." }); return; } }
          if (daysOwnedStr?.trim()) {
              const daysOwned = parseInt(daysOwnedStr.trim());
              if (!isNaN(daysOwned) && daysOwned >= 0 && daysOwned <= 180) {
                  filters.daysOwned = daysOwned;
              } else {
                  await interaction.reply({ ...replyOpts, content: "❌ Invalid 'Days Owned' (must be a number between 0-180)." });
                  return;
              }
          }

          // Defer before performing search
          if (!interaction.deferred && !interaction.replied) { await interaction.deferReply(replyOpts); }
          await performSearch(interaction, filters);
      } else { logger.warn(`[search.js] Received unknown modal action: ${action}`); await interaction.reply({ content: 'Unknown form action.', flags: 1 << 6 }); }
  },
  invalidateSearchCache,
  showSearchModal, // Export the modal function
  performSearch // Export the search execution function
};