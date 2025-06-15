// team.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const { table, getBorderCharacters } = require('table');
const db = require('../database.js');
const logger = require('../utils/logger.js');
const utils = require('../utils.js');
const CONSTANTS = require('../utils/constants.js');

const WORLDS_PER_PAGE = CONSTANTS.PAGE_SIZE_TEAM || 5;

// --- Main Display Function ---
async function showTeamList(interaction, team, page = 1) {
    const isUpdate = interaction.isMessageComponent() || interaction.isModalSubmit();
    if (isUpdate && !interaction.deferred) {
        await interaction.deferUpdate();
    } else if (!isUpdate && !interaction.deferred) {
        await interaction.deferReply({ ephemeral: true });
    }

    const { worlds, total } = await db.getTeamWorlds(team.id, page, WORLDS_PER_PAGE);
    const totalPages = Math.max(1, Math.ceil(total / WORLDS_PER_PAGE));
    page = Math.max(1, Math.min(page, totalPages));

    if (total === 0) {
        const opts = { content: "Your team has no tracked worlds. Use `/team add` to add one.", ephemeral: true, components: [] };
        if (isUpdate) await interaction.editReply(opts); else await interaction.reply(opts);
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
    
    const components = total > WORLDS_PER_PAGE ? [utils.createPaginationRow(page, totalPages, `team_button_list_${team.id}`)] : [];
    
    const opts = { content: finalContent, components, ephemeral: true };
    if (isUpdate) await interaction.editReply(opts); else await interaction.reply(opts);
}

// --- Subcommand Handlers ---
async function handleTeamCreate(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**.`, ephemeral: true });
    const teamName = interaction.options.getString('team_name');
    if (!/^[a-zA-Z0-9\s-]{3,25}$/.test(teamName)) return interaction.reply({ content: '❌ Invalid team name format.', ephemeral: true });
    
    const result = await db.createTeam(teamName, userId);
    if (result.success) await interaction.reply({ content: `✅ Team **${teamName}** created! Your invite code: \`\`\`${result.initialInviteCode}\`\`\``, ephemeral: true });
    else await interaction.reply({ content: `❌ Error: ${result.error === 'name_taken' ? 'Team name taken.' : 'Database error.'}`, ephemeral: true });
}

async function handleTeamJoin(interaction, userId, userTeam) {
    if (userTeam) return interaction.reply({ content: `❌ You are already in team **${userTeam.name}**.`, ephemeral: true });
    const teamName = interaction.options.getString('team_name');
    const code = interaction.options.getString('invitation_code');
    const result = await db.validateAndUseTeamInvitation(teamName, code, userId);
    if (result.success) await interaction.reply({ content: `🎉 Welcome to **${result.teamName}**!`, ephemeral: true });
    else await interaction.reply({ content: `❌ Error joining: ${result.error}`, ephemeral: true });
}

async function handleTeamAdd(interaction, userId, userTeam) {
    const worldName = interaction.options.getString('world_name').toUpperCase();
    if (worldName.includes(' ')) return interaction.reply({ content: "❌ World names cannot contain spaces.", ephemeral: true });
    const result = await db.addWorldToTeam(userTeam.id, worldName, interaction.options.getInteger('days_owned') || 1, interaction.options.getString('note'), userId);
    if (result.success) await interaction.reply({ content: `✅ **${worldName}** added to the team list.`, ephemeral: true });
    else await interaction.reply({ content: `❌ Error: ${result.error === 'already_exists' ? 'That world is already on the team list.' : 'Database error.'}`, ephemeral: true });
}

