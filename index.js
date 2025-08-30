require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database.js');
const logger = require('./utils/logger.js');
const { DateTime } = require('luxon');
const cron = require('node-cron');
const { deployCommands } = require('./deploy-commands.js');

// --- Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
    // partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember], // Enable if needed
});

client.commands = new Collection();
client.cooldowns = new Collection();

// --- Main application logic ---
async function main() {
    try {
        // Step 1: Deploy commands
        logger.info('[Startup] Starting command deployment...');
        await deployCommands(logger);
        logger.info('[Startup] Command deployment finished.');

        // Step 2: Load command handlers
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        logger.info(`[Startup] Loading ${commandFiles.length} commands...`);
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            try {
                delete require.cache[require.resolve(filePath)];
                const command = require(filePath);
                if (command.data && command.data.name) {
                    client.commands.set(command.data.name, command);
                    logger.debug(`[Startup] Loaded command: ${command.data.name}`);
                } else {
                    logger.warn(`[Startup] Command at ${filePath} is missing a required "data" or "data.name" property.`);
                }
            } catch (error) {
                logger.error(`[Startup] Failed to load command at ${filePath}: ${error.message}`, error.stack);
            }
        }
        logger.info(`[Startup] Finished loading commands.`);

        // Step 3: Setup event handlers
        setupEventHandlers();

        // Step 4: Login to Discord
        logger.info('[Startup] Checking DISCORD_TOKEN presence...');
        if (!process.env.DISCORD_TOKEN) {
            logger.error('[Startup] FATAL: DISCORD_TOKEN is missing! Cannot login.');
            process.exit(1);
        }
        logger.info('[Startup] Logging in to Discord...');
        await client.login(process.env.DISCORD_TOKEN);
        logger.info('[Startup] Login successful.');

    } catch (error) {
        logger.error('[Startup] FATAL: An error occurred during the startup sequence:', error);
        process.exit(1);
    }
}

// --- Event Handlers Setup ---
function setupEventHandlers() {
    client.once(Events.ClientReady, async c => {
        logger.info(`Logged in as ${c.user.tag}!`);
        try {
        // Migrations should be run manually via a script, not on startup.
        // logger.info('[Startup] Running database migrations...');
        // await db.knex.migrate.latest();
        // logger.info('[Startup] Database migrations complete.');

            logger.info('[Startup] Running one-time startup cleanup...');
            const count = await db.removeExpiredWorlds();
            if (count > 0) {
                logger.info(`[Startup] Removed ${count} expired worlds during startup.`);
            } else {
                logger.info('[Startup] No expired worlds found on startup.');
            }

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

        } catch (err) {
            logger.error('[Startup] FATAL: Error during ClientReady tasks:', err);
            process.exit(1);
        }
    });

    try {
        const handlerPath = require.resolve('./handlers/interactionHandler');
        delete require.cache[handlerPath];
        require(handlerPath).setupInteractionHandler(client);
    } catch (error) {
        logger.error('[Startup] FATAL: Failed to setup interaction handler:', error);
        process.exit(1);
    }

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
}

// --- Run Application ---
main();
