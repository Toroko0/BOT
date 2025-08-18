// /home/container/database.js

const path = require('path');
const fs = require('fs');
const knexConfig = require('./knexfile.js');
const Knex = require('knex');
const logger = require('./utils/logger.js');
const { DateTime } = require('luxon');

// --- Initialize Knex ---
let knexInstance;
try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
        logger.info("[DB] Created data directory.");
    }
    knexInstance = Knex(knexConfig.development);

    knexInstance.on('query', (queryData) => {
        logger.debug('[DB Query]', { sql: queryData.sql, bindings: queryData.bindings });
    });

    knexInstance.raw('SELECT 1')
        .then(() => { logger.info("[DB] Knex connected (Early Check)."); })
        .catch((err) => { logger.error("[DB] FATAL: Knex connection failed (Early Check).", err); process.exit(1); });

} catch (error) {
    logger.error("[DB] FATAL: Error initializing Knex instance.", error);
    process.exit(1);
}

// --- Define ALL Functions FIRST ---

function initializeDatabase() { return Promise.resolve(); }

async function addWorld(worldName, daysOwned, lockType = 'mainlock', customId = null, username = null) {
    const worldNameUpper = worldName.toUpperCase();
    const normalizedLockType = String(lockType).toLowerCase() === 'o' || String(lockType).toLowerCase() === 'outlock' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    if (worldNameUpper.includes(' ')) {
        throw new Error('World names cannot contain spaces.');
    }
    if (normalizedCustomId === '') { normalizedCustomId = null; }

    const now = DateTime.utc().startOf('day');
    const daysLeft = 180 - daysOwnedNum;
    const expiryDate = now.plus({ days: daysLeft });
    const expiryDateISO = expiryDate.toISO();

    try {
        await knexInstance('worlds').insert({
            name: worldNameUpper,
            days_owned: daysOwnedNum,
            expiry_date: expiryDateISO,
            lock_type: normalizedLockType,
            custom_id: normalizedCustomId,
            added_by_username: username,
            added_date: DateTime.utc().toISO(),
        });
        logger.info(`[DB] Added world ${worldNameUpper}`);
    } catch (error) {
        logger.error(`[DB] Error adding world ${worldNameUpper}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) {
            if (error.message.includes('uq_worlds_name_days_lock')) {
                throw new Error(`A world named **${worldNameUpper}** with the exact same days owned and lock type is already being tracked.`);
            } else if (error.message.includes('worlds.uq_worlds_customid') && normalizedCustomId) {
                throw new Error(`Custom ID **${normalizedCustomId}** already in use.`);
            }
        }
        throw new Error('Failed to add world due to a database error.');
    }
}

async function updateWorld(worldId, updatedData) {
    const { daysOwned, lockType, customId } = updatedData;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    const normalizedLockType = String(lockType).toLowerCase() === 'o' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null;
    if (normalizedCustomId === '') normalizedCustomId = null;

    const now = DateTime.utc().startOf('day');
    const daysLeft = 180 - daysOwnedNum;
    const newExpiryDate = now.plus({ days: daysLeft });
    const expiryDateISO = newExpiryDate.toISO();

    try {
        const updateCount = await knexInstance('worlds')
            .where({ id: worldId })
            .update({
                days_owned: daysOwnedNum,
                expiry_date: expiryDateISO,
                lock_type: normalizedLockType,
                custom_id: normalizedCustomId
            });
        if (updateCount === 0) throw new Error('World not found.');
        logger.info(`[DB] Updated core details for world ${worldId}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating world ${worldId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) {
            if (error.message.includes('worlds.uq_worlds_customid') && normalizedCustomId) {
                throw new Error(`Custom ID **${normalizedCustomId}** already used.`);
            }
        }
        throw error;
    }
}

async function removeWorld(worldId) {
    try {
        const deletedCount = await knexInstance('worlds').where({ id: worldId }).del();
        if (deletedCount > 0) { logger.info(`[DB] Removed world ${worldId}`); return true; }
        else { logger.warn(`[DB] removeWorld: World ${worldId} not found.`); return false; }
    } catch (error) { logger.error(`[DB] Error removing world ${worldId}:`, error); return false; }
}

async function getWorlds(page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize;
    logger.debug(`[DB] Attempting to get worlds, page ${page}`);
    try {
        const worlds = await knexInstance('worlds')
            .orderBy('expiry_date', 'asc')
            .limit(pageSize)
            .offset(offset)
            .select('*');

        logger.debug(`[DB] getWorlds raw rows fetched, page ${page}:`, worlds.map(w => ({ id: w.id, name: w.name })));

        const totalResult = await knexInstance('worlds')
            .count({ total: '*' });

        const totalCount = (totalResult && totalResult[0] && totalResult[0].total !== undefined)
            ? Number(totalResult[0].total)
            : 0;

        logger.debug(`[DB] getWorlds count query returned: ${totalCount}`);

        return { worlds: worlds, total: totalCount };

    } catch (error) {
        logger.error(`[DB] Error getting worlds:`, error);
        return { worlds: [], total: 0 };
    }
}

async function getWorldById(worldId) {
    try { const world = await knexInstance('worlds').where('id', worldId).first(); return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by ID ${worldId}:`, error); return null; }
}

async function getWorldByName(worldName) {
    try { const world = await knexInstance('worlds').whereRaw('lower(name) = lower(?)', [worldName]).first(); return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by name "${worldName}":`, error); return null; }
}

