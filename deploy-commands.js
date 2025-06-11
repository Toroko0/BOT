const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
// Removed top-level logger imports

async function deployCommands(logger) { // Renamed and added logger as a parameter
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    // Use GUILD_ID for admin command deployment, DEV_GUILD_ID is not used by this script directly for deployment logic
    const guildId = process.env.GUILD_ID;

    if (!token || !clientId) {
        logger.error('[Deploy] Missing DISCORD_TOKEN or CLIENT_ID environment variables. Cannot deploy commands.');
        throw new Error('[Deploy] Missing DISCORD_TOKEN or CLIENT_ID environment variables.');
    }

    const adminCommandsData = [];
    const globalCommandsData = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    logger.info(`[Deploy] Loading commands from: ${commandsPath}`);
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if (command.data && typeof command.data.toJSON === 'function') {
                if (command.data.name === 'admin') {
                    adminCommandsData.push(command.data.toJSON());
                    logger.debug(`[Deploy] Loaded ADMIN command: ${command.data.name}`);
                } else {
                    globalCommandsData.push(command.data.toJSON());
                    logger.debug(`[Deploy] Loaded GLOBAL command: ${command.data.name}`);
                }
            } else {
                logger.warn(`[Deploy] Command at ${filePath} is missing a valid "data" property or toJSON method.`);
            }
        } catch (error) {
            logger.error(`[Deploy] Failed to load command file ${file}:`, error);
        }
    }
    logger.info(`[Deploy] Found ${adminCommandsData.length} admin command(s) and ${globalCommandsData.length} global command(s).`);

    const rest = new REST({ version: '10' }).setToken(token);
    let deployedAdminCount = 0;
    let deployedGlobalCount = 0;

    // Deploy Admin (Guild-specific) Commands
    if (guildId) {
        if (adminCommandsData.length > 0) {
            try {
                logger.info(`[Deploy] Deploying ${adminCommandsData.length} admin command(s) to GUILD_ID: ${guildId}...`);
                const adminData = await rest.put(
                    Routes.applicationGuildCommands(clientId, guildId),
                    { body: adminCommandsData }
                );
                logger.info(`[Deploy] Successfully deployed ${adminData.length} admin command(s) to GUILD_ID: ${guildId}.`);
                deployedAdminCount = adminData.length;
            } catch (error) {
                logger.error(`[Deploy] Error deploying admin commands to GUILD_ID ${guildId}:`, error);
            }
        } else {
            logger.info(`[Deploy] No admin commands found to deploy to GUILD_ID: ${guildId}.`);
            // Attempt to clear existing guild commands if no admin commands are defined now
            try {
                logger.info(`[Deploy] Clearing existing admin commands from GUILD_ID: ${guildId} as no admin commands are currently defined.`);
                await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
                logger.info(`[Deploy] Successfully cleared admin commands from GUILD_ID: ${guildId}.`);
            } catch (error) {
                logger.error(`[Deploy] Error clearing admin commands from GUILD_ID ${guildId}:`, error);
            }
        }
    } else {
        if (adminCommandsData.length > 0) {
            logger.warn('[Deploy] GUILD_ID is not set in .env. Admin commands will NOT be deployed.');
            logger.warn('[Deploy] If you have admin commands, please set GUILD_ID in your .env file to deploy them to a specific server.');
        } else {
            logger.info('[Deploy] No admin commands found, and GUILD_ID is not set. Skipping admin command deployment.');
        }
    }

    // Deploy Global Commands
    if (globalCommandsData.length > 0) {
        try {
            logger.info(`[Deploy] Deploying ${globalCommandsData.length} global command(s)...`);
            const globalData = await rest.put(
                Routes.applicationCommands(clientId),
                { body: globalCommandsData }
            );
            logger.info(`[Deploy] Successfully deployed ${globalData.length} global command(s).`);
            deployedGlobalCount = globalData.length;
        } catch (error) {
            logger.error('[Deploy] Error deploying global commands:', error);
            // We might still want to return partial success if admin commands deployed
        }
    } else {
        logger.info("[Deploy] No global commands found to deploy.");
         // Attempt to clear existing global commands if no global commands are defined now
        try {
            logger.info(`[Deploy] Clearing existing global commands as no global commands are currently defined.`);
            await rest.put(Routes.applicationCommands(clientId), { body: [] });
            logger.info(`[Deploy] Successfully cleared global commands.`);
        } catch (error) {
            logger.error(`[Deploy] Error clearing global commands:`, error);
        }
    }

    return {
        success: true, // Overall script execution success, individual deployments might have failed
        adminCount: deployedAdminCount,
        globalCount: deployedGlobalCount
    };
}

module.exports = { deployCommands }; // Updated export name

// --- Direct execution block ---
if (require.main === module) {
    // Simple console logger for direct execution
    const consoleLogger = {
        info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
        warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args),
        error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
        debug: (message, ...args) => console.log(`[DEBUG] ${message}`, ...args), // Or console.debug
    };

    (async () => {
        try {
            // The deployCommands function now handles GUILD_ID internally based on process.env.GUILD_ID
            // The --guild flag is not directly used by the deployCommands function anymore for its main logic.
            // It's good practice to ensure environment variables are set correctly.
            if (process.argv.includes('--guild') && !process.env.GUILD_ID && process.env.DEV_GUILD_ID) {
                 consoleLogger.warn(`[DeployRunner] --guild flag detected, and DEV_GUILD_ID is set, but GUILD_ID is not. For admin command deployment, ensure GUILD_ID is set directly in your .env or environment.`);
            } else if (process.argv.includes('--guild') && !process.env.GUILD_ID && !process.env.DEV_GUILD_ID) {
                consoleLogger.warn(`[DeployRunner] --guild flag detected, but neither GUILD_ID nor DEV_GUILD_ID are set. Admin commands will not be deployed without GUILD_ID.`);
            }


            await deployCommands(consoleLogger); // Call the renamed function
            consoleLogger.info('[DeployRunner] Command deployment process finished.');
        } catch (e) {
            // Error should already be logged by deployCommands, but we log here for the runner context
            consoleLogger.error('[DeployRunner] Command deployment process encountered an error.');
            process.exitCode = 1; // Indicate failure
        }
    })();
}