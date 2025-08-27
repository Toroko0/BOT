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
                .setRequired(true)
                .setAutocomplete(true)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const worldName = interaction.options.getString('world');
        const isAdmin = interaction.user.id === process.env.OWNER_ID;

        const filter = { prefix: worldName };
        // For non-admins, only search their own worlds.
        if (!isAdmin) {
            filter.added_by_username = interaction.user.username;
        }

        const { worlds } = await db.getFilteredWorlds(filter);

        if (worlds.length === 0) {
            const content = isAdmin ? `No worlds found starting with **${worldName}**.` : `World starting with **${worldName}** not found in your tracking list.`;
            return interaction.editReply({ content });
        }

        if (worlds.length === 1) {
            const world = worlds[0];
            // A non-admin can only get here if they own the world, due to the filter.
            // An admin can get here with any world. No extra permission check needed here.
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`edit_button_edit_${world.id}`)
                        .setLabel(`Edit ${world.name}`)
                        .setStyle(ButtonStyle.Primary),
                );

            await interaction.editReply({
                content: `Found one world matching **${worldName}**: **${world.name}** (Owner: ${world.added_by_username}).`,
                components: [row]
            });
            return;
        }

        // If multiple worlds are found
        const options = worlds.map(world => {
            return {
                label: `ID: ${world.id}, ${world.name}`,
                description: `Owner: ${world.added_by_username}`,
                value: world.id.toString()
            }
        }).slice(0, 25); // Max 25 options

        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('edit_select_world') // Use a more descriptive custom ID
                    .setPlaceholder('Select a world to edit')
                    .addOptions(options),
            );

        await interaction.editReply({
            content: `Found multiple worlds starting with **${worldName}**. Please select one to edit.`,
            components: [row]
        });
    },

    async showEditModal(interaction, worldId) {
        const world = await db.getWorldById(worldId);
        if (!world) {
            // Use update for components, reply for modals
            return interaction.update({ content: 'This world no longer exists.', components: [] });
        }

        const isAdmin = interaction.user.id === process.env.OWNER_ID;
        if (!isAdmin && world.added_by_username !== interaction.user.username) {
            return interaction.update({ content: 'You do not have permission to edit this world.', components: [] });
        }

        const modal = new ModalBuilder()
            .setCustomId(`edit_modal_submit_${worldId}`)
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

        const customIdInput = new TextInputBuilder()
            .setCustomId('custom_id')
            .setLabel("Custom ID (Optional)")
            .setStyle(TextInputStyle.Short)
            .setValue(world.custom_id || '')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(daysOwnedInput),
            new ActionRowBuilder().addComponents(lockTypeInput),
            new ActionRowBuilder().addComponents(customIdInput)
        );

        await interaction.showModal(modal);
    },

    async handleButton(interaction, params) {
        // Custom ID: edit_button_edit_worldId
        const [action, worldIdString] = params; // params[0] is 'edit', params[1] is worldId
        if (action === 'edit' && worldIdString) {
            const worldId = parseInt(worldIdString, 10);
            await this.showEditModal(interaction, worldId);
        } else {
            logger.warn(`[edit.js] Unknown button action or missing worldId: ${params}`);
        }
    },

    async handleSelectMenu(interaction, params) {
        // Custom ID: edit_select_world
        const worldId = parseInt(interaction.values[0], 10);
        await this.showEditModal(interaction, worldId);
    },

    async handleModal(interaction, params) {
        // Custom ID: edit_modal_submit_worldId
        const [action, worldIdString] = params;
        if (action !== 'submit') return;

        await interaction.deferReply({ ephemeral: true });

        const worldId = parseInt(worldIdString);
        const world = await db.getWorldById(worldId);

        if (!world) {
            return interaction.editReply({ content: 'This world no longer exists.' });
        }

        const isAdmin = interaction.user.id === process.env.OWNER_ID;
        if (!isAdmin && world.added_by_username !== interaction.user.username) {
            return interaction.editReply({ content: 'You do not have permission to edit this world.' });
        }

        const daysOwned = interaction.fields.getTextInputValue('daysOwned');
        const lockType = interaction.fields.getTextInputValue('lockType').toUpperCase();
        const custom_id = interaction.fields.getTextInputValue('custom_id');

        // Basic validation
        if (isNaN(parseInt(daysOwned)) || parseInt(daysOwned) < 1 || parseInt(daysOwned) > 180) {
            return interaction.editReply({ content: 'Invalid input for "Days Owned". Please provide a number between 1 and 180.' });
        }
        if (lockType !== 'M' && lockType !== 'O') {
            return interaction.editReply({ content: 'Invalid input for "Lock Type". Please provide M or O.' });
        }

        const updatedData = {
            daysOwned: parseInt(daysOwned),
            lockType: lockType === 'M' ? 'mainlock' : 'outlock',
            custom_id: custom_id,
        };

        await db.updateWorld(worldId, updatedData);
        await logHistory(worldId, interaction.user.id, 'edit', `Edited world ${world.name}`);

        await interaction.editReply({ content: `✅ World **${world.name}** has been updated successfully.` });
    }
};