async function getWorldsByName(worldName) {
    try { const worlds = await knexInstance('worlds').whereRaw('lower(name) = lower(?)', [worldName]); return worlds; }
    catch (error) { logger.error(`[DB] Error getting worlds by name "${worldName}":`, error); return []; }
}

async function getWorldByCustomId(customId) {
    if (!customId) return null;
    try { const world = await knexInstance('worlds').whereRaw('lower(custom_id) = lower(?)', [customId]).first(); return world || null; }
    catch (error) { logger.error(`[DB] Error getting world by custom ID "${customId}":`, error); return null; }
}

async function findWorldByIdentifier(identifier) {
    if (!identifier) return null; const identifierUpper = identifier.toUpperCase();
    try { let world = await getWorldByName(identifierUpper); if (world) return world; world = await getWorldByCustomId(identifierUpper); if (world) return world; return null; }
    catch (error) { logger.error(`[DB] Error in findWorldByIdentifier for "${identifier}":`, error); return null; }
}

async function getFilteredWorlds(filters = {}, page = 1, pageSize = 10, options = {}) {
    logger.debug(`[DB] getFilteredWorlds called - Filters: ${JSON.stringify(filters)}, Page: ${page}, PageSize: ${pageSize}, Options: ${JSON.stringify(options)}`);
    try {
        let query = knexInstance('worlds');
        const nowUtc = DateTime.utc().startOf('day');

        if (filters.prefix) {
            query = query.whereRaw('lower(name) LIKE ?', [`${filters.prefix.toLowerCase()}%`]);
        }
        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query = query.where('lock_type', filters.lockType);
        }
        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query = query.whereRaw("strftime('%w', date(expiry_date)) = ?", [dayNum.toString()]);
            }
        }
        if (filters.daysOwned !== undefined && filters.daysOwned !== null) {
            const daysOwnedInput = parseInt(filters.daysOwned);
            if (!isNaN(daysOwnedInput) && daysOwnedInput >= 0 && daysOwnedInput <= 180) {
                const targetDaysLeft = 180 - daysOwnedInput;
                const targetExpiryDate = nowUtc.plus({ days: targetDaysLeft });
                const nextDay = targetExpiryDate.plus({ days: 1 });
                query = query.where('expiry_date', '>=', targetExpiryDate.toISO()).andWhere('expiry_date', '<', nextDay.toISO());
            }
        }
        if (filters.nameLengthMin !== undefined && filters.nameLengthMin !== null) {
            const minLength = parseInt(filters.nameLengthMin);
            if (!isNaN(minLength) && minLength > 0) {
                query = query.whereRaw('LENGTH(name) >= ?', [minLength]);
            }
        }
        if (filters.nameLengthMax !== undefined && filters.nameLengthMax !== null) {
            const maxLength = parseInt(filters.nameLengthMax);
            if (!isNaN(maxLength) && maxLength > 0) {
                query = query.whereRaw('LENGTH(name) <= ?', [maxLength]);
            }
        }
        if (filters.added_by_username) {
            query = query.where('added_by_username', filters.added_by_username);
        }

        const totalResult = await query.clone().count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;

        // Default sort order
        query = query.orderBy('expiry_date', 'asc')
             .orderByRaw('LENGTH(name) asc')
             .orderBy('lock_type', 'asc')
             .orderBy('name', 'asc');

        query = query.limit(pageSize).offset((page - 1) * pageSize);

        const worlds = await query.select('*');

        logger.debug(`[DB] getFilteredWorlds returning ${worlds.length} worlds, total: ${totalCount}`);
        return { worlds, total: totalCount };
    } catch (error) {
        logger.error(`[DB] Error in getFilteredWorlds (Filters: ${JSON.stringify(filters)}, Page: ${page}):`, error);
        return { worlds: [], total: 0 };
    }
}

