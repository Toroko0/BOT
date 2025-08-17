require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database.js');
const logger = require('./utils/logger.js');
const { DateTime } = require('luxon');
const cron = require('node-cron');

// --- Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
    // partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember], // Enable if needed
});

client.commands = new Collection();
client.cooldowns = new Collection();

// --- Command Loading ---
const commandsPath = path.join(__dirname, 'commands');
try {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    logger.info(`[Startup] Loading ${commandFiles.length} commands...`);
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            // Clear cache before requiring to pick up changes during dev
            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);
            if (command.data && command.data.name) {
                client.commands.set(command.data.name, command);
                logger.debug(`[Startup] Loaded command: ${command.data.name}`);
            } else {
                logger.warn(`[Startup] Command at ${filePath} is missing a required "data" or "data.name" property.`);
            }
        } catch (error) {
            // Log specific file loading errors
            logger.error(`[Startup] Failed to load command at ${filePath}: ${error.message}`, error.stack);
               // Continue loading other commands even if one fails
        }
    }
    logger.info(`[Startup] Finished loading commands.`);
} catch (error) {
      logger.error(`[Startup] Failed to read commands directory at ${commandsPath}:`, error);
      process.exit(1);
}

// --- Event Handlers ---

// Client Ready Event
client.once(Events.ClientReady, async c => {
    logger.info(`Logged in as ${c.user.tag}!`);
    try {
        logger.info('[Startup] Running database migrations...');
        await db.knex.migrate.latest();
        logger.info('[Startup] Database migrations complete.');

        // --- NEW CODE BLOCK ---
        logger.info('[Startup] Running one-time startup cleanup...');
        const count = await db.removeExpiredWorlds();
        if (count > 0) {
            logger.info(`[Startup] Removed ${count} expired worlds during startup.`);
        } else {
            logger.info('[Startup] No expired worlds found on startup.');
        }
        // --- END OF NEW CODE BLOCK ---
        
        // Schedule daily cleanup of expired worlds
        cron.schedule('0 1 * * *', async () => {
            logger.info('[Cron] Running daily expired worlds cleanup job...');
            try {
                const count = await db.removeExpiredWorlds();
                if (count > 0) {
                    logger.info(`[Cron] Successfully removed ${count} expired worlds.`);
                } else {
                    logger.info('[Cron] No expired worlds to remove.');
                }
            } catch (error) {
                logger.error('[Cron] Error during expired worlds cleanup:', error);
            }
        });
        logger.info('[Startup] Scheduled daily expired worlds cleanup job.');

        // Schedule hourly notification job
        cron.schedule('0 * * * *', async () => {
            logger.info('[Cron] Running hourly notification job...');
            try {
                const usersToNotify = await db.getUsersToNotify();
                if (usersToNotify.length === 0) {
                    logger.info('[Cron] No users to notify.');
                    return;
                }

                for (const user of usersToNotify) {
                    const lastNotified = user.last_notification_timestamp || DateTime.utc().minus({ hours: user.notification_interval }).toISO();
                    const newWorlds = await db.getRecentlyAddedWorldsSince(lastNotified);

                    if (newWorlds.length > 0) {
                        const userDM = await client.users.fetch(user.id);
                        if (userDM) {
                            let message = `**Last ${newWorlds.length} worlds added to the list**\n\n`;
                            newWorlds.forEach(world => {
                                const lockType = world.lock_type === 'mainlock' ? '(M)' : '(O)';
                                const customId = world.custom_id ? ` (ID: ${world.custom_id})` : '';
                                message += `${lockType} ${world.name} ${world.days_owned} Days, BY ${world.added_by_username}${customId}\n`;
                            });
                            await userDM.send(message);
                            await db.updateLastNotificationTimestamp(user.id, DateTime.utc().toISO());
                            logger.info(`[Cron] Sent notification to ${user.username}`);
                        }
                    }
                }
            } catch (error) {
                logger.error('[Cron] Error during notification job:', error);
            }
        });
        logger.info('[Startup] Scheduled hourly notification job.');

    } catch (err) {
        logger.error('[Startup] FATAL: Error during startup process (migrations or schedulers):', err);
        process.exit(1);
    }
});

// Interaction Handler Setup
try {
    require('./handlers/interactionHandler').setupInteractionHandler(client);
} catch (error) {
    logger.error('[Startup] FATAL: Failed to setup interaction handler:', error);
    process.exit(1);
}


// --- Global Error Handling (as before) ---
client.on(Events.Error, error => logger.error("Client Websocket Error:", error));
client.on(Events.Warn, warning => logger.warn("Client Warning:", warning));

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    if (reason instanceof Error) { logger.error(reason.stack); }
});
process.on('uncaughtException', (error, origin) => {
    logger.error('Uncaught Exception:', error, 'Origin:', origin);
});
process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.error('Uncaught Exception Monitor:', error, 'Origin:', origin);
});
process.on('warning', (warning) => {
    logger.warn('Node Process Warning:', warning);
});
process.on('SIGINT', () => { logger.info("Received SIGINT. Shutting down..."); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { logger.info("Received SIGTERM. Shutting down..."); client.destroy(); process.exit(0); });

// --- Login ---
logger.info('[Startup] Checking DISCORD_TOKEN presence...');
if (!process.env.DISCORD_TOKEN) {
    logger.error('[Startup] FATAL: DISCORD_TOKEN is missing! Cannot login.');
    process.exit(1);
}
console.log('[DIAGNOSTIC] Preparing to call client.login()');
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('[DIAGNOSTIC] client.login() promise RESOLVED. Waiting for ClientReady event.');
    })
    .catch(err => {
        console.error('[DIAGNOSTIC] client.login() promise REJECTED:', err);
        process.exit(1);
    });
console.log('[DIAGNOSTIC] client.login() call has been fully dispatched (promise chain set up).');
