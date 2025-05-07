const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const logger = require('./utils/logger'); // Use logger

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
// GUILD_ID is optional, check if provided via env var or command line arg
const guildId = process.env.GUILD_ID || (process.argv.includes('--guild') ? process.env.DEV_GUILD_ID : null); // Allow overriding via arg or specific dev guild

if (!token || !clientId) {
  logger.error('[Deploy] Missing DISCORD_TOKEN or CLIENT_ID environment variables');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

logger.info(`[Deploy] Loading commands from: ${commandsPath}`);

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  try {
    const command = require(filePath);
    // Check for the essential 'data' property which holds the command definition
    if (command.data && typeof command.data.toJSON === 'function') {
      commands.push(command.data.toJSON());
       logger.debug(`[Deploy] Loaded command: ${command.data.name}`);
    } else {
      logger.warn(`[Deploy] Command at ${filePath} is missing a valid "data" property.`);
    }
  } catch (error) {
     logger.error(`[Deploy] Failed to load command file ${file}:`, error);
  }
}

if (commands.length === 0) {
    logger.error("[Deploy] No valid commands found to deploy.");
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
  try {
    if (guildId) {
      // Deploying to a specific guild (faster updates for testing)
      logger.info(`[Deploy] Deploying ${commands.length} commands to GUILD: ${guildId}`);
      const data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      logger.info(`[Deploy] Successfully deployed ${data.length} guild commands.`);
    } else {
      // Deploying globally (can take up to an hour to propagate)
      logger.info(`[Deploy] Deploying ${commands.length} GLOBAL commands...`);
      const data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      logger.info(`[Deploy] Successfully deployed ${data.length} global commands.`);
    }
  } catch (error) {
    logger.error('[Deploy] Error deploying commands:', error);
  }
}

deployCommands();