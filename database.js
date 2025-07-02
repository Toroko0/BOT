const path = require('path');
const fs = require('fs');
const knexConfig = require('./knexfile.js');
const Knex = require('knex');
const logger = require('./utils/logger.js');

// --- Initialize Knex ---
let knexInstance;
try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
        logger.info("[DB] Created data directory.");
    }
    knexInstance = Knex(knexConfig.development);

    // Add event listener for query logging
    knexInstance.on('query', (queryData) => {
        logger.debug('[DB Query]', { sql: queryData.sql, bindings: queryData.bindings });
    });

    // Test connection immediately after initialization
    knexInstance.raw('SELECT 1')
      .then(() => { logger.info("[DB] Knex connected (Early Check)."); })
      .catch((err) => { logger.error("[DB] FATAL: Knex connection failed (Early Check).", err); process.exit(1); });

} catch (error) {
     logger.error("[DB] FATAL: Error initializing Knex instance.", error);
     process.exit(1);
}

// --- Define ALL Functions FIRST ---

function initializeDatabase() { return Promise.resolve(); }

async function addUser(userId, username) {
  try {
    const existingUser = await knexInstance('users').where({ id: userId }).first();
    if (existingUser) {
      if (existingUser.username !== username) {
        await knexInstance('users').where({ id: userId }).update({ username: username });
        logger.debug(`[DB] Updated username for user ${userId} to ${username}`);
      }
      // If user exists, we don't modify their preferences here.
      // Specific functions will handle preference updates.
      return true;
    } else {
      await knexInstance('users').insert({
        id: userId,
        username: username,
        timezone_offset: 0.0,      // Default GMT+0
        view_mode: 'pc',           // Default 'pc'
        reminder_enabled: false,   // Default false
        reminder_time_utc: null,   // Default null
        bio: null,                 // Initialize bio as null
        // Initialize bot_join_date when a new user is added
        bot_join_date: knexInstance.fn.now()
      });
      logger.info(`[DB] Added new user ${userId} (${username}) with default preferences, bio, and bot_join_date`);
      return true;
    }
  } catch (error) { logger.error(`[DB] Error adding/updating user ${userId}:`, error); return false; }
}

// --- Admin Functions ---
/**
 * Fetches all worlds from all users, paginated. For Admin use.
 * @param {object} options - Pagination options { page, pageSize }.
 * @returns {Promise<{worlds: Array, total: number}>}
 */
async function getAllWorldsPaged(options = {}) {
    const { page = 1, pageSize = 10 } = options;
    logger.debug(`[DB] Fetching all worlds for admin, page ${page}, pageSize ${pageSize}`);
    try {
        const query = knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .select(
                'w.id',
                'w.name',
                'u.username as owner_username',
                'w.user_id as owner_id',
                'w.custom_id',
                'w.expiry_date',
                'w.lock_type'
            );

        const totalResult = await knexInstance('worlds').count({ total: '*' }).first();
        const total = totalResult ? Number(totalResult.total) : 0;

        query.orderBy('w.added_date', 'desc').limit(pageSize).offset((page - 1) * pageSize);
        const worlds = await query;

        return { worlds, total };
    } catch (error) {
        logger.error('[DB] Error fetching all paged worlds for admin:', error);
        return { worlds: [], total: 0 };
    }
}


// --- Bot Profile Functions ---

