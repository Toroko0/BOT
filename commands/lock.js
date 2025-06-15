// lock.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { table, getBorderCharacters } = require('table');
const CONSTANTS = require('../utils/constants');
const utils = require('../utils.js');

// --- Helper Functions ---
function encodeFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) return 'e30'; // Represents {} in base64url
  return Buffer.from(JSON.stringify(filters)).toString('base64url');
}

function decodeFilters(encodedString) {
  if (!encodedString || encodedString === 'e30') return {};
  try {
    return JSON.parse(Buffer.from(encodedString, 'base64url').toString('utf8'));
  } catch (e) {
    logger.error('[lock.js] Failed to decode filters:', { error: e, encodedString });
    return {};
  }
}

// --- Main Display Function ---
async function showLockedWorldsList(interaction, page = 1, currentFilters = {}) {
  const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
  if (isUpdate && !interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
  } else if (!isUpdate && !interaction.deferred && !interaction.replied) {
       await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const { worlds, total } = await db.getLockedWorlds(interaction.user.id, page, CONSTANTS.PAGE_SIZE, currentFilters);
  const totalPages = Math.max(1, Math.ceil(total / CONSTANTS.PAGE_SIZE));
  page = Math.max(1, Math.min(page, totalPages));
  const encodedFilters = encodeFilters(currentFilters);

  if (total === 0) {
    let content = "You have no locked worlds. Use `/lock add` to add some!";
    const components = [];
    if (Object.keys(currentFilters).length > 0) {
      content = "No locked worlds match your current filters.";
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lock_button_clearfilter`).setLabel('Clear Filters').setStyle(ButtonStyle.Danger)
      ));
    }
    const opts = { content, embeds: [], components, flags: MessageFlags.Ephemeral };
    // Use editReply for updates, reply for initial command
    if (interaction.deferred || interaction.replied) await interaction.editReply(opts); else await interaction.reply(opts);
    return;
  }

  const headers = ['ID', 'WORLD', 'TYPE', 'LOCKED ON', 'NOTE'];
  const data = [headers];

  worlds.forEach(world => {
    data.push([
      world.id.toString(),
      world.world_name,
      world.lock_type,
      world.locked_on_date ? new Date(world.locked_on_date).toLocaleDateString('en-CA') : 'N/A',
      world.note || 'N/A'
    ]);
  });

  const tableConfig = {
    columns: [ { alignment: 'right', width: 6 }, { width: 15 }, { width: 8 }, { width: 12 }, { width: 25, wrapWord: true } ],
    border: getBorderCharacters('norc'),
  };

  let tableOutput = `\`\`\`\n${table(data, tableConfig)}\n\`\`\``;
  const footerText = `\n📊 Total: ${total} | Page ${page}/${totalPages}${Object.keys(currentFilters).length > 0 ? ' (Filtered)' : ''}`;
  if (tableOutput.length + footerText.length > 1990) {
      tableOutput = tableOutput.substring(0, tableOutput.lastIndexOf('\n', 1900)) + '\n... (Table truncated) ...```';
  }
  const finalContent = `${tableOutput}${footerText}`;

  const components = [];
  components.push(utils.createPaginationRow(`lock_button_page_${encodedFilters}`, page, totalPages));

  if (worlds.length > 0) {
    const selectOptions = worlds.map(w => new StringSelectMenuOptionBuilder()
        .setLabel(`ID: ${w.id} - ${w.world_name}`)
        .setDescription(w.note ? `Note: ${w.note.substring(0, 50)}` : 'No note provided.')
        .setValue(w.id.toString())
    );
    components.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('lock_select_manage').setPlaceholder('Select a lock to manage...').addOptions(selectOptions)
    ));
  }
  
  const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lock_button_filtershow').setLabel('🔍 Filter List').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`lock_button_export_${page}_${encodedFilters}`).setLabel('📄 Export Page').setStyle(ButtonStyle.Success)
  );
  if (Object.keys(currentFilters).length > 0) {
      actionRow.addComponents(new ButtonBuilder().setCustomId('lock_button_clearfilter').setLabel('Clear Filters').setStyle(ButtonStyle.Danger));
  }
  components.push(actionRow);

  const opts = { content: finalContent, embeds: [], components, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.editReply(opts); else await interaction.reply(opts);
}

// --- Interaction Handlers ---
async function handleButtonCommand(interaction, params) {
  const [action, ...args] = params;
  
  switch(action) {
    case 'page': {
      const [encodedFilters, pageStr] = args;
      await showLockedWorldsList(interaction, parseInt(pageStr), decodeFilters(encodedFilters));
      break;
    }
    case 'goto': {
      const [encodedFilters] = args;
      const modal = new ModalBuilder().setCustomId(`lock_modal_goto_${encodedFilters}`).setTitle('Go To Page');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('page_number').setLabel('Page Number').setStyle(TextInputStyle.Short).setRequired(true)));
      await interaction.showModal(modal);
      break;
    }
    case 'filtershow': {
      const modal = new ModalBuilder().setCustomId('lock_modal_filterapply').setTitle('Filter Locked Worlds');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_prefix').setLabel('World Prefix (Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_min_len').setLabel('Min Name Length (Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_max_len').setLabel('Max Name Length (Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_type').setLabel('Lock Type (main/out, Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('filter_note').setLabel('Note Contains (Optional)').setStyle(TextInputStyle.Short).setRequired(false))
      );
      await interaction.showModal(modal);
      break;
    }
    case 'clearfilter': {
      await showLockedWorldsList(interaction, 1, {});
      break;
    }
    case 'export': {
       await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const [pageStr, encodedFilters] = args;
      const { worlds } = await db.getLockedWorlds(interaction.user.id, parseInt(pageStr), CONSTANTS.PAGE_SIZE, decodeFilters(encodedFilters));
      if (worlds.length === 0) { await interaction.editReply({ content: 'No names to export on this page.' }); return; }
      const exportText = "```\n" + worlds.map(w => w.world_name).join('\n') + "\n```";
      await interaction.editReply({ content: exportText.substring(0, 2000) });
      break;
    }
    case 'confirmremove': {
      const [confirm, worldId] = args;
      if (confirm === 'yes') {
        const success = await db.removeLockedWorldById(interaction.user.id, parseInt(worldId));
        await interaction.update({ content: success ? `✅ Lock ID ${worldId} removed.` : `❌ Failed to remove lock ID ${worldId}. It may have already been removed or is listed on the market.`, components: [] });
      } else {
        await interaction.update({ content: '❌ Removal cancelled.', components: [] });
      }
      break;
    }
    case 'marketlist': { // This is now a button to open a modal
        const [worldId] = args;
        const world = await db.getLockedWorldById(interaction.user.id, parseInt(worldId));
        if(!world) return interaction.update({content: 'Error: Could not find this world to list it.', components:[]});

        const modal = new ModalBuilder().setCustomId(`lock_modal_marketlist_${worldId}`).setTitle(`List ${world.world_name} on Market`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price_dl').setLabel('Price in Diamond Locks (DLs)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('listing_note').setLabel('Optional Note for Listing').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        await interaction.showModal(modal);
        break;
    }
  }
}

async function handleModalSubmitCommand(interaction, params) {
  const [action, ...args] = params;

  switch(action) {
    case 'goto': {
      const [encodedFilters] = args;
      const page = parseInt(interaction.fields.getTextInputValue('page_number'));
      if (isNaN(page) || page < 1) return interaction.reply({ content: 'Invalid page number.', flags: MessageFlags.Ephemeral });
      await showLockedWorldsList(interaction, page, decodeFilters(encodedFilters));
      break;
    }
    case 'filterapply': {
        const newFilters = {};
        const prefix = interaction.fields.getTextInputValue('filter_prefix')?.trim() || null;
        const minLen = parseInt(interaction.fields.getTextInputValue('filter_min_len')?.trim()) || null;
        const maxLen = parseInt(interaction.fields.getTextInputValue('filter_max_len')?.trim()) || null;
        const lockType = interaction.fields.getTextInputValue('filter_type')?.trim().toLowerCase() || null;
        const note = interaction.fields.getTextInputValue('filter_note')?.trim() || null;
        
        if (prefix) newFilters.prefix = prefix;
        if (minLen || maxLen) {
            newFilters.nameLength = {};
            if (minLen) newFilters.nameLength.min = minLen;
            if (maxLen) newFilters.nameLength.max = maxLen;
        }
        if (lockType && ['main', 'out'].includes(lockType)) newFilters.lockType = lockType;
        if (note) newFilters.note = note;
      
        await showLockedWorldsList(interaction, 1, newFilters);
        break;
    }
    case 'marketlist': {
       await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const [worldId] = args;
      const price = parseInt(interaction.fields.getTextInputValue('price_dl'));
      const note = interaction.fields.getTextInputValue('listing_note')?.trim() || null;
      if (isNaN(price) || price <= 0) return interaction.editReply({ content: '❌ Invalid price.' });

      const result = await db.createMarketListing(interaction.user.id, parseInt(worldId), price, note);
      if (result.success) {
        await interaction.editReply({ content: `✅ World listed successfully! Listing ID: **${result.listingId}**` });
      } else {
        await interaction.editReply({ content: `❌ Error listing world: ${result.error === 'already_listed' ? 'This world is already listed.' : 'A database error occurred.'}` });
      }
      break;
    }
  }
}

async function handleSelectMenuCommand(interaction, params) {
    const [action] = params;
    if (action !== 'manage') return;

    const worldId = interaction.values[0];
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lock_button_confirmremove_yes_${worldId}`).setLabel('🗑️ Remove Lock').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`lock_button_marketlist_${worldId}`).setLabel('💰 List on Market').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lock_button_confirmremove_no_0`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Managing Lock ID **${worldId}**. What would you like to do?`, components: [row], flags: MessageFlags.Ephemeral });
}

// --- Main Export ---
module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Manages your locked worlds.')
    .addSubcommand(sub => sub.setName('add').setDescription('Adds a world to your locked list.').addStringOption(o => o.setName('worldname').setRequired(true).setDescription('Name of the world.')).addStringOption(o => o.setName('lock_type').setDescription('main or out').addChoices({name: 'Main', value: 'main'}, {name: 'Out', value: 'out'})).addStringOption(o => o.setName('note').setDescription('Optional note.')))
    .addSubcommand(sub => sub.setName('view').setDescription('View your locked worlds list.'))
    .addSubcommand(sub => sub.setName('remove').setDescription('Removes a world from your locked list.').addStringOption(o => o.setName('worldname').setRequired(true).setDescription('Exact name of the locked world.'))),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'view') {
      await showLockedWorldsList(interaction, 1, {});
    } else if (subcommand === 'add') {
      const worldName = interaction.options.getString('worldname');
      if (worldName.includes(' ')) return interaction.reply({ content: '❌ World names cannot contain spaces.', flags: MessageFlags.Ephemeral });
      const result = await db.addLockedWorld(interaction.user.id, worldName.toUpperCase(), interaction.options.getString('lock_type') || 'main', interaction.options.getString('note'));
      await interaction.reply({ content: result.success ? `✅ **${worldName.toUpperCase()}** added to locks.` : `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
    } else if (subcommand === 'remove') {
      const worldName = interaction.options.getString('worldname').toUpperCase();
      const world = await db.findLockedWorldByName(interaction.user.id, worldName);
      if (!world) return interaction.reply({ content: `❌ World "${worldName}" not found in your locks.`, flags: MessageFlags.Ephemeral });
      const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lock_button_confirmremove_yes_${world.id}`).setLabel('Confirm Remove').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`lock_button_confirmremove_no_0`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ content: `⚠️ Are you sure you want to remove **${worldName}**?`, components: [row], flags: MessageFlags.Ephemeral });
    }
  },
  // async handleInteraction(interaction) { // Commented out as per subtask, assuming interactionHandler.js routes to specific functions
  //   const [context, componentType, ...params] = interaction.customId.split('_');
  //   if (context !== 'lock') return;

  //   if (interaction.isButton()) {
  //     await handleButtonCommand(interaction, [componentType, ...params]);
  //   } else if (interaction.isModalSubmit()) {
  //     await handleModalSubmitCommand(interaction, [componentType, ...params]);
  //   } else if (interaction.isStringSelectMenu()) {
  //     await handleSelectMenuCommand(interaction, [componentType, ...params]);
  //   }
  // },
  showLockedWorldsList,
  handleButtonCommand,        // Add this export
  handleModalSubmitCommand,   // Add this export
  handleSelectMenuCommand     // Add this export
};
