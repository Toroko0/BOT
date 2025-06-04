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
        reminder_time_utc: null    // Default null
      });
      logger.info(`[DB] Added new user ${userId} (${username}) with default preferences`);
      return true;
    }
  } catch (error) { logger.error(`[DB] Error adding/updating user ${userId}:`, error); return false; }
}

async function addWorld(userId, worldName, daysOwned, lockType = 'mainlock', note = null, username = null, guildId = null) {
    const worldNameUpper = worldName.toUpperCase();
    const normalizedLockType = String(lockType).toLowerCase() === 'o' || String(lockType).toLowerCase() === 'outlock' ? 'outlock' : 'mainlock';
    let normalizedNote = note ? String(note).trim().toUpperCase() : null;
    const publicStatus = false;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    if (worldNameUpper.includes(' ')) { return { success: false, message: 'World names cannot contain spaces.' }; }
    if (normalizedNote === '') { normalizedNote = null; }
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const expiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = expiryDate.toISOString();
    try {
        await knexInstance('worlds').insert({ name: worldNameUpper, days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, is_public: publicStatus, user_id: userId, note: normalizedNote, added_by: username, guild_id: guildId });
        logger.info(`[DB] Added world ${worldNameUpper} for user ${userId}`);
        return { success: true, message: `**${worldNameUpper}** added.` };
    } catch (error) {
        logger.error(`[DB] Error adding world ${worldNameUpper} for user ${userId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) { if (error.message.includes('worlds.uq_worlds_name_user')) { return { success: false, message: `You are already tracking **${worldNameUpper}**.` }; } else if (error.message.includes('worlds.uq_worlds_customid_user') && normalizedNote) { return { success: false, message: `Note **${normalizedNote}** already in use by you.` }; } }
        return { success: false, message: 'Failed to add world due to a database error.' };
    }
}

async function updateWorld(worldId, userId, updatedData) {
    const { daysOwned, lockType, note } = updatedData;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    const normalizedLockType = String(lockType).toLowerCase() === 'o' ? 'outlock' : 'mainlock';
    let normalizedNote = note ? String(note).trim().toUpperCase() : null; if (normalizedNote === '') normalizedNote = null;
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const newExpiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = newExpiryDate.toISOString();
    try {
        const updateCount = await knexInstance('worlds').where({ id: worldId, user_id: userId }).update({ days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, note: normalizedNote });
        if (updateCount === 0) throw new Error('World not found or no permission to update.');
        logger.info(`[DB] Updated core details for world ${worldId} by user ${userId}`); return true;
    } catch (error) {
        logger.error(`[DB] Error updating world ${worldId} for user ${userId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) { if (error.message.includes('worlds.uq_worlds_customid_user') && normalizedNote) { throw new Error(`Note **${normalizedNote}** already used by you.`); } }
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
    // Query for the current page's worlds
    const worlds = await knexInstance('worlds as w')
      .leftJoin('users as u', 'w.user_id', 'u.id')
      .where('w.user_id', userId)
      .orderBy('w.expiry_date', 'asc') // Orders by expiry_date ascending (fewer days left first), which means days_owned descending (more days owned first)
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

async function getWorldByNote(note, userId) {
    if (!note) return null;
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where('w.user_id', userId).andWhereRaw('lower(w.note) = lower(?)', [note]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by note "${note}" for user ${userId}:`, error); return null; }
}

async function getPublicWorldsByGuild(guildId, page = 1, pageSize = 10) {
    if (!guildId) return { worlds: [], total: 0 }; const offset = (page - 1) * pageSize;
    try { 
        const worlds = await knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .where('w.is_public', true)
            .andWhere('w.guild_id', guildId)
            .orderBy('w.expiry_date', 'asc') // Orders by expiry_date ascending (fewer days left first), which means days_owned descending (more days owned first)
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

async function getPublicWorldByNote(note, guildId) {
    if (!note || !guildId) return null;
    try { const world = await knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').where({ 'w.is_public': true, 'w.guild_id': guildId }).andWhereRaw('lower(w.note) = lower(?)', [note]).select('w.*', 'u.username as added_by_tag').first(); if (world) world.is_public = !!world.is_public; return world || null; }
    catch (error) { logger.error(`[DB] Error getting public world by note "${note}" in guild ${guildId}:`, error); return null; }
}

async function findWorldByIdentifier(userId, identifier, guildId) {
    if (!identifier) return null; const identifierUpper = identifier.toUpperCase();
    try { let world = await getWorldByName(identifierUpper, userId); if (world) return world; world = await getWorldByNote(identifierUpper, userId); if (world) return world; if (guildId) { world = await getPublicWorldByName(identifierUpper, guildId); if (world) return world; world = await getPublicWorldByNote(identifierUpper, guildId); if (world) return world; } return null; }
    catch (error) { logger.error(`[DB] Error in findWorldByIdentifier for "${identifier}" (User: ${userId}, Guild: ${guildId}):`, error); return null; }
}

async function getFilteredWorlds(userId, filters = {}) {
    try { let query = knexInstance('worlds as w').leftJoin('users as u', 'w.user_id', 'u.id').select('w.*', 'u.username as added_by_tag'); if (filters.showPublic && filters.guildId) { query = query.where(builder => { builder.where('w.user_id', userId).orWhere(subBuilder => { subBuilder.where('w.is_public', true).andWhere('w.guild_id', filters.guildId); }); }); } else { query = query.where('w.user_id', userId); } if (filters.prefix) query = query.andWhereRaw('lower(w.name) LIKE lower(?)', [`${filters.prefix}%`]); if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') query = query.andWhere('w.lock_type', filters.lockType); if (filters.expiryDay) { const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 }; const dayNum = dayMap[filters.expiryDay.toLowerCase()]; if (dayNum !== undefined) query = query.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]); } if (filters.expiringDays !== undefined && filters.expiringDays !== null) { const days = parseInt(filters.expiringDays, 10); if (!isNaN(days) && days >= 0) { const targetDate = new Date(); targetDate.setUTCDate(targetDate.getUTCDate() + days); targetDate.setUTCHours(23, 59, 59, 999); const targetDateISO = targetDate.toISOString(); query = query.andWhere('w.expiry_date', '<=', targetDateISO); } } query = query.orderBy('w.expiry_date', 'asc'); const worlds = await query; return worlds.map(w => ({ ...w, is_public: !!w.is_public })); }
    catch (error) { logger.error(`[DB] Error searching/filtering worlds for user ${userId} with filters ${JSON.stringify(filters)}:`, error); return []; }
}

async function updateAllWorldDays() { try { logger.info("[DB] Daily Task: Skipping days_owned increment (relying on expiry_date)."); return 0; } catch (error) { logger.error('[DB] Error in (commented out) updateAllWorldDays:', error); return 0; } }

async function removeExpiredWorlds() { try { const now = new Date(); now.setUTCHours(0, 0, 0, 0); const nowISO = now.toISOString(); const deletedCount = await knexInstance('worlds').where('expiry_date', '<', nowISO).del(); if (deletedCount > 0) logger.info(`[DB] Daily Task: Removed ${deletedCount} expired worlds (Expired before ${nowISO}).`); return deletedCount; } catch (error) { logger.error('[DB] Error removing expired worlds:', error); return 0; } }

async function getWorldCount(userId) { try { const result = await knexInstance('worlds').where({ user_id: userId }).count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting world count for user ${userId}:`, error); return 0; } }

async function getWorldLockStats(userId) { try { const stats = await knexInstance('worlds').select('lock_type').count({ count: '*' }).where({ user_id: userId }).groupBy('lock_type'); const result = { mainlock: 0, outlock: 0 }; stats.forEach(row => { if (row.lock_type === 'mainlock') result.mainlock = Number(row.count); else if (row.lock_type === 'outlock') result.outlock = Number(row.count); }); return result; } catch (error) { logger.error(`[DB] Error getting lock stats for user ${userId}:`, error); return { mainlock: 0, outlock: 0 }; } }

async function getExpiringWorldCount(userId, days = 7) { try { const targetDate = new Date(); targetDate.setUTCDate(targetDate.getUTCDate() + parseInt(days)); targetDate.setUTCHours(23, 59, 59, 999); const targetDateISO = targetDate.toISOString(); const nowISO = new Date().toISOString(); const result = await knexInstance('worlds').where({ user_id: userId }).andWhere('expiry_date', '<=', targetDateISO).andWhere('expiry_date', '>=', nowISO).count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting expiring world count (in ${days} days) for user ${userId}:`, error); return 0; } }

async function getMostRecentWorld(userId) { try { const world = await knexInstance('worlds').where({ user_id: userId }).orderBy('added_date', 'desc').select('name', 'added_date').first(); return world || null; } catch (error) { logger.error(`[DB] Error getting most recent world for user ${userId}:`, error); return null; } }

async function getMostRecentWorld(userId) { try { const world = await knexInstance('worlds').where({ user_id: userId }).orderBy('added_date', 'desc').select('name', 'added_date').first(); return world || null; } catch (error) { logger.error(`[DB] Error getting most recent world for user ${userId}:`, error); return null; } }

// --- New function to get worlds expiring soon for a specific user ---
async function getExpiringWorldsForUser(userId, daysUntilExpiry = 7) {
    logger.debug(`[DB] Fetching worlds expiring in ${daysUntilExpiry} days for user ${userId}`);
    try {
        const now = new Date();
        const targetDate = new Date();
        targetDate.setUTCDate(now.getUTCDate() + daysUntilExpiry);
        targetDate.setUTCHours(23, 59, 59, 999); // End of the target day

        const nowISO = now.toISOString();
        const targetDateISO = targetDate.toISOString();

        const worlds = await knexInstance('worlds')
            .where('user_id', userId)
            .andWhere('expiry_date', '>=', nowISO)
            .andWhere('expiry_date', '<=', targetDateISO)
            .orderBy('expiry_date', 'asc')
            .select('name', 'expiry_date', 'note'); // Added note

        logger.debug(`[DB] Found ${worlds.length} worlds expiring for user ${userId} by ${targetDateISO}`);
        return worlds;
    } catch (error) {
        logger.error(`[DB] Error getting expiring worlds for user ${userId}:`, error);
        return []; // Return an empty array in case of an error
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
                reminder_enabled: !!user.reminder_enabled, // Ensure boolean
                reminder_time_utc: user.reminder_time_utc
            };
        }
        // Return default preferences if user not found or preferences not set
        // This ensures the bot always has some preference values to work with.
        logger.warn(`[DB] User ${userId} not found or preferences missing, returning defaults.`);
        return {
            timezone_offset: 0.0,
            view_mode: 'pc',
            reminder_enabled: false,
            reminder_time_utc: null
        };
    } catch (error) {
        logger.error(`[DB] Error getting preferences for user ${userId}:`, error);
        // Return default preferences on error as a fallback
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
            return false; // Indicate failure due to invalid value
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
            return false; // Indicate failure due to invalid value
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
        // Basic validation for reminderTimeUtc if reminderEnabled is true
        if (reminderEnabled && reminderTimeUtc) {
            if (!/^\d{2}:\d{2}$/.test(reminderTimeUtc)) {
                 logger.warn(`[DB] Invalid reminder_time_utc format for user ${userId}: ${reminderTimeUtc}`);
                 return false; // Indicate failure
            }
        }
        const effectiveReminderTimeUtc = reminderEnabled ? reminderTimeUtc : null;

        await knexInstance('users').where({ id: userId }).update({
            reminder_enabled: !!reminderEnabled, // Ensure boolean
            reminder_time_utc: effectiveReminderTimeUtc 
        });
        logger.info(`[DB] Updated reminder settings for user ${userId} to enabled: ${!!reminderEnabled}, time: ${effectiveReminderTimeUtc}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating reminder settings for user ${userId}:`, error);
        return false;
    }
}

// Function to get worlds by days left, without pagination (for export)
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
            .orderBy('w.name', 'asc') // This ordering is primarily for DB consistency, JS sort will refine
            .select('w.*', 'u.username as added_by_tag');
        
        logger.debug(`[DB] getAllWorldsByDaysLeft: Worlds query returned ${worlds.length} rows.`);

        const formattedWorlds = worlds.map(row => ({ ...row, is_public: !!row.is_public }));
        return formattedWorlds;

    } catch (error) {
        logger.error(`[DB] Error in getAllWorldsByDaysLeft (User: ${userId}, Guild: ${guildId}, DaysLeft: ${daysLeft}):`, error);
        return [];
    }
}

// Add this function definition within database.js
async function getWorldsByDaysLeft(userId, daysLeft, guildId = null, page = 1, pageSize = 10 /* Default, calling code should pass CONSTANTS.PAGE_SIZE */) {
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
// Assign all defined functions to the exports object
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
  getWorldByNote,
  getPublicWorldsByGuild,
  getPublicWorldByName,
  getPublicWorldByNote,
  findWorldByIdentifier,
  getFilteredWorlds,
  searchWorlds: getFilteredWorlds, // Alias
  updateAllWorldDays,
  removeExpiredWorlds,
  getWorldCount,
  getWorldLockStats,
  getExpiringWorldCount,
  getMostRecentWorld,
  getExpiringWorldsForUser, // Added the new function to exports
  // User Preferences
  getUserPreferences,
  updateUserTimezone,
  updateUserViewMode,
  updateUserReminderSettings,
  getWorldsByDaysLeft, // Add the new function here
  getAllWorldsByDaysLeft // NEW: Added function to export
};