async function setBotUsername(userId, newBotUsername) {
  const newBotUsernameLower = newBotUsername.toLowerCase();
  try {
    // Check if the lowercase username is already taken by another user
    const existingUserWithUsername = await knexInstance('users')
      .whereRaw('LOWER(bot_username) = ?', [newBotUsernameLower])
      .whereNot('id', userId)
      .first();

    if (existingUserWithUsername) {
      logger.warn(`[DB] Attempt to set bot_username: ${newBotUsername} for user ${userId} failed. Username taken by user ${existingUserWithUsername.id}`);
      return { success: false, error: 'taken' };
    }

    const currentUser = await knexInstance('users').where({ id: userId }).first();

    if (!currentUser) {
        logger.warn(`[DB] Attempt to set bot_username for non-existent user ${userId}`);
        return { success: false, error: 'not_found' };
    }

    const updatePayload = { bot_username: newBotUsername };
    const veryOldDate = '2024-01-01T00:00:00.000Z'; // Arbitrary date to consider "very old" or uninitialized

    // Update bot_join_date if it's the first time setting username OR if current date is null/very old
    if (!currentUser.bot_username || !currentUser.bot_join_date || new Date(currentUser.bot_join_date) < new Date(veryOldDate)) {
        updatePayload.bot_join_date = knexInstance.fn.now();
        logger.info(`[DB] Updating bot_join_date for user ${userId} along with bot_username.`);
    }

    await knexInstance('users').where({ id: userId }).update(updatePayload);
    logger.info(`[DB] Successfully set bot_username to ${newBotUsername} for user ${userId}`);
    return { success: true };

  } catch (error) {
    logger.error(`[DB] Error setting bot_username for user ${userId} to ${newBotUsername}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function getUser(userId) {
  try {
    const user = await knexInstance('users')
      .where({ id: userId })
      .select('id', 'username', 'bot_username', 'bot_join_date')
      .first();
    return user || null;
  } catch (error) {
    logger.error(`[DB] Error getting user ${userId}:`, error);
    return null;
  }
}

async function getBotUsername(userId) {
  try {
    const user = await knexInstance('users').where({ id: userId }).select('bot_username').first();
    if (user) {
      return user.bot_username;
    }
    return null;
  } catch (error) {
    logger.error(`[DB] Error getting bot_username for user ${userId}:`, error);
    return null;
  }
}

async function getUserByBotUsername(botUsername) {
  try {
    // Case-insensitive search for bot_username
    const user = await knexInstance('users')
      .whereRaw('LOWER(bot_username) = ?', [botUsername.toLowerCase()])
      .select('id', 'username', 'bot_username', 'bot_join_date')
      .first();
    return user || null;
  } catch (error) {
    logger.error(`[DB] Error getting user by bot_username ${botUsername}:`, error);
    return null;
  }
}

async function getAllFilteredWorlds(userId, filters = {}) {
    logger.debug(`[DB] getAllFilteredWorlds called - User: ${userId}, Filters: ${JSON.stringify(filters)}`);
    try {
        let query = knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .select('w.*', 'u.username as added_by_tag');

        if (filters.guildId) {
            query.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
        } else if (userId) {
            query.where('w.user_id', userId)
                 .andWhere(function() {
                     this.where('w.is_public', false).orWhereNull('w.is_public');
                 });
        } else {
            logger.warn('[DB] getAllFilteredWorlds called without userId (for private) or guildId (for public). Returning empty array.');
            return [];
        }

        if (filters.prefix) {
            const prefixLower = filters.prefix.toLowerCase();
            query.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
        }

        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query.andWhere('w.lock_type', filters.lockType);
        }

        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
            }
        }

        if (filters.daysOwned !== undefined && filters.daysOwned !== null) {
            const daysOwnedInput = parseInt(filters.daysOwned);
            if (!isNaN(daysOwnedInput)) {
                if (daysOwnedInput === 180) {
                    const todayEnd = new Date();
                    todayEnd.setUTCHours(23, 59, 59, 999);
                    query.andWhere('w.expiry_date', '<=', todayEnd.toISOString());
                } else if (daysOwnedInput >= 0 && daysOwnedInput < 180) {
                    const targetDaysLeft = 180 - daysOwnedInput;
                    const targetDate = new Date();
                    targetDate.setUTCHours(0,0,0,0);
                    targetDate.setUTCDate(targetDate.getUTCDate() + targetDaysLeft);
                    const targetStartDateISO = targetDate.toISOString();
                    const targetEndDate = new Date(targetDate);
                    targetEndDate.setUTCDate(targetDate.getUTCDate() + 1);
                    const targetEndDateISO = targetEndDate.toISOString();
                    query.andWhere('w.expiry_date', '>=', targetStartDateISO)
                         .andWhere('w.expiry_date', '<', targetEndDateISO);
                }
            }
        }

        if (filters.nameLengthMin !== undefined && filters.nameLengthMin !== null) {
            const minLength = parseInt(filters.nameLengthMin);
            if (!isNaN(minLength) && minLength > 0) {
                query.andWhereRaw('LENGTH(w.name) >= ?', [minLength]);
            }
        }
        if (filters.nameLengthMax !== undefined && filters.nameLengthMax !== null) {
            const maxLength = parseInt(filters.nameLengthMax);
            if (!isNaN(maxLength) && maxLength > 0) {
                query.andWhereRaw('LENGTH(w.name) <= ?', [maxLength]);
            }
        }

        query.orderBy('w.expiry_date', 'asc');

        const worlds = await query;
        const formattedWorlds = worlds.map(w => ({ ...w, is_public: !!w.is_public }));

        logger.debug(`[DB] getAllFilteredWorlds returning ${formattedWorlds.length} worlds`);
        return formattedWorlds;

    } catch (error) {
        logger.error(`[DB] Error in getAllFilteredWorlds (User: ${userId}, Filters: ${JSON.stringify(filters)}):`, error);
        return [];
    }
}

async function addWorld(userId, worldName, daysOwned, lockType = 'mainlock', customId = null, username = null, guildId = null) {
    const worldNameUpper = worldName.toUpperCase();
    const normalizedLockType = String(lockType).toLowerCase() === 'o' || String(lockType).toLowerCase() === 'outlock' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null;
    const publicStatus = false;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    if (worldNameUpper.includes(' ')) { return { success: false, message: 'World names cannot contain spaces.' }; }
    if (normalizedCustomId === '') { normalizedCustomId = null; }
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const expiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = expiryDate.toISOString();

    // Pre-emptive check for existing world with exact same parameters
    const existingWorld = await knexInstance('worlds')
        .where({
            user_id: userId,
            name: worldNameUpper,
            days_owned: daysOwnedNum,
            lock_type: normalizedLockType
        })
        .first();

    if (existingWorld) {
        return { success: false, message: `You are already tracking a world named **${worldNameUpper}** with the exact same days owned and lock type.` };
    }

    try {
        await knexInstance('worlds').insert({ name: worldNameUpper, days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, is_public: publicStatus, user_id: userId, custom_id: normalizedCustomId, added_by: username, guild_id: guildId });
        logger.info(`[DB] Added world ${worldNameUpper} for user ${userId}`);
        return { success: true, message: `**${worldNameUpper}** added.` };
    } catch (error) {
        logger.error(`[DB] Error adding world ${worldNameUpper} for user ${userId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) {
            if (error.message.includes('uq_worlds_user_name_days_lock')) { // New constraint name
                return { success: false, message: `You are already tracking a world named **${worldNameUpper}** with the exact same days owned and lock type (database constraint).` };
            } else if (error.message.includes('worlds.uq_worlds_customid_user') && normalizedCustomId) { // normalizedCustomId is defined earlier in the function
                return { success: false, message: `Custom ID **${normalizedCustomId}** already in use by you.` };
            }
        }
        return { success: false, message: 'Failed to add world due to a database error.' };
    }
}

async function updateWorld(worldId, userId, updatedData) {
    const { daysOwned, lockType, customId } = updatedData;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    const normalizedLockType = String(lockType).toLowerCase() === 'o' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null; if (normalizedCustomId === '') normalizedCustomId = null;
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const newExpiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = newExpiryDate.toISOString();
    try {
        const updateCount = await knexInstance('worlds').where({ id: worldId, user_id: userId }).update({ days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, custom_id: normalizedCustomId });
        if (updateCount === 0) throw new Error('World not found or no permission to update.');
        logger.info(`[DB] Updated core details for world ${worldId} by user ${userId}`); return true;
    } catch (error) {
        logger.error(`[DB] Error updating world ${worldId} for user ${userId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) { if (error.message.includes('worlds.uq_worlds_customid_user') && normalizedCustomId) { throw new Error(`Custom ID **${normalizedCustomId}** already used by you.`); } }
        throw error;
    }
}

async function updateWorldVisibility(worldId, userId, isPublic, guildId = null) {
    try {
        const publicStatus = isPublic ? true : false; const effectiveGuildId = isPublic ? guildId : null;
        const worldExists = await knexInstance('worlds').where({ id: worldId, user_id: userId }).first();
        if (!worldExists) { logger.warn(`[DB] updateWorldVisibility: World ${worldId} not found or not owned by user ${userId}.`); return false; }
        const updateCount = await knexInstance('worlds').where({ id: worldId, user_id: userId }).update({ is_public: publicStatus, guild_id: effectiveGuildId });
        if (updateCount > 0) { logger.info(`[DB] Updated visibility for world ${worldId} to ${publicStatus} (Guild: ${effectiveGuildId}) by user ${userId}`); return true; }
        else { logger.error(`[DB] updateWorldVisibility: Update failed unexpectedly for world ${worldId}, user ${userId}.`); return false; }
    } catch (error) { logger.error(`[DB] Error updating visibility for world ${worldId} by user ${userId}:`, error); return false; }
}

async function removeWorld(worldId, userId) {
    try {
        const deletedCount = await knexInstance('worlds').where({ id: worldId, user_id: userId }).del();
        if (deletedCount > 0) { logger.info(`[DB] Removed world ${worldId} by user ${userId}`); return true; }
        else { logger.warn(`[DB] removeWorld: World ${worldId} not found or not owned by user ${userId}.`); return false; }
    } catch (error) { logger.error(`[DB] Error removing world ${worldId} by user ${userId}:`, error); return false; }
}

async function getWorlds(userId, page = 1, pageSize = 10) {
  const offset = (page - 1) * pageSize;
  logger.debug(`[DB] Attempting to get worlds for user ${userId}, page ${page}`);
  try {
    const worlds = await knexInstance('worlds as w')
      .leftJoin('users as u', 'w.user_id', 'u.id')
      .where('w.user_id', userId)
      .orderBy('w.expiry_date', 'asc')
      .limit(pageSize)
      .offset(offset)
      .select('w.*', 'u.username as added_by_tag');

    logger.debug(`[DB] getWorlds raw rows fetched for user ${userId}, page ${page}:`, worlds.map(w => ({ id: w.id, name: w.name })));

    const totalResult = await knexInstance('worlds')
        .where({ user_id: userId })
        .count({ total: '*' }); 

    const totalCount = (totalResult && totalResult[0] && totalResult[0].total !== undefined)
                       ? Number(totalResult[0].total)
                       : 0;

    logger.debug(`[DB] getWorlds count query for user ${userId} returned: ${totalCount}`);

    const formattedWorlds = worlds.map(row => ({ ...row, is_public: !!row.is_public }));

    return { worlds: formattedWorlds, total: totalCount };

  } catch (error) {
    logger.error(`[DB] Error getting worlds for user ${userId}:`, error);
    return { worlds: [], total: 0 };
  }
}

async function getWorldById(worldId) {
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where('w.id', worldId).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by ID ${worldId}:`, error); return null; }
}

async function getWorldByName(worldName, userId) {
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where('w.user_id', userId).andWhereRaw('lower(w.name) = lower(?)', [worldName]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by name "${worldName}" for user ${userId}:`, error); return null; }
}

async function getWorldByCustomId(customId, userId) {
    if (!customId) return null;
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where('w.user_id', userId).andWhereRaw('lower(w.custom_id) = lower(?)', [customId]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by custom ID "${customId}" for user ${userId}:`, error); return null; }
}

