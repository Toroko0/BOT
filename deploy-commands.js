const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
// Removed top-level logger imports

async function deployGlobalCommands(logger) { // Added logger as a parameter
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID || (process.argv.includes('--guild') ? process.env.DEV_GUILD_ID : null);

    if (!token || !clientId) {
        logger.error('[Deploy] Missing DISCORD_TOKEN or CLIENT_ID environment variables');
        throw new Error('[Deploy] Missing DISCORD_TOKEN or CLIENT_ID environment variables');
    }

    const allCommandsData = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    logger.info(`[Deploy] Loading commands from: ${commandsPath}`);
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if (command.data && typeof command.data.toJSON === 'function') {
                allCommandsData.push(command.data.toJSON());
                logger.debug(`[Deploy] Loaded command: ${command.data.name}`);
            } else {
                logger.warn(`[Deploy] Command at ${filePath} is missing a valid "data" property.`);
            }
        } catch (error) {
            logger.error(`[Deploy] Failed to load command file ${file}:`, error);
        }
    }

    if (guildId) {
        logger.info(`[Deploy] GUILD_ID (${guildId}) is set in .env but all commands will be deployed globally as per current strategy.`);
    }

    if (allCommandsData.length === 0) {
        logger.warn("[Deploy] No commands found to deploy. Proceeding to deploy empty list globally (will clear commands).");
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        logger.info(`[Deploy] Deploying all ${allCommandsData.length} command(s) globally...`);
        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: allCommandsData }
        );
        logger.info(`[Deploy] Successfully deployed ${data.length} global commands.`);
        return { success: true, count: data.length, type: 'global' };
    } catch (error) {
        logger.error('[Deploy] Error deploying commands globally:', error);
        throw error;
    }
}

module.exports = { deployGlobalCommands };