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

async function addWorld(worldName, daysOwned, lockType = 'mainlock', customId = null, username = null) {
    const worldNameUpper = worldName.toUpperCase();
    const normalizedLockType = String(lockType).toLowerCase() === 'o' || String(lockType).toLowerCase() === 'outlock' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    if (worldNameUpper.includes(' ')) { return { success: false, message: 'World names cannot contain spaces.' }; }
    if (normalizedCustomId === '') { normalizedCustomId = null; }
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const expiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = expiryDate.toISOString();

    // Pre-emptive check for existing world with exact same parameters
    const existingWorld = await knexInstance('worlds')
        .where({
            name: worldNameUpper,
            days_owned: daysOwnedNum,
            lock_type: normalizedLockType
        })
        .first();

    if (existingWorld) {
        return { success: false, message: `A world named **${worldNameUpper}** with the exact same days owned and lock type is already being tracked.` };
    }

    try {
        await knexInstance('worlds').insert({ name: worldNameUpper, days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, custom_id: normalizedCustomId, added_by_username: username });
        logger.info(`[DB] Added world ${worldNameUpper}`);
        return { success: true, message: `**${worldNameUpper}** added.` };
    } catch (error) {
        logger.error(`[DB] Error adding world ${worldNameUpper}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) {
            if (error.message.includes('uq_worlds_name_days_lock')) { // New constraint name
                return { success: false, message: `A world named **${worldNameUpper}** with the exact same days owned and lock type is already being tracked (database constraint).` };
            } else if (error.message.includes('worlds.uq_worlds_customid') && normalizedCustomId) {
                return { success: false, message: `Custom ID **${normalizedCustomId}** already in use.` };
            }
        }
        return { success: false, message: 'Failed to add world due to a database error.' };
    }
}

async function updateWorld(worldId, updatedData) {
    const { daysOwned, lockType, customId } = updatedData;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    const normalizedLockType = String(lockType).toLowerCase() === 'o' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null; if (normalizedCustomId === '') normalizedCustomId = null;
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const newExpiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = newExpiryDate.toISOString();
    try {
        const updateCount = await knexInstance('worlds').where({ id: worldId }).update({ days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, custom_id: normalizedCustomId });
        if (updateCount === 0) throw new Error('World not found.');
        logger.info(`[DB] Updated core details for world ${worldId}`); return true;
    } catch (error) {
        logger.error(`[DB] Error updating world ${worldId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) { if (error.message.includes('worlds.uq_worlds_customid') && normalizedCustomId) { throw new Error(`Custom ID **${normalizedCustomId}** already used.`); } }
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

async function getFilteredWorlds(filters = {}, page = 1, pageSize = 10) {
    logger.debug(`[DB] getFilteredWorlds called - Filters: ${JSON.stringify(filters)}, Page: ${page}, PageSize: ${pageSize}`);
    try {
        let query = knexInstance('worlds').select('*');
        let countQueryBase = knexInstance('worlds');

        if (filters.prefix) {
            const prefixLower = filters.prefix.toLowerCase();
            query.andWhereRaw('lower(name) LIKE ?', [`${prefixLower}%`]);
            countQueryBase.andWhereRaw('lower(name) LIKE ?', [`${prefixLower}%`]);
        }

        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query.andWhere('lock_type', filters.lockType);
            countQueryBase.andWhere('lock_type', filters.lockType);
        }

        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query.andWhereRaw("strftime('%w', date(expiry_date)) = ?", [dayNum.toString()]);
                countQueryBase.andWhereRaw("strftime('%w', date(expiry_date)) = ?", [dayNum.toString()]);
            }
        }

        if (filters.daysOwned !== undefined && filters.daysOwned !== null) {
            const daysOwnedInput = parseInt(filters.daysOwned);
            if (!isNaN(daysOwnedInput)) {
                if (daysOwnedInput === 180) {
                    const todayEnd = new Date();
                    todayEnd.setUTCHours(23, 59, 59, 999);
                    query.andWhere('expiry_date', '<=', todayEnd.toISOString());
                    countQueryBase.andWhere('expiry_date', '<=', todayEnd.toISOString());
                } else if (daysOwnedInput >= 0 && daysOwnedInput < 180) {
                    const targetDaysLeft = 180 - daysOwnedInput;
                    const targetDate = new Date();
                    targetDate.setUTCHours(0,0,0,0);
                    targetDate.setUTCDate(targetDate.getUTCDate() + targetDaysLeft);
                    const targetStartDateISO = targetDate.toISOString();
                    const targetEndDate = new Date(targetDate);
                    targetEndDate.setUTCDate(targetDate.getUTCDate() + 1);
                    const targetEndDateISO = targetEndDate.toISOString();
                    query.andWhere('expiry_date', '>=', targetStartDateISO)
                         .andWhere('expiry_date', '<', targetEndDateISO);
                    countQueryBase.andWhere('expiry_date', '>=', targetStartDateISO)
                                  .andWhere('expiry_date', '<', targetEndDateISO);
                }
            }
        }

        if (filters.nameLengthMin !== undefined && filters.nameLengthMin !== null) {
            const minLength = parseInt(filters.nameLengthMin);
            if (!isNaN(minLength) && minLength > 0) {
                query.andWhereRaw('LENGTH(name) >= ?', [minLength]);
                countQueryBase.andWhereRaw('LENGTH(name) >= ?', [minLength]);
            }
        }
        if (filters.nameLengthMax !== undefined && filters.nameLengthMax !== null) {
            const maxLength = parseInt(filters.nameLengthMax);
            if (!isNaN(maxLength) && maxLength > 0) {
                query.andWhereRaw('LENGTH(name) <= ?', [maxLength]);
                countQueryBase.andWhereRaw('LENGTH(name) <= ?', [maxLength]);
            }
        }

        const totalResult = await countQueryBase.count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;

        query.orderBy('expiry_date', 'asc')
             .limit(pageSize)
             .offset((page - 1) * pageSize);

        const worlds = await query;

        logger.debug(`[DB] getFilteredWorlds returning ${worlds.length} worlds, total: ${totalCount}`);
        return { worlds: worlds, total: totalCount };

    } catch (error) {
        logger.error(`[DB] Error in getFilteredWorlds (Filters: ${JSON.stringify(filters)}, Page: ${page}):`, error);
        return { worlds: [], total: 0 };
    }
}

