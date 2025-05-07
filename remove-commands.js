const { REST, Routes } = require('discord.js');
require('dotenv').config();

// Get the token and client ID from environment variables
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID environment variables');
  process.exit(1);
}

// Create REST instance
const rest = new REST({ version: '10' }).setToken(token);

// Function to delete all commands
async function deleteCommands() {
  try {
    console.log('Started removing application commands...');
    
    // Delete all global commands
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [] }
    );
    
    console.log('Successfully removed all application commands.');
  } catch (error) {
    console.error('Error removing commands:', error);
  }
}

// Run the function
deleteCommands();