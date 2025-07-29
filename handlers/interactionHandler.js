const { Events, InteractionType } = require('discord.js');
const db = require('../database.js'); // Assuming database connection is handled
const logger = require('../utils/logger.js'); // Assuming you have a logger
const CONSTANTS = require('../utils/constants.js'); // For autocomplete limit

// Helper function to safely reply or followUp ephemerally
async function safeReplyEphemeral(interaction, options) {
    try {
        if (typeof options === 'string') options = { content: options };
        options.flags = 1 << 6; // Ensure ephemeral

        if (interaction.replied || interaction.deferred) {
            // Use followUp if already replied/deferred, otherwise it fails
            await interaction.followUp(options);
        } else {
            await interaction.reply(options);
        }
    } catch (error) {
        // Ignore errors like "Interaction has already been acknowledged" or "Unknown interaction"
        if (error.code === 10062 || error.code === 40060) {
             logger.warn(`[Interaction Handler] Suppressed reply error (${error.code}) for interaction ${interaction.id}`);
        } else {
             logger.error(`[Interaction Handler] Failed to send safe ephemeral reply: ${error.message}`, { customId: interaction.customId, commandName: interaction.commandName, code: error.code });
        }
    }
}

// Helper function to safely editReply ephemerally
async function safeEditEphemeral(interaction, options) {
    try {
        if (typeof options === 'string') options = { content: options };
        options.flags = 1 << 6; // Ensure ephemeral
        options.components = options.components || []; // Clear components if not specified

        // Check if deferred or replied before trying to edit
        if (interaction.deferred || interaction.replied) {
             await interaction.editReply(options);
        } else {
             logger.warn(`[Interaction Handler] Attempted to editReply on non-deferred/replied interaction: ${interaction.id}`);
             // Optionally try a regular reply as fallback?
             // await safeReplyEphemeral(interaction, options);
        }
    } catch (error) {
         if (error.code === 10062 || error.code === 40060) {
              logger.warn(`[Interaction Handler] Suppressed editReply error (${error.code}) for interaction ${interaction.id}`);
         } else {
            logger.error(`[Interaction Handler] Failed to send safe ephemeral editReply: ${error.message}`, { customId: interaction.customId, code: error.code });
         }
    }
}


