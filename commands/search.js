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
async function showSearchModal(interaction, isPublic = true) {
  const modalId = isPublic ? 'search_modal_submit_public' : 'search_modal_submit_private';
  const title = isPublic ? '🔍 Search All Worlds' : '🔍 Search Your Worlds';

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(title);

  const prefixInput = new TextInputBuilder().setCustomId('prefix').setLabel('World Name Prefix (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  const lengthInput = new TextInputBuilder().setCustomId('length').setLabel('Exact World Name Length (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  const lockTypeInput = new TextInputBuilder().setCustomId('lockType').setLabel('Lock Type (M/O) (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(1);
  const expiryDayInput = new TextInputBuilder().setCustomId('expiryDay').setLabel('Expiry Day (e.g., Monday) (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  const daysOwnedInput = new TextInputBuilder().setCustomId('search_days_owned').setLabel('Days Owned (0-180) (opt.)').setStyle(TextInputStyle.Short).setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prefixInput),
    new ActionRowBuilder().addComponents(lengthInput),
    new ActionRowBuilder().addComponents(lockTypeInput),
    new ActionRowBuilder().addComponents(expiryDayInput),
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
      // No longer automatically adding added_by_username filter here.
      // It's expected to be in the `filters` object if a private search is intended.
      logger.info(`[search.js] Performing search with filters: ${JSON.stringify(filters)}`);


      // Fetch only the first page and total count initially
      const { worlds: firstPageWorlds, total: totalMatchingWorlds } = await db.getFilteredWorlds(filters, 1, CONSTANTS.PAGE_SIZE);

      // Display results (always treated as an update after deferral)
      await displaySearchResults(interaction, filters, firstPageWorlds, totalMatchingWorlds, 1, true);
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
async function displaySearchResults(interaction, filters, currentPageWorlds, totalWorlds, page = 1, isUpdate = false) {
  const PAGE_SIZE = CONSTANTS.PAGE_SIZE;
  // totalWorlds is now a parameter
  const totalPages = Math.ceil(totalWorlds / PAGE_SIZE) || 1;
  page = Math.max(1, Math.min(page, totalPages)); // Ensure page is still valid, esp. if totalWorlds is 0
  const replyOpts = { flags: 1 << 6, fetchReply: true };

  // currentPageWorlds is now a parameter, no need to slice 'worlds'
  // const startIdx = (page - 1) * PAGE_SIZE;
  // const endIdx = startIdx + PAGE_SIZE;
  // const currentPageWorlds = worlds.slice(startIdx, endIdx);

   // Handle No Results
  if (totalWorlds === 0) { // Check totalWorlds passed as parameter
    const noResultsOptions = { content: '📭 No worlds found matching your search criteria.', components: [], embeds: [], flags: 1 << 6 };
    try {
      if (isUpdate || interaction.deferred || interaction.replied) await interaction.editReply(noResultsOptions);
      else await interaction.reply(noResultsOptions);
    } catch (error) { logger.error("[search.js] Error displaying no search results:", error); }
    return;
  }

  // Build Table
  const { data, config } = utils.formatWorldsToTable(currentPageWorlds, 'pc', 'search', 0, interaction.user.username);
  let tableOutput = '```\n' + table(data, config) + '\n```';

   if (data.length <= 1 && totalWorlds > 0) {
       const errorMsg = { content: ` Gomen 🙏, no valid worlds to display on Page ${page}/${totalPages} of search results.`, components: [], flags: 1 << 6 };
       try { if (isUpdate || interaction.deferred || interaction.replied) await interaction.editReply(errorMsg); else await interaction.reply(errorMsg); }
       catch (e) { logger.error("[search.js] Error sending invalid data message:", e); } return;
   }

  // Build Components
  const components = [];
  const scopeRow = new ActionRowBuilder();
  const navRow = new ActionRowBuilder();
  const actionRow = new ActionRowBuilder();

  const isPublicSearch = !filters.added_by_username;

  scopeRow.addComponents(
      new ButtonBuilder().setCustomId('search_toggle_public').setLabel('🌐 Search All Worlds').setStyle(ButtonStyle.Success).setDisabled(isPublicSearch),
      new ButtonBuilder().setCustomId('search_toggle_private').setLabel('👤 Search My Worlds').setStyle(ButtonStyle.Primary).setDisabled(!isPublicSearch)
  );
  components.push(scopeRow);


   navRow.addComponents(
     new ButtonBuilder().setCustomId(`search_prev_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
     new ButtonBuilder().setCustomId(`search_page_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
     new ButtonBuilder().setCustomId(`search_next_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
     new ButtonBuilder().setCustomId(`search_refresh_${page}`).setLabel('🔄').setStyle(ButtonStyle.Success)
   );
   components.push(navRow);

  actionRow.addComponents(
    new ButtonBuilder().setCustomId('list_view_private_1').setLabel('Back to List').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`search_new_${isPublicSearch ? 'public' : 'private'}`).setLabel('New Search').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('search_exportall').setLabel('📄 Export All Names').setStyle(ButtonStyle.Success)
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
      logger.debug(`[search.js] Caching search results under key: ${messageId} - Filters: ${JSON.stringify(filters)}, Total: ${totalWorlds}`);
      searchCache.set(messageId, { filters, totalWorlds }); // Store totalWorlds instead of the full worlds array
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
    .setDescription('Search for worlds with advanced filters.')
    .addBooleanOption(option =>
        option.setName('public')
            .setDescription("Set to false to search only your own worlds. Defaults to true (everyone's).")
            .setRequired(false))
    .addStringOption(option => option.setName('prefix').setDescription('Filter by world name prefix').setRequired(false))
    .addStringOption(option => option.setName('locktype').setDescription('Filter by lock type (M/O)').setRequired(false)
        .addChoices({ name: 'Main Lock (M)', value: 'mainlock' }, { name: 'Out Lock (O)', value: 'outlock' })
    )
    .addStringOption(option => option.setName('expiryday').setDescription('Filter by day of the week the world expires').setRequired(false)
        .addChoices( { name: 'Monday', value: 'monday' }, { name: 'Tuesday', value: 'tuesday' }, { name: 'Wednesday', value: 'wednesday' }, { name: 'Thursday', value: 'thursday' }, { name: 'Friday', value: 'friday' }, { name: 'Saturday', value: 'saturday' }, { name: 'Sunday', value: 'sunday' } ))
    .addIntegerOption(option => option.setName('daysowned').setDescription('Filter by exact days owned (0-180)').setRequired(false).setMinValue(0).setMaxValue(180))
    .addIntegerOption(option => option.setName('length').setDescription('Filter by exact world name length').setRequired(false).setMinValue(1)),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? true;
    const prefix = interaction.options.getString('prefix');
    const lockType = interaction.options.getString('locktype');
    const expiryDay = interaction.options.getString('expiryday');
    const daysOwned = interaction.options.getInteger('daysowned');
    const length = interaction.options.getInteger('length');
    const hasFilters = prefix || lockType || expiryDay || daysOwned !== null || length !== null;

    if (hasFilters) {
        const filters = {};
        if (!isPublic) {
            filters.added_by_username = interaction.user.username;
        }
        if (prefix) filters.prefix = prefix;
        if (lockType) filters.lockType = lockType;
        if (expiryDay) filters.expiryDay = expiryDay;
        if (daysOwned !== null) filters.daysOwned = daysOwned;
        if (length !== null) filters.nameLength = length;

        await performSearch(interaction, filters);
    } else {
        await showSearchModal(interaction, isPublic);
    }
  },

  async handleButton(interaction, params) {
    const [action, ...args] = params;
    const replyOpts = { flags: 1 << 6 };
    const cooldown = utils.checkCooldown(interaction.user.id, 'search_btn', 1);
    if (cooldown.onCooldown) { await interaction.reply({ ...replyOpts, content: `⏱️ Wait ${cooldown.timeLeft}s.` }); return; }
    logger.debug(`[search.js] Button action: ${action}, args: [${args}], customId: ${interaction.customId}`);

    if (action === 'new') {
        const isPublic = args[0] === 'public';
        await showSearchModal(interaction, isPublic);
        return;
    }

    if (action === 'exportall') {
        await interaction.deferReply({ ephemeral: true });
        const cacheKeyForExport = interaction.message?.id;
        if (!cacheKeyForExport) {
            logger.warn("[search.js] Export All: No message ID for cache key.");
            await interaction.editReply({ content: "❌ Cannot retrieve search session for export." });
            return;
        }
        const cachedDataForExport = searchCache.get(cacheKeyForExport);
        if (!cachedDataForExport || !cachedDataForExport.filters) {
            logger.warn(`[search.js] Export All: Cache miss or no filters for key: ${cacheKeyForExport}`);
            await interaction.editReply({ content: "Search session expired or filters not found. Please perform a new search to export.", components: [] });
            return;
        }
        const { filters: exportFilters } = cachedDataForExport;
        const { worlds: allMatchingWorlds } = await db.getFilteredWorlds(exportFilters, 1, 10000);

        if (!allMatchingWorlds || allMatchingWorlds.length === 0) {
            await interaction.editReply({ content: 'No names to export for the current filters.' });
            return;
        }

        let exportText = "```\n";
        allMatchingWorlds.forEach(world => {
            const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
            const notePart = world.note ? ` (${world.note})` : '';
            exportText += `(${lockChar}) ${world.name.toUpperCase()}${notePart}\n`;
        });
        exportText += "```";

        if (exportText.length > 2000) {
            let cutOff = exportText.lastIndexOf('\n', 1990);
            if (cutOff === -1) cutOff = 1990;
            exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
        }
        await interaction.editReply({ content: exportText });
        return;
    }

    const cacheKey = interaction.message?.id;
    if (!cacheKey) { logger.warn("[search.js] No message ID for cache key."); await interaction.reply({ ...replyOpts, content: "❌ Cannot retrieve search results." }); return; }
    const cachedData = searchCache.get(cacheKey);
    if (!cachedData) { logger.warn(`[search.js] Cache miss for key: ${cacheKey}`); await interaction.update({ content: "Search results expired. Please search again.", components: [], embeds: [], flags: 1 << 6 }); return; }

    const { filters: cachedFilters, totalWorlds: cachedTotalWorlds } = cachedData;
    let currentPage = parseInt(args[0] || '1');
    let targetPage = currentPage;

    if (action === 'toggle') {
        const scope = args[0]; // 'public' or 'private'
        const newFilters = { ...cachedFilters };
        if (scope === 'public') {
            delete newFilters.added_by_username;
        } else { // private
            newFilters.added_by_username = interaction.user.username;
        }
        await performSearch(interaction, newFilters);
        return;
    }

    if (action === 'prev') {
        targetPage = Math.max(1, currentPage - 1);
    } else if (action === 'next') {
        targetPage = Math.min(Math.ceil(cachedTotalWorlds / CONSTANTS.PAGE_SIZE) || 1, currentPage + 1);
    } else if (action === 'refresh') {
        logger.info(`[search.js] Refreshing search with filters: ${JSON.stringify(cachedFilters)}`);
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
        const { worlds: refreshedWorlds, total: refreshedTotal } = await db.getFilteredWorlds(cachedFilters, 1, CONSTANTS.PAGE_SIZE);
        searchCache.set(cacheKey, { filters: cachedFilters, totalWorlds: refreshedTotal });
        await displaySearchResults(interaction, cachedFilters, refreshedWorlds, refreshedTotal, 1, true);
        return;
    } else if (action === 'page') {
        await interaction.deferUpdate();
        return;
    } else {
        logger.warn(`[search.js] Unknown search button action: ${action}`);
        await interaction.reply({ ...replyOpts, content: "Unknown search action." });
        return;
    }

    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    const { worlds: newPageWorlds } = await db.getFilteredWorlds(cachedFilters, targetPage, CONSTANTS.PAGE_SIZE);
    await displaySearchResults(interaction, cachedFilters, newPageWorlds, cachedTotalWorlds, targetPage, true);
  },

  async handleModal(interaction, params) {
      const [action, scope] = params; // e.g., 'submit', 'public'
      const replyOpts = { flags: 1 << 6 };

      if (action === 'submit') {
          const isPublic = scope === 'public';
          const prefix = interaction.fields.getTextInputValue('prefix');
          const lengthStr = interaction.fields.getTextInputValue('length');
          const lockTypeInput = interaction.fields.getTextInputValue('lockType');
          const expiryDay = interaction.fields.getTextInputValue('expiryDay');
          const daysOwnedStr = interaction.fields.getTextInputValue('search_days_owned');

          let lockType = null; const lockTypeUpper = lockTypeInput?.trim().toUpperCase();
          if (lockTypeUpper === 'M') lockType = 'mainlock'; else if (lockTypeUpper === 'O') lockType = 'outlock'; else if (lockTypeUpper !== '') { await interaction.reply({ ...replyOpts, content: "❌ Invalid Lock Type (M/O or blank)." }); return; }

          const filters = {};
          if (!isPublic) {
              filters.added_by_username = interaction.user.username;
          }

          if (prefix?.trim()) filters.prefix = prefix.trim();
          if (lockType) filters.lockType = lockType;

          if (expiryDay?.trim()) {
              const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
              const lowerDay = expiryDay.trim().toLowerCase();
              if (validDays.includes(lowerDay)) { filters.expiryDay = lowerDay; }
              else { await interaction.reply({ ...replyOpts, content: "❌ Invalid Expiry Day (use full name)." }); return; }
          }

          if (lengthStr?.trim()) {
              const length = parseInt(lengthStr.trim());
              if (!isNaN(length) && length > 0) {
                  filters.nameLength = length;
              } else {
                  await interaction.reply({ ...replyOpts, content: "❌ Invalid 'Length' (must be a positive number)." });
                  return;
              }
          }

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