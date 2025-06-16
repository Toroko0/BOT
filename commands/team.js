// team.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, MessageFlags } = require('discord.js');
const { table, getBorderCharacters } = require('table');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const utils = require('../utils.js');
const CONSTANTS = require('../utils/constants.js');

const WORLDS_PER_PAGE = CONSTANTS.PAGE_SIZE_TEAM || 5;
const MEMBERS_PER_PAGE_INFO = CONSTANTS.PAGE_SIZE_INFO_MEMBERS || 5; // For member list in team info

// --- Main Display Function ---
async function showTeamList(interaction, team, page = 1) {
    const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    } else if (!isUpdate && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const { worlds, total } = await db.getTeamWorlds(team.id, page, WORLDS_PER_PAGE);
    const totalPages = Math.max(1, Math.ceil(total / WORLDS_PER_PAGE));
    page = Math.max(1, Math.min(page, totalPages));

    if (total === 0) {
        const opts = { content: "Your team has no tracked worlds. Use `/team add` to add one.", flags: MessageFlags.Ephemeral, components: [] };
        await interaction.editReply(opts);
        return;
    }

    const headers = ['WORLD', 'DAYS LEFT', 'NOTE', 'ADDED BY'];
    const data = [headers];
    worlds.forEach(w => {
        data.push([
            w.world_name.toUpperCase(),
            w.days_left !== null ? w.days_left.toString() : 'N/A',
            w.note || '-',
            w.added_by_display_name || 'Unknown'
        ]);
    });
    
    const tableConfig = {
        columns: [ { width: 15 }, { width: 10 }, { width: 20 }, { width: 15 } ],
        border: getBorderCharacters('norc'),
        header: { content: `Team "${team.name}" Worlds`, alignment: 'center' }
    };
    
    let tableOutput = '```\n' + table(data, tableConfig) + '\n```';
    if (tableOutput.length > 1900) {
        tableOutput = tableOutput.substring(0, tableOutput.lastIndexOf('\n', 1900)) + '\n... (Table truncated) ...```';
    }
    const finalContent = `Page ${page}/${totalPages}\n${tableOutput}`;
    
    const components = [];
    if (total > WORLDS_PER_PAGE) {
        components.push(utils.createPaginationRow(`team_button_list_${team.id}`, page, totalPages));
    }

    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`team_button_addworld_${team.id}`)
                .setLabel('➕ Add World')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`team_button_removeworldmodal_${team.id}`)
                .setLabel('➖ Remove World')
                .setStyle(ButtonStyle.Danger)
        );
    components.push(actionRow);
    
    const opts = { content: finalContent, components, flags: MessageFlags.Ephemeral };
    await interaction.editReply(opts);
}

// --- Subcommand Handlers ---
async function handleTeamCreate(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**.`, flags: MessageFlags.Ephemeral });
    const teamName = interaction.options.getString('team_name');
    if (!/^[a-zA-Z0-9\s-]{3,25}$/.test(teamName)) return interaction.reply({ content: '❌ Invalid team name format.', flags: MessageFlags.Ephemeral });
    
    const result = await db.createTeam(teamName, userId);
    if (result.success) await interaction.reply({ content: `✅ Team **${teamName}** created! Your invite code: \`\`\`${result.initialInviteCode}\`\`\``, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content: `❌ Error: ${result.error === 'name_taken' ? 'Team name taken.' : 'Database error.'}`, flags: MessageFlags.Ephemeral });
}

