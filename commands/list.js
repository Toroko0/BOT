// list.js

// Imports
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, StringSelectMenuOptionBuilder, MessageFlags
} = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const { showWorldInfo, showEditWorldModal } = require('./info.js');
const CONSTANTS = require('../utils/constants.js');
// const { showSearchModal } = require('./search.js'); // Keep if still used elsewhere, or remove if fully replaced
// const { show179WorldsList } = require('./179.js'); // Removed as 179.js is deleted
const { showLockedWorldsList } = require('./lock.js');

// --- Modal Definitions ---
async function showRemoveWorldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('list_modal_remove')
    .setTitle('Remove World')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('worldName')
          .setLabel('World Name or Custom ID to Remove')
          .setPlaceholder('Case-insensitive world name or ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function showShareWorldModal(interaction, isShare) {
  const modal = new ModalBuilder()
    .setCustomId(isShare ? 'list_modal_share' : 'list_modal_unshare')
    .setTitle(isShare ? 'Share World' : 'Unshare World')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('worldName')
          .setLabel('World Name or Custom ID')
          .setPlaceholder(`Enter world name or ID to ${isShare ? 'share' : 'unshare'}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function showInfoWorldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('list_modal_info')
    .setTitle('Get World Info')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('worldName')
          .setLabel('World Name or Custom ID')
          .setPlaceholder('Enter world name or ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
  await interaction.showModal(modal);
}

async function showAddWorldModal(interaction) {
    logger.info(`[list.js] Add World button clicked by ${interaction.user.tag}, redirecting...`);
    await interaction.reply({ content: "Please use the `/addworld` command to add a new world.", flags: MessageFlags.Ephemeral }); // Changed to ephemeral
}

async function showListFilterModal(interaction, currentListType) {
  const modal = new ModalBuilder()
    .setCustomId(`list_modal_filter_apply_${currentListType}`) // Page info removed, filter applies from page 1
    .setTitle('Filter Worlds List');

  const prefixInput = new TextInputBuilder()
    .setCustomId('filter_prefix')
    .setLabel('World Name Prefix (Optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const nameLengthMinInput = new TextInputBuilder()
    .setCustomId('filter_name_length_min')
    .setLabel('Min Name Length (Optional, Number)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
    // .setType(TextInputType.Number); // Not a valid method for TextInputBuilder, type is inferred or validated later

  const nameLengthMaxInput = new TextInputBuilder()
    .setCustomId('filter_name_length_max')
    .setLabel('Max Name Length (Optional, Number)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const expiryDayInput = new TextInputBuilder()
    .setCustomId('filter_expiry_day')
    .setLabel('Day of Expiry (e.g., Monday, Optional)')
    .setPlaceholder('Full day name, case-insensitive')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const daysOwnedInput = new TextInputBuilder()
    .setCustomId('filter_days_owned')
    .setLabel('Days Owned (Number, 0-180, Optional)')
    .setPlaceholder('0 for worlds expiring in 180 days')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prefixInput),
    new ActionRowBuilder().addComponents(nameLengthMinInput),
    new ActionRowBuilder().addComponents(nameLengthMaxInput),
    new ActionRowBuilder().addComponents(expiryDayInput),
    new ActionRowBuilder().addComponents(daysOwnedInput)
  );

  await interaction.showModal(modal);
}


// --- Core List Display Function ---
async function showWorldsList(interaction, type = 'private', page = 1, currentFilters = null) { // Added currentFilters
  interaction.client.activeListFilters = interaction.client.activeListFilters || {};
  if (currentFilters && Object.keys(currentFilters).length > 0) {
    interaction.client.activeListFilters[interaction.user.id] = currentFilters;
  } else {
    delete interaction.client.activeListFilters[interaction.user.id];
  }

  let userPrefs = await db.getUserPreferences(interaction.user.id);
  if (!userPrefs) {
      userPrefs = { timezone_offset: 0.0, view_mode: 'pc', reminder_enabled: false, reminder_time_utc: null };
      logger.warn(`[list.js] User ${interaction.user.id} preferences not found, using defaults.`);
  }
  const viewMode = userPrefs.view_mode || 'pc';
  const timezoneOffset = userPrefs.timezone_offset || 0.0;
  const userTeam = await db.getUserTeam(interaction.user.id); // Fetch user's team status

  logger.debug(`[list.js] User ID ${interaction.user.id} - Prefs: viewMode=${viewMode}, timezoneOffset=${timezoneOffset}, Team: ${userTeam ? userTeam.name : 'None'}`);
  logger.info(`[list.js] showWorldsList called - Type: ${type}, Page: ${page}, Guild: ${interaction.guildId || 'DM'}, Filters: ${JSON.stringify(currentFilters)}, Component: ${interaction.isMessageComponent()}`);

  const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;

  if (isUpdate && !interaction.deferred && !interaction.replied) {
    try { await interaction.deferUpdate({ fetchReply: true }); }
    catch (deferError) { 
        logger.error(`[list.js] Failed to defer update: ${deferError.message}`); 
        try { await interaction.followUp({ content: 'Error processing request. Please try again.', flags: MessageFlags.Ephemeral }); }
        catch (followUpError) { logger.error(`[list.js] Failed to send followUp after deferError: ${followUpError.message}`);}
        return; 
    }
  }

  if (!interaction.guildId) type = 'private';
  logger.info(`[list.js] Final type: ${type}, Page: ${page}`);

  let dbResult = { worlds: [], total: 0 };
  try {
    if (currentFilters && Object.keys(currentFilters).length > 0) {
      logger.info(`[list.js] Fetching filtered worlds. Filters: ${JSON.stringify(currentFilters)}, Type: ${type}, Page: ${page}`);
      const userIdForDb = type === 'private' ? interaction.user.id : null;
      // Pass guildId in filters object for getFilteredWorlds to use
      const filtersWithGuild = { ...currentFilters, guildId: type === 'public' ? interaction.guildId : null };
      dbResult = await db.getFilteredWorlds(userIdForDb, filtersWithGuild, page, CONSTANTS.PAGE_SIZE);
    } else {
      // Original logic if no filters are applied
      if (type === 'public') {
        if (interaction.guildId) {
          dbResult = await db.getPublicWorldsByGuild(interaction.guildId, page, CONSTANTS.PAGE_SIZE);
        } else {
          // Public list requested but not in a guild, should be handled (e.g. show error or empty)
          // For now, it will result in empty list by getPublicWorldsByGuild if guildId is null
           dbResult = { worlds: [], total: 0 }; // Explicitly set empty
           logger.warn('[list.js] Public list requested outside of a guild context without filters.');
        }
      } else { // type === 'private'
        dbResult = await db.getWorlds(interaction.user.id, page, CONSTANTS.PAGE_SIZE);
      }
    }
  } catch (error) {
    logger.error(`[list.js] Error fetching worlds (Filters: ${JSON.stringify(currentFilters)}):`, error?.stack || error);
    const errorContent = '❌ Sorry, I couldn\'t fetch the worlds list.';
    const opts = { content: errorContent, components: [], embeds: [], flags: MessageFlags.Ephemeral };
    try { 
        if (interaction.deferred || interaction.replied) await interaction.editReply(opts); 
        else await interaction.reply(opts); 
    }
    catch (replyError) { logger.error(`[list.js] Failed to send DB error reply: ${replyError.message}`); }
    return;
  }

  const worlds = dbResult.worlds || [];
  const totalWorlds = dbResult.total || 0;
  const totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE) : 1;
  page = Math.max(1, Math.min(page, totalPages));

  if (worlds && worlds.length > 0) {
    const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
    const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
    worlds.sort((a, b) => {
        const expiryDateA_UTC = new Date(a.expiry_date);
        const expiryDateB_UTC = new Date(b.expiry_date);
        const expiryDatePartA = new Date(Date.UTC(expiryDateA_UTC.getUTCFullYear(), expiryDateA_UTC.getUTCMonth(), expiryDateA_UTC.getUTCDate()));
        const expiryDatePartB = new Date(Date.UTC(expiryDateB_UTC.getUTCFullYear(), expiryDateB_UTC.getUTCMonth(), expiryDateB_UTC.getUTCDate()));
        const daysLeftA = Math.ceil((expiryDatePartA.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
        const daysLeftB = Math.ceil((expiryDatePartB.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
        const daysOwnedA = daysLeftA <= 0 ? 180 : Math.max(0, 180 - daysLeftA);
        const daysOwnedB = daysLeftB <= 0 ? 180 : Math.max(0, 180 - daysLeftB);
        if (daysOwnedA !== daysOwnedB) return daysOwnedB - daysOwnedA;
        const nameLengthDiff = a.name.length - b.name.length;
        if (nameLengthDiff !== 0) return nameLengthDiff;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }

  const components = [];
  let tableOutput = '';

  if (worlds.length === 0) {
    let emptyMsg = type === 'public'
        ? (interaction.guildId ? `🌐 No public worlds found in this server.` : '🌐 Public worlds only viewable in a server.')
        : '🔒 You haven\'t added any worlds yet. Use `/addworld` or the button below!';
    if (totalWorlds > 0) emptyMsg = ` Gomen 🙏, no worlds on Page ${page}/${totalPages}.`;
    
    const emptyListActionRow = new ActionRowBuilder();
    if (type === 'private') emptyListActionRow.addComponents(new ButtonBuilder().setCustomId('addworld_button_show').setLabel('➕ Add World').setStyle(ButtonStyle.Success));
    emptyListActionRow.addComponents(new ButtonBuilder().setCustomId('list_button_search').setLabel('🔍 Search').setStyle(ButtonStyle.Secondary));
     if (userTeam && type === 'private') { // Add View Team List button if user is in a team and viewing their private list
        emptyListActionRow.addComponents(new ButtonBuilder().setCustomId('list_btn_view_team_list').setLabel('🏢 View Team List').setStyle(ButtonStyle.Secondary));
    }
    if (interaction.guildId) { 
        const target = type === 'private' ? 'public' : 'private'; 
        emptyListActionRow.addComponents(new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'} Worlds`).setStyle(ButtonStyle.Secondary));
    }
    if (emptyListActionRow.components.length > 0) components.push(emptyListActionRow);

    const opts = { content: emptyMsg, components, flags: MessageFlags.Ephemeral }; // All list views are ephemeral now
    try { 
        if (interaction.deferred || interaction.replied) await interaction.editReply(opts);
        else await interaction.reply(opts);
    }
    catch (replyError) { logger.error(`[list.js] Failed editReply for empty list: ${replyError.message}`, { code: replyError.code }); }
    return;
  }

  let headers, data, config;
  const selectOptions = [];

    if (viewMode === 'pc') {
      headers = ['WORLD', 'OWNED', 'LEFT', 'EXPIRES ON', 'LOCK'];
      if (type === 'public') headers.push('ADDED BY');
      data = [headers];
      worlds.forEach(world => {
        const expiryDateUTC = new Date(world.expiry_date);
        const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
        const expiryUserLocal = new Date(expiryDateUTC.getTime() + timezoneOffset * 3600000);
        const expiryDatePart = new Date(Date.UTC(expiryUserLocal.getUTCFullYear(), expiryUserLocal.getUTCMonth(), expiryUserLocal.getUTCDate()));
        const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
        const daysLeft = Math.ceil((expiryDatePart.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
        const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(0, 180 - daysLeft);
        const dayOfWeek = expiryUserLocal.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const expiryStr = `${expiryUserLocal.toLocaleDateString('en-US', { timeZone: 'UTC' })} (${dayOfWeek})`;
        const lockTypeShort = world.lock_type.substring(0, 4).toUpperCase();
        const row = [world.name.toUpperCase(), displayedDaysOwned.toString(), daysLeft <= 0 ? 'EXP' : daysLeft.toString(), expiryStr, lockTypeShort];
        if (type === 'public') row.push(world.added_by_tag || world.added_by || 'Unknown');
        data.push(row);
        if (selectOptions.length < CONSTANTS.MAX_SELECT_OPTIONS) {
          selectOptions.push({ label: world.name.toUpperCase().substring(0,100), description: `Expires: ${expiryStr}`.substring(0,100), value: world.id.toString() });
        }
      });
      config = { columns: [{ alignment: 'left', width: 15, wrapWord: true }, { alignment: 'right', width: 5 }, { alignment: 'right', width: 5 }, { alignment: 'left', width: 18 }, { alignment: 'center', width: 5 }], border: getBorderCharacters('norc'), header: { alignment: 'center', content: (type === 'public' ? '🌐 PUBLIC WORLDS' : '🔒 YOUR WORLDS') }};
      if (type === 'public') config.columns.push({ alignment: 'left', width: 15, wrapWord: true });
    } else { // phone mode
      headers = ['WORLD', 'OWNED']; data = [headers];
      worlds.forEach(world => {
        const expiryDateUTC = new Date(world.expiry_date);
        const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
        const expiryUserLocal = new Date(expiryDateUTC.getTime() + timezoneOffset * 3600000);
        const expiryDatePart = new Date(Date.UTC(expiryUserLocal.getUTCFullYear(), expiryUserLocal.getUTCMonth(), expiryUserLocal.getUTCDate()));
        const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
        const daysLeft = Math.ceil((expiryDatePart.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
        const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(0, 180 - daysLeft);
        data.push([`(${world.lock_type.charAt(0).toUpperCase()}) ${world.name.toUpperCase()}`, displayedDaysOwned.toString()]);
      });
      config = { columns: [{ alignment: 'left', width: 18, wrapWord: true },{ alignment: 'right', width: 5 }], border: getBorderCharacters('norc'), header: { alignment: 'center', content: (type === 'public' ? '🌐 PUBLIC (M)' : '🔒 YOURS (M)') }};
    }
    try { tableOutput = '```\n' + table(data, config) + '\n```'; if (tableOutput.length > 1990) { let cutOff = tableOutput.lastIndexOf('\n', 1950); if (cutOff === -1) cutOff = 1950; tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...```'; } }
    catch (tableError) { logger.error('[list.js] Table generation failed:', tableError); tableOutput = 'Error generating table.'; }

  const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`list_button_prev_${type}_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`list_button_page_${type}_${page}`).setLabel(`Page ${page}/${totalPages}${currentFilters ? ' (Filtered)' : ''}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`list_button_next_${type}_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
      new ButtonBuilder().setCustomId(`list_button_goto_${type}`).setLabel('Go to').setStyle(ButtonStyle.Secondary)
  );
  components.push(navRow);

  const actionRow1 = new ActionRowBuilder();
  if (type === 'private') {
      actionRow1.addComponents(
          new ButtonBuilder().setCustomId('addworld_button_show').setLabel('➕ Add').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('list_button_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('list_btn_lockworld').setLabel('🔒 Lock').setStyle(ButtonStyle.Secondary)
      );
  } else { // public
      actionRow1.addComponents(new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary));
  }
  // Add Export Names button to actionRow1 for both private and public lists
  actionRow1.addComponents(
      new ButtonBuilder().setCustomId(`list_button_export_names_${type}_${page}`).setLabel('📄 Export Page Names').setStyle(ButtonStyle.Secondary)
  );
  if (actionRow1.components.length > 0) components.push(actionRow1);

  const actionRow2 = new ActionRowBuilder();
  if (interaction.guildId) {
      const target = type === 'private' ? 'public' : 'private';
      actionRow2.addComponents(
          new ButtonBuilder().setCustomId(`list_button_${type === 'private' ? 'share' : 'unshare'}`).setLabel(type === 'private' ? '🔗 Share' : '🔓 Unshare').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'} Worlds`).setStyle(ButtonStyle.Secondary)
      );
  }
  actionRow2.addComponents(
      new ButtonBuilder().setCustomId(`list_button_filter_show_${type}`).setLabel('🔍 Filter').setStyle(ButtonStyle.Secondary), // Changed ID and Label
      new ButtonBuilder().setCustomId('list_button_opensettings').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('list_btn_viewlocks').setLabel('🔐 View Locks').setStyle(ButtonStyle.Primary)
  );
   // list_button_179days was removed.

  // Conditionally add "View Team List" button to actionRow2 or a new actionRow3
  if (userTeam && type === 'private') {
    if (actionRow2.components.length < 5) {
        actionRow2.addComponents(
            new ButtonBuilder().setCustomId('list_btn_view_team_list').setLabel('🏢 View Team List').setStyle(ButtonStyle.Secondary)
        );
    } else {
        const actionRow3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('list_btn_view_team_list').setLabel('🏢 View Team List').setStyle(ButtonStyle.Secondary)
        );
        // No need to check actionRow3.components.length > 0 as we just added a button
        components.push(actionRow3);
    }
  }

  if (actionRow2.components.length > 0) components.push(actionRow2);

  if (viewMode === 'pc' && selectOptions.length > 0 && type === 'private') {
      const selectMenu = new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions).setMaxValues(1); components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const finalContent = `${tableOutput}\n📊 Total ${type} worlds: ${totalWorlds}`;
  const finalOpts = { content: finalContent, components, embeds: [], fetchReply: true, flags: MessageFlags.Ephemeral }; // All list views ephemeral

  if (interaction.deferred || interaction.replied) await interaction.editReply(finalOpts);
  else await interaction.reply(finalOpts);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('View your tracked Growtopia worlds or public worlds in this server.'),
  async execute(interaction) {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } // All list views ephemeral
    catch (deferError) { logger.error("[list.js] Failed to defer reply in /list execute:", deferError); return; }
    const initialType = interaction.guildId ? 'private' : 'private';
    await showWorldsList(interaction, initialType, 1);
  },
  async handleButton(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    
    // New parsing logic
    let mainAction = params[0];
    let subAction = params.length > 1 ? params[1] : null;
    let derivedAction = mainAction; // Default action
    let actionArgs = params.slice(1);   // Default arguments start after mainAction

    if (mainAction === 'export' && subAction === 'names') {
        derivedAction = 'export_names';
        actionArgs = params.slice(2); // Remaining args: [type, page]
    } else if (mainAction === 'filter' && subAction === 'show') {
        derivedAction = 'filter_show';
        actionArgs = params.slice(2); // Remaining args: [type]
    }
    // For simple actions like 'prev', 'next', 'switch', 'goto', 'page', 'remove', 'info', etc.,
    // derivedAction remains mainAction (params[0]), and actionArgs (params.slice(1)) is already correct.
    // Example: prev_private_1 -> mainAction='prev', actionArgs=['private', '1']
    // Example: remove -> mainAction='remove', actionArgs=[]

    logger.info(`[list.js] Button Clicked: derivedAction=${derivedAction}, actionArgs=${actionArgs.join(',')}, raw_params=${params.join('_')}, customId=${interaction.customId}`);

    // Variables for type and page, to be extracted from actionArgs where applicable
    let type, page;

    try {
        switch(derivedAction) { // Use derivedAction for the switch
            case 'prev':
            case 'next':
                 type = actionArgs[0] || 'private';
                 page = parseInt(actionArgs[1]) || 1;
                 const userActiveFilters = interaction.client.activeListFilters ? interaction.client.activeListFilters[interaction.user.id] : null;
                 await showWorldsList(interaction, type, derivedAction === 'prev' ? Math.max(1, page - 1) : page + 1, userActiveFilters);
                 break;
            case 'switch':
                type = actionArgs[0] || 'private'; // This is the TARGET type
                page = parseInt(actionArgs[1]) || 1; // This is the page to go to (usually 1)
                // When switching list type, filters should be cleared.
                await showWorldsList(interaction, type, page, null);
                break;
            case 'view': // Not typically used with current button setup, but for completeness
                type = actionArgs[0] || 'private';
                page = parseInt(actionArgs[1]) || 1;
                const userActiveFiltersView = interaction.client.activeListFilters ? interaction.client.activeListFilters[interaction.user.id] : null;
                await showWorldsList(interaction, type, page, userActiveFiltersView);
                break;
            case 'goto':
                type = actionArgs[0] || 'private'; // Type is from the button's customId part
                const modal = new ModalBuilder().setCustomId(`list_modal_goto_${type}`).setTitle('Go to Page'); 
                const pageInput = new TextInputBuilder().setCustomId('page_number').setLabel('Page Number').setPlaceholder('Enter page number').setStyle(TextInputStyle.Short).setRequired(true); 
                modal.addComponents(new ActionRowBuilder().addComponents(pageInput)); 
                await interaction.showModal(modal);
                break;
            case 'remove': await showRemoveWorldModal(interaction); break; // Uses its own modal, no args from params needed here
            case 'info': await showInfoWorldModal(interaction); break; // Uses its own modal
            case 'share': await showShareWorldModal(interaction, true); break; // Uses its own modal
            case 'unshare': await showShareWorldModal(interaction, false); break; // Uses its own modal
            case 'search': // This was re-routed to filter_show if search button existed with old ID
            case 'filter_show': {
                const listType = actionArgs[0] || 'private'; // Type is from button customId: list_button_filter_show_TYPE
                await showListFilterModal(interaction, listType);
                break;
            }
            case 'addworld_button_show': await showAddWorldModal(interaction); break; // Simple action
            case 'opensettings': // Simple action
                if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { getSettingsReplyOptions } = require('./settings.js');
                const settingsReplyOptions = await getSettingsReplyOptions(interaction.user.id);
                await interaction.editReply(settingsReplyOptions);
                break;
            case 'page':  // This is usually part of a pagination button ID, like list_button_page_TYPE_PAGE
                // The current derivedAction would be 'page'. actionArgs would be [type, pageStr]
                // This button is disabled, so it shouldn't be clicked. If it were, deferring is fine.
                if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                break;
            // case '179days': await show179WorldsList(interaction, 1); break; // Already removed
            case 'viewlocks': await showLockedWorldsList(interaction, 1, {}); break; // Simple action
            case 'lockworld': { // Simple action, opens a modal
                const newLockModal = new ModalBuilder()
                    .setCustomId('list_modal_lockworldsubmit')
                    .setTitle('Lock World from Active List');

                const worldNameInput = new TextInputBuilder()
                    .setCustomId('worldname_to_lock')
                    .setLabel('World Name from Your Active List')
                    .setPlaceholder('Enter exact world name to lock')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const lockTypeInput = new TextInputBuilder()
                    .setCustomId('lock_type_for_move')
                    .setLabel('Lock Type (main/out)')
                    .setPlaceholder("main or out (defaults to main)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                const noteInput = new TextInputBuilder()
                    .setCustomId('note_for_move')
                    .setLabel('Optional Note')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);

                newLockModal.addComponents(
                    new ActionRowBuilder().addComponents(worldNameInput),
                    new ActionRowBuilder().addComponents(lockTypeInput),
                    new ActionRowBuilder().addComponents(noteInput)
                );
                await interaction.showModal(newLockModal);
                break;
            }
            case 'view_team_list': // Simple action
                await interaction.reply({ content: "Use `/team list` to view your team's worlds.", flags: MessageFlags.Ephemeral });
                break;
            case 'export_names': { // derivedAction is 'export_names', actionArgs = [type, page]
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const listType = actionArgs[0] || 'private';
                const listPage = parseInt(actionArgs[1]) || 1;
                let dbResultExport;
                const userActiveFiltersExport = interaction.client.activeListFilters ? interaction.client.activeListFilters[interaction.user.id] : null;

                if (userActiveFiltersExport && Object.keys(userActiveFiltersExport).length > 0) {
                    logger.info(`[list.js] Exporting filtered names. Filters: ${JSON.stringify(userActiveFiltersExport)}, Type: ${listType}, Page: ${listPage}`);
                    const userIdForDb = listType === 'private' ? interaction.user.id : null;
                    const filtersWithGuild = { ...userActiveFiltersExport, guildId: listType === 'public' ? interaction.guildId : null };
                    dbResultExport = await db.getFilteredWorlds(userIdForDb, filtersWithGuild, listPage, CONSTANTS.PAGE_SIZE);
                } else {
                    // Original logic if no filters are applied for export
                    if (listType === 'public') {
                        if (!interaction.guildId) {
                            await interaction.editReply({ content: 'Public worlds can only be exported from within a server.', flags: MessageFlags.Ephemeral });
                            return;
                        }
                        dbResultExport = await db.getPublicWorldsByGuild(interaction.guildId, listPage, CONSTANTS.PAGE_SIZE);
                    } else { // private
                        dbResultExport = await db.getWorlds(interaction.user.id, listPage, CONSTANTS.PAGE_SIZE);
                    }
                }

                const worldsForExport = dbResultExport.worlds || [];

                if (worldsForExport.length === 0) {
                    await interaction.editReply({ content: 'No names to export on this page.', flags: MessageFlags.Ephemeral });
                    return;
                }

                let exportText = "```\n";
                worldsForExport.forEach(world => {
                    const lockChar = world.lock_type ? world.lock_type.charAt(0).toUpperCase() : 'L';
                    const customIdPart = world.custom_id ? ` (${world.custom_id})` : '';
                    exportText += `(${lockChar}) ${world.name.toUpperCase()}${customIdPart}\n`;
                });
                exportText += "```";

                if (exportText.length > 2000) {
                    let cutOff = exportText.lastIndexOf('\n', 1990);
                    if (cutOff === -1) cutOff = 1990;
                    exportText = exportText.substring(0, cutOff) + "\n... (list truncated)```";
                }
                await interaction.editReply({ content: exportText, flags: MessageFlags.Ephemeral });
                break;
            }
            default: 
                logger.warn(`[list.js] Unknown list button action: ${derivedAction}`);
                if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                await interaction.editReply({ content: 'Unknown button action.', flags: MessageFlags.Ephemeral });
                break;
        }
    } catch (error) {
        logger.error(`[list.js] Error executing list button handler for action ${action}:`, error?.stack || error);
        const errorReply = { content: 'An error occurred processing this action.', flags: MessageFlags.Ephemeral };
        try { 
            if (interaction.replied || interaction.deferred) await interaction.editReply(errorReply);
            else await interaction.reply(errorReply);
        } catch (fallbackError) { logger.error("[list.js] Failed to send final error message:", fallbackError); }
    }
  },
  async handleSelectMenu(interaction, params) {
    // ... (rest of handleSelectMenu, ensure ephemeral replies if needed)
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_select');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: MessageFlags.Ephemeral }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    const action = params[0];
    logger.info(`[list.js] Select Menu Used: action=${action}, customId=${interaction.customId}, values=${interaction.values}`);
    if (action === 'info') {
      if (!interaction.values || interaction.values.length === 0) { await interaction.reply({ content: "No world selected.", flags: MessageFlags.Ephemeral }); return; }
      const worldId = parseInt(interaction.values[0]); if (isNaN(worldId)) { await interaction.reply({ content: "Invalid world ID selected.", flags: MessageFlags.Ephemeral }); return; }
      try {
        let world = await db.getWorldById(worldId); if (!world) { await interaction.reply({ content: `❌ World with ID ${worldId} not found.`, flags: MessageFlags.Ephemeral }); return; }
        if (world.user_id !== interaction.user.id && !world.is_public) { await interaction.reply({ content: '🔒 You do not have permission to view details for this world.', flags: MessageFlags.Ephemeral }); return; }
        await showWorldInfo(interaction, world);
      } catch (error) {
        logger.error(`[list.js] Error fetching/showing world info from select menu (ID: ${worldId}):`, error?.stack || error);
        const errorReply = { content: 'An error occurred while fetching world details.', flags: MessageFlags.Ephemeral };
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
      }
    } else { logger.warn(`[list.js] Unhandled list select menu action: ${action}`); await interaction.reply({ content: "Unknown select menu action.", flags: MessageFlags.Ephemeral }); }
  },
  async handleModal(interaction, params) {
    // params are derived from customId.split('_').slice(N) where N depends on the handler structure.
    // Example customId: list_modal_ACTION_ARG1 or list_modal_PARENT_CHILD_ARG1
    // If interactionHandler sends params from customId.split('_').slice(1):
    // For list_modal_goto_private -> params = ["modal", "goto", "private"]
    // For list_modal_lock_confirm_123 -> params = ["modal", "lock", "confirm", "123"]

    // Let's assume params from interactionHandler is customId.split('_').slice(2) for modals
    // So, for list_modal_goto_private -> params = ["goto", "private"]
    // For list_modal_filter_apply_private -> params = ["filter", "apply", "private"]
    // For list_modal_lockworldsubmit -> params assumed to be ["lockworldsubmit"] (after interactionHandler processing)

    let action = params[0];
    let dataParams = params.slice(1);

    // Simplified action parsing: if it's a known composite from previous structure, handle it.
    // Otherwise, action is params[0].
    if (params[0] === 'filter' && params.length > 1 && params[1] === 'apply') {
      action = `${params[0]}_${params[1]}`; // "filter_apply"
      dataParams = params.slice(2); // dataParams will contain [currentListType]
    }
    // Note: The old 'lock_getname' and 'lock_confirm' parsing is removed as the cases are removed.
    // The new 'lockworldsubmit' case will be handled by action = params[0].

    logger.info(`[list.js] Modal Submitted: derived_action=${action}, raw_params_for_handler='${params.join('_')}', customId=${interaction.customId}`);
    try {
      switch(action) {
        case 'goto': { 
            const currentListType = dataParams[0] || 'private';
            const pageInput = interaction.fields.getTextInputValue('page_number'); 
            const pageNumber = parseInt(pageInput); 
            if (isNaN(pageNumber) || pageNumber < 1) { 
                await interaction.reply({ content: '❌ Invalid page number entered.', flags: MessageFlags.Ephemeral });
                return; 
            } 
            await interaction.deferUpdate(); 
            await showWorldsList(interaction, currentListType, pageNumber, null);
            break; 
        }
        case 'filter_apply': {
            await interaction.deferUpdate();
            const currentListType = dataParams[0] || 'private';

            const filtersToApply = {};
            const prefix = interaction.fields.getTextInputValue('filter_prefix')?.trim() || null;
            if (prefix) filtersToApply.prefix = prefix;

            const nameLengthMinStr = interaction.fields.getTextInputValue('filter_name_length_min')?.trim();
            if (nameLengthMinStr) {
                const nameLengthMin = parseInt(nameLengthMinStr);
                if (!isNaN(nameLengthMin)) filtersToApply.nameLengthMin = nameLengthMin;
            }

            const nameLengthMaxStr = interaction.fields.getTextInputValue('filter_name_length_max')?.trim();
            if (nameLengthMaxStr) {
                const nameLengthMax = parseInt(nameLengthMaxStr);
                if (!isNaN(nameLengthMax)) filtersToApply.nameLengthMax = nameLengthMax;
            }

            const expiryDay = interaction.fields.getTextInputValue('filter_expiry_day')?.trim() || null;
            if (expiryDay) filtersToApply.expiryDay = expiryDay.toLowerCase();

            const daysOwnedStr = interaction.fields.getTextInputValue('filter_days_owned')?.trim();
            if (daysOwnedStr) {
                const daysOwned = parseInt(daysOwnedStr);
                if (!isNaN(daysOwned)) filtersToApply.daysOwned = daysOwned;
            }

            logger.info(`[list.js] Applying filters for list type ${currentListType}: ${JSON.stringify(filtersToApply)}`);
            await showWorldsList(interaction, currentListType, 1, filtersToApply);
            break;
        }
        case 'lockworldsubmit': { // New consolidated modal handler
            // Assuming deferReply or deferUpdate will be handled by the calling button or here if needed.
            // For a modal submission, it's usually an update to the existing message (list).
            await interaction.deferUpdate(); // Or deferReply({ephemeral: true}) if it's a new message

            const worldNameInput = interaction.fields.getTextInputValue('worldname_to_lock').trim();
            let targetLockTypeInput = interaction.fields.getTextInputValue('lock_type_for_move')?.trim().toLowerCase() || 'main';
            const targetNote = interaction.fields.getTextInputValue('note_for_move')?.trim() || null;

            if (!worldNameInput || worldNameInput.includes(' ')) {
                await interaction.editReply({ content: '❌ Invalid world name format. Name cannot be empty or contain spaces.', flags: MessageFlags.Ephemeral });
                return;
            }
            if (targetLockTypeInput !== 'main' && targetLockTypeInput !== 'out') {
                targetLockTypeInput = 'main'; // Default if invalid input
            }

            const worldNameUpper = worldNameInput.toUpperCase();
            const activeWorld = await db.getWorldByName(worldNameUpper, interaction.user.id);

            if (!activeWorld) {
                await interaction.editReply({ content: `❌ World "**${worldNameInput}**" not found in your active tracking list.`, flags: MessageFlags.Ephemeral });
                return;
            }

            const alreadyLocked = await db.findLockedWorldByName(interaction.user.id, activeWorld.name);
            if (alreadyLocked) {
                await interaction.editReply({ content: `❌ World **${activeWorld.name}** is already in your Locks list.`, flags: MessageFlags.Ephemeral });
                return;
            }

            const result = await db.moveWorldToLocks(interaction.user.id, activeWorld.id, targetLockTypeInput, targetNote);

            if (result.success) {
                await interaction.editReply({ content: `✅ ${result.message}`, flags: MessageFlags.Ephemeral });
                // Optionally, refresh the list view
                // await showWorldsList(interaction, type, page, currentFilters); // Need to get type, page, currentFilters if refreshing
            } else {
                await interaction.editReply({ content: `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
            }
            break;
        }
        // Removed 'lock_getname' and 'lock_confirm' cases
        case 'remove': {
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim();
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, flags: MessageFlags.Ephemeral }); return;
            }
            const confirmId = `remove_button_confirm_${world.id}`; 
            const cancelId = `remove_button_cancel_${world.id}`;
            const row = new ActionRowBuilder().addComponents( 
                new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger), 
                new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary) 
            );
            await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`, components: [row], flags: MessageFlags.Ephemeral });
            break;
        }
        case 'share':  // Assumes action is 'share', dataParams is empty
        case 'unshare': { // Assumes action is 'unshare', dataParams is empty
            if (!interaction.guildId) { 
                await interaction.reply({ content: "Sharing/unsharing only possible in a server.", flags: MessageFlags.Ephemeral }); return;
            }
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, flags: MessageFlags.Ephemeral }); return;
            }
            const makePublic = (action === 'share'); // 'action' here is the derived one, e.g. "share"
            if (makePublic && world.is_public && world.guild_id === interaction.guildId) { 
                await interaction.reply({ content: `🌐 **${world.name.toUpperCase()}** is already public here.`, flags: MessageFlags.Ephemeral }); return;
            }
            if (!makePublic && !world.is_public) { 
                await interaction.reply({ content: `🔒 **${world.name.toUpperCase()}** is already private.`, flags: MessageFlags.Ephemeral }); return;
            }
            if (makePublic) { 
                const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId); 
                if (existingPublic && existingPublic.id !== world.id) { 
                    await interaction.reply({ content: `❌ Another public world named **${world.name.toUpperCase()}** already exists here.`, flags: MessageFlags.Ephemeral }); return;
                } 
            }
            const guildToSet = makePublic ? interaction.guildId : null;
            const success = await db.updateWorldVisibility(world.id, interaction.user.id, makePublic, guildToSet);
            if (success) { 
                await require('./search.js').invalidateSearchCache(); 
                await require('../utils/share_and_history.js').logHistory(world.id, interaction.user.id, action, `World ${world.name.toUpperCase()} ${action}d in guild ${interaction.guildId}`);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('list_button_view_private_1').setLabel('View My Worlds').setStyle(ButtonStyle.Primary));
                await interaction.reply({ content: `✅ **${world.name.toUpperCase()}** is now ${makePublic ? 'public in this server' : 'private'}.`, components: [row], flags: MessageFlags.Ephemeral });
            } else { 
                await interaction.reply({ content: `❌ Failed to ${action} **${world.name.toUpperCase()}**.`, flags: MessageFlags.Ephemeral });
            }
            break;
        }
        case 'info': { // Assumes action is 'info', dataParams is empty
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            let world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, interaction.guildId); 
            if (!world) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found or not accessible.`, flags: MessageFlags.Ephemeral }); return;
            } 
            await showWorldInfo(interaction, world);
            break; 
        }
        default: logger.warn(`[list.js] Unhandled list modal action: ${action} (derived) from customId: ${interaction.customId}, raw_params_for_handler: ${params.join('_')}`); await interaction.reply({ content: "This form submission is not recognized.", flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error(`[list.js] Error handling modal ${interaction.customId} (derived_action: ${action}):`, error?.stack || error);
      const errorReply = { content: 'An error occurred processing this form.', flags: MessageFlags.Ephemeral };
      try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
    }
  },
  showWorldsList // Export for use by other commands if needed
};