async function getPublicWorldsByGuild(guildId, page = 1, pageSize = 10) {
    if (!guildId) return { worlds: [], total: 0 }; const offset = (page - 1) * pageSize;
    try { 
        const worlds = await knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .where('w.is_public', true)
            .andWhere('w.guild_id', guildId)
            .orderBy('w.expiry_date', 'asc')
            .limit(pageSize)
            .offset(offset)
            .select('w.*', 'u.username as added_by_tag'); 
        
        const totalResult = await knexInstance('worlds').where({ is_public: true, guild_id: guildId }).count({ total: '*' }).first(); 
        const totalCount = totalResult ? Number(totalResult.total) : 0; 
        const formattedWorlds = worlds.map(row => ({ ...row, is_public: !!row.is_public })); 
        return { worlds: formattedWorlds, total: totalCount }; 
    }
    catch (error) { logger.error(`[DB] Error getting public worlds for guild ${guildId}:`, error); return { worlds: [], total: 0 }; }
}

async function getPublicWorldByName(worldName, guildId) {
    if (!guildId) return null;
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where({ 'w.is_public': true, 'w.guild_id': guildId }).andWhereRaw('lower(w.name) = lower(?)', [worldName]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting public world by name "${worldName}" in guild ${guildId}:`, error); return null; }
}

async function getPublicWorldByCustomId(customId, guildId) {
    if (!customId || !guildId) return null;
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where({ 'w.is_public': true, 'w.guild_id': guildId }).andWhereRaw('lower(w.custom_id) = lower(?)', [customId]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting public world by custom ID "${customId}" in guild ${guildId}:`, error); return null; }
}