async function setupInteractionHandler(client) {
    if (!client.cooldowns) {
       logger.warn("[Interaction Handler] client.cooldowns collection not found. Rate limiting disabled.");
       client.cooldowns = new Map(); // Initialize if missing
    }

    client.on(Events.InteractionCreate, async interaction => {
        logger.info(`[Interaction Handler] Raw interaction received. Type: ${interaction.type}, ID: ${interaction.id}, CommandName: ${interaction.commandName || 'N/A'}, CustomID: ${interaction.customId || 'N/A'}, User: ${interaction.user.tag}`);
        // Ignore interactions from bots
        if (interaction.user.bot) return;

        // --- Global Rate Limiting ---
        if (interaction.user && client.cooldowns instanceof Map) {
            const now = Date.now();
            const timestamps = client.cooldowns.get(interaction.user.id) || [];
            const validTimestamps = timestamps.filter(ts => now - ts < 10000); // 10 second window

            if (validTimestamps.length >= 7) { // Limit: 7 interactions per 10 seconds (adjust as needed)
                logger.warn(`[Interaction Handler] Rate limit exceeded for user ${interaction.user.id} (${interaction.user.tag})`);
                // Only reply if the interaction is repliable (e.g., not autocomplete)
                if (interaction.isRepliable()) {
                     await safeReplyEphemeral(interaction, '⏱️ You are interacting too quickly. Please slow down.');
                }
                return;
            }
            validTimestamps.push(now);
            client.cooldowns.set(interaction.user.id, validTimestamps);
        }

        try {
            // --- Autocomplete Handling ---
            if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
                const command = client.commands.get(interaction.commandName);
                // Delegate to command's autocomplete if it exists
                if (command && typeof command.autocomplete === 'function') {
                    await command.autocomplete(interaction);
                } else {
                    // Default autocomplete for 'world' option (used by info, remove, share, unshare)
                    const focusedOption = interaction.options.getFocused(true);
                    if (focusedOption.name === 'world') {
                         let choices = [];
                         try {
                            // Fetch limited worlds owned by the user for suggestion
                            const dbResult = await db.getWorlds(interaction.user.id, 1, 50); // Limit results
                            const query = focusedOption.value.toLowerCase();
                            choices = dbResult.worlds
                                .filter(w =>
                                    w.name.toLowerCase().includes(query) ||
                                    (w.custom_id && w.custom_id.toLowerCase().includes(query))
                                )
                                .slice(0, CONSTANTS.MAX_SELECT_OPTIONS) // Use constant from constants.js
                                .map(w => ({
                                    name: w.custom_id ? `${w.name.toUpperCase()} (${w.custom_id.toUpperCase()})` : w.name.toUpperCase(),
                                    // Return the identifier that the command expects (name or custom_id)
                                    value: w.custom_id || w.name
                                }));
                         } catch(e) {
                             logger.error("[Interaction Handler] Default autocomplete DB error:", e);
                         }
                         try {
                             await interaction.respond(choices);
                         } catch (respondError) {
                              logger.warn("[Interaction Handler] Autocomplete respond error:", respondError.message);
                         }
                    } else {
                         // Respond empty if no specific handler or match
                         try { await interaction.respond([]); } catch {}
                    }
                }
            }
            // --- Slash Command Handling ---
            else if (interaction.type === InteractionType.ApplicationCommand) {
                logger.info(`[Interaction Handler] Received ApplicationCommand: ${interaction.commandName}, User: ${interaction.user.tag}`);
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    logger.error(`[Interaction Handler] Command not found: ${interaction.commandName}`);
                    await safeReplyEphemeral(interaction, 'Sorry, that command does not seem to exist.');
                    return;
                }

                // Permission check (only applies in guilds)
                if (command.permissions && interaction.inGuild()) {
                    // Check if interaction.memberPermissions is available (it should be for guild commands)
                    if (!interaction.memberPermissions) {
                         logger.warn(`[Interaction Handler] Could not check permissions for /${interaction.commandName} - memberPermissions missing.`);
                         await safeReplyEphemeral(interaction, '❌ Could not verify your permissions.');
                         return;
                    }
                    if (!interaction.memberPermissions.has(command.permissions)) {
                        await safeReplyEphemeral(interaction, '❌ You do not have permission to use this command.');
                        return;
                    }
                }

                logger.info(`[Interaction Handler] Executing command: /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`);
                await command.execute(interaction); // Command handles its own deferral/reply
            }
            // --- Component Handling (Buttons, Select Menus) ---
            else if (interaction.isMessageComponent()) { // Combined check for Button, SelectMenu, etc.
                 // Routing Logic: commandName_componentType_action_...params
                 const customIdParts = interaction.customId.split('_');
                 const commandName = customIdParts[0];
                 const componentType = customIdParts[1]; // 'button', 'select', 'modal' (though modal handled separately)
                 const params = customIdParts.slice(2); // The rest are params for the handler

                 if (!commandName || !componentType) {
                     logger.warn(`[Interaction Handler] Received component interaction with invalid customId format: ${interaction.customId}`);
                     await safeReplyEphemeral(interaction, "This component seems outdated or invalid.");
                     return;
                 }

                 const command = client.commands.get(commandName);

                 if (!command) {
                     logger.error(`[Interaction Handler] Command handler not found for component prefix: ${commandName} (customId: ${interaction.customId})`);
                     // Update the interaction if possible to remove potentially broken components
                     if (interaction.isRepliable() || interaction.deferred) {
                         await safeEditEphemeral(interaction, { content: "Cannot process this component (handler missing).", components: []});
                     }
                     return;
                 }

                 // Delegate based on component type and check if handler exists (for other commands)
                 if (interaction.isButton() && typeof command.handleButton === 'function') {
                     logger.debug(`[Interaction Handler] Routing button ${interaction.customId} to ${commandName}.handleButton`);
                     await command.handleButton(interaction, params); // params here is customIdParts.slice(2)
                 } else if (interaction.isStringSelectMenu() && typeof command.handleSelectMenu === 'function') {
                      logger.debug(`[Interaction Handler] Routing select menu ${interaction.customId} to ${commandName}.handleSelectMenu`);
                     await command.handleSelectMenu(interaction, params); // params here is customIdParts.slice(2)
                 }
                 // Add handlers for other component types (UserSelect, RoleSelect, etc.) if needed here
                 // else if (interaction.isUserSelectMenu() && ...) { ... }
                 else {
                     logger.warn(`[Interaction Handler] No suitable handler in ${commandName}.js for ${interaction.componentType} with customId: ${interaction.customId}`);
                      if (interaction.isRepliable() || interaction.deferred) {
                           await safeEditEphemeral(interaction, { content: "This component type is not handled correctly.", components: []});
                      }
                 }
            }
            // --- Modal Submit Handling ---
            else if (interaction.type === InteractionType.ModalSubmit) {
                 // Routing Logic: commandName_modal_action_...params
                 const customIdParts = interaction.customId.split('_');
                 const commandName = customIdParts[0];
                 const modalIdentifier = customIdParts[1]; // Should be 'modal' or a specific modal prefix like 'mod' for lock
                 // const params = customIdParts.slice(2); // Action and any other params (original logic)

                 if (!commandName || (modalIdentifier !== 'modal' && modalIdentifier !== 'mod')) { // Adjusted for lock's 'mod' prefix
                     logger.warn(`[Interaction Handler] Received modal submission with invalid customId format or unknown modal type: ${interaction.customId}`);
                     await safeReplyEphemeral(interaction, "This form seems outdated or invalid.");
                     return;
                 }

                 const command = client.commands.get(commandName);
                 // The original logic used `command.handleModal` and `params = customIdParts.slice(2)`
                 // Keep this for other commands if they use a generic `handleModal`
                 if (!command || typeof command.handleModal !== 'function') {
                     logger.error(`[Interaction Handler] Modal handler function missing in ${commandName}.js for customId: ${interaction.customId}`);
                     await safeReplyEphemeral(interaction, "Cannot process this form (handler not found).");
                     return;
                 }

                 logger.debug(`[Interaction Handler] Routing modal submission ${interaction.customId} to ${commandName}.handleModal`);
                 await command.handleModal(interaction, customIdParts.slice(2)); // Pass params as original logic

            }

        } catch (error) {
            logger.error('[Interaction Handler] Uncaught error processing interaction:', {
                 error: error?.message, stack: error?.stack,
                 type: interaction.type, commandName: interaction.commandName,
                 customId: interaction.customId, user: interaction.user?.id
            });

            // Attempt to inform the user ephemerally if the interaction hasn't already failed entirely
            if (interaction.isRepliable()) {
                 const errorContent = { content: '❌ An unexpected error occurred while processing your request. Please try again later.', components: [] };
                 if (interaction.replied || interaction.deferred) {
                     // Use editReply if we already replied/deferred
                     await safeEditEphemeral(interaction, errorContent);
                 } else {
                     // Otherwise, use reply
                     await safeReplyEphemeral(interaction, errorContent);
                 }
            }
        }
    });

    logger.info("[Interaction Handler] Interaction handler setup complete.");
}

module.exports = { setupInteractionHandler };