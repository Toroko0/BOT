const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder, // For selecting users if needed, otherwise parse UserOption
    InteractionType
} = require('discord.js'); // Corrected import for v14
const { table, getBorderCharacters } = require('table');
const db = require('../database.js');
const logger = require('../utils/logger.js');

const WORLDS_PER_PAGE_TEAM = 5;

// Helper to create pagination buttons
function createTeamWorldPaginationRow(currentPage, totalPages, teamId) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`team:list:prev:${currentPage - 1}:${teamId}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`team:list:next:${currentPage + 1}:${teamId}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages)
        );
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('team')
        .setDescription('Manage or join a team for world tracking.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new team and become its owner.')
                .addStringOption(option =>
                    option.setName('team_name')
                        .setDescription('Name for your team (3-25 characters, alphanumeric, spaces, hyphens).')
                        .setRequired(true)
                        .setMinLength(3)
                        .setMaxLength(25)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('join')
                .setDescription('Join an existing team using an invitation code.')
                .addStringOption(option => option.setName('team_name').setDescription('The name of the team to join.').setRequired(true))
                .addStringOption(option => option.setName('invitation_code').setDescription('The invitation code.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription("View your team's tracked worlds.")
                .addIntegerOption(option => option.setName('page').setDescription('Page number.').setMinValue(1).setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a world to your team list.')
                .addStringOption(option => option.setName('world_name').setDescription('Name of the world.').setRequired(true))
                .addIntegerOption(option => option.setName('days_owned').setDescription('How many days ago the world was acquired (1-180). Defaults to 1.').setMinValue(1).setMaxValue(180).setRequired(false))
                .addStringOption(option => option.setName('note').setDescription('Optional note for the world.').setRequired(false).setMaxLength(100)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a world from your team list.')
                .addStringOption(option => option.setName('world_name').setDescription('Name of the world to remove.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View information about your current team.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Leave your current team.'))
        .addSubcommand(subcommand => // Owner Only Commands
            subcommand
                .setName('invite')
                .setDescription('Generate a new single-use invitation code for your team (Owner only).'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('kick')
                .setDescription('Remove a member from your team (Owner only).')
                .addUserOption(option => option.setName('member').setDescription('The member to remove.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transfer')
                .setDescription('Transfer ownership of your team to another member (Owner only).')
                .addUserOption(option => option.setName('new_owner').setDescription('The member to transfer ownership to.').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disband')
                .setDescription('Permanently disband your team and delete all its data (Owner only).')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        await db.addUser(userId, username);
        const userTeam = await db.getUserTeam(userId);

        const ownerOnlyCommands = ['invite', 'kick', 'transfer', 'disband'];
        if (ownerOnlyCommands.includes(subcommand)) {
            if (!userTeam) return interaction.reply({ content: "❌ You are not in a team, so you cannot perform owner actions.", ephemeral: true });
            if (userTeam.owner_user_id !== userId) {
                return interaction.reply({ content: "❌ Only the team owner can use this command.", ephemeral: true });
            }
        }

        const memberOnlyCommands = ['list', 'add', 'remove', 'info', 'leave'];
         if (memberOnlyCommands.includes(subcommand) && !userTeam && subcommand !== 'leave') {
            return interaction.reply({ content: "❌ You are not in a team.", ephemeral: true });
        }


        if (interaction.isChatInputCommand()) {
            if (subcommand === 'create') await handleTeamCreate(interaction, userId, userTeam);
            else if (subcommand === 'join') await handleTeamJoin(interaction, userId, userTeam);
            else if (subcommand === 'list') await handleTeamList(interaction, userId, userTeam, interaction.options.getInteger('page') || 1);
            else if (subcommand === 'add') await handleTeamAddWorld(interaction, userId, userTeam);
            else if (subcommand === 'remove') await handleTeamRemoveWorld(interaction, userId, userTeam);
            else if (subcommand === 'info') await handleTeamInfo(interaction, userId, userTeam);
            else if (subcommand === 'leave') await handleTeamLeave(interaction, userId, userTeam);
            else if (subcommand === 'invite') await handleTeamInvite(interaction, userId, userTeam);
            else if (subcommand === 'kick') await handleTeamKick(interaction, userId, userTeam);
            else if (subcommand === 'transfer') await handleTeamTransfer(interaction, userId, userTeam);
            else if (subcommand === 'disband') await handleTeamDisband(interaction, userId, userTeam);

        } else if (interaction.isButton()) {
            const [context, action, operation, value, teamIdForListOrPage] = interaction.customId.split(':');
            if (context !== 'team') return;

            const page = parseInt(teamIdForListOrPage) || 1;
            const targetInfo = operation;

            if (action === 'list') {
                 const teamObj = await db.getTeamDetails(parseInt(value));
                 if (teamObj) await handleTeamList(interaction, userId, teamObj, parseInt(operation), true);
                 else await interaction.update({ content: "Error: Team info for pagination.", components: []});
            } else if (action === 'confirmleave') {
                if (operation === 'yes') {
                    const teamToLeave = userTeam;
                    if (!teamToLeave) return interaction.update({ content: "You are not in a team.", components: []});
                    const leaveResult = await db.leaveTeam(userId, teamToLeave.id);
                    if (leaveResult.success) await interaction.update({ content: `✅ You have successfully left team **${leaveResult.teamName}**.`, components: [] });
                    else await interaction.update({ content: `❌ Error leaving team: ${leaveResult.error}`, components: [] });
                } else await interaction.update({ content: 'Team leave cancelled.', components: [] });
            } else if (action === 'confirmremoveworld') {
                 const [worldNameToRemove, teamIdStr] = targetInfo.split('~');
                 const teamId = parseInt(teamIdStr);
                 if (value === 'yes') {
                     const removeResult = await db.removeWorldFromTeam(teamId, worldNameToRemove, userId);
                     if (removeResult.success) await interaction.update({ content: `✅ World **${worldNameToRemove}** removed.`, components: [] });
                     else await interaction.update({ content: `❌ Error removing world: ${removeResult.error}`, components: [] });
                 } else await interaction.update({ content: `Removal of **${worldNameToRemove}** cancelled.`, components: [] });
            } else if (action === 'confirmkick') {
                const memberToKickId = targetInfo; // targetInfo is memberId
                if (value === 'yes') {
                    if (!userTeam) return interaction.update({ content: "Error: Could not find your team information.", components:[]});
                    const kickResult = await db.removeTeamMember(userTeam.id, memberToKickId, userId);
                    if (kickResult.success) await interaction.update({ content: `✅ Member <@${memberToKickId}> kicked.`, components: []});
                    else await interaction.update({ content: `❌ Error kicking member: ${kickResult.error}`, components: []});
                } else await interaction.update({ content: 'Kick cancelled.', components: []});
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            const [context, action, targetIdFromModal] = interaction.customId.split(':');
            if (context !== 'team') return;
            if (!userTeam) return interaction.reply({content: "Error: Could not find your team information for modal submission.", ephemeral: true});


            if (action === 'confirmtransfermodal') {
                const newOwnerId = targetIdFromModal;
                const confirmationText = interaction.fields.getTextInputValue('transfer_confirmation_field');
                if (confirmationText !== 'TRANSFER') {
                    return interaction.reply({ content: "❌ Ownership transfer cancelled: Incorrect confirmation text.", ephemeral: true });
                }
                const transferResult = await db.transferTeamOwnership(userTeam.id, userId, newOwnerId);
                if (transferResult.success) await interaction.reply({ content: `✅ Ownership transferred to <@${newOwnerId}>. You are now a regular member.`, ephemeral: true });
                else await interaction.reply({ content: `❌ Error transferring ownership: ${transferResult.error}`, ephemeral: true });

            } else if (action === 'confirmdisbandmodal') {
                const teamIdToDisband = userTeam.id;
                const confirmationText = interaction.fields.getTextInputValue('disband_confirmation_field');
                if (confirmationText !== userTeam.name) {
                     return interaction.reply({ content: `❌ Team disband cancelled: You did not correctly type the team name ('${userTeam.name}').`, ephemeral: true });
                }
                const disbandResult = await db.disbandTeam(teamIdToDisband, userId);
                if (disbandResult.success) await interaction.reply({ content: `✅ Team **${userTeam.name}** has been disbanded.`, ephemeral: true });
                else await interaction.reply({ content: `❌ Error disbanding team: ${disbandResult.error}`, ephemeral: true });
            }
        }
    },
};

// --- SUBCOMMAND HANDLERS (Create, Join, List, Add, Remove, Info, Leave - from previous step, ensure they use userTeam param) ---
async function handleTeamCreate(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**. Leave it before creating a new one.`, ephemeral: true });
    const teamName = interaction.options.getString('team_name');
    if (!/^[a-zA-Z0-9\s-]{3,25}$/.test(teamName)) return interaction.reply({ content: '❌ Team name must be 3-25 characters and can only contain letters, numbers, spaces, and hyphens.', ephemeral: true });
    try {
        const result = await db.createTeam(teamName, userId);
        if (result.success) await interaction.reply({ content: `✅ Team **${teamName}** created! Owner: ${interaction.user.tag}.\nInvite code: \`\`\`${result.initialInviteCode}\`\`\``, ephemeral: true });
        else await interaction.reply({ content: `❌ Error: ${result.error === 'name_taken' ? 'Team name taken.' : (result.error === 'already_in_team' ? 'You are already in a team.' : 'Database error.')}`, ephemeral: true });
    } catch (e) { logger.error(e); await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true }); }
}

async function handleTeamJoin(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**. Leave it before joining another.`, ephemeral: true });
    const teamName = interaction.options.getString('team_name');
    const invitationCode = interaction.options.getString('invitation_code');
    try {
        const result = await db.validateAndUseTeamInvitation(teamName, invitationCode, userId);
        if (result.success) await interaction.reply({ content: `🎉 Welcome to **${result.teamName}**! You are now a member.`, ephemeral: true });
        else {
             let errMsg = `❌ Error joining: ${result.error}`;
             if (result.error === 'already_in_team' && result.teamName) errMsg = `❌ You are already in team **${result.teamName}**.`;
             await interaction.reply({ content: errMsg, ephemeral: true });
        }
    } catch (e) { logger.error(e); await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true }); }
}

async function handleTeamList(interaction, userId, userTeam, page = 1, isButton = false) {
    if (!userTeam) return interaction.reply({ content: "❌ You are not part of any team.", ephemeral: true });
    const replyMethod = isButton ? interaction.update.bind(interaction) : interaction.reply.bind(interaction);
    try {
        let { worlds, total } = await db.getTeamWorlds(userTeam.id, page, WORLDS_PER_PAGE_TEAM);
        const totalPages = Math.ceil(total / WORLDS_PER_PAGE_TEAM) || 1;
        if (page > totalPages && totalPages > 0) {
            page = totalPages;
            const result = await db.getTeamWorlds(userTeam.id, page, WORLDS_PER_PAGE_TEAM);
            worlds = result.worlds; total = result.total;
        }
        if (worlds.length === 0) {
            await replyMethod({ content: "No worlds tracked by the team yet.", components: [], ephemeral: true });
            return;
        }

        const headers = ['WORLD', 'DAYS LEFT', 'NOTE', 'ADDED BY'];
        const data = [headers];

        worlds.forEach(w => {
            const world_name = w.world_name || 'N/A';
            const days_left_value = w.days_left !== null ? w.days_left.toString() : 'N/A';
            const note_value = w.note || '-';
            // Ensure added_by_display_name is fetched or use a placeholder
            const added_by_value = w.added_by_display_name || (w.added_by_username || 'Unknown');
            data.push([world_name.toUpperCase(), days_left_value, note_value, added_by_value]);
        });

        const config = {
            columns: [
                { alignment: 'left', width: 15, wrapWord: true }, // WORLD
                { alignment: 'right', width: 10 }, // DAYS LEFT
                { alignment: 'left', width: 20, wrapWord: true }, // NOTE
                { alignment: 'left', width: 15, wrapWord: true }  // ADDED BY
            ],
            border: getBorderCharacters('norc'),
            header: {
                alignment: 'center',
                content: `Team ${userTeam.name}'s Worlds`,
            }
        };

        let tableOutput = '```\n' + table(data, config) + '\n```';
        if (tableOutput.length > 1950) { // Check if too long for Discord message
            let cutOff = tableOutput.lastIndexOf('\n', 1900);
            if (cutOff === -1) cutOff = 1900;
            tableOutput = tableOutput.substring(0, cutOff) + '\n... (Table truncated) ...```';
        }

        const finalContent = `Page ${page}/${totalPages}\n${tableOutput}`;
        const components = total > WORLDS_PER_PAGE_TEAM ? [createTeamWorldPaginationRow(page, totalPages, userTeam.id)] : [];

        await replyMethod({ content: finalContent, components, ephemeral: true });
    } catch (e) {
        logger.error('[team.js] Error in handleTeamList:', e);
        await replyMethod({ content: '❌ Error fetching team worlds.', components:[], ephemeral: true });
    }
}