async function removeExpiredWorlds() {
    try {
        const now = DateTime.utc();
        const nowISO = now.toISO();
        
        logger.debug(`[DB] Running cleanup query. Removing worlds with expiry_date < '${nowISO}'`);

        const deletedCount = await knexInstance('worlds')
            .where('expiry_date', '<', nowISO)
            .del();
        
        if (deletedCount > 0) {
            logger.info(`[DB] Daily Task: Removed ${deletedCount} expired worlds.`);
        } else {
            logger.info('[DB] Daily Task: No expired worlds to remove.');
        }
        return deletedCount;
    } catch (error) {
        logger.error('[DB] Error removing expired worlds:', error);
        return 0;
    }
}

async function getWorldCount() { try { const result = await knexInstance('worlds').count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting world count:`, error); return 0; } }

async function getWorldLockStats() { try { const stats = await knexInstance('worlds').select('lock_type').count({ count: '*' }).groupBy('lock_type'); const result = { mainlock: 0, outlock: 0 }; stats.forEach(row => { if (row.lock_type === 'mainlock') result.mainlock = Number(row.count); else if (row.lock_type === 'outlock') result.outlock = Number(row.count); }); return result; } catch (error) { logger.error(`[DB] Error getting lock stats:`, error); return { mainlock: 0, outlock: 0 }; } }

async function getExpiringWorldCount(days = 7) {
    try {
        const now = DateTime.utc();
        const targetDate = now.plus({ days });
        const result = await knexInstance('worlds')
            .where('expiry_date', '>=', now.toISO())
            .andWhere('expiry_date', '<=', targetDate.toISO())
            .count({ count: '*' }).first();
        return result ? Number(result.count) : 0;
    } catch (error) {
        logger.error(`[DB] Error getting expiring world count (in ${days} days):`, error);
        return 0;
    }
}

async function getMostRecentWorld() { try { const world = await knexInstance('worlds').orderBy('added_date', 'desc').select('name', 'added_date').first(); return world || null; } catch (error) { logger.error(`[DB] Error getting most recent world:`, error); return null; } }

async function getLeaderboard(page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize;
    logger.debug(`[DB] Attempting to get leaderboard, page ${page}`);
    try {
        const subquery = knexInstance('users')
            .leftJoin('worlds', 'users.username', 'worlds.added_by_username')
            .select('users.username as added_by_username')
            .count('worlds.id as world_count')
            .groupBy('users.username')
            .orderBy('world_count', 'desc')
            .limit(pageSize)
            .offset(offset)
            .as('leaderboard');

        const leaderboard = await knexInstance.from(subquery);
        const totalResult = await knexInstance('users').count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;

        return { leaderboard, total: totalCount };
    } catch (error) {
        logger.error(`[DB] Error getting leaderboard:`, error);
        return { leaderboard: [], total: 0 };
    }
}

async function addUser(userId, username) {
    try {
        const existingUser = await knexInstance('users').where({ id: userId }).first();
        if (existingUser) {
            if (existingUser.username !== username) {
                await knexInstance('users').where({ id: userId }).update({ username: username });
                logger.debug(`[DB] Updated username for user ${userId} to ${username}`);
            }
            return true;
        } else {
            await knexInstance('users').insert({
                id: userId,
                username: username,
            });
            logger.info(`[DB] Added new user ${userId} (${username})`);
            return true;
        }
    } catch (error) { logger.error(`[DB] Error adding/updating user ${userId}:`, error); return false; }
}

async function getUserPreferences(userId) {
    try {
        const user = await knexInstance('users').where({ id: userId }).first();
        if (user) {
            return {
                timezone_offset: user.timezone_offset,
                view_mode: user.view_mode,
                notifications_enabled: user.notifications_enabled,
                notification_interval: user.notification_interval,
            };
        }
        return {
            timezone_offset: 0.0,
            view_mode: 'pc',
            notifications_enabled: true,
            notification_interval: 6,
        };
    } catch (error) {
        logger.error(`[DB] Error getting preferences for user ${userId}:`, error);
        return {
            timezone_offset: 0.0,
            view_mode: 'pc',
            notifications_enabled: true,
            notification_interval: 6,
        };
    }
}

async function updateUserNotificationSettings(userId, { notifications_enabled, notification_interval }) {
    try {
        const updateData = {};
        if (notifications_enabled !== undefined) {
            updateData.notifications_enabled = notifications_enabled;
        }
        if (notification_interval !== undefined) {
            const interval = parseInt(notification_interval, 10);
            if (!isNaN(interval) && [6, 12, 24, 0].includes(interval)) {
                updateData.notification_interval = interval;
                if (interval === 0) {
                    updateData.notifications_enabled = false;
                } else {
                    updateData.notifications_enabled = true;
                }
            } else {
                return false;
            }
        }

        if (Object.keys(updateData).length > 0) {
            await knexInstance('users').where({ id: userId }).update(updateData);
            logger.info(`[DB] Updated notification settings for user ${userId}:`, updateData);
        }
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating notification settings for user ${userId}:`, error);
        return false;
    }
}

