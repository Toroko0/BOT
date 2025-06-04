const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database.js');
const logger = require('../utils/logger.js');

// Helper function to format join date
function formatJoinDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Manage and view bot profiles.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your own bot profile.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription("View someone else's bot profile.")
                .addStringOption(option =>
                    option.setName('target')
                        .setDescription('User to view (mention, user ID, or their bot username)')
                        .setRequired(true)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('set')
                .setDescription('Set parts of your profile.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('username')
                        .setDescription('Set or update your unique bot username.')
                        .addStringOption(option =>
                            option.setName('value')
                                .setDescription('Your desired username (3-20 alphanumeric characters).')
                                .setRequired(true)
                        )
                )
        ),

    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            const group = interaction.options.getSubcommandGroup(false);
            const subcommand = interaction.options.getSubcommand();

            // Ensure user exists for relevant commands
            if ((group === 'set' && subcommand === 'username') ||
                (!group && subcommand === 'view') ||
                (!group && subcommand === 'show')) { // Also for 'show' to ensure target user might be added
                await db.addUser(interaction.user.id, interaction.user.username);
            }

            if (group === 'set' && subcommand === 'username') {
                await handleSetUsername(interaction);
            } else if (!group && subcommand === 'view') {
                await handleViewOwnProfile(interaction);
            } else if (!group && subcommand === 'show') {
                await handleViewOtherProfile(interaction);
            } else {
                await interaction.reply({ content: 'Unknown profile command.', ephemeral: true });
            }
        } else if (interaction.isButton()) {
            const [actionPrefix, operation, targetIdFromButton] = interaction.customId.split(':');

            // Standard buttons from own profile view
            if (actionPrefix === 'profile_btn_view_list') { // No targetIdFromButton needed here, it's for the interactor
                await interaction.reply({ content: `To view your list, use the \`/list\` command.`, ephemeral: true });
            } else if (actionPrefix === 'profile_btn_view_locks') { // No targetIdFromButton needed
                await interaction.reply({ content: `To view your locked worlds, use the \`/lock view\` command.`, ephemeral: true });
            } else if (actionPrefix === 'profile_btn_view_market_listings_own') {
                 await interaction.reply({ content: 'Use `/market mylistings` to see your active market listings.', ephemeral: true });
            }
            // Button from other's profile view
            else if (actionPrefix === 'profile_btn_view_market_listings_other') {
                const actualTargetId = operation; // operation from split is the target_user_id
                const targetUser = await db.getUser(actualTargetId);
                const targetIdentifier = targetUser?.bot_username || `<@${actualTargetId}>`;
                await interaction.reply({ content: `Use \`/market browse seller:${targetIdentifier}\` to see listings from **${targetIdentifier}**.`, ephemeral: true });
            }
            // New button for team list from own profile
            else if (actionPrefix === 'profile_btn_view_team_list') { // No targetIdFromButton needed
                 await interaction.reply({ content: "Use `/team list` to view your team's worlds.", ephemeral: true });
            }
        }
    },
};

async function handleSetUsername(interaction) {
    const userId = interaction.user.id;
    const newUsername = interaction.options.getString('value');

    if (newUsername.length < 3 || newUsername.length > 20 || !/^[a-zA-Z0-9]+$/.test(newUsername)) {
        return interaction.reply({ content: '❌ Username must be between 3-20 alphanumeric characters.', ephemeral: true });
    }
    try {
        const result = await db.setBotUsername(userId, newUsername);
        if (result.success) {
            return interaction.reply({ content: `✅ Your bot username has been set to **${newUsername}**.`, ephemeral: true });
        } else {
            if (result.error === 'taken') return interaction.reply({ content: '❌ That username is already taken. Please choose another.', ephemeral: true });
            if (result.error === 'not_found') {
                logger.error(`[ProfileCmd] User ${userId} not found by setBotUsername after addUser call.`);
                return interaction.reply({ content: '❌ An error occurred (user profile not found). Try again or contact support.', ephemeral: true });
            }
            logger.error(`[ProfileCmd] Error setting username for ${userId}: ${result.error || 'Unknown DB error'}`);
            return interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
        }
    } catch (error) {
        logger.error(`[ProfileCmd] Exception while setting username for ${userId}:`, error);
        return interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', ephemeral: true });
    }
}

