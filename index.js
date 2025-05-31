require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, Partials } = require('discord.js'); // Added Partials
// const { spawnSync } = require('child_process'); // Removed spawnSync
const fs = require('fs');
const path = require('path');
const db = require('./database.js'); // Knex instance from database.js
const logger = require('./utils/logger.js');
const { DateTime } = require('luxon');
const reminderScheduler = require('./services/reminderScheduler.js');
const { deployGlobalCommands } = require('./deploy-commands.js'); // Added for in-process deployment

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

// --- Daily Tasks Setup ---
async function removeExpiredWorldsOnStartup() {
  try {
    logger.info('[Startup] Removing expired worlds on startup.');
    const removedCount = await db.removeExpiredWorlds();
    logger.info(`[Startup] Removed ${removedCount} expired worlds.`);
  } catch (error) {
    logger.error('[Startup] Error removing expired worlds:', error);
  }
}

function setupScheduledTasks() {
  logger.info('[Scheduler] Setting up daily tasks.');
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const now = DateTime.utc();
  const nextRunTime = now.plus({ days: 1 }).set({ hour: 0, minute: 5, second: 0, millisecond: 0 });
  const msUntilNextRun = Math.max(0, nextRunTime.diff(now).as('milliseconds')); // Ensure non-negative

  logger.info(`[Scheduler] Next daily tasks scheduled at ${nextRunTime.toISO()} (in ${Math.round(msUntilNextRun / 1000 / 60)} mins)`);

  // Run startup tasks immediately
  removeExpiredWorldsOnStartup(); // Don't await

  // Schedule the first run
  setTimeout(() => {
    runDailyTasks();
    // Schedule subsequent runs
    setInterval(runDailyTasks, TWENTY_FOUR_HOURS_MS);
  }, msUntilNextRun);
}

// Function to run daily tasks
async function runDailyTasks() {
  try {
    logger.info(`[Scheduler] Running daily tasks at ${new Date().toISOString()}`);
    // Remove expired worlds
    const removedCount = await db.removeExpiredWorlds();
    logger.info(`[Scheduler] Daily check removed ${removedCount} expired worlds.`);
    // Daily update logic (if any needed besides expiry removal) could go here
  } catch (error) {
    logger.error('[Scheduler] Error running daily tasks:', error);
  }
}

// --- Event Handlers ---

// Client Ready Event
client.once(Events.ClientReady, async c => {
    logger.info(`Logged in as ${c.user.tag}!`); // Keep this first log
    try {
        logger.info('[Startup] Running database migrations...');
        await db.knex.migrate.latest();
        logger.info('[Startup] Database migrations complete.');

        logger.info('[Startup] Deploying slash commands in-process...');
        await deployGlobalCommands(logger);
        logger.info('[Startup] In-process slash command deployment complete.');

        setupScheduledTasks();

        logger.info('[Startup] Starting reminder scheduler...');
        reminderScheduler.start(c);
        logger.info('[Startup] Reminder scheduler started.');

    } catch (err) {
        logger.error('[Startup] FATAL: Error during startup process (migrations, command deployment, or schedulers):', err);
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
logger.info('[Startup] DISCORD_TOKEN found. Attempting to login...');
client.login(process.env.DISCORD_TOKEN);
logger.info('[Startup] client.login() call has been executed. Waiting for ClientReady event...');