async function addToWhitelist(username) {
    try {
        await knexInstance('whitelist').insert({ username });
        logger.info(`[DB] Added ${username} to the whitelist.`);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            throw new Error(`**${username}** is already on the whitelist.`);
        }
        logger.error(`[DB] Error adding to whitelist:`, error);
        throw new Error('An error occurred while adding to the whitelist.');
    }
}

async function removeFromWhitelist(username) {
    try {
        const deletedCount = await knexInstance('whitelist').where({ username }).del();
        if (deletedCount === 0) {
            throw new Error(`**${username}** is not on the whitelist.`);
        }
        logger.info(`[DB] Removed ${username} from the whitelist.`);
    } catch (error) {
        logger.error(`[DB] Error removing from whitelist:`, error);
        throw new Error('An error occurred while removing from the whitelist.');
    }
}

async function getWhitelist() {
    try {
        return await knexInstance('whitelist').select('username');
    } catch (error) {
        logger.error(`[DB] Error getting whitelist:`, error);
        return [];
    }
}

async function isWhitelisted(username) {
    try {
        const result = await knexInstance('whitelist').where({ username }).first();
        return !!result;
    } catch (error) {
        logger.error(`[DB] Error checking whitelist:`, error);
        return false;
    }
}

async function updateUserTimezone(userId, timezoneOffset) {
    try {
        const offset = parseFloat(timezoneOffset);
        if (isNaN(offset) || offset < -12.0 || offset > 14.0) {
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

async function getUserStats(username) {
    try {
        const totalWorlds = await knexInstance('worlds').where('added_by_username', username).count({ count: '*' }).first();
        const lockStats = await knexInstance('worlds').where('added_by_username', username).select('lock_type').count({ count: '*' }).groupBy('lock_type');
        const result = {
            totalWorlds: totalWorlds ? Number(totalWorlds.count) : 0,
            mainlock: 0,
            outlock: 0,
        };
        lockStats.forEach(row => {
            if (row.lock_type === 'mainlock') result.mainlock = Number(row.count);
            else if (row.lock_type === 'outlock') result.outlock = Number(row.count);
        });
        return result;
    } catch (error) {
        logger.error(`[DB] Error getting stats for user ${username}:`, error);
        return { totalWorlds: 0, mainlock: 0, outlock: 0 };
    }
}

async function getRecentlyAddedWorldsSince(since, limit = 10) {
    try {
        return await knexInstance('worlds')
            .where('added_date', '>', since)
            .orderBy('added_date', 'desc')
            .limit(limit);
    } catch (error) {
        logger.error(`[DB] Error getting recently added worlds:`, error);
        return [];
    }
}

async function getUsersToNotify() {
    try {
        const now = DateTime.utc();
        return await knexInstance('users')
            .where('notifications_enabled', true)
            .andWhere(function() {
                this.whereNull('last_notification_timestamp')
                    .orWhereRaw('julianday(?) - julianday(last_notification_timestamp) > notification_interval / 24.0', [now.toISO()]);
            });
    } catch (error) {
        logger.error(`[DB] Error getting users to notify:`, error);
        return [];
    }
}

async function updateLastNotificationTimestamp(userId, timestamp) {
    try {
        await knexInstance('users')
            .where({ id: userId })
            .update({ last_notification_timestamp: timestamp });
        logger.debug(`[DB] Updated last notification timestamp for user ${userId}`);
        return true;
    } catch (error) {
        logger.error(`[DB] Error updating last notification timestamp for user ${userId}:`, error);
        return false;
    }
}

// --- Module Exports ---
module.exports = {
    knex: knexInstance,
    initializeDatabase,
    addWorld,
    updateWorld,
    removeWorld,
    getWorlds,
    getWorldById,
    getWorldByName,
    getWorldsByName,
    getWorldByCustomId,
    findWorldByIdentifier,
    getFilteredWorlds,
    searchWorlds: getFilteredWorlds,
    removeExpiredWorlds,
    getWorldCount,
    getWorldLockStats,
    getExpiringWorldCount,
    getMostRecentWorld,
    getLeaderboard,
    addUser,
    getUserPreferences,
    updateUserTimezone,
    updateUserViewMode,
    getUserStats,
    updateUserNotificationSettings,
    getRecentlyAddedWorldsSince,
    getUsersToNotify,
    updateLastNotificationTimestamp,
    addToWhitelist,
    removeFromWhitelist,
    getWhitelist,
    isWhitelisted,
};
