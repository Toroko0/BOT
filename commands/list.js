// list.js

// Imports
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, StringSelectMenuOptionBuilder // Ensure this is imported if used
} = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const { showWorldInfo, showEditWorldModal } = require('./info.js'); // Assuming info.js exports these
const CONSTANTS = require('../utils/constants.js');
const { showSearchModal } = require('./search.js');
const { show179WorldsList } = require('./179.js');

// --- Modal Definitions ---
async function showRemoveWorldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('list_modal_remove') // Command: list, Type: modal, Action: remove
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
    .setCustomId(isShare ? 'list_modal_share' : 'list_modal_unshare') // Command: list, Type: modal, Action: share/unshare
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
    .setCustomId('list_modal_info') // Command: list, Type: modal, Action: info
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

// Placeholder Add World Modal logic (redirects to slash command)
async function showAddWorldModal(interaction) {
    logger.info(`[list.js] Add World button clicked by ${interaction.user.tag}, redirecting...`);
    await interaction.reply({ content: "Please use the `/addworld` command to add a new world.", flags: 1 << 6 });
}


// --- Core List Display Function ---
async function showWorldsList(interaction, type = 'private', page = 1) {
  // Fetch User Preferences
  let userPrefs = await db.getUserPreferences(interaction.user.id);
  if (!userPrefs) { // Fallback to defaults if not found
      userPrefs = { timezone_offset: 0.0, view_mode: 'pc', reminder_enabled: false, reminder_time_utc: null };
      logger.warn(`[list.js] User ${interaction.user.id} preferences not found, using defaults.`);
  }
  const viewMode = userPrefs.view_mode || 'pc';
  const timezoneOffset = userPrefs.timezone_offset || 0.0;

  logger.debug(`[list.js] User ID ${interaction.user.id} - Fetched Prefs: viewMode=${viewMode}, timezoneOffset=${timezoneOffset}`);
  logger.info(`[list.js] showWorldsList called - Type: ${type}, Page: ${page}, Guild: ${interaction.guildId || 'DM'}, Component: ${interaction.isMessageComponent()}`);
  const isUpdate = interaction.isMessageComponent() || interaction.type === InteractionType.ModalSubmit;
  const replyOpts = { flags: 1 << 6, fetchReply: true };

  if (isUpdate && interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
    try { await interaction.deferUpdate(replyOpts); }
    catch (deferError) { logger.error(`[list.js] Failed to defer update: ${deferError.message}`); try { await interaction.followUp({ content: 'Error processing request.', flags: 1 << 6 }); } catch {} return; }
  }

  if (!interaction.guildId) type = 'private';
  logger.info(`[list.js] Final type: ${type}, Page: ${page}`);

  let dbResult = { worlds: [], total: 0 };
  try {
    // Simplified fetch logic: only handles list view, not search results
    if (type === 'public') {
      if (interaction.guildId) { dbResult = await db.getPublicWorldsByGuild(interaction.guildId, page, CONSTANTS.PAGE_SIZE); }
    } else { // private
      dbResult = await db.getWorlds(interaction.user.id, page, CONSTANTS.PAGE_SIZE);
    }
  } catch (error) {
    logger.error(`[list.js] Error fetching worlds:`, error?.stack || error);
    const errorContent = '❌ Sorry, I couldn\'t fetch the worlds list.';
    const opts = { content: errorContent, components: [], embeds: [], flags: 1 << 6 };
    try { if (interaction.deferred || interaction.replied) await interaction.editReply(opts); else await interaction.reply(opts); }
    catch (replyError) { logger.error(`[list.js] Failed to send DB error reply: ${replyError.message}`); }
    return;
  }

  const worlds = dbResult.worlds || [];
  const totalWorlds = dbResult.total || 0;
  const totalPages = totalWorlds > 0 ? Math.ceil(totalWorlds / CONSTANTS.PAGE_SIZE) : 1;
  page = Math.max(1, Math.min(page, totalPages));

  // Add the new sorting block:
  if (worlds && worlds.length > 0) {
    logger.debug(`[list.js] Sorting worlds for display. Initial count: ${worlds.length}`);
    worlds.sort((a, b) => {
        // The primary sort by expiry_date (days_owned) is already done by the database query.
        // This JS sort refines the order for items on the current page.

        // Secondary sort: Number of letters in name (ascending)
        const nameLengthDiff = a.name.length - b.name.length;
        if (nameLengthDiff !== 0) {
            return nameLengthDiff;
        }

        // Tertiary sort: Alphabetical order of name (ascending, case-insensitive)
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    logger.debug('[list.js] Worlds sorted by name length then alphabetically.');
  }

  // === Handle Empty List ===
  if (worlds.length === 0) {
    let emptyMsg = '';
    if (type === 'public') { emptyMsg = interaction.guildId ? `🌐 No public worlds found in this server.` : '🌐 Public worlds only viewable in a server.'; if (totalWorlds > 0) emptyMsg += ` (Page ${page}/${totalPages})`; }
    else { emptyMsg = '🔒 You haven\'t added any worlds yet.'; if (totalWorlds > 0) { emptyMsg = ` Gomen 🙏, no worlds on Page ${page}/${totalPages}.`; } else { emptyMsg += ' Use `/addworld` or the button below!'; } }
    
    const emptyListComponents = [];
    if (type === 'private') { emptyListComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('addworld_button_show').setLabel('➕ Add World').setStyle(ButtonStyle.Success))); }
    emptyListComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('list_button_search').setLabel('🔍 Search').setStyle(ButtonStyle.Secondary)));
    if (interaction.guildId) { 
        const target = type === 'private' ? 'public' : 'private'; 
        emptyListComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'} Worlds`).setStyle(ButtonStyle.Secondary))); 
    }
    const opts = { content: emptyMsg, components: emptyListComponents, flags: 1 << 6 };
    try { if (interaction.deferred || interaction.replied) { await interaction.editReply(opts); } else { logger.error(`[list.js] Interaction not deferred/replied in empty list handler: ${interaction.id}.`); await interaction.reply(opts); } }
    catch (replyError) { logger.error(`[list.js] Failed editReply for empty list: ${replyError.message}`, { code: replyError.code }); }
    return;
  }
  // === End Empty Check ===

  logger.info(`[list.js] Displaying worlds (Page ${page}/${totalPages}, Count on page: ${worlds.length}, Total: ${totalWorlds})`);
  let headers;
  let data;
  let tableOutput = '';
  const selectOptions = [];
  let config;

  try {
    logger.debug('[list.js] Populating table data and select options...');

    if (viewMode === 'pc') {
      headers = ['WORLD', 'OWNED', 'LEFT', 'EXPIRES ON', 'LOCK'];
      if (type === 'public') headers.push('ADDED BY');
      data = [headers];

      worlds.forEach((world, index) => {
        logger.debug(`[list.js] PC Processing world #${index + 1} (ID: ${world?.id}, Name: ${world?.name})`);
        if (!world || typeof world !== 'object' || !world.name || !world.expiry_date || !world.lock_type || !world.id) {
          logger.warn(`[list.js] PC Skipping invalid world object: ${JSON.stringify(world)}`); return;
        }
        
        const expiryDateUTC = new Date(world.expiry_date);
        if (isNaN(expiryDateUTC.getTime())) {
          logger.warn(`[list.js] PC Skipping world with invalid expiry date (UTC): ${world.name} (${world.expiry_date})`); return;
        }

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
          selectOptions.push({
            label: world.name.toUpperCase().substring(0, 100),
            description: `Expires: ${expiryStr}`.substring(0, 100),
            value: world.id.toString(),
          });
        }
      });

      if (data.length <= 1) { logger.warn("[list.js] PC No valid world data."); const opts = { content: ` Gomen 🙏, no valid worlds on Page ${page}/${totalPages} (PC).`, components: [], flags: 1 << 6 }; if (interaction.deferred || interaction.replied) await interaction.editReply(opts); else await interaction.reply(opts); return; }

      config = {
        columns: [{ alignment: 'left', width: 15, wrapWord: true }, { alignment: 'right', width: 5 }, { alignment: 'right', width: 5 }, { alignment: 'left', width: 18 }, { alignment: 'center', width: 5 }],
        border: getBorderCharacters('norc'),
        header: { alignment: 'center', content: (type === 'public' ? '🌐 PUBLIC WORLDS' : '🔒 YOUR WORLDS') }
      };
      if (type === 'public') config.columns.push({ alignment: 'left', width: 15, wrapWord: true });

    } else if (viewMode === 'phone') {
      headers = ['WORLD', 'OWNED'];
      data = [headers];

      worlds.forEach((world, index) => {
        logger.debug(`[list.js] Phone Processing world #${index + 1} (ID: ${world?.id}, Name: ${world?.name})`);
        if (!world || typeof world !== 'object' || !world.name || !world.expiry_date || !world.lock_type || !world.id) {
          logger.warn(`[list.js] Phone Skipping invalid world object: ${JSON.stringify(world)}`); return;
        }
        const expiryDateUTC = new Date(world.expiry_date);
         if (isNaN(expiryDateUTC.getTime())) {
          logger.warn(`[list.js] Phone Skipping world with invalid expiry date (UTC): ${world.name} (${world.expiry_date})`); return;
        }

        const nowUserLocal = new Date(Date.now() + timezoneOffset * 3600000);
        const expiryUserLocal = new Date(expiryDateUTC.getTime() + timezoneOffset * 3600000);

        const expiryDatePart = new Date(Date.UTC(expiryUserLocal.getUTCFullYear(), expiryUserLocal.getUTCMonth(), expiryUserLocal.getUTCDate()));
        const nowDatePart = new Date(Date.UTC(nowUserLocal.getUTCFullYear(), nowUserLocal.getUTCMonth(), nowUserLocal.getUTCDate()));
        const daysLeft = Math.ceil((expiryDatePart.getTime() - nowDatePart.getTime()) / (1000 * 60 * 60 * 24));
        
        const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(0, 180 - daysLeft);
        
        const worldDisplay = `(${world.lock_type.charAt(0).toUpperCase()}) ${world.name.toUpperCase()}`;
        const daysOwnedDisplay = displayedDaysOwned.toString();
        data.push([worldDisplay, daysOwnedDisplay]);
      });

      if (data.length <= 1) { logger.warn("[list.js] Phone No valid world data."); const opts = { content: ` Gomen 🙏, no valid worlds on Page ${page}/${totalPages} (Phone).`, components: [], flags: 1 << 6 }; if (interaction.deferred || interaction.replied) await interaction.editReply(opts); else await interaction.reply(opts); return; }
      
      config = {
        columns: [
            { alignment: 'left', width: 18, wrapWord: true, paddingLeft: 0, paddingRight: 0 }, // For (L) WORLDNAME
            { alignment: 'right', width: 5, paddingLeft: 0, paddingRight: 0 }      // For Days Owned
        ],
        border: getBorderCharacters('norc'),
        header: {
          alignment: 'center',
          content: (type === 'public' ? '🌐 PUBLIC (Phone)' : '🔒 YOURS (Phone)')
        }
      };
    }

    logger.debug('[list.js] Generating table string...');
    try { tableOutput = '```\n' + table(data, config) + '\n```'; if (tableOutput.length > 1990) { let cutOff = tableOutput.lastIndexOf('\n', 1950); if (cutOff === -1) cutOff = 1950; tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...```'; } }
    catch (tableError) { logger.error('[list.js] Table generation failed:', tableError); tableOutput = 'Error generating table.'; throw tableError; }

    // --- Build Components (Revised Instantiation) ---
    const components = [];
    logger.debug('[list.js] Building components...');
    const navRowComponents = [
        new ButtonBuilder().setCustomId(`list_button_prev_${type}_${page}`).setLabel('⬅️ Prev').setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId(`list_button_page_${type}_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`list_button_next_${type}_${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
        new ButtonBuilder().setCustomId(`list_button_goto_${type}`).setLabel('Go to').setStyle(ButtonStyle.Secondary)
    ];

    // Toggle view button removed as per subtask

    if (navRowComponents.length > 0) { components.push(new ActionRowBuilder().addComponents(navRowComponents)); logger.debug(`[list.js] Added navRow with ${navRowComponents.length} components.`); } else { logger.warn(`[list.js] navRowComponents was unexpectedly empty.`); }
    
    const actionRow1Components = [];
    if (type === 'private') {
        actionRow1Components.push(
            new ButtonBuilder().setCustomId('addworld_button_show').setLabel('➕ Add').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('list_button_remove').setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary)
        );
    } else {
        actionRow1Components.push(
            new ButtonBuilder().setCustomId('list_button_info').setLabel('ℹ️ Info').setStyle(ButtonStyle.Primary)
        );
    }
    if (actionRow1Components.length > 0) { components.push(new ActionRowBuilder().addComponents(actionRow1Components)); logger.debug(`[list.js] Added actionRow1 with ${actionRow1Components.length} components.`); }
    
    const actionRow2Components = [];
    if (interaction.guildId) {
        const target = type === 'private' ? 'public' : 'private';
        actionRow2Components.push(
            new ButtonBuilder().setCustomId(`list_button_${type === 'private' ? 'share' : 'unshare'}`).setLabel(type === 'private' ? '🔗 Share' : '🔓 Unshare').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`list_button_switch_${target}_1`).setLabel(`🔄 View ${target === 'public' ? 'Public' : 'Your'}`).setStyle(ButtonStyle.Secondary)
        );
    }
    actionRow2Components.push(
        new ButtonBuilder().setCustomId('list_button_search').setLabel('🔍 Search').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('list_button_opensettings').setLabel('⚙️ Settings').setStyle(ButtonStyle.Secondary)
    );
    // Add the new "179 Days" button
    actionRow2Components.push(
        new ButtonBuilder()
            .setCustomId('list_button_179days')
            .setLabel('179 Days')
            .setStyle(ButtonStyle.Secondary)
    );
    if (actionRow2Components.length > 0) { components.push(new ActionRowBuilder().addComponents(actionRow2Components)); logger.debug(`[list.js] Added actionRow2 with ${actionRow2Components.length} components.`); }
    
    if (viewMode === 'pc' && selectOptions.length > 0) { const selectMenu = new StringSelectMenuBuilder().setCustomId('list_select_info').setPlaceholder('📋 Select a world for details').addOptions(selectOptions).setMaxValues(1); components.push(new ActionRowBuilder().addComponents(selectMenu)); logger.debug(`[list.js] Added selectRow with 1 component.`); } else { logger.debug(`[list.js] selectRow: No options available or phone mode.`); }
    // --- End Build Components ---

    logger.info(`[list.js] Final assembled components array length: ${components.length}`);
    if (components.some(row => !row.components || row.components.length === 0 || row.components.length > 5)) { logger.error("[list.js] FATAL: Detected an invalid ActionRow before sending!", components.map(r => r.components?.length)); throw new Error("Invalid component structure detected before sending."); }
    try { logger.debug(`[list.js] Components structure: ${JSON.stringify(components.map(row => row.toJSON()), null, 2)}`); } catch (e) { logger.error("[list.js] Failed to stringify components:", e); }

    const finalContent = `${tableOutput}\n📊 Total ${type} worlds: ${totalWorlds}`;
    const finalOpts = { content: finalContent, components: components, embeds: [], fetchReply: true };

    logger.debug('[list.js] Sending final reply/edit...');
    if (interaction.deferred || interaction.replied) { await interaction.editReply(finalOpts); }
    else { logger.error(`[list.js] Interaction not deferred/replied for table display: ${interaction.id}.`); }
    logger.debug('[list.js] Final reply/edit sent successfully.');

  } catch (e) {
    logger.error("[list.js] Error during table/components/reply:", e?.message, { stack: e?.stack, code: e?.code });
    const errorContent = "❌ Sorry, I encountered an error displaying the list.";
    const errorOpts = { content: errorContent, components: [], embeds: [], flags: 1 << 6 };
    try { if (interaction.replied || interaction.deferred) await interaction.editReply(errorOpts); else await interaction.reply(errorOpts); }
    catch (followUpError) { logger.error("[list.js] Failed to send final error message:", followUpError); }
  }
}

// --- Command Definition and Execution ---
module.exports = {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('View your tracked Growtopia worlds or public worlds in this server.'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: 1 << 6 });
    } catch (deferError) {
      logger.error("[list.js] Failed to defer reply in /list execute:", deferError);
      return;
    }
    const initialType = interaction.guildId ? 'private' : 'private';
    await showWorldsList(interaction, initialType, 1);
  },

  // --- Component Handlers ---
  async handleButton(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_button');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: 1 << 6 }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    
    const action = params[0];
    let type, page, targetType, targetPage; // viewMode is no longer in params for most buttons

    logger.info(`[list.js] Button Clicked: action=${action}, params=${params}, customId=${interaction.customId}`);

    try {
        switch(action) {
            case 'prev':
                type = params[1] || 'private';
                page = parseInt(params[2]) || 1; // Old: params[3]
                await showWorldsList(interaction, type, Math.max(1, page - 1));
                break;
            case 'next':
                type = params[1] || 'private';
                page = parseInt(params[2]) || 1; // Old: params[3]
                await showWorldsList(interaction, type, page + 1);
                break;
            case 'goto':
                type = params[1] || 'private';
                // viewMode = params[2] || 'pc'; // Removed from customId
                const modal = new ModalBuilder().setCustomId(`list_modal_goto_${type}`).setTitle('Go to Page'); 
                const pageInput = new TextInputBuilder().setCustomId('page_number').setLabel('Page Number').setPlaceholder('Enter page number').setStyle(TextInputStyle.Short).setRequired(true); 
                modal.addComponents(new ActionRowBuilder().addComponents(pageInput)); 
                await interaction.showModal(modal); 
                break;
            case 'switch':
                targetType = params[1]; // e.g. 'public' or 'private'
                // currentViewMode = params[2] || 'pc'; // Removed
                targetPage = parseInt(params[2]) || 1; // Old: params[3]
                if (targetType === 'public' || targetType === 'private') { 
                    await showWorldsList(interaction, targetType, targetPage); 
                } else { 
                    await interaction.reply({ content: 'Invalid switch target type.', flags: 1 << 6 }); 
                } 
                break;
            // case 'toggleview': // Removed
            //     type = params[1] || 'private';
            //     targetViewMode = params[2] || 'pc'; 
            //     page = parseInt(params[3]) || 1;
            //     await showWorldsList(interaction, type, page, targetViewMode); // This would now fetch viewMode internally
            //     break;
            case 'remove': await showRemoveWorldModal(interaction); break;
            case 'info': await showInfoWorldModal(interaction); break;
            case 'share': await showShareWorldModal(interaction, true); break;
            case 'unshare': await showShareWorldModal(interaction, false); break;
            case 'search': await showSearchModal(interaction); break;
            case 'opensettings':
                const { getSettingsReplyOptions } = require('./settings.js');
                const settingsReplyOptions = await getSettingsReplyOptions(interaction.user.id);
                await interaction.followUp(settingsReplyOptions); // Send as new ephemeral follow-up
                break;
            case 'page': 
                logger.info(`[list.js] Page button clicked (display only). Params: ${params.join('_')}. Deferring update.`);
                await interaction.deferUpdate(); 
                break;
            case 'view': // This case might be from an old help button or similar
                type = params[1] || 'private';
                page = parseInt(params[2]) || 1; 
                await showWorldsList(interaction, type, page); // viewMode is fetched internally
                break;
            case '179days': // Matches the customId 'list_button_179days' (action is '179days')
                logger.info(`[list.js] Button Clicked: action=179days, customId=${interaction.customId}`);
                try {
                    // Defer update as show179WorldsList will edit the reply
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferUpdate(); // Ephemeral by default from interaction handler if not specified
                    }
                } catch (deferError) {
                    logger.error(`[list.js] Failed to defer update for 179days button: ${deferError.message}`);
                    // Attempt to send a followup message if deferral fails
                    try {
                        await interaction.followUp({ content: "Error processing your request. Please try again.", flags: 1 << 6 });
                    } catch (followUpError) {
                        logger.error('[list.js] Failed to send followup after 179days defer error:', followUpError);
                    }
                    return; // Stop if deferral failed
                }
                // Call the imported function to display the 179-day list
                // Pass the current interaction and default to page 1
                await show179WorldsList(interaction, 1);
                break;
            default: logger.warn(`[list.js] Unknown list button action: ${action}`); await interaction.reply({ content: 'Unknown button action.', flags: 1 << 6 });
        }
    } catch (error) {
        logger.error(`[list.js] Error executing list button handler for action ${action}:`, error?.stack || error);
        const errorReply = { content: 'An error occurred processing this action.', flags: 1 << 6 };
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
    }
  },

  async handleSelectMenu(interaction, params) {
    const cooldown = utils.checkCooldown(interaction.user.id, 'list_select');
    if (cooldown.onCooldown) { try { await interaction.reply({ content: `⏱️ Please wait ${cooldown.timeLeft} seconds.`, flags: 1 << 6 }); } catch (e) { logger.error("[list.js] Error sending cooldown message", e)} return; }
    const action = params[0];
    logger.info(`[list.js] Select Menu Used: action=${action}, customId=${interaction.customId}, values=${interaction.values}`);
    if (action === 'info') {
      if (!interaction.values || interaction.values.length === 0) { await interaction.reply({ content: "No world selected.", flags: 1 << 6 }); return; }
      const worldId = parseInt(interaction.values[0]); if (isNaN(worldId)) { await interaction.reply({ content: "Invalid world ID selected.", flags: 1 << 6 }); return; }
      try {
        let world = await db.getWorldById(worldId); if (!world) { await interaction.reply({ content: `❌ World with ID ${worldId} not found.`, flags: 1 << 6 }); return; }
        if (world.user_id !== interaction.user.id && !world.is_public) { await interaction.reply({ content: '🔒 You do not have permission to view details for this world.', flags: 1 << 6 }); return; }
        await showWorldInfo(interaction, world); // showWorldInfo handles reply/update
      } catch (error) {
        logger.error(`[list.js] Error fetching/showing world info from select menu (ID: ${worldId}):`, error?.stack || error);
        const errorReply = { content: 'An error occurred while fetching world details.', flags: 1 << 6 };
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
      }
    } else { logger.warn(`[list.js] Unhandled list select menu action: ${action}`); await interaction.reply({ content: "Unknown select menu action.", flags: 1 << 6 }); }
  },

  async handleModal(interaction, params) {
    const action = params[0];
    // For goto: params[1] is type. viewMode is no longer part of modal customId.
    // For others, params structure remains the same as they don't involve viewMode in their customId.
    logger.info(`[list.js] Modal Submitted: action=${action}, params=${params}, customId=${interaction.customId}`);
    try {
      switch(action) {
        case 'goto': { 
            const type = params[1] || 'private'; // Type is still part of modal customId
            // const viewMode = params[2] || 'pc'; // viewMode removed from modal customId
            const pageInput = interaction.fields.getTextInputValue('page_number'); 
            const pageNumber = parseInt(pageInput); 
            if (isNaN(pageNumber) || pageNumber < 1) { 
                await interaction.reply({ content: '❌ Invalid page number entered.', flags: 1 << 6 }); 
                return; 
            } 
            await interaction.deferUpdate(); 
            await showWorldsList(interaction, type, pageNumber); // Call without viewMode
            break; 
        }
        case 'remove': {
            // This modal's customId is 'list_modal_remove', so params[1] etc. are not set here.
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim();
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, flags: 1 << 6 }); 
                return; 
            }
            // Note: The remove confirmation buttons (remove_button_confirm_worldId, remove_button_cancel_worldId)
            // are handled by the remove.js command's handleButton, not here.
            // This modal (list_modal_remove) only initiates the confirmation step.
            const confirmId = `remove_button_confirm_${world.id}`; 
            const cancelId = `remove_button_cancel_${world.id}`;
            const row = new ActionRowBuilder().addComponents( 
                new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger), 
                new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary) 
            );
            await interaction.reply({ content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`, components: [row], flags: 1 << 6 });
            break;
        }
        case 'share': 
        case 'unshare': {
            // These modals customId are 'list_modal_share' or 'list_modal_unshare'
            if (!interaction.guildId) { 
                await interaction.reply({ content: "Sharing/unsharing only possible in a server.", flags: 1 << 6 }); 
                return; 
            }
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            const world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, null);
            if (!world || world.user_id !== interaction.user.id) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found in your list.`, flags: 1 << 6 }); 
                return; 
            }
            const makePublic = (action === 'share'); // 'share' or 'unshare'
            if (makePublic && world.is_public && world.guild_id === interaction.guildId) { 
                await interaction.reply({ content: `🌐 **${world.name.toUpperCase()}** is already public here.`, flags: 1 << 6 }); 
                return; 
            }
            if (!makePublic && !world.is_public) { 
                await interaction.reply({ content: `🔒 **${world.name.toUpperCase()}** is already private.`, flags: 1 << 6 }); 
                return; 
            }
            if (makePublic) { 
                const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId); 
                if (existingPublic && existingPublic.id !== world.id) { 
                    await interaction.reply({ content: `❌ Another public world named **${world.name.toUpperCase()}** already exists here.`, flags: 1 << 6 }); 
                    return; 
                } 
            }
            const guildToSet = makePublic ? interaction.guildId : null; // Unsharing makes it fully private (guildId=null)
            const success = await db.updateWorldVisibility(world.id, interaction.user.id, makePublic, guildToSet);
            if (success) { 
                await require('./search.js').invalidateSearchCache(); 
                await require('./utils/share_and_history.js').logHistory(world.id, interaction.user.id, action, `World ${world.name.toUpperCase()} ${action}d in guild ${interaction.guildId}`); 
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('list_button_view_private_1') // No viewMode needed here, it defaults to pc
                            .setLabel('View My Worlds')
                            .setStyle(ButtonStyle.Primary)
                    );
                await interaction.reply({ content: `✅ **${world.name.toUpperCase()}** is now ${makePublic ? 'public in this server' : 'private'}.`, components: [row], flags: 1 << 6 }); 
            } else { 
                await interaction.reply({ content: `❌ Failed to ${action} **${world.name.toUpperCase()}**.`, flags: 1 << 6 }); 
            }
            break;
        }
        case 'info': { 
            // This modal's customId is 'list_modal_info'
            const worldIdentifier = interaction.fields.getTextInputValue('worldName').trim(); 
            let world = await db.findWorldByIdentifier(interaction.user.id, worldIdentifier, interaction.guildId); 
            if (!world) { 
                await interaction.reply({ content: `❌ World "**${worldIdentifier}**" not found or not accessible.`, flags: 1 << 6 }); 
                return; 
            } 
            await showWorldInfo(interaction, world); // showWorldInfo defaults its own viewMode if needed
            break; 
        }
        default: logger.warn(`[list.js] Unhandled list modal action: ${action} from customId: ${interaction.customId}`); await interaction.reply({ content: "This form submission is not recognized.", flags: 1 << 6 });
      }
    } catch (error) {
      logger.error(`[list.js] Error handling modal ${interaction.customId}:`, error?.stack || error);
      const errorReply = { content: 'An error occurred processing this form.', flags: 1 << 6 };
      try { if (!interaction.replied && !interaction.deferred) await interaction.reply(errorReply); else await interaction.followUp(errorReply); } catch {}
    }
  },
};