async function handleTeamAddWorld(interaction, userId, userTeam) {
    if (!userTeam) return interaction.reply({ content: "❌ You must be in a team to add worlds.", ephemeral: true });
    const worldName = interaction.options.getString('world_name').toUpperCase();
    const daysOwned = interaction.options.getInteger('days_owned') || 1;
    const note = interaction.options.getString('note');
    if (!/^[A-Z0-9]{1,15}$/.test(worldName)) return interaction.reply({ content: "❌ Invalid world name (1-15 A-Z, 0-9, no spaces).", ephemeral: true });
    try {
        const result = await db.addWorldToTeam(userTeam.id, worldName, daysOwned, note, userId);
        if (result.success) await interaction.reply({ content: `✅ **${worldName}** added to **${userTeam.name}**'s list.`, ephemeral: true });
        else await interaction.reply({ content: `❌ Error adding world: ${result.error}`, ephemeral: true });
    } catch (e) { logger.error(e); await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true }); }
}

async function handleTeamRemoveWorld(interaction, userId, userTeam) {
    if (!userTeam) return interaction.reply({ content: "❌ You must be in a team.", ephemeral: true });
    const worldName = interaction.options.getString('world_name').toUpperCase();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team:confirmremoveworld:${worldName}~${userTeam.id}:yes`).setLabel("✅ Yes, Remove").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team:confirmremoveworld:${worldName}~${userTeam.id}:no`).setLabel("❌ No, Keep").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Remove **${worldName}** from team list? (Owner or original adder only)`, components: [row], ephemeral: true });
}

async function handleTeamInfo(interaction, userId, userTeam) {
    if (!userTeam) return interaction.reply({ content: "❌ You are not part of any team.", ephemeral: true });
    try {
        const details = await db.getTeamDetails(userTeam.id);
        if (!details) return interaction.reply({ content: "❌ Could not fetch team details.", ephemeral: true });
        const embed = new EmbedBuilder().setTitle(`🔰 Team Info: ${details.name}`).setColor(0x2ECC71)
            .addFields(
                { name: '👑 Owner', value: details.owner_display_name || 'N/A', inline: true },
                { name: '🗓️ Created', value: `<t:${Math.floor(new Date(details.creation_date).getTime()/1000)}:D>`, inline: true },
                { name: '📊 Worlds', value: String(details.totalWorlds), inline: true },
                { name: '👥 Members', value: details.members.map(m => `${m.display_name} (Joined <t:${Math.floor(new Date(m.join_date).getTime()/1000)}:R>)`).join('\n').substring(0,1020) || 'Owner only', inline: false }
            );
        await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (e) { logger.error(e); await interaction.reply({ content: '❌ Error fetching team info.', ephemeral: true }); }
}

async function handleTeamLeave(interaction, userId, userTeam) {
    if (!userTeam) return interaction.reply({ content: "❌ You are not in any team.", ephemeral: true });
    if (userTeam.owner_user_id === userId) return interaction.reply({ content: "❌ Owners must transfer or disband team.", ephemeral: true });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team:confirmleave:yes`).setLabel("✅ Yes, Leave").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team:confirmleave:no`).setLabel("❌ No, Stay").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Leave **${userTeam.name}**?`, components: [row], ephemeral: true });
}