async function findWorldByIdentifier(userId, identifier, guildId) {
    if (!identifier) return null; const identifierUpper = identifier.toUpperCase();
    try { let world = await getWorldByName(identifierUpper, userId); if (world) return world; world = await getWorldByCustomId(identifierUpper, userId); if (world) return world; if (guildId) { world = await getPublicWorldByName(identifierUpper, guildId); if (world) return world; world = await getPublicWorldByCustomId(identifierUpper, guildId); if (world) return world; } return null; }
    catch (error) { logger.error(`[DB] Error in findWorldByIdentifier for "${identifier}" (User: ${userId}, Guild: ${guildId}):`, error); return null; }
}

async function getFilteredWorlds(userId, filters = {}, page = 1, pageSize = 10) {
    logger.debug(`[DB] getFilteredWorlds called - User: ${userId}, Filters: ${JSON.stringify(filters)}, Page: ${page}, PageSize: ${pageSize}`);
    try {
        let query = knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .select('w.*', 'u.username as added_by_tag');

        let countQueryBase = knexInstance('worlds as w');

        if (filters.guildId) {
            query.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
            countQueryBase.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
        } else if (userId) {
            query.where('w.user_id', userId)
                 .andWhere(function() {
                     this.where('w.is_public', false).orWhereNull('w.is_public');
                 });
            countQueryBase.where('w.user_id', userId)
                          .andWhere(function() {
                              this.where('w.is_public', false).orWhereNull('w.is_public');
                          });
        } else {
            logger.warn('[DB] getFilteredWorlds called without userId (for private) or guildId (for public). Returning empty.');
            return { worlds: [], total: 0 };
        }

        if (filters.prefix) {
            const prefixLower = filters.prefix.toLowerCase();
            query.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
            countQueryBase.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
        }

        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query.andWhere('w.lock_type', filters.lockType);
            countQueryBase.andWhere('w.lock_type', filters.lockType);
        }

        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
                countQueryBase.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
            }
        }

        if (filters.daysOwned !== undefined && filters.daysOwned !== null) {
            const daysOwnedInput = parseInt(filters.daysOwned);
            if (!isNaN(daysOwnedInput)) {
                if (daysOwnedInput === 180) {
                    const todayEnd = new Date();
                    todayEnd.setUTCHours(23, 59, 59, 999);
                    query.andWhere('w.expiry_date', '<=', todayEnd.toISOString());
                    countQueryBase.andWhere('w.expiry_date', '<=', todayEnd.toISOString());
                } else if (daysOwnedInput >= 0 && daysOwnedInput < 180) {
                    const targetDaysLeft = 180 - daysOwnedInput;
                    const targetDate = new Date();
                    targetDate.setUTCHours(0,0,0,0);
                    targetDate.setUTCDate(targetDate.getUTCDate() + targetDaysLeft);
                    const targetStartDateISO = targetDate.toISOString();
                    const targetEndDate = new Date(targetDate);
                    targetEndDate.setUTCDate(targetDate.getUTCDate() + 1);
                    const targetEndDateISO = targetEndDate.toISOString();
                    query.andWhere('w.expiry_date', '>=', targetStartDateISO)
                         .andWhere('w.expiry_date', '<', targetEndDateISO);
                    countQueryBase.andWhere('w.expiry_date', '>=', targetStartDateISO)
                                  .andWhere('w.expiry_date', '<', targetEndDateISO);
                }
            }
        }

        if (filters.nameLengthMin !== undefined && filters.nameLengthMin !== null) {
            const minLength = parseInt(filters.nameLengthMin);
            if (!isNaN(minLength) && minLength > 0) {
                query.andWhereRaw('LENGTH(w.name) >= ?', [minLength]);
                countQueryBase.andWhereRaw('LENGTH(w.name) >= ?', [minLength]);
            }
        }
        if (filters.nameLengthMax !== undefined && filters.nameLengthMax !== null) {
            const maxLength = parseInt(filters.nameLengthMax);
            if (!isNaN(maxLength) && maxLength > 0) {
                query.andWhereRaw('LENGTH(w.name) <= ?', [maxLength]);
                countQueryBase.andWhereRaw('LENGTH(w.name) <= ?', [maxLength]);
            }
        }

        const totalResult = await countQueryBase.count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;

        query.orderBy('w.expiry_date', 'asc')
             .limit(pageSize)
             .offset((page - 1) * pageSize);

        const worlds = await query;
        const formattedWorlds = worlds.map(w => ({ ...w, is_public: !!w.is_public }));

        logger.debug(`[DB] getFilteredWorlds returning ${formattedWorlds.length} worlds, total: ${totalCount}`);
        return { worlds: formattedWorlds, total: totalCount };

    } catch (error) {
        logger.error(`[DB] Error in getFilteredWorlds (User: ${userId}, Filters: ${JSON.stringify(filters)}, Page: ${page}):`, error);
        return { worlds: [], total: 0 };
    }
}

