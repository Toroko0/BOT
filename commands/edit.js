const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const { logHistory } = require('../utils/share_and_history.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('Edit a world in the tracking list.')
        .addStringOption(option =>
            option.setName('world')
                .setDescription('The name of the world to edit.')
                .setRequired(true)),
    async execute(interaction) {
        const worldName = interaction.options.getString('world');
        const { worlds } = await db.getFilteredWorlds({ prefix: worldName, added_by_username: interaction.user.username });

        if (worlds.length === 0) {
            return interaction.reply({ content: `World starting with **${worldName}** not found in your tracking list.`, flags: 1 << 6 });
        }

        if (worlds.length === 1) {
            const world = worlds[0];
            if (world.added_by_username !== interaction.user.username) {
                return interaction.reply({ content: 'You do not have permission to edit this world.', flags: 1 << 6 });
            }
            await this.showEditModal(interaction, world.id);
        } else {
            const options = worlds.map(world => {
                return {
                    label: `ID: ${world.id}, Days: ${world.days_owned}, Lock: ${world.lock_type}, Added by: ${world.added_by_username}`,
                    value: world.id.toString()
                }
            });

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                    .setCustomId('edit_select')
                        .setPlaceholder('Select a world to edit')
                        .addOptions(options),
                );

            await interaction.reply({
                content: `There are multiple worlds starting with **${worldName}**. Please select the one you want to edit.`,
                components: [row],
                flags: 1 << 6
            });
        }
    },

    async showEditModal(interaction, worldId) {
        const world = await db.getWorldById(worldId);
        const modal = new ModalBuilder()
            .setCustomId(`edit_submit_${worldId}`)
            .setTitle(`Edit World: ${world.name}`);

        const daysOwnedInput = new TextInputBuilder()
            .setCustomId('daysOwned')
            .setLabel("Days Already Owned (1-180)")
            .setStyle(TextInputStyle.Short)
            .setValue(world.days_owned.toString())
            .setRequired(true);

        const lockTypeInput = new TextInputBuilder()
            .setCustomId('lockType')
            .setLabel("Lock Type (M/O)")
            .setStyle(TextInputStyle.Short)
            .setValue(world.lock_type === 'mainlock' ? 'M' : 'O')
            .setRequired(true);

        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel("Note (Optional)")
            .setStyle(TextInputStyle.Short)
            .setValue(world.note || '')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(daysOwnedInput),
            new ActionRowBuilder().addComponents(lockTypeInput),
            new ActionRowBuilder().addComponents(noteInput)
        );

        await interaction.showModal(modal);
    },

    async handleSelectMenu(interaction, params) {
        const worldId = parseInt(interaction.values[0]);
        const world = await db.getWorldById(worldId);

        if (!world) {
            return interaction.reply({ content: 'This world no longer exists.', flags: 1 << 6 });
        }

        if (world.added_by_username !== interaction.user.username) {
            return interaction.reply({ content: 'You do not have permission to edit this world.', flags: 1 << 6 });
        }

        await this.showEditModal(interaction, worldId);
    },

    async handleModal(interaction, params) {
        const [action, worldIdString] = params;
        if (action !== 'submit') return; // Should only be submit
        const worldId = parseInt(worldIdString);
        const world = await db.getWorldById(worldId);

        if (!world) {
            return interaction.reply({ content: 'This world no longer exists.', flags: 1 << 6 });
        }

        if (world.added_by_username !== interaction.user.username) {
            return interaction.reply({ content: 'You do not have permission to edit this world.', flags: 1 << 6 });
        }

        const daysOwned = interaction.fields.getTextInputValue('daysOwned');
        const lockType = interaction.fields.getTextInputValue('lockType').toUpperCase();
        const note = interaction.fields.getTextInputValue('note');

        const updatedData = {
            daysOwned: parseInt(daysOwned),
            lockType: lockType === 'M' ? 'mainlock' : 'outlock',
            note: note,
        };

        await db.updateWorld(worldId, updatedData);
        await logHistory(worldId, interaction.user.id, 'edit', `Edited world ${world.name}`);

        await interaction.reply({ content: `World **${world.name}** has been updated.`, flags: 1 << 6 });
    }
};