// --- OWNER-ONLY SUBCOMMAND HANDLERS ---
async function handleTeamInvite(interaction, userId, userTeam) { // userTeam is passed and owner check is done
    try {
        const newCode = await db.generateTeamInvitationCode(userTeam.id, userId);
        await interaction.reply({ content: `✅ New single-use invitation code for **${userTeam.name}**: \`\`\`${newCode}\`\`\``, ephemeral: true });
    } catch (e) { logger.error(e); await interaction.reply({ content: '❌ Error generating invite code.', ephemeral: true }); }
}

async function handleTeamKick(interaction, userId, userTeam) {
    const memberToKickUserObj = interaction.options.getUser('member');
    if (!memberToKickUserObj) return interaction.reply({ content: "❌ You must specify a member to kick.", ephemeral: true });
    const memberToKickId = memberToKickUserObj.id;

    if (memberToKickId === userId) return interaction.reply({ content: "❌ You cannot kick yourself.", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team:confirmkick:${memberToKickId}:yes`).setLabel(`✅ Yes, Kick ${memberToKickUserObj.username}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team:confirmkick:${memberToKickId}:no`).setLabel("❌ No, Don't Kick").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Are you sure you want to remove ${memberToKickUserObj.tag} from **${userTeam.name}**?`, components: [row], ephemeral: true });
}