async function updateAllWorldDays() { try { logger.info("[DB] Daily Task: Skipping days_owned increment (relying on expiry_date)."); return 0; } catch (error) { logger.error('[DB] Error in (commented out) updateAllWorldDays:', error); return 0; } }

async function removeExpiredWorlds() { try { const now = new Date(); now.setUTCHours(0, 0, 0, 0); const nowISO = now.toISOString(); const deletedCount = await knexInstance('worlds').where('expiry_date', '<', nowISO).del(); if (deletedCount > 0) logger.info(`[DB] Daily Task: Removed ${deletedCount} expired worlds (Expired before ${nowISO}).`); return deletedCount; } catch (error) { logger.error('[DB] Error removing expired worlds:', error); return 0; } }

async function getWorldCount(userId) { try { const result = await knexInstance('worlds').where({ user_id: userId }).count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting world count for user ${userId}:`, error); return 0; } }

async function getWorldLockStats(userId) { try { const stats = await knexInstance('worlds').select('lock_type').count({ count: '*' }).where({ user_id: userId }).groupBy('lock_type'); const result = { mainlock: 0, outlock: 0 }; stats.forEach(row => { if (row.lock_type === 'mainlock') result.mainlock = Number(row.count); else if (row.lock_type === 'outlock') result.outlock = Number(row.count); }); return result; } catch (error) { logger.error(`[DB] Error getting lock stats for user ${userId}:`, error); return { mainlock: 0, outlock: 0 }; } }

async function getExpiringWorldCount(userId, days = 7) { try { const targetDate = new Date(); targetDate.setUTCDate(targetDate.getUTCDate() + parseInt(days)); targetDate.setUTCHours(23, 59, 59, 999); const targetDateISO = targetDate.toISOString(); const nowISO = new Date().toISOString(); const result = await knexInstance('worlds').where({ user_id: userId }).andWhere('expiry_date', '<=', targetDateISO).andWhere('expiry_date', '>=', nowISO).count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting expiring world count (in ${days} days) for user ${userId}:`, error); return 0; } }

