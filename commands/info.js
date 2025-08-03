const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const db = require('../database.js');
const utils = require('../utils.js');
const { invalidateSearchCache } = require('./search.js'); // Assuming search.js exports this
const logger = require('../utils/logger.js'); // Added logger
const { logHistory } = require('../utils/share_and_history.js'); // For logging edits
const CONSTANTS = require('../utils/constants.js'); // For select options limit

// Function to show the Edit World Modal
async function showEditWorldModal(interaction, world) {
    // Use the standardized custom ID format
    const modal = new ModalBuilder()
      .setCustomId(`info_modal_edit_${world.id}`) // command_modal_action_id
      .setTitle(`✏️ Edit: ${world.name.toUpperCase()}`);

    // Pre-fill with current data from the database
    const currentDaysOwned = world.days_owned.toString();
    const currentLockType = world.lock_type === 'mainlock' ? 'M' : 'O';
    const currentCustomId = world.custom_id || '';
    // Determine if public *in this specific guild* or globally private
    const isPublicInGuild = world.is_public && world.guild_id === interaction.guildId;
    const currentIsPublic = isPublicInGuild ? 'yes' : 'no';

    const daysOwnedInput = new TextInputBuilder()
        .setCustomId('editDaysOwned')
        .setLabel("Days Owned (1-180)")
        .setStyle(TextInputStyle.Short)
        .setValue(currentDaysOwned)
        .setRequired(true)
        .setMaxLength(3);

    const lockTypeInput = new TextInputBuilder()
        .setCustomId('editLockType')
        .setLabel("Lock Type (M/O)")
        .setStyle(TextInputStyle.Short)
        .setValue(currentLockType)
        .setRequired(true)
        .setMaxLength(1);

    const customIdInput = new TextInputBuilder()
        .setCustomId('editCustomId')
        .setLabel("Custom ID (Optional)")
        .setStyle(TextInputStyle.Short)
        .setValue(currentCustomId)
        .setRequired(false)
        .setMaxLength(24);

    // Only show public toggle if in a guild
    const components = [
        new ActionRowBuilder().addComponents(daysOwnedInput),
        new ActionRowBuilder().addComponents(lockTypeInput),
        new ActionRowBuilder().addComponents(customIdInput),
    ];
    if (interaction.guildId) {
        const isPublicInput = new TextInputBuilder()
            .setCustomId('editIsPublic')
            .setLabel(`Public in this Server? (yes/no)`)
            .setStyle(TextInputStyle.Short)
            .setValue(currentIsPublic)
            .setRequired(true)
            .setMaxLength(3);
        components.push(new ActionRowBuilder().addComponents(isPublicInput));
    }


    modal.addComponents(components);
    await interaction.showModal(modal);
}