async function handleTeamRemove(interaction, userId, userTeam) {
    const worldName = interaction.options.getString('world_name').toUpperCase();
    const worldEntry = await db.getTeamWorlds(userTeam.id, 1, 1, { worldName }); // Not ideal, but checks existence
    if (!worldEntry.worlds[0]) return interaction.reply({ content: 'That world is not on the team list.', ephemeral: true });

    if (userId !== userTeam.owner_user_id && userId !== worldEntry.worlds[0].added_by_user_id) {
        return interaction.reply({ content: "❌ You can only remove worlds you added, unless you're the team owner.", ephemeral: true });
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team_button_confirmremove_yes_${userTeam.id}_${worldName}`).setLabel("✅ Yes, Remove").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team_button_confirmremove_no`).setLabel("❌ No, Keep").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Remove **${worldName}** from team list?`, components: [row], ephemeral: true });
}

async function handleTeamInfo(interaction, userTeam) {
    const details = await db.getTeamDetails(userTeam.id);
    if (!details) return interaction.reply({ content: "❌ Could not fetch team details.", ephemeral: true });
    const embed = new EmbedBuilder().setTitle(`🔰 Team Info: ${details.name}`).setColor(0x2ECC71)
        .addFields(
            { name: '👑 Owner', value: details.owner_display_name, inline: true },
            { name: '🗓️ Created', value: `<t:${Math.floor(new Date(details.creation_date).getTime()/1000)}:D>`, inline: true },
            { name: '📊 Worlds', value: String(details.totalWorlds), inline: true },
            { name: '👥 Members', value: details.members.map(m => `> ${m.display_name}`).join('\n').substring(0,1020) || 'Owner only', inline: false }
        );
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleTeamKick(interaction, userId, userTeam) {
    const memberToKick = interaction.options.getUser('member');
    if (memberToKick.id === userId) return interaction.reply({ content: "❌ You can't kick yourself.", ephemeral: true });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team_button_confirmkick_yes_${memberToKick.id}`).setLabel(`Kick ${memberToKick.username}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`team_button_confirmkick_no`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `Are you sure you want to remove ${memberToKick.tag} from the team?`, components: [row], ephemeral: true });
}

async function handleTeamTransfer(interaction, userId, userTeam) {
    const newOwner = interaction.options.getUser('new_owner');
    if (newOwner.id === userId) return interaction.reply({ content: "❌ You are already the owner.", ephemeral: true });
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
        .addSubcommand(s => s.setName('join').setDescription('Join a team.').addStringOption(o => o.setName('team_name').setRequired(true)).addStringOption(o => o.setName('invitation_code').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription("View team's worlds.").addIntegerOption(o => o.setName('page').setMinValue(1)))
        .addSubcommand(s => s.setName('add').setDescription('Add a world.')
            .addStringOption(o => o.setName('world_name').setRequired(true).setDescription('The name of the world to add.'))
            .addIntegerOption(o => o.setName('days_owned').setMinValue(1).setMaxValue(180).setDescription('How many days the world has been owned (approx).'))
            .addStringOption(o => o.setName('note').setMaxLength(100).setDescription('A short note for this world.')))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a world.').addStringOption(o => o.setName('world_name').setRequired(true)))
        .addSubcommand(s => s.setName('info').setDescription('View team info.'))
        .addSubcommand(s => s.setName('leave').setDescription('Leave your team.'))
        .addSubcommand(s => s.setName('invite').setDescription('Generate a new invite code (Owner only).'))
        .addSubcommand(s => s.setName('kick').setDescription('Kick a member (Owner only).').addUserOption(o => o.setName('member').setRequired(true).setDescription('The team member to kick.')))
        .addSubcommand(s => s.setName('transfer').setDescription('Transfer ownership (Owner only).').addUserOption(o => o.setName('new_owner').setRequired(true)))
        .addSubcommand(s => s.setName('disband').setDescription('Permanently disband your team (Owner only).')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const userTeam = await db.getUserTeam(userId);

        const memberRequired = ['list', 'add', 'remove', 'info', 'leave'];
        const ownerRequired = ['invite', 'kick', 'transfer', 'disband'];

        if ((memberRequired.includes(subcommand) || ownerRequired.includes(subcommand)) && !userTeam) {
            return interaction.reply({ content: "❌ You are not in a team.", ephemeral: true });
        }
        if (ownerRequired.includes(subcommand) && userTeam.owner_user_id !== userId) {
            return interaction.reply({ content: "❌ Only the team owner can use this command.", ephemeral: true });
        }

        switch (subcommand) {
            case 'create': await handleTeamCreate(interaction, userId, userTeam); break;
            case 'join': await handleTeamJoin(interaction, userId, userTeam); break;
            case 'list': await showTeamList(interaction, userTeam, interaction.options.getInteger('page') || 1); break;
            case 'add': await handleTeamAdd(interaction, userId, userTeam); break;
            case 'remove': await handleTeamRemove(interaction, userId, userTeam); break;
            case 'info': await handleTeamInfo(interaction, userTeam); break;
            case 'leave':
                if (userTeam.owner_user_id === userId) return interaction.reply({ content: "❌ Owners must transfer or disband the team.", ephemeral: true });
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('team_button_confirmleave_yes').setLabel("✅ Yes, Leave").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('team_button_confirmleave_no').setLabel("❌ No, Stay").setStyle(ButtonStyle.Secondary));
                await interaction.reply({ content: `Leave **${userTeam.name}**?`, components: [row], ephemeral: true });
                break;
            case 'invite':
                const newCode = await db.generateTeamInvitationCode(userTeam.id, userId);
                await interaction.reply({ content: `✅ New single-use invite code: \`\`\`${newCode}\`\`\``, ephemeral: true });
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
                    const [action, ...btnArgs] = args;
                    if(action === 'list') await showTeamList(interaction, userTeam, parseInt(btnArgs[1]));
                    else if (action === 'confirmleave') {
                        if(btnArgs[0] === 'no') return interaction.update({ content: 'Leave cancelled.', components: [] });
                        const result = await db.leaveTeam(interaction.user.id, userTeam.id);
                        await interaction.update({ content: result.success ? `✅ You left **${userTeam.name}**.` : `❌ Error: ${result.error}`, components: [] });
                    } else if (action === 'confirmremove') {
                        const [confirm, teamId, worldName] = btnArgs;
                        if(confirm === 'no') return interaction.update({ content: 'Removal cancelled.', components: [] });
                        const result = await db.removeWorldFromTeam(parseInt(teamId), worldName, interaction.user.id);
                        await interaction.update({ content: result.success ? `✅ World **${worldName}** removed.` : `❌ Error: ${result.error}`, components: [] });
                    } else if (action === 'confirmkick') {
                        const [confirm, memberId] = btnArgs;
                        if(confirm === 'no') return interaction.update({ content: 'Kick cancelled.', components: [] });
                        const result = await db.removeTeamMember(userTeam.id, memberId, interaction.user.id);
                        await interaction.update({ content: result.success ? `✅ Member kicked.` : `❌ Error: ${result.error}`, components: [] });
                    }
                    break;
                }
            }
        } else if (interaction.isModalSubmit()) {
            const userTeam = await db.getUserTeam(interaction.user.id);
            if (!userTeam) return interaction.reply({ content: 'You are no longer in a team.', ephemeral: true });

            const [action, modalArgs] = args;
            if(action === 'modal') {
                const [operation, targetId] = modalArgs.split('_');
                const confirmText = interaction.fields.getTextInputValue('confirm_text');
                if(operation === 'transfer') {
                    if (confirmText !== 'TRANSFER') return interaction.reply({ content: "❌ Confirmation text incorrect. Transfer cancelled.", ephemeral: true });
                    const result = await db.transferTeamOwnership(userTeam.id, interaction.user.id, targetId);
                    await interaction.reply({ content: result.success ? `✅ Ownership transferred to <@${targetId}>.` : `❌ Error: ${result.error}`, ephemeral: true });
                } else if (operation === 'disband') {
                    if(confirmText !== userTeam.name) return interaction.reply({ content: "❌ Confirmation text incorrect. Disband cancelled.", ephemeral: true });
                    const result = await db.disbandTeam(userTeam.id, interaction.user.id);
                    await interaction.reply({ content: result.success ? `✅ Team **${userTeam.name}** disbanded.` : `❌ Error: ${result.error}`, ephemeral: true });
                }
            }
        }
    },
    showTeamList,
};