async function getMostRecentWorld(userId) { try { const world = await knexInstance('worlds').where({ user_id: userId }).orderBy('added_date', 'desc').select('name', 'added_date').first(); return world || null; } catch (error) { logger.error(`[DB] Error getting most recent world for user ${userId}:`, error); return null; } }

async function getExpiringWorldsForUser(userId, daysUntilExpiry = 7) {
    logger.debug(`[DB] Fetching worlds expiring in ${daysUntilExpiry} days for user ${userId}`);
    try {
        const now = new Date();
        const targetDate = new Date();
        targetDate.setUTCDate(now.getUTCDate() + daysUntilExpiry);
        targetDate.setUTCHours(23, 59, 59, 999);

        const nowISO = now.toISOString();
        const targetDateISO = targetDate.toISOString();

        const worlds = await knexInstance('worlds')
            .where('user_id', userId)
            .andWhere('expiry_date', '>=', nowISO)
            .andWhere('expiry_date', '<=', targetDateISO)
            .orderBy('expiry_date', 'asc')
            .select('name', 'expiry_date', 'custom_id');

        logger.debug(`[DB] Found ${worlds.length} worlds expiring for user ${userId} by ${targetDateISO}`);
        return worlds;
    } catch (error) {
        logger.error(`[DB] Error getting expiring worlds for user ${userId}:`, error);
        return [];
    }
}