async function handleViewOwnProfile(interaction) {
    const userId = interaction.user.id;
    try {
        const userProfile = await db.getUser(userId);
        const profileStats = await db.getUserProfileStats(userId);
        const userTeam = await db.getUserTeam(userId); // Fetch team info

        if (!userProfile) {
            return interaction.reply({ content: '❌ Could not retrieve your profile. Please try again.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(userProfile.bot_username ? `Profile of ${userProfile.bot_username}` : 'Your Profile')
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🤖 Bot Username', value: userProfile.bot_username || 'Not Set', inline: true },
                { name: '🗣️ Discord Tag', value: interaction.user.tag, inline: true },
                { name: '🗓️ Joined Bot', value: formatJoinDate(userProfile.bot_join_date), inline: true },
                { name: '🌍 Worlds Tracked', value: String(profileStats.worldsTracked), inline: true },
                { name: '🔒 Worlds Locked', value: String(profileStats.worldsLocked), inline: true },
                { name: '📈 Market Listings', value: String(profileStats.marketListingsActive), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'World Watcher Bot', iconURL: interaction.client.user.displayAvatarURL() });

        if (userTeam) {
            embed.addFields({ name: '🏢 Current Team', value: userTeam.name, inline: true });
        }

        const actionRow1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(`profile_btn_view_list`).setLabel('View My List').setStyle(ButtonStyle.Primary), // Removed :userId, not needed for own profile
                new ButtonBuilder().setCustomId(`profile_btn_view_locks`).setLabel('View Locked Worlds').setStyle(ButtonStyle.Secondary)
            );

        const actionRow2 = new ActionRowBuilder()
            .addComponents(
                 new ButtonBuilder().setCustomId('profile_btn_view_market_listings_own').setLabel('🛍️ My Market Listings').setStyle(ButtonStyle.Success)
            );

        if (userTeam) {
            actionRow2.addComponents(
                new ButtonBuilder().setCustomId('profile_btn_view_team_list').setLabel('🏢 View Team List').setStyle(ButtonStyle.Secondary)
            );
        }

        const components = [actionRow1];
        if(actionRow2.components.length > 0) components.push(actionRow2);


        await interaction.reply({ embeds: [embed], components: components, ephemeral: false });

    } catch (error) {
        logger.error(`[ProfileCmd] Error viewing own profile for ${userId}:`, error);
        await interaction.reply({ content: '❌ An error occurred while fetching your profile.', ephemeral: true });
    }
}

async function handleViewOtherProfile(interaction) {
    const targetArg = interaction.options.getString('target');
    let targetDbUser = null;
    let targetDiscordUser = null;

    const mentionMatch = targetArg.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        const targetId = mentionMatch[1];
        targetDbUser = await db.getUser(targetId);
        try {
            targetDiscordUser = await interaction.client.users.fetch(targetId);
            if (!targetDbUser && targetDiscordUser) { // User not in DB but exists in Discord
                 await db.addUser(targetId, targetDiscordUser.username);
                 targetDbUser = await db.getUser(targetId);
            } else if (targetDbUser && targetDiscordUser && targetDiscordUser.username !== targetDbUser.username) {
                 await db.addUser(targetId, targetDiscordUser.username);
                 targetDbUser.username = targetDiscordUser.username;
            }
        } catch (e) { logger.warn(`[ProfileCmd] Could not fetch Discord user for ID ${targetId}.`); }
    } else {
        targetDbUser = await db.getUserByBotUsername(targetArg);
        if (!targetDbUser) {
            if (/^\d{17,19}$/.test(targetArg)) {
                targetDbUser = await db.getUser(targetArg);
                 try {
                    targetDiscordUser = await interaction.client.users.fetch(targetArg);
                     if (!targetDbUser && targetDiscordUser) {
                         await db.addUser(targetArg, targetDiscordUser.username);
                         targetDbUser = await db.getUser(targetArg);
                     } else if (targetDbUser && targetDiscordUser && targetDiscordUser.username !== targetDbUser.username) {
                         await db.addUser(targetArg, targetDiscordUser.username);
                         targetDbUser.username = targetDiscordUser.username;
                     }
                } catch (e) { logger.warn(`[ProfileCmd] Could not fetch Discord user for ID ${targetArg} (direct ID).`); }
            }
        } else {
             try { targetDiscordUser = await interaction.client.users.fetch(targetDbUser.id); }
             catch (e) { logger.warn(`[ProfileCmd] Could not fetch Discord user for ID ${targetDbUser.id} (from bot username lookup).`);}
        }
    }

    if (!targetDbUser) {
        return interaction.reply({ content: `❌ User "${targetArg}" not found. They may need to use the bot first, or check the identifier.`, ephemeral: true });
    }

    // Ensure target user exists if identified by ID but not fetched from Discord (e.g. not in cache/guild)
    // The db.getUser would have returned null if not in DB, so addUser would have been called if targetDiscordUser was found.
    // If targetDbUser exists, it means they are in the DB.
    const finalUserProfile = targetDbUser; // Use the user record we have (potentially updated with fresh Discord tag)
    const profileStats = await db.getUserProfileStats(finalUserProfile.id);
    const userTeam = await db.getUserTeam(finalUserProfile.id); // Fetch team info for the target user

    const displayDiscordTag = targetDiscordUser ? targetDiscordUser.tag : finalUserProfile.username;
    const displayAvatar = targetDiscordUser ? targetDiscordUser.displayAvatarURL({ dynamic: true }) : null;

    const embed = new EmbedBuilder()
        .setColor(0x1E90FF)
        .setTitle(finalUserProfile.bot_username ? `Profile of ${finalUserProfile.bot_username}` : `Profile of ${displayDiscordTag}`)
        .setThumbnail(displayAvatar)
        .addFields(
            { name: '🤖 Bot Username', value: finalUserProfile.bot_username || 'Not Set', inline: true },
            { name: '🗣️ Discord Tag', value: displayDiscordTag, inline: true },
            { name: '🗓️ Joined Bot', value: formatJoinDate(finalUserProfile.bot_join_date), inline: true },
            { name: '🌍 Worlds Tracked', value: String(profileStats.worldsTracked), inline: true },
            { name: '🔒 Worlds Locked', value: String(profileStats.worldsLocked), inline: true },
            { name: '📈 Market Listings', value: String(profileStats.marketListingsActive), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'World Watcher Bot', iconURL: interaction.client.user.displayAvatarURL() });

    if (userTeam) {
        embed.addFields({ name: '🏢 Current Team', value: userTeam.name, inline: true });
    }

    const components = [];
    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_btn_view_market_listings_other:${finalUserProfile.id}`)
                .setLabel("🛍️ View User's Listings")
                .setStyle(ButtonStyle.Success)
        );

    // If the viewed user is in a team, add a button to view their team list (leads to /team list which is team-member only)
    // This button will just guide the interactor to use /team list if they are in THAT team.
    // Or, better, guide them to /team info <team_name_or_id> if such a command existed for public team view.
    // For now, let's keep it simple: only "View User's Listings" for other profiles.
    // If spec changes to allow viewing other teams' lists (e.g. if team has public profile), this could be added.

    components.push(actionRow);

    await interaction.reply({ embeds: [embed], components: components, ephemeral: false });
}