async function removeExpiredWorlds() { try { const now = new Date(); now.setUTCHours(0, 0, 0, 0); const nowISO = now.toISOString(); const deletedCount = await knexInstance('worlds').where('expiry_date', '<', nowISO).del(); if (deletedCount > 0) logger.info(`[DB] Daily Task: Removed ${deletedCount} expired worlds (Expired before ${nowISO}).`); return deletedCount; } catch (error) { logger.error('[DB] Error removing expired worlds:', error); return 0; } }

async function getWorldCount() { try { const result = await knexInstance('worlds').count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting world count:`, error); return 0; } }

async function getWorldLockStats() { try { const stats = await knexInstance('worlds').select('lock_type').count({ count: '*' }).groupBy('lock_type'); const result = { mainlock: 0, outlock: 0 }; stats.forEach(row => { if (row.lock_type === 'mainlock') result.mainlock = Number(row.count); else if (row.lock_type === 'outlock') result.outlock = Number(row.count); }); return result; } catch (error) { logger.error(`[DB] Error getting lock stats:`, error); return { mainlock: 0, outlock: 0 }; } }

async function getExpiringWorldCount(days = 7) { try { const targetDate = new Date(); targetDate.setUTCDate(targetDate.getUTCDate() + parseInt(days)); targetDate.setUTCHours(23, 59, 59, 999); const targetDateISO = targetDate.toISOString(); const nowISO = new Date().toISOString(); const result = await knexInstance('worlds').andWhere('expiry_date', '<=', targetDateISO).andWhere('expiry_date', '>=', nowISO).count({ count: '*' }).first(); return result ? Number(result.count) : 0; } catch (error) { logger.error(`[DB] Error getting expiring world count (in ${days} days):`, error); return 0; } }

async function getMostRecentWorld() { try { const world = await knexInstance('worlds').orderBy('added_date', 'desc').select('name', 'added_date').first(); return world || null; } catch (error) { logger.error(`[DB] Error getting most recent world:`, error); return null; } }

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
  getWorldByCustomId,
  findWorldByIdentifier,
  getFilteredWorlds,
  searchWorlds: getFilteredWorlds,
  removeExpiredWorlds,
  getWorldCount,
  getWorldLockStats,
  getExpiringWorldCount,
  getMostRecentWorld,
};