async function handleTeamJoin(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**.`, flags: MessageFlags.Ephemeral });
    const teamName = interaction.options.getString('team_name');
    const code = interaction.options.getString('invitation_code');
    const result = await db.validateAndUseTeamInvitation(teamName, code, userId);
    if (result.success) await interaction.reply({ content: `🎉 Welcome to **${result.teamName}**!`, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content: `❌ Error joining: ${result.error}`, flags: MessageFlags.Ephemeral });
}

async function handleTeamAdd(interaction, userId, userTeam) {
    const worldName = interaction.options.getString('world_name').toUpperCase();
    if (worldName.includes(' ')) return interaction.reply({ content: "❌ World names cannot contain spaces.", flags: MessageFlags.Ephemeral });
    const result = await db.addWorldToTeam(userTeam.id, worldName, interaction.options.getInteger('days_owned') || 1, interaction.options.getString('note'), userId);
    if (result.success) await interaction.reply({ content: `✅ **${worldName}** added to the team list.`, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content: `❌ Error: ${result.error === 'already_exists' ? 'That world is already on the team list.' : 'Database error.'}`, flags: MessageFlags.Ephemeral });
}

async function handleTeamRemove(interaction, userId, userTeam) {
    const worldName = interaction.options.getString('world_name').toUpperCase();
    const worldEntry = await db.getTeamWorlds(userTeam.id, 1, 1, { worldName }); // Not ideal, but checks existence
    if (!worldEntry.worlds[0]) return interaction.reply({ content: 'That world is not on the team list.', flags: MessageFlags.Ephemeral });

    if (userId !== userTeam.owner_user_id && userId !== worldEntry.worlds[0].added_by_user_id) {
        return interaction.reply({ content: "❌ You can only remove worlds you added, unless you're the team owner.", flags: MessageFlags.Ephemeral });
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team_button_confirmremove_yes_${userTeam.id}_${worldName}`).setLabel("✅ Yes, Remove").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team_button_confirmremove_no`).setLabel("❌ No, Keep").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Remove **${worldName}** from team list?`, components: [row], flags: MessageFlags.Ephemeral });
}

async function handleTeamInfo(interaction, userTeam) {
    const details = await db.getTeamDetails(userTeam.id);
    if (!details) return interaction.reply({ content: "❌ Could not fetch team details.", flags: MessageFlags.Ephemeral });
    const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
    if (isUpdate && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
    } else if (!isUpdate && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    if (!details) { // This 'if' block should now use the 'details' variable from the first declaration
        return interaction.editReply({ content: "❌ Could not fetch team details.", flags: MessageFlags.Ephemeral, components: [] });
    }

    let memberPage = interaction.options?.getInteger('memberpage') || 1; // Get page from options if initial call
    if (isUpdate && interaction.customId?.startsWith('team_button_infomemberpage_')) { // Or from button custom ID
        const parts = interaction.customId.split('_');
        memberPage = parseInt(parts[parts.length -1]) || 1;
    }


    // Team Info Summary Table
    const summaryData = [
        ['Team Name', details.name],
        ['Owner', details.owner_display_name],
        ['Created', new Date(details.creation_date).toLocaleDateString('en-CA')],
        ['Total Worlds', String(details.totalWorlds)],
        ['Total Members', String(details.members.length)]
    ];
    const summaryTableConfig = {
        border: getBorderCharacters('norc'),
        columns: [{ width: 15 }, { width: 35 }],
    };
    let output = '```\n' + table(summaryData, summaryTableConfig) + '```\n';

    // Member List Table & Pagination
    const totalMemberPages = Math.max(1, Math.ceil(details.members.length / MEMBERS_PER_PAGE_INFO));
    memberPage = Math.max(1, Math.min(memberPage, totalMemberPages));

    const memberStartIndex = (memberPage - 1) * MEMBERS_PER_PAGE_INFO;
    const memberEndIndex = memberStartIndex + MEMBERS_PER_PAGE_INFO;
    const pagedMembers = details.members.slice(memberStartIndex, memberEndIndex);

    output += `**Members (Page ${memberPage}/${totalMemberPages}):**\n`;
    if (pagedMembers.length > 0) {
        const membersHeaders = ['#', 'Member', 'Joined'];
        const membersRows = pagedMembers.map((m, index) => [
            (memberStartIndex + index + 1).toString(),
            m.display_name,
            new Date(m.join_date).toLocaleDateString('en-CA')
        ]);
        const membersTableConfig = {
            border: getBorderCharacters('norc'),
            columns: [{ width: 3 }, { width: 25 }, { width: 15 }],
        };
        output += '```\n' + table([membersHeaders, ...membersRows], membersTableConfig) + '```';
    } else {
        output += 'No members on this page (or team has no members other than owner if applicable).';
    }

    const components = [];
    const actionRow1 = new ActionRowBuilder();
    actionRow1.addComponents(
        new ButtonBuilder().setCustomId(`team_button_infoviewworlds_${userTeam.id}`).setLabel('📚 View Worlds').setStyle(ButtonStyle.Primary)
    );

    if (interaction.user.id === details.owner_user_id) {
        actionRow1.addComponents(
            new ButtonBuilder().setCustomId(`team_button_infoinvitecode_${userTeam.id}`).setLabel('✉️ New Invite Code').setStyle(ButtonStyle.Success)
        );
        actionRow1.addComponents(
             new ButtonBuilder().setCustomId(`team_button_infokickmodal_${userTeam.id}`).setLabel('👢 Kick Member').setStyle(ButtonStyle.Danger)
        );
    }
    // "Leave Team" button should be on a new row for better UI separation if other owner buttons exist.
    const actionRow2 = new ActionRowBuilder();
    actionRow2.addComponents(
        new ButtonBuilder().setCustomId(`team_button_leave_${userTeam.id}`).setLabel('🚪 Leave Team').setStyle(ButtonStyle.Danger)
    );

    components.push(actionRow1);
    components.push(actionRow2);


    if (details.members.length > MEMBERS_PER_PAGE_INFO) {
        components.push(utils.createPaginationRow(`team_button_infomemberpage_${userTeam.id}`, memberPage, totalMemberPages));
    }

    if (isUpdate) {
        await interaction.editReply({ content: output, components, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ content: output, components, flags: MessageFlags.Ephemeral });
    }
}

async function handleTeamKick(interaction, userId, userTeam) {
    const memberToKick = interaction.options.getUser('member');
    if (memberToKick.id === userId) return interaction.reply({ content: "❌ You can't kick yourself.", flags: MessageFlags.Ephemeral });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team_button_confirmkick_yes_${memberToKick.id}`).setLabel(`Kick ${memberToKick.username}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team_button_confirmkick_no`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Are you sure you want to remove ${memberToKick.tag} from the team?`, components: [row], flags: MessageFlags.Ephemeral });
}

