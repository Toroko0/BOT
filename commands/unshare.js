const { SlashCommandBuilder } = require('discord.js');
const db = require('../database.js');
const { logHistory } = require('../utils/share_and_history.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unshare')
    .setDescription('Make one of your worlds private')
    .addStringOption(option =>
      option.setName('world_name')
        .setDescription('Name of the world to unshare')
        .setRequired(true)
    ),

  async execute(interaction) {
    const worldNameInput = interaction.options.getString('world_name');
    const worldNameUpper = worldNameInput.toUpperCase(); // Convert to uppercase
    const userId = interaction.user.id;

    try {
      // Use the uppercase name for lookup
      const world = await db.getWorldByName(worldNameUpper, userId);
      if (!world) {
        // Use the uppercase name in the reply as well
        await interaction.reply({ content: `❌ World **${worldNameUpper}** not found.`, flags: 1 << 6 });
        return;
      }
      if (world.user_id !== userId) {
        await interaction.reply({ content: '❌ You do not own this world.', flags: 1 << 6 });
        return;
      }
      if (!world.is_public) {
        await interaction.reply({ content: `🔒 World **${worldNameUpper}** is already private.`, flags: 1 << 6 });
        return;
      }

      await db.updateWorldVisibility(world.id, false);

      // Log the unshare action
      await logHistory(world.id, userId, 'unshare', `Unshared world ${worldNameUpper}`);

      await interaction.reply({ content: `✅ World **${worldNameUpper}** is now private!`, flags: 1 << 6 });
    } catch (error) {
      console.error('Error unsharing world:', error?.stack || error?.message || error);
      await interaction.reply({ content: '❌ Sorry, I couldn\'t unshare the world due to a server error. Please try again later.', flags: 1 << 6 });
    }
  }
};