// --- User Preference Functions ---
async function getUserPreferences(userId) {
    try {
        const user = await knexInstance('users').where({ id: userId }).first();
        if (user) {
            return {
                timezone_offset: user.timezone_offset,
                view_mode: user.view_mode,
                reminder_enabled: !!user.reminder_enabled,
                reminder_time_utc: user.reminder_time_utc
            };
        }
        logger.warn(`[DB] User ${userId} not found or preferences missing, returning defaults.`);
        return {
            timezone_offset: 0.0,
            view_mode: 'pc',
            reminder_enabled: false,
            reminder_time_utc: null
        };
    } catch (error) {
        logger.error(`[DB] Error getting preferences for user ${userId}:`, error);
        return {
            timezone_offset: 0.0,
            view_mode: 'pc',
            reminder_enabled: false,
            reminder_time_utc: null
        };
    }
}

async function updateUserTimezone(userId, timezoneOffset) {
    try {
        const offset = parseFloat(timezoneOffset);
        if (isNaN(offset) || offset < -12.0 || offset > 14.0) {
            logger.warn(`[DB] Invalid timezone offset value for user ${userId}: ${timezoneOffset}`);
            return false;
        }
        await knexInstance('users').where({ id: userId }).update({ timezone_offset: offset });
        logger.info(`[DB] Updated timezone for user ${userId} to ${offset}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating timezone for user ${userId}:`, error);
        return false;
    }
}

async function updateUserViewMode(userId, viewMode) {
    try {
        if (viewMode !== 'pc' && viewMode !== 'phone') {
            logger.warn(`[DB] Invalid view mode value for user ${userId}: ${viewMode}`);
            return false;
        }
        await knexInstance('users').where({ id: userId }).update({ view_mode: viewMode });
        logger.info(`[DB] Updated view mode for user ${userId} to ${viewMode}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating view mode for user ${userId}:`, error);
        return false;
    }
}

async function updateUserReminderSettings(userId, reminderEnabled, reminderTimeUtc) {
    try {
        if (reminderEnabled && reminderTimeUtc) {
            if (!/^\d{2}:\d{2}$/.test(reminderTimeUtc)) {
                 logger.warn(`[DB] Invalid reminder_time_utc format for user ${userId}: ${reminderTimeUtc}`);
                 return false;
            }
        }
        const effectiveReminderTimeUtc = reminderEnabled ? reminderTimeUtc : null;

        await knexInstance('users').where({ id: userId }).update({
            reminder_enabled: !!reminderEnabled,
            reminder_time_utc: effectiveReminderTimeUtc 
        });
        logger.info(`[DB] Updated reminder settings for user ${userId} to enabled: ${!!reminderEnabled}, time: ${effectiveReminderTimeUtc}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating reminder settings for user ${userId}:`, error);
        return false;
    }
}

async function getAllWorldsByDaysLeft(userId, daysLeft, guildId = null) {
    logger.debug(`[DB] getAllWorldsByDaysLeft called - User: ${userId}, DaysLeft: ${daysLeft}, Guild: ${guildId}`);
    
    if (typeof daysLeft !== 'number' || daysLeft < 0) {
        logger.warn(`[DB] getAllWorldsByDaysLeft: Invalid daysLeft parameter: ${daysLeft}`);
        return [];
    }

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0); 

    const startDate = new Date(todayUTC);
    startDate.setUTCDate(todayUTC.getUTCDate() + daysLeft); 
    const startDateISO = startDate.toISOString();

    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 1); 
    const endDateISO = endDate.toISOString();

    logger.debug(`[DB] getAllWorldsByDaysLeft: Target expiry date range: >= ${startDateISO} AND < ${endDateISO}`);

    try {
        let queryBase = knexInstance('worlds as w')
            .where('w.expiry_date', '>=', startDateISO)
            .andWhere('w.expiry_date', '<', endDateISO);

        if (guildId) { 
            queryBase = queryBase.andWhere('w.is_public', true).andWhere('w.guild_id', guildId);
        } else if (userId) { 
            queryBase = queryBase.andWhere('w.user_id', userId);
        } else {
            logger.warn('[DB] getAllWorldsByDaysLeft: Called without userId (for private) or guildId (for public context). Returning empty.');
            return [];
        }

        const worlds = await queryBase
            .leftJoin('users as u', 'w.user_id', 'u.id') 
            .orderBy('w.name', 'asc')
            .select('w.*', 'u.username as added_by_tag');
        
        logger.debug(`[DB] getAllWorldsByDaysLeft: Worlds query returned ${worlds.length} rows.`);

        const formattedWorlds = worlds.map(row => ({ ...row, is_public: !!row.is_public }));
        return formattedWorlds;

    } catch (error) {
        logger.error(`[DB] Error in getAllWorldsByDaysLeft (User: ${userId}, Guild: ${guildId}, DaysLeft: ${daysLeft}):`, error);
        return [];
    }
}