async function handleTeamTransfer(interaction, userId, userTeam) {
    const newOwner = interaction.options.getUser('new_owner');
    if (newOwner.id === userId) return interaction.reply({ content: "❌ You are already the owner.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`team_modal_transfer_${newOwner.id}`).setTitle(`Transfer Team Ownership`);
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('confirm_text').setLabel(`Type 'TRANSFER' to confirm transfer`).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('TRANSFER')
    ));
    await interaction.showModal(modal);
}

// --- Main Export ---
module.exports = {
    data: new SlashCommandBuilder().setName('team').setDescription('Manage your team.')
        .addSubcommand(s => s.setName('create').setDescription('Create a team.').addStringOption(o => o.setName('team_name').setRequired(true).setMinLength(3).setMaxLength(25).setDescription('The name for your new team.')))
        .addSubcommand(s => s.setName('join').setDescription('Join a team.').addStringOption(o => o.setName('team_name').setRequired(true).setDescription('The name of the team you want to join.')).addStringOption(o => o.setName('invitation_code').setRequired(true).setDescription('The invitation code for the team.')))
        .addSubcommand(s => s.setName('list').setDescription("View team's worlds.").addIntegerOption(o => o.setName('page').setMinValue(1).setDescription('Page number for the team world list.')))
        .addSubcommand(s => s.setName('add').setDescription('Add a world.')
            .addStringOption(o => o.setName('world_name').setRequired(true).setDescription('The name of the world to add.'))
            .addIntegerOption(o => o.setName('days_owned').setMinValue(1).setMaxValue(180).setDescription('How many days the world has been owned (approx).'))
            .addStringOption(o => o.setName('note').setMaxLength(100).setDescription('A short note for this world.')))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a world.').addStringOption(o => o.setName('world_name').setRequired(true).setDescription('The name of the world to remove from the team list.')))
        .addSubcommand(s => s.setName('info').setDescription('View team info.'))
        .addSubcommand(s => s.setName('leave').setDescription('Leave your team.'))
        .addSubcommand(s => s.setName('invite').setDescription('Generate a new invite code (Owner only).'))
        .addSubcommand(s => s.setName('kick').setDescription('Kick a member (Owner only).').addUserOption(o => o.setName('member').setRequired(true).setDescription('The team member to kick.')))
        .addSubcommand(s => s.setName('transfer').setDescription('Transfer ownership (Owner only).').addUserOption(o => o.setName('new_owner').setRequired(true).setDescription('The member to transfer team ownership to.')))
        .addSubcommand(s => s.setName('disband').setDescription('Permanently disband your team (Owner only).')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const userTeam = await db.getUserTeam(userId);

        const memberRequired = ['list', 'add', 'remove', 'info', 'leave'];
        const ownerRequired = ['invite', 'kick', 'transfer', 'disband'];

        if ((memberRequired.includes(subcommand) || ownerRequired.includes(subcommand)) && !userTeam) {
            return interaction.reply({ content: "❌ You are not in a team.", flags: MessageFlags.Ephemeral });
        }
        if (ownerRequired.includes(subcommand) && userTeam.owner_user_id !== userId) {
            return interaction.reply({ content: "❌ Only the team owner can use this command.", flags: MessageFlags.Ephemeral });
        }

        switch (subcommand) {
            case 'create': await handleTeamCreate(interaction, userId, userTeam); break;
            case 'join': await handleTeamJoin(interaction, userId, userTeam); break;
            case 'list': await showTeamList(interaction, userTeam, interaction.options.getInteger('page') || 1); break;
            case 'add': await handleTeamAdd(interaction, userId, userTeam); break;
            case 'remove': await handleTeamRemove(interaction, userId, userTeam); break;
            case 'info': await handleTeamInfo(interaction, userTeam, 1); break; // Pass initial member page
            case 'leave': {
                // This is the /team leave subcommand
                if (!userTeam) { // Should have been caught by pre-check, but safeguard
                    return interaction.reply({ content: "❌ You are not in a team.", flags: MessageFlags.Ephemeral });
                }
                if (userTeam.owner_user_id === userId) {
                    const teamDetails = await db.getTeamDetails(userTeam.id);
                    if (teamDetails && teamDetails.members.length > 1) {
                        return interaction.reply({ content: "❌ As the team owner, you cannot leave directly while other members are present. Please transfer ownership or remove other members first.", flags: MessageFlags.Ephemeral });
                    } else { // Owner is solo or teamDetails fetch failed (assume solo for safety if failed)
                        const result = await db.disbandTeam(userTeam.id, userId);
                        return interaction.reply({ content: result.success ? `✅ You have left and disbanded team **${userTeam.name}**.` : `❌ Error disbanding team: ${result.error}`, flags: MessageFlags.Ephemeral });
                    }
                } else {
                    const result = await db.leaveTeam(userId, userTeam.id);
                    return interaction.reply({ content: result.success ? `✅ You have left team **${userTeam.name}**.` : `❌ Error leaving team: ${result.error}`, flags: MessageFlags.Ephemeral });
                }
                // break; // Unreachable due to returns, but good practice
            }
            case 'invite':
                const newCode = await db.generateTeamInvitationCode(userTeam.id, userId);
                await interaction.reply({ content: `✅ New single-use invite code: \`\`\`${newCode}\`\`\``, flags: MessageFlags.Ephemeral });
                break;
            case 'kick': await handleTeamKick(interaction, userId, userTeam); break;
            case 'transfer': await handleTeamTransfer(interaction, userId, userTeam); break;
            case 'disband':
                const modal = new ModalBuilder().setCustomId('team_modal_disband').setTitle(`Disband Team ${userTeam.name}`);
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('confirm_text').setLabel(`Type team name '${userTeam.name}' to confirm`).setStyle(TextInputStyle.Short).setRequired(true)));
                await interaction.showModal(modal);
                break;
        }
    },
    async handleInteraction(interaction) {
        const [context, command, ...args] = interaction.customId.split('_');
        if (context !== 'team') return;

        if (interaction.isButton()) {
            const userTeam = await db.getUserTeam(interaction.user.id);
            if (!userTeam && command !== 'confirmleave') return interaction.update({ content: 'You are no longer in a team.', components: [] });

            switch(command) {
                case 'button': {
                    const [action, teamIdFromArgs, ...actionArgs] = args;
                    if (action === 'list') {
                        await showTeamList(interaction, userTeam, parseInt(actionArgs[0]));
                    } else if (action === 'confirmleave') { // This specific confirmleave is from old /team leave direct command, might be dead after subcommand rework.
                        if(teamIdFromArgs === 'no') return interaction.update({ content: 'Leave cancelled.', components: [] });
                        // This part of confirmleave is now mostly handled by the direct /team leave logic or the new leave button from /team info
                        const leaveResult = await db.leaveTeam(interaction.user.id, userTeam.id); // userTeam context should be valid
                        await interaction.update({ content: leaveResult.success ? `✅ You left **${userTeam.name}**.` : `❌ Error: ${leaveResult.error}`, components: [] });
                    } else if (action === 'confirmremove') {
                        const [confirmStatus, worldName] = actionArgs;
                        if(confirmStatus === 'no') return interaction.update({ content: 'Removal cancelled.', components: [] });
                        const result = await db.removeWorldFromTeam(parseInt(teamIdFromArgs), worldName, interaction.user.id);
                        await interaction.update({ content: result.success ? `✅ World **${worldName}** removed.` : `❌ Error: ${result.error}`, components: [] });
                         if (result.success && userTeam) await showTeamList(interaction, userTeam, 1);
                    } else if (action === 'confirmkick') {
                        const [confirmStatus, memberId] = actionArgs;
                        if(teamIdFromArgs === 'no') return interaction.update({ content: 'Kick cancelled.', components: [] });
                        const result = await db.removeTeamMember(userTeam.id, memberId, interaction.user.id);
                        await interaction.update({ content: result.success ? `✅ Member kicked.` : `❌ Error: ${result.error}`, components: [] });
                    } else if (action === 'addworld') {
                        const teamId = teamIdFromArgs;
                        const modal = new ModalBuilder().setCustomId(`team_modal_addworldsubmit_${teamId}`).setTitle('Add World to Team');
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('world_name').setLabel("World Name").setStyle(TextInputStyle.Short).setRequired(true)),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days_owned').setLabel("Days Owned (1-180)").setStyle(TextInputStyle.Short).setRequired(true).setValue('1')),
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel("Note (Optional)").setStyle(TextInputStyle.Paragraph).setRequired(false))
                        );
                        await interaction.showModal(modal);
                    } else if (action === 'removeworldmodal') {
                        const teamId = teamIdFromArgs;
                        const modal = new ModalBuilder().setCustomId(`team_modal_removeworldsubmit_${teamId}`).setTitle('Remove World from Team');
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('world_name').setLabel("World Name to Remove").setStyle(TextInputStyle.Short).setRequired(true))
                        );
                        await interaction.showModal(modal);
                    } else if (action === 'infoviewworlds') {
                        const teamId = teamIdFromArgs;
                        if (userTeam && userTeam.id.toString() === teamId) {
                           await showTeamList(interaction, userTeam, 1);
                        } else {
                            const teamToView = await db.getTeamByName( (await db.getTeamDetails(teamId))?.name ); // Re-fetch team by ID then name for showTeamList
                            if (teamToView) await showTeamList(interaction, teamToView, 1);
                            else await interaction.reply({content: 'Could not fetch team to view its worlds.', ephemeral: true});
                        }
                    } else if (action === 'infoinvitecode') {
                        const teamId = teamIdFromArgs;
                        if (userTeam && userTeam.id.toString() === teamId && userTeam.owner_user_id === interaction.user.id) {
                            const newCode = await db.generateTeamInvitationCode(teamId, interaction.user.id);
                            await interaction.reply({ content: `✅ New single-use invite code for **${userTeam.name}**: \`\`\`${newCode}\`\`\``, flags: MessageFlags.Ephemeral });
                        } else {
                            await interaction.reply({ content: '❌ You must be the owner to generate an invite code, or team ID was mismatched.', flags: MessageFlags.Ephemeral });
                        }
                    } else if (action === 'infokickmodal') {
                        const teamId = teamIdFromArgs;
                         if (userTeam && userTeam.id.toString() === teamId && userTeam.owner_user_id === interaction.user.id) {
                            const modal = new ModalBuilder().setCustomId(`team_modal_infokicksubmit_${teamId}`).setTitle('Kick Member from Team');
                            modal.addComponents(
                                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('member_id_kick').setLabel("User ID or @mention of member to kick").setStyle(TextInputStyle.Short).setRequired(true))
                            );
                            await interaction.showModal(modal);
                        } else {
                             await interaction.reply({ content: '❌ You must be the owner to kick members, or team ID was mismatched.', flags: MessageFlags.Ephemeral });
                        }
                    } else if (action === 'infomemberpage') {
                        const teamId = teamIdFromArgs;
                        const page = parseInt(actionArgs[0]) || 1;
                        if (userTeam && userTeam.id.toString() === teamId) {
                            await handleTeamInfo(interaction, userTeam, page);
                        } else {
                            const teamToView = await db.getTeamDetails(teamId); // Fetches the full team object
                             if (teamToView) await handleTeamInfo(interaction, teamToView, page); // teamToView now has .id, .name etc.
                             else await interaction.reply({content: 'Could not fetch team info for pagination.', ephemeral: true});
                        }
                    } else if (action === 'leave') { // Handler for "Leave Team" button from /team info
                        const teamId = teamIdFromArgs;
                        const currentMemberUserId = interaction.user.id;
                        const teamToLeaveDetails = await db.getTeamDetails(teamId);

                        if (!teamToLeaveDetails) {
                            return interaction.update({ content: '❌ Team not found or could not be verified.', components: [] });
                        }
                        // Check if the current user is part of this team (safeguard)
                        const isMember = teamToLeaveDetails.members.some(m => m.id === currentMemberUserId);
                        if (!isMember && teamToLeaveDetails.owner_user_id !== currentMemberUserId) { // owner is also a member implicitly
                             return interaction.update({ content: '❌ You are not a member of this team.', components: [] });
                        }


                        if (teamToLeaveDetails.owner_user_id === currentMemberUserId) { // User is the owner
                            if (teamToLeaveDetails.members.length > 1) {
                                return interaction.update({ content: "❌ As the team owner, you cannot leave directly if other members are present. Please transfer ownership or remove other members first.", components: [] });
                            } else { // Owner is the only member
                                const result = await db.disbandTeam(teamId, currentMemberUserId);
                                return interaction.update({ content: result.success ? `✅ You have left and disbanded team **${teamToLeaveDetails.name}**.` : `❌ Error disbanding team: ${result.error}`, components: [] });
                            }
                        } else { // User is a regular member
                            const result = await db.leaveTeam(currentMemberUserId, teamId);
                            return interaction.update({ content: result.success ? `✅ You have left team **${teamToLeaveDetails.name}**.` : `❌ Error leaving team: ${result.error}`, components: [] });
                        }
                    }
                    break;
                }
            }
        } else if (interaction.isModalSubmit()) {
            const userTeam = await db.getUserTeam(interaction.user.id);
            if (!userTeam) return interaction.reply({ content: 'You are no longer in a team, or the team could not be determined.', flags: MessageFlags.Ephemeral });

            const [modalContext, modalName, actionType, targetIdIfPresent] = interaction.customId.split('_');
            // For new modals: team_modal_infokicksubmit_TEAMID -> modalContext='team', modalName='modal', actionType='infokicksubmit', targetIdIfPresent=TEAMID
            // For old modals: team_modal_addworldsubmit_TEAMID -> modalContext='team', modalName='modal', actionType='addworldsubmit', targetIdIfPresent=TEAMID
            // For old modals: team_modal_transfer_USERID -> modalContext='team', modalName='modal', actionType='transfer', targetIdIfPresent=USERID

            if (modalName === 'modal') {
                if (actionType === 'transfer') {
                    const targetUserId = targetIdIfPresent;
                    const confirmText = interaction.fields.getTextInputValue('confirm_text');
                    if (confirmText !== 'TRANSFER') return interaction.reply({ content: "❌ Confirmation text incorrect. Transfer cancelled.", flags: MessageFlags.Ephemeral });
                    const result = await db.transferTeamOwnership(userTeam.id, interaction.user.id, targetUserId);
                    await interaction.reply({ content: result.success ? `✅ Ownership transferred to <@${targetUserId}>.` : `❌ Error: ${result.error}`, flags: MessageFlags.Ephemeral });
                } else if (actionType === 'disband') {
                    const confirmText = interaction.fields.getTextInputValue('confirm_text');
                    if (confirmText !== userTeam.name) return interaction.reply({ content: "❌ Confirmation text incorrect. Disband cancelled.", flags: MessageFlags.Ephemeral });
                    const result = await db.disbandTeam(userTeam.id, interaction.user.id);
                    await interaction.reply({ content: result.success ? `✅ Team **${userTeam.name}** disbanded.` : `❌ Error: ${result.error}`, flags: MessageFlags.Ephemeral });
                } else if (actionType === 'addworldsubmit') { // From team list view
                    const teamId = targetIdIfPresent;
                    const worldName = interaction.fields.getTextInputValue('world_name').trim();
                    const daysOwnedStr = interaction.fields.getTextInputValue('days_owned').trim();
                    const note = interaction.fields.getTextInputValue('note').trim() || null;

                    if (!worldName || worldName.includes(' ')) {
                        await interaction.reply({ content: "❌ World name cannot be empty or contain spaces.", flags: MessageFlags.Ephemeral });
                        return showTeamList(interaction, userTeam, 1); // Show list again
                    }
                    const daysOwned = parseInt(daysOwnedStr);
                    if (isNaN(daysOwned) || daysOwned < 1 || daysOwned > 180) {
                        await interaction.reply({ content: "❌ Days owned must be a number between 1 and 180.", flags: MessageFlags.Ephemeral });
                        return showTeamList(interaction, userTeam, 1);
                    }

                    const result = await db.addWorldToTeam(teamId, worldName.toUpperCase(), daysOwned, note, interaction.user.id);
                    await interaction.reply({ content: result.success ? `✅ World **${worldName.toUpperCase()}** added to team.` : `❌ Error: ${result.error === 'already_exists' ? 'That world is already on the team list.' : 'Database error.'}`, flags: MessageFlags.Ephemeral });
                    await showTeamList(interaction, userTeam, 1); // Refresh list
                } else if (actionType === 'removeworldsubmit') { // From team list view
                    const teamId = targetIdIfPresent;
                    const worldName = interaction.fields.getTextInputValue('world_name').trim();
                    if (!worldName) {
                        await interaction.reply({ content: "❌ World name cannot be empty.", flags: MessageFlags.Ephemeral });
                        return showTeamList(interaction, userTeam, 1);
                    }
                    const result = await db.removeWorldFromTeam(teamId, worldName.toUpperCase(), interaction.user.id);
                    await interaction.reply({ content: result.success ? `✅ World **${worldName.toUpperCase()}** removed from team.` : `❌ Error removing: ${result.message || result.error || 'Unknown error.'}`, flags: MessageFlags.Ephemeral });
                    await showTeamList(interaction, userTeam, 1); // Refresh list
                } else if (actionType === 'infokicksubmit') {
                    const teamId = targetIdIfPresent;
                    const memberIdentifier = interaction.fields.getTextInputValue('member_id_kick').trim();
                    // Basic validation: Expect a User ID (string of numbers)
                    if (!/^\d+$/.test(memberIdentifier)) {
                        await interaction.reply({ content: "❌ Invalid User ID format. Please provide a valid User ID.", flags: MessageFlags.Ephemeral });
                        return handleTeamInfo(interaction, userTeam, 1); // Refresh team info
                    }
                    const memberToKickId = memberIdentifier;

                    if (memberToKickId === userTeam.owner_user_id) {
                         await interaction.reply({ content: "❌ Cannot kick the team owner.", flags: MessageFlags.Ephemeral });
                         return handleTeamInfo(interaction, userTeam, 1);
                    }
                     if (memberToKickId === interaction.user.id) {
                        await interaction.reply({ content: "❌ You cannot kick yourself.", flags: MessageFlags.Ephemeral });
                        return handleTeamInfo(interaction, userTeam, 1);
                    }

                    // Permission check (owner) is implicitly handled by button visibility, but double check here for safety
                    if (userTeam.owner_user_id !== interaction.user.id) {
                        await interaction.reply({ content: "❌ Only the team owner can kick members.", flags: MessageFlags.Ephemeral });
                        return handleTeamInfo(interaction, userTeam, 1);
                    }

                    const kickResult = await db.removeTeamMember(teamId, memberToKickId, interaction.user.id);
                    if (kickResult.success) {
                        await interaction.reply({ content: `✅ Member <@${memberToKickId}> kicked from the team.`, flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: `❌ Failed to kick member: ${kickResult.error || 'Unknown error.'}`, flags: MessageFlags.Ephemeral });
                    }
                    await handleTeamInfo(interaction, userTeam, 1); // Refresh team info
                }
            }
        }
    },
    showTeamList,
};