// Display detailed world information
async function showWorldInfo(interaction, world) {
  const expiryDate = new Date(world.expiry_date);
  const today = new Date();
  const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiryMidnight = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  const daysLeft = Math.ceil((expiryMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
  const displayedDaysOwned = daysLeft <= 0 ? 180 : Math.max(1, 180 - daysLeft); // Use 1 instead of 0

  const formattedExpiryDate = expiryDate.toLocaleDateString('en-US', { timeZone: 'UTC' });
  const dayOfWeek = expiryDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  let statusIcon, statusColor;
  if (daysLeft <= 0) { statusIcon = '🔴'; statusColor = 0xFF0000; } // Red
  else if (daysLeft <= 7) { statusIcon = '🟠'; statusColor = 0xFFA500; } // Orange
  else if (daysLeft <= 30) { statusIcon = '🟡'; statusColor = 0xFFFF00; } // Yellow
  else { statusIcon = '🟢'; statusColor = 0x00FF00; } // Green

  const isMainLock = world.lock_type === 'mainlock';
  const lockIcon = isMainLock ? '🧲' : '👑'; // Using different icons
  const lockTypeDisplay = isMainLock ? 'Main Lock' : 'Out Lock';

  // Determine public status display based on context
  let visibilityText = '🔒 Private';
  let visibilityIcon = '🔒';
  if (world.is_public) {
      if (world.guild_id === interaction.guildId) {
          visibilityText = '🌍 Public (This Server)';
          visibilityIcon = '🌍';
      } else if (world.guild_id) {
          visibilityText = '🌍 Public (Another Server)';
           visibilityIcon = '🌐'; // Different icon maybe?
      } else {
          // Should not happen based on current logic, but handle just in case
           visibilityText = '❓ Public (Unknown Server)';
           visibilityIcon = '❓';
      }
  }


  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`${statusIcon} Info: ${world.name.toUpperCase()}`)
    .setDescription(`World details retrieved for <@${interaction.user.id}>`)
    .addFields(
      { name: '📊 Days Owned', value: `${displayedDaysOwned} days`, inline: true },
      { name: '📅 Expiry Date', value: `${formattedExpiryDate}\n(${dayOfWeek})`, inline: true }, // Added newline
      { name: '⏳ Days Left', value: daysLeft <= 0 ? '**EXPIRED**' : `${daysLeft} days`, inline: true },
      { name: '🔑 Lock Type', value: `${lockIcon} ${lockTypeDisplay}`, inline: true },
      { name: '👁️ Visibility', value: `${visibilityIcon} ${visibilityText}`, inline: true }
    )
    .setFooter({ text: `World ID: ${world.id} | Added: ${new Date(world.added_date).toLocaleDateString()}` }); // Added footer

  if (world.custom_id) {
    embed.addFields({ name: '🏷️ Custom ID', value: world.custom_id.toUpperCase(), inline: true });
  }
  if (world.added_by) {
      embed.addFields({ name: '👤 Added By', value: world.added_by, inline: true });
  }


  const components = [];
  const replyOpts = { flags: MessageFlags.Ephemeral }; // Ephemeral by default


  // Show management buttons only if the user owns the world
  if (world.added_by_username === interaction.user.username) {
    const mgmtButtonsRow = new ActionRowBuilder();
    // Share button: Enabled only if private OR public in another server
    mgmtButtonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`info_button_share_${world.id}`) // Correct prefix
        .setLabel('🌍 Share Here')
        .setStyle(ButtonStyle.Success) // Success for sharing
        .setDisabled(world.is_public && world.guild_id === interaction.guildId) // Disabled if already public here
    );
     // Unshare button: Enabled only if public in THIS server
     mgmtButtonsRow.addComponents(
       new ButtonBuilder()
        .setCustomId(`info_button_unshare_${world.id}`) // Correct prefix
        .setLabel('🔒 Make Private')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!world.is_public || world.guild_id !== interaction.guildId) // Disabled if private or public elsewhere
    );
    // Edit button
    mgmtButtonsRow.addComponents(
       new ButtonBuilder()
        .setCustomId(`info_button_edit_${world.id}`) // Correct prefix
        .setLabel('✏️ Edit')
        .setStyle(ButtonStyle.Primary)
    );
    // Remove button
    mgmtButtonsRow.addComponents(
       new ButtonBuilder()
        .setCustomId(`info_button_remove_${world.id}`) // Changed prefix
        .setLabel('🗑️ Remove')
        .setStyle(ButtonStyle.Danger)
    );
    if (mgmtButtonsRow.components.length > 0) {
        components.push(mgmtButtonsRow);
    }
  }

  const replyOptions = { ...replyOpts, embeds: [embed], components: components };

    try {
        // Use update for components, reply for initial command
        if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
             if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate(); // deferUpdate doesn't take flags
             await interaction.editReply(replyOptions);
        } else {
             // For initial slash command execution, defer and then edit.
             if (!interaction.deferred && !interaction.replied) await interaction.deferReply(replyOpts);
             await interaction.editReply(replyOptions);
        }
    } catch (error) {
        logger.error("[info.js] Error showing world info / sending reply:", error?.stack || error);
        // Try to send a followup if the initial reply/edit failed
        try {
             await interaction.followUp({ ...replyOpts, content: "❌ Sorry, I couldn't display the world info due to a server error." });
        } catch (followUpError) {
             logger.error("[info.js] Failed info error followUp:", followUpError);
        }
    }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('View detailed info about a tracked world')
    .addStringOption(o => o.setName('world').setDescription('World name or custom ID').setRequired(true).setAutocomplete(true)),

  async execute(interaction) {
    const worldIdentifier = interaction.options.getString('world');
    const replyOpts = { flags: MessageFlags.Ephemeral };
    const cooldown = utils.checkCooldown(interaction.user.id, 'info_cmd', 3);
    if (cooldown.onCooldown) { await interaction.reply({ ...replyOpts, content: `⏱️ Wait ${cooldown.timeLeft}s.` }); return; }

    // Add user silently (handled by interaction handler)
    // await db.addUser(interaction.user.id, interaction.user.username);

    // Defer early as DB lookup might take time
    await interaction.deferReply(replyOpts);

    const world = await db.findWorldByIdentifier(worldIdentifier);

    if (!world) {
        await interaction.editReply({ content: `❌ World/ID "**${worldIdentifier}**" not found or not accessible.` });
        return;
    }
    // showWorldInfo handles editing the reply
    await showWorldInfo(interaction, world);
  },

  async handleButton(interaction, params) {
    // Structure: info_button_action_worldId
    const action = params[0];
    const worldId = params[1];
    const replyOpts = { flags: MessageFlags.Ephemeral };
    const cooldown = utils.checkCooldown(interaction.user.id, `info_btn_${action}`, 2); // Shorter cooldown for buttons
    if (cooldown.onCooldown) { await interaction.reply({ ...replyOpts, content: `⏱️ Wait ${cooldown.timeLeft}s.` }); return; }

    if (!worldId) { await interaction.reply({ ...replyOpts, content: '❌ Invalid action: Missing world ID.' }); return; }

    const world = await db.getWorldById(worldId);
    if (!world) { await interaction.update({ content: '❌ World not found.', embeds: [], components: [], flags: MessageFlags.Ephemeral }); return; }
    if (world.user_id !== interaction.user.id) { await interaction.reply({ ...replyOpts, content: '❌ You do not own this world.' }); return; }

    let success = false;
    let feedback = '';
    try {
        switch (action) {
            case 'share':
                if (!interaction.guildId) { feedback = '❌ Sharing only possible in servers.'; break; }
                 // Check for duplicate public world name in *this* guild if sharing
                 const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId);
                 if (existingPublic && existingPublic.id !== world.id) {
                     feedback = `❌ Another public world named **${world.name.toUpperCase()}** already exists here.`;
                     break;
                 }
                success = await db.updateWorldVisibility(worldId, interaction.user.id, true, interaction.guildId);
                feedback = success ? `✅ **${world.name.toUpperCase()}** is now public in this server.` : `❌ Failed to share.`;
                if (success) await logHistory(worldId, interaction.user.id, 'share', `Shared world ${world.name.toUpperCase()} in guild ${interaction.guildId}`);
                break;
            case 'unshare':
                // Unsharing always makes it fully private (guildId=null)
                success = await db.updateWorldVisibility(worldId, interaction.user.id, false, null);
                feedback = success ? `✅ **${world.name.toUpperCase()}** is now private.` : `❌ Failed to unshare.`;
                 if (success) await logHistory(worldId, interaction.user.id, 'unshare', `Unshared world ${world.name.toUpperCase()}`);
                break;
            case 'edit':
                // Show the edit modal
                await showEditWorldModal(interaction, world);
                return; // Modal shown, no further feedback needed here
            case 'remove':
                // world and ownership already checked before switch
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`remove_button_confirm_${world.id}`)
                        .setLabel('Confirm Remove')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`remove_button_cancel_${world.id}`)
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
                await interaction.update({ // Use update as we are responding to a button click
                    content: `⚠️ Are you sure you want to remove **${world.name.toUpperCase()}**?`,
                    components: [confirmRow],
                    flags: MessageFlags.Ephemeral, // Ephemeral
                    embeds: [] // Clear existing embed
                });
                return; // Return here to prevent falling through to generic feedback
            default:
                feedback = '❌ Unknown action.'; break;
        }

        if (success) invalidateSearchCache(); // Invalidate cache on success

        // If action was share/unshare and successful, refresh the info display
        if (success && (action === 'share' || action === 'unshare')) {
            const updatedWorld = await db.getWorldById(worldId);
            if (updatedWorld) {
                await showWorldInfo(interaction, updatedWorld); // This handles the interaction update
                // Send ephemeral followup confirmation
                await interaction.followUp({ ...replyOpts, content: feedback });
            } else {
                 // Failed to refetch, edit the original interaction with error
                 await interaction.editReply({ ...replyOpts, content: '❌ Error refreshing world info after update.', embeds: [], components: [] });
            }
        } else if (feedback) { // Only send feedback if it's set (and not for 'remove' case)
            // If action failed or was unknown, send ephemeral reply/followup
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ ...replyOpts, content: feedback });
            else await interaction.followUp({ ...replyOpts, content: feedback });
        }
    } catch (e) {
        logger.error(`[info.js] Err handling button ${action} for world ${worldId}:`, e?.stack || e);
        try { await interaction.followUp({ ...replyOpts, content: '❌ An error occurred.' }); } catch {}
    }
  },

  async handleModal(interaction, params) {
      // Structure: info_modal_action_worldId
      const action = params[0];
      const worldId = params[1];
      const replyOpts = { flags: MessageFlags.Ephemeral }; // Ephemeral

      if (action === 'edit') {
           if (!worldId) { await interaction.reply({ ...replyOpts, content: "❌ Error: Missing world ID for edit." }); return; }

           const world = await db.getWorldById(worldId);
           if (!world || world.user_id !== interaction.user.id) {
               await interaction.reply({ ...replyOpts, content: '❌ World not found or you do not own it.' }); return;
           }

           // Get data from modal fields
           const daysOwnedStr = interaction.fields.getTextInputValue('editDaysOwned');
           const lockTypeStr = interaction.fields.getTextInputValue('editLockType').toUpperCase();
           const customIdStr = interaction.fields.getTextInputValue('editCustomId').trim();
           // Public status might not exist if modal was shown in DMs
           const isPublicStr = interaction.guildId ? interaction.fields.getTextInputValue('editIsPublic').toLowerCase() : 'no'; // Default to no if not in guild context


           // --- Validation ---
           const daysOwned = parseInt(daysOwnedStr);
           if (isNaN(daysOwned) || daysOwned < 1 || daysOwned > 180) { await interaction.reply({ ...replyOpts, content: "❌ Invalid Days Owned (1-180)." }); return; }
           if (lockTypeStr !== 'M' && lockTypeStr !== 'O') { await interaction.reply({ ...replyOpts, content: "❌ Invalid Lock Type (M/O)." }); return; }
           if (isPublicStr !== 'yes' && isPublicStr !== 'no') { await interaction.reply({ ...replyOpts, content: "❌ Invalid Public value (yes/no)." }); return; }
           // Optional: Custom ID validation (e.g., format, uniqueness check handled by DB update)
           // --- End Validation ---

           const normalizedLockType = lockTypeStr === 'O' ? 'outlock' : 'mainlock';
           const makePublic = isPublicStr === 'yes';
           const guildIdForUpdate = makePublic ? interaction.guildId : null; // Only set guild ID if making public

           const updatedData = {
               daysOwned: daysOwned, // Pass validated number
               lockType: normalizedLockType,
               customId: customIdStr || null, // Ensure empty becomes null
           };

           try {
                // Check for duplicate public name if making public
                if (makePublic && world.is_public === 0) { // Only check if changing TO public
                     const existingPublic = await db.getPublicWorldByName(world.name, interaction.guildId);
                     if (existingPublic && existingPublic.id !== world.id) {
                         await interaction.reply({ ...replyOpts, content: `❌ Cannot make public: Another public world named **${world.name.toUpperCase()}** already exists here.` });
                         return;
                     }
                }

               // Update core world details (days, lock, custom ID)
               await db.updateWorld(worldId, interaction.user.id, updatedData);
               // Separately update visibility
               await db.updateWorldVisibility(worldId, interaction.user.id, makePublic, guildIdForUpdate);

               invalidateSearchCache(); // Invalidate cache
               await logHistory(worldId, interaction.user.id, 'edit', `Edited world ${world.name.toUpperCase()} via modal`);

               // Fetch updated world and show info again
                const updatedWorld = await db.getWorldById(worldId);
                if (updatedWorld) {
                    // Update the original message with new info
                    await showWorldInfo(interaction, updatedWorld);
                    // Send ephemeral confirmation
                    await interaction.followUp({ ...replyOpts, content: `✅ World **${updatedWorld.name.toUpperCase()}** updated!` });
                } else {
                    await interaction.reply({ ...replyOpts, content: `✅ World updated, but failed to refresh info.` });
                }
           } catch (error) {
                logger.error(`[info.js] Error updating world ${worldId} via modal:`, error?.stack || error);
                await interaction.reply({ ...replyOpts, content: `❌ Error updating world: ${error.message}` });
           }
      } else {
           logger.warn(`[info.js] Received unknown modal action: ${action}`);
           await interaction.reply({ content: 'Unknown form action.', flags: MessageFlags.Ephemeral });
      }
  },

  // Add autocomplete handler
  async autocomplete(interaction) {
        if (!interaction.isAutocomplete()) return;
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

        if (focusedOption.name === 'world') {
            try {
                // Fetch user's worlds + public worlds in this guild
                const identifierQuery = focusedOption.value.toLowerCase();
                // Combine results from user's worlds and public worlds (limit each)
                const userWorldsResult = await db.getFilteredWorlds({ added_by_username: interaction.user.username }, 1, 25);
                let publicWorldsResult = { worlds: [], total: 0 };
                if (interaction.guildId) {
                     publicWorldsResult = await db.getFilteredWorlds({ is_public: true, guild_id: interaction.guildId }, 1, 25);
                }

                const combinedWorlds = [...userWorldsResult.worlds];
                // Add public worlds, avoiding duplicates by ID
                const userWorldIds = new Set(userWorldsResult.worlds.map(w => w.id));
                publicWorldsResult.worlds.forEach(pw => {
                    if (!userWorldIds.has(pw.id)) {
                        combinedWorlds.push(pw);
                    }
                });

                choices = combinedWorlds
                    .filter(w =>
                        w.name.toLowerCase().includes(identifierQuery) ||
                        (w.custom_id && w.custom_id.toLowerCase().includes(identifierQuery))
                    )
                    .slice(0, CONSTANTS.MAX_SELECT_OPTIONS) // Ensure final count is within limit
                    .map(w => ({
                        name: w.custom_id ? `${w.name.toUpperCase()} (${w.custom_id.toUpperCase()})` : w.name.toUpperCase(),
                        value: w.custom_id || w.name // Prefer custom_id as value
                    }));
            } catch (e) {
                logger.error("[info.js] Autocomplete DB error:", e);
            }
        }
        try {
            await interaction.respond(choices);
        } catch (e) {
             logger.warn("[info.js] Autocomplete respond error:", e.message);
        }
    },

  showWorldInfo, showEditWorldModal // Export functions
};