async function getWorldsByDaysLeft(userId, daysLeft, guildId = null, page = 1, pageSize = 10) {
    logger.debug(`[DB] getWorldsByDaysLeft called - User: ${userId}, DaysLeft: ${daysLeft}, Guild: ${guildId}, Page: ${page}, PageSize: ${pageSize}`);
    
    if (typeof daysLeft !== 'number' || daysLeft < 0) {
        logger.warn(`[DB] getWorldsByDaysLeft: Invalid daysLeft parameter: ${daysLeft}`);
        return { worlds: [], total: 0 };
    }

    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0); 

    const startDate = new Date(todayUTC);
    startDate.setUTCDate(todayUTC.getUTCDate() + daysLeft); 
    const startDateISO = startDate.toISOString();

    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 1); 
    const endDateISO = endDate.toISOString();

    logger.debug(`[DB] getWorldsByDaysLeft: Target expiry date range: >= ${startDateISO} AND < ${endDateISO}`);

    const offset = (page - 1) * pageSize;

    try {
        let queryBase = knexInstance('worlds as w')
            .where('w.expiry_date', '>=', startDateISO)
            .andWhere('w.expiry_date', '<', endDateISO);

        let countBase = knexInstance('worlds')
            .where('expiry_date', '>=', startDateISO)
            .andWhere('expiry_date', '<', endDateISO);

        if (guildId) { 
            queryBase = queryBase.andWhere('w.is_public', true).andWhere('w.guild_id', guildId);
            countBase = countBase.andWhere('is_public', true).andWhere('guild_id', guildId);
        } else if (userId) { 
            queryBase = queryBase.andWhere('w.user_id', userId);
            countBase = countBase.andWhere('user_id', userId);
        } else {
            logger.warn('[DB] getWorldsByDaysLeft: Called without userId (for private) or guildId (for public context). Returning empty.');
            return { worlds: [], total: 0 };
        }

        const worlds = await queryBase
            .leftJoin('users as u', 'w.user_id', 'u.id') 
            .orderBy('w.name', 'asc') 
            .limit(pageSize)
            .offset(offset)
            .select('w.*', 'u.username as added_by_tag');
        
        logger.debug(`[DB] getWorldsByDaysLeft: Worlds query returned ${worlds.length} rows.`);

        const totalResult = await countBase.count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;
        
        logger.debug(`[DB] getWorldsByDaysLeft: Total count for criteria: ${totalCount}`);

        const formattedWorlds = worlds.map(row => ({ ...row, is_public: !!row.is_public }));
        return { worlds: formattedWorlds, total: totalCount };

    } catch (error) {
        logger.error(`[DB] Error in getWorldsByDaysLeft (User: ${userId}, Guild: ${guildId}, DaysLeft: ${daysLeft}):`, error);
        return { worlds: [], total: 0 };
    }
}

// --- Module Exports ---
module.exports = {
  knex: knexInstance,
  initializeDatabase,
  addUser,
  addWorld,
  updateWorld,
  updateWorldVisibility,
  removeWorld,
  getWorlds,
  getWorldById,
  getWorldByName,
  getWorldByCustomId,
  getPublicWorldsByGuild,
  getPublicWorldByName,
  getPublicWorldByCustomId,
  findWorldByIdentifier,
  getFilteredWorlds,
  getAllFilteredWorlds,
  searchWorlds: getFilteredWorlds,
  updateAllWorldDays,
  removeExpiredWorlds,
  getWorldCount,
  getWorldLockStats,
  getExpiringWorldCount,
  getMostRecentWorld,
  getExpiringWorldsForUser,
  // User Preferences
  getUserPreferences,
  updateUserTimezone,
  updateUserViewMode,
  updateUserReminderSettings,
  getWorldsByDaysLeft,
  getAllWorldsByDaysLeft,

  // Admin Functions
  getAllWorldsPaged,

  // Bot Profile Functions
  setBotUsername,
  getBotUsername,
  getUserByBotUsername,
  getUser,
};