async function handleTeamTransfer(interaction, userId, userTeam) {
    const newOwnerUserObj = interaction.options.getUser('new_owner');
    if (!newOwnerUserObj) return interaction.reply({ content: "❌ You must specify a new owner.", ephemeral: true});
    const newOwnerId = newOwnerUserObj.id;

    if (newOwnerId === userId) return interaction.reply({ content: "❌ You are already the owner.", ephemeral: true });

    const modal = new ModalBuilder()
        .setCustomId(`team:confirmtransfermodal:${newOwnerId}`)
        .setTitle(`Transfer Team Ownership`);
    const warningText = new TextInputBuilder()
        .setCustomId('transfer_warning_text')
        .setLabel(`Transfer to ${newOwnerUserObj.username}?`)
        .setStyle(TextInputStyle.Paragraph)
        .setValue(`WARNING: Transfer ownership of "${userTeam.name}" to ${newOwnerUserObj.tag}? You will become a regular member. This is IRREVERSIBLE. Type 'TRANSFER' below to confirm.`)
        .setRequired(false);
    const confirmationInput = new TextInputBuilder()
        .setCustomId('transfer_confirmation_field')
        .setLabel("Type 'TRANSFER' to confirm")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('TRANSFER')
        .setRequired(true)
        .setMinLength(8).setMaxLength(8);

    modal.addComponents(new ActionRowBuilder().addComponents(warningText), new ActionRowBuilder().addComponents(confirmationInput));
    await interaction.showModal(modal);
}

async function handleTeamDisband(interaction, userId, userTeam) {
    const modal = new ModalBuilder()
        .setCustomId(`team:confirmdisbandmodal:${userTeam.id}`)
        .setTitle(`Disband Team ${userTeam.name}`);
    const warningText = new TextInputBuilder()
        .setCustomId('disband_warning_text')
        .setLabel(`Permanently delete team "${userTeam.name}"?`)
        .setStyle(TextInputStyle.Paragraph)
        .setValue(`WARNING: This action will permanently delete team "${userTeam.name}", all tracked worlds, and member associations. This CANNOT BE UNDONE. Type the team name '${userTeam.name}' below to confirm.`)
        .setRequired(false);
    const confirmationInput = new TextInputBuilder()
        .setCustomId('disband_confirmation_field')
        .setLabel(`Type '${userTeam.name}' to confirm`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(userTeam.name)
        .setRequired(true)
        .setMinLength(userTeam.name.length)
        .setMaxLength(userTeam.name.length);

    modal.addComponents(new ActionRowBuilder().addComponents(warningText), new ActionRowBuilder().addComponents(confirmationInput));
    await interaction.showModal(modal);
}
