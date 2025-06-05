// list.js

// Imports
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, StringSelectMenuOptionBuilder
} = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const { showWorldInfo, showEditWorldModal } = require('./info.js');
const CONSTANTS = require('../utils/constants.js');
const { showSearchModal } = require('./search.js');
const { show179WorldsList } = require('./179.js');
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
    await interaction.reply({ content: "Please use the `/addworld` command to add a new world.", ephemeral: true }); // Changed to ephemeral
}


// --- Core List Display Function ---
async function showWorldsList(interaction, type = 'private', page = 1) {
  let userPrefs = await db.getUserPreferences(interaction.user.id);
  if (!userPrefs) {
      userPrefs = { timezone_offset: 0.0, view_mode: 'pc', reminder_enabled: false, reminder_time_utc: null };
      logger.warn(`[list.js] User ${interaction.user.id} preferences not found, using defaults.`);
  }
  const viewMode = userPrefs.view_mode || 'pc';
  const timezoneOffset = userPrefs.timezone_offset || 0.0;
  const userTeam = await db.getUserTeam(interaction.user.id); // Fetch user's team status

  logger.debug(`[list.js] User ID ${interaction.user.id} - Prefs: viewMode=${viewMode}, timezoneOffset=${timezoneOffset}, Team: ${userTeam ? userTeam.name : 'None'}`);
  logger.info(`[list.js] showWorldsList called - Type: ${type}, Page: ${page}, Guild: ${interaction.guildId || 'DM'}, Component: ${interaction.isMessageComponent()}`);

  const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;

  if (isUpdate && !interaction.deferred && !interaction.replied) {
    try { await interaction.deferUpdate({ fetchReply: true }); }
    catch (deferError) { 
        logger.error(`[list.js] Failed to defer update: ${deferError.message}`); 
        try { await interaction.followUp({ content: 'Error processing request. Please try again.', ephemeral: true }); }
        catch (followUpError) { logger.error(`[list.js] Failed to send followUp after deferError: ${followUpError.message}`);}
        return; 
    }
  }

  if (!interaction.guildId) type = 'private';
  logger.info(`[list.js] Final type: ${type}, Page: ${page}`);

  let dbResult = { worlds: [], total: 0 };
  try {
    if (type === 'public') {
      if (interaction.guildId) { dbResult = await db.getPublicWorldsByGuild(interaction.guildId, page, CONSTANTS.PAGE_SIZE); }
    } else {
      dbResult = await db.getWorlds(interaction.user.id, page, CONSTANTS.PAGE_SIZE);
    }
  } catch (error) {
    logger.error(`[list.js] Error fetching worlds:`, error?.stack || error);
    const errorContent = '❌ Sorry, I couldn\'t fetch the worlds list.';
    const opts = { content: errorContent, components: [], embeds: [], ephemeral: true };
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

    const opts = { content: emptyMsg, components, ephemeral: true }; // All list views are ephemeral now
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
      new ButtonBuilder().setCustomId(`list_button_page_${type}_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
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
  } else {
      actionRow1.addComponents(new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary));
  }
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
      new ButtonBuilder().setCustomId('list_button_search').setLabel('🔍 Search').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('list_button_opensettings').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('list_btn_viewlocks').setLabel('🔐 View Locks').setStyle(ButtonStyle.Primary)
  );
   actionRow2.addComponents(new ButtonBuilder().setCustomId('list_button_179days').setLabel('⏳ 179 Days').setStyle(ButtonStyle.Secondary));
  if (userTeam && type === 'private') { // Add View Team List button if user is in a team and viewing their private list
        actionRow2.addComponents(new ButtonBuilder().setCustomId('list_btn_view_team_list').setLabel('🏢 View Team List').setStyle(ButtonStyle.Secondary));
  }
  if (actionRow2.components.length > 0) components.push(actionRow2);

  if (viewMode === 'pc' && selectOptions.length > 0 && type === 'private') {
      const selectMenu = new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions).setMaxValues(1); components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const finalContent = `${tableOutput}\n📊 Total ${type} worlds: ${totalWorlds}`;
  const finalOpts = { content: finalContent, components, embeds: [], fetchReply: true, ephemeral: true }; // All list views ephemeral

  if (interaction.deferred || interaction.replied) await interaction.editReply(finalOpts);
  else await interaction.reply(finalOpts);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('View your tracked Growtopia worlds or public worlds in this server.'),
  async execute(interaction) {
    try { await interaction.deferReply({ ephemeral: true }); } // All list views ephemeral
    catch (deferError) { logger.error("[list.js] Failed to defer reply in /list execute:", deferError); return; }
    const initialType = interaction.guildId ? 'private' : 'private';
    await showWorldsList(interaction, initialType, 1);
  },
  async handleButton(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    
    const action = params[0];
    let type, page; // Declare here for broader scope if needed
    logger.info(`[list.js] Button Clicked: action=${action}, params=${params.join('_')}, customId=${interaction.customId}`);

    try {
        switch(action) {
            case 'prev':
            case 'next':
                 type = params[1] || 'private';
                 page = parseInt(params[2]) || 1;
                 await showWorldsList(interaction, type, action === 'prev' ? Math.max(1, page - 1) : page + 1);
                 break;
            case 'switch': // Handles list_button_switch_public_1 or list_button_switch_private_1
                type = params[1] || 'private'; // This is the TARGET type
                page = parseInt(params[2]) || 1; // This is the page to go to (usually 1)
                await showWorldsList(interaction, type, page);
                break;
            case 'view': // Not typically used with current button setup, but for completeness
                type = params[1] || 'private';
                page = parseInt(params[2]) || 1;
                await showWorldsList(interaction, type, page);
                break;
            case 'goto':
                type = params[1] || 'private';
                const modal = new ModalBuilder().setCustomId(`list_modal_goto_${type}`).setTitle('Go to Page'); 
                const pageInput = new TextInputBuilder().setCustomId('page_number').setLabel('Page Number').setPlaceholder('Enter page number').setStyle(TextInputStyle.Short).setRequired(true); 
                modal.addComponents(new ActionRowBuilder().addComponents(pageInput)); 
                await interaction.showModal(modal);
                break;
            case 'remove': await showRemoveWorldModal(interaction); break;
            case 'info': await showInfoWorldModal(interaction); break;
            case 'share': await showShareWorldModal(interaction, true); break;
            case 'unshare': await showShareWorldModal(interaction, false); break;
            case 'search': await showSearchModal(interaction); break;
            case 'addworld_button_show': await showAddWorldModal(interaction); break;
            case 'opensettings':
                if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
                const { getSettingsReplyOptions } = require('./settings.js');
                const settingsReplyOptions = await getSettingsReplyOptions(interaction.user.id);
                await interaction.editReply(settingsReplyOptions);
                break;
            case 'page': 
                if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                break;
            case '179days': await show179WorldsList(interaction, 1); break;
            case 'viewlocks': await showLockedWorldsList(interaction, 1, {}); break;
            case 'lockworld':
                const lockModal = new ModalBuilder().setCustomId('list_modal_lock_getname').setTitle('Lock World: Enter Name');
                const worldNameInput = new TextInputBuilder().setCustomId('worldname_to_lock').setLabel('World Name from Active List').setPlaceholder('Enter exact world name to lock').setStyle(TextInputStyle.Short).setRequired(true);
                lockModal.addComponents(new ActionRowBuilder().addComponents(worldNameInput));
                await interaction.showModal(lockModal);
                break;
            case 'view_team_list': // Handler for the new button
                await interaction.reply({ content: "Use `/team list` to view your team's worlds.", ephemeral: true });
                break;
            default: 
                logger.warn(`[list.js] Unknown list button action: ${action}`); 
                if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                await interaction.editReply({ content: 'Unknown button action.', ephemeral: true });
                break;
        }
    } catch (error) {
        logger.error(`[list.js] Error executing list button handler for action ${action}:`, error?.stack || error);
        const errorReply = { content: 'An error occurred processing this action.', ephemeral: true };
        try { 
            if (interaction.replied || interaction.deferred) await interaction.editReply(errorReply);
            else await interaction.reply(errorReply);
        } catch (fallbackError) { logger.error("[list.js] Failed to send final error message:", fallbackError); }
    }
  },
  async handleSelectMenu(interaction, params) {
    // ... (rest of handleSelectMenu, ensure ephemeral replies if needed)
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_select');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, ephemeral: true }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    const action = params[0];
    logger.info(`[list.js] Select Menu Used: action=${action}, customId=${interaction.customId}, values=${interaction.values}`);
    if (action === 'info') {
      if (!interaction.values || interaction.values.length === 0) { await interaction.reply({ content: "No world selected.", ephemeral: true }); return; }
      const worldId = parseInt(interaction.values[0]); if (isNaN(worldId)) { await interaction.reply({ content: "Invalid world ID selected.", ephemeral: true }); return; }
      try {
        let world = await db.getWorldById(worldId); if (!world) { await interaction.reply({ content: `❌ World with ID ${worldId} not found.`, ephemeral: true }); return; }
        if (world.user_id !== interaction.user.id && !world.is_public) { await interaction.reply({ content: '🔒 You do not have permission to view details for this world.', ephemeral: true }); return; }
        await showWorldInfo(interaction, world);
      } catch (error) {
        logger.error(`[list.js] Error fetching/showing world info from select menu (ID: ${worldId}):`, error?.stack || error);
        const errorReply = { content: 'An error occurred while fetching world details.', ephemeral: true };
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
      }
    } else { logger.warn(`[list.js] Unhandled list select menu action: ${action}`); await interaction.reply({ content: "Unknown select menu action.", ephemeral: true }); }
  },
  async handleModal(interaction, params) {
    // params are derived from customId.split('_').slice(N) where N depends on the handler structure.
    // Example customId: list_modal_ACTION_ARG1 or list_modal_PARENT_CHILD_ARG1
    // If interactionHandler sends params from customId.split('_').slice(1):
    // For list_modal_goto_private -> params = ["modal", "goto", "private"]
    // For list_modal_lock_confirm_123 -> params = ["modal", "lock", "confirm", "123"]

    // Let's assume params from interactionHandler is customId.split('_').slice(2) for modals
    // So, for list_modal_goto_private -> params = ["goto", "private"]
    // For list_modal_lock_confirm_123 -> params = ["lock", "confirm", "123"]

    let action = params[0];
    let dataParams = params.slice(1); // Default: action arguments start from params[1]

    // Handle composite actions like "lock_getname" or "lock_confirm"
    // These would have params like ["lock", "getname"] or ["lock", "confirm", "worldId"]
    if (action === 'lock' && params.length > 1 && (params[1] === 'getname' || params[1] === 'confirm')) {
      action = `${params[0]}_${params[1]}`; // e.g., "lock_getname", "lock_confirm"
      dataParams = params.slice(2); // Arguments for these composite actions start from params[2]
    }
    // For other actions like 'goto', 'remove', etc., action remains params[0] and dataParams are params.slice(1)

    logger.info(`[list.js] Modal Submitted: derived_action=${action}, raw_params_for_handler='${params.join('_')}', customId=${interaction.customId}`);
    try {
      switch(action) {
        case 'goto': { 
            const type = dataParams[0] || 'private'; // Was params[1]
            const pageInput = interaction.fields.getTextInputValue('page_number'); 
            const pageNumber = parseInt(pageInput); 
            if (isNaN(pageNumber) || pageNumber < 1) { 
                await interaction.reply({ content: '❌ Invalid page number entered.', ephemeral: true });
                return; 
            } 
            await interaction.deferUpdate(); 
            await showWorldsList(interaction, type, pageNumber);
            break; 
        }
        case 'lock_getname': { // This action itself doesn't use dataParams, it leads to another modal
            const worldNameInput = interaction.fields.getTextInputValue('worldname_to_lock').trim();
            const worldNameUpper = worldNameInput.toUpperCase();
            if (!worldNameUpper || worldNameUpper.includes(' ')) {
                await interaction.reply({ content: '❌ Invalid world name format. Name cannot be empty or contain spaces.', ephemeral: true }); return;
            }
            const activeWorld = await db.getWorldByName(worldNameUpper, interaction.user.id);
            if (!activeWorld) {
                await interaction.reply({ content: `❌ World "**${worldNameInput}**" not found in your active tracking list.`, ephemeral: true }); return;
            }
            const alreadyLocked = await db.findLockedWorldByName(interaction.user.id, activeWorld.name);
            if (alreadyLocked) {
                await interaction.reply({ content: `❌ World **${activeWorld.name}** is already in your Locks list.`, ephemeral: true }); return;
            }
            // The customId for the confirmation modal needs to be list_modal_lock_confirm_ID
            // The interaction handler is assumed to split 'list_modal_lock_confirm_ID' into params for handleModal
            // e.g. if handler uses .slice(1) -> ["modal", "lock", "confirm", ID] -> then our logic derives action="lock_confirm", dataParams=[ID]
            // e.g. if handler uses .slice(2) -> ["lock", "confirm", ID] -> then our logic derives action="lock_confirm", dataParams=[ID]
            const modalConfirm = new ModalBuilder().setCustomId(`list_modal_lock_confirm_${activeWorld.id}`).setTitle(`Lock: ${activeWorld.name}`);
            const worldNameDisplay = new TextInputBuilder().setCustomId('worldname_display_readonly').setLabel('World Name (Cannot Change)').setValue(activeWorld.name).setStyle(TextInputStyle.Short).setRequired(false);
            const lockTypeInput = new TextInputBuilder().setCustomId('lock_type_for_move').setLabel('Lock Type (main/out)').setValue(activeWorld.lock_type || 'main').setPlaceholder('main or out').setStyle(TextInputStyle.Short).setRequired(true);
            const noteInput = new TextInputBuilder().setCustomId('note_for_move').setLabel('Optional Note').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modalConfirm.addComponents(new ActionRowBuilder().addComponents(worldNameDisplay), new ActionRowBuilder().addComponents(lockTypeInput), new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modalConfirm);
            break;
        }
        case 'lock_confirm': { // Action "lock_confirm", dataParams should contain [activeWorldIdStr]
            const activeWorldIdStr = dataParams[0]; // Was params[1]
            const activeWorldId = parseInt(activeWorldIdStr);
            if (isNaN(activeWorldId)) {
                await interaction.reply({ content: '❌ Error processing request: Invalid world ID for confirmation.', ephemeral: true }); return;
            }
            let targetLockType = interaction.fields.getTextInputValue('lock_type_for_move').trim().toLowerCase() || 'main';
            if (targetLockType !== 'main' && targetLockType !== 'out') targetLockType = 'main';
            const targetNote = interaction.fields.getTextInputValue('note_for_move').trim() || null;
            const result = await db.moveWorldToLocks(interaction.user.id, activeWorldId, targetLockType, targetNote);
            if (result.success) await interaction.reply({ content: `✅ ${result.message}`, ephemeral: true });
            else await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
            break;
        }
        case 'remove': { // Action "remove", dataParams is empty as worldName comes from modal field
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim();
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, ephemeral: true }); return;
            }
            const confirmId = `remove_button_confirm_${world.id}`; 
            const cancelId = `remove_button_cancel_${world.id}`;
            const row = new ActionRowBuilder().addComponents( 
                new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger), 
                new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary) 
            );
            await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`, components: [row], ephemeral: true });
            break;
        }
        case 'share':  // Assumes action is 'share', dataParams is empty
        case 'unshare': { // Assumes action is 'unshare', dataParams is empty
            if (!interaction.guildId) { 
                await interaction.reply({ content: "Sharing/unsharing only possible in a server.", ephemeral: true }); return;
            }
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, ephemeral: true }); return;
            }
            const makePublic = (action === 'share'); // 'action' here is the derived one, e.g. "share"
            if (makePublic && world.is_public && world.guild_id === interaction.guildId) { 
                await interaction.reply({ content: `🌐 **${world.name.toUpperCase()}** is already public here.`, ephemeral: true }); return;
            }
            if (!makePublic && !world.is_public) { 
                await interaction.reply({ content: `🔒 **${world.name.toUpperCase()}** is already private.`, ephemeral: true }); return;
            }
            if (makePublic) { 
                const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId); 
                if (existingPublic && existingPublic.id !== world.id) { 
                    await interaction.reply({ content: `❌ Another public world named **${world.name.toUpperCase()}** already exists here.`, ephemeral: true }); return;
                } 
            }
            const guildToSet = makePublic ? interaction.guildId : null;
            const success = await db.updateWorldVisibility(world.id, interaction.user.id, makePublic, guildToSet);
            if (success) { 
                await require('./search.js').invalidateSearchCache(); 
                await require('./utils/share_and_history.js').logHistory(world.id, interaction.user.id, action, `World ${world.name.toUpperCase()} ${action}d in guild ${interaction.guildId}`); 
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('list_button_view_private_1').setLabel('View My Worlds').setStyle(ButtonStyle.Primary));
                await interaction.reply({ content: `✅ **${world.name.toUpperCase()}** is now ${makePublic ? 'public in this server' : 'private'}.`, components: [row], ephemeral: true });
            } else { 
                await interaction.reply({ content: `❌ Failed to ${action} **${world.name.toUpperCase()}**.`, ephemeral: true });
            }
            break;
        }
        case 'info': { // Assumes action is 'info', dataParams is empty
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            let world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, interaction.guildId); 
            if (!world) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found or not accessible.`, ephemeral: true }); return;
            } 
            await showWorldInfo(interaction, world);
            break; 
        }
        default: logger.warn(`[list.js] Unhandled list modal action: ${action} (derived) from customId: ${interaction.customId}, raw_params_for_handler: ${params.join('_')}`); await interaction.reply({ content: "This form submission is not recognized.", ephemeral: true });
      }
    } catch (error) {
      logger.error(`[list.js] Error handling modal ${interaction.customId} (derived_action: ${action}):`, error?.stack || error);
      const errorReply = { content: 'An error occurred processing this form.', ephemeral: true };
      try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
    }
  },
  showWorldsList // Export for use by other commands if needed
};
