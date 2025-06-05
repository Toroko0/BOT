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
        // Initialize bot_join_date when a new user is added
        bot_join_date: knexInstance.fn.now()
      });
      logger.info(`[DB] Added new user ${userId} (${username}) with default preferences and bot_join_date`);
      return true;
    }
  } catch (error) { logger.error(`[DB] Error adding/updating user ${userId}:`, error); return false; }
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
      .select('id', 'username', 'bot_username', 'bot_join_date', 'diamond_locks_balance', 'notify_on_new_message') // Added notify_on_new_message
      .first();
    return user || null;
  } catch (error) {
    logger.error(`[DB] Error getting user ${userId}:`, error);
    return null;
  }
}

async function getUserProfileStats(userId) {
  try {
    const worldsTrackedResult = await knexInstance('worlds')
      .where({ user_id: userId })
      .count({ count: '*' })
      .first();
    const worldsTracked = worldsTrackedResult ? Number(worldsTrackedResult.count) : 0;

    const worldsLockedResult = await knexInstance('locked_worlds')
      .where({ user_id: userId })
      .count({ count: '*' })
      .first();
    const worldsLocked = worldsLockedResult ? Number(worldsLockedResult.count) : 0;

    const marketListingsActiveResult = await knexInstance('market_listings')
      .where({ seller_user_id: userId })
      .count({ count: '*' })
      .first();
    const marketListingsActive = marketListingsActiveResult ? Number(marketListingsActiveResult.count) : 0;

    return {
      worldsTracked,
      worldsLocked,
      marketListingsActive,
      // Future: team_members: 0
    };
  } catch (error) {
    logger.error(`[DB] Error getting profile stats for user ${userId}:`, error);
    return {
      worldsTracked: 0,
      worldsLocked: 0,
      marketListingsActive: 0,
    };
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
      .first();
    return user || null;
  } catch (error) {
    logger.error(`[DB] Error getting user by bot_username ${botUsername}:`, error);
    return null;
  }
}

// --- Marketplace Functions ---

async function getLockedWorldForListing(userId, worldName) {
  const worldNameUpper = worldName.toUpperCase();
  logger.debug(`[DB] Fetching locked world ${worldNameUpper} for user ${userId} for listing purposes.`);
  try {
    const world = await knexInstance('locked_worlds')
      .where({ user_id: userId, world_name: worldNameUpper })
      .first(); // Selects all columns by default, including 'id'
    return world || null;
  } catch (error) {
    logger.error(`[DB] Error fetching locked world ${worldNameUpper} for listing by user ${userId}:`, error);
    return null;
  }
}

async function isWorldListed(lockedWorldId) {
  logger.debug(`[DB] Checking if locked_world_id ${lockedWorldId} is already listed.`);
  try {
    const listing = await knexInstance('market_listings')
      .where({ locked_world_id: lockedWorldId })
      .first();
    return !!listing; // True if listing exists, false otherwise
  } catch (error) {
    logger.error(`[DB] Error checking if world ${lockedWorldId} is listed:`, error);
    return false; // Assume not listed on error, or handle error more specifically
  }
}

async function createMarketListing(sellerUserId, lockedWorldId, priceDl, listingNote = null) {
  logger.info(`[DB] Creating market listing for locked_world_id ${lockedWorldId} by user ${sellerUserId} for ${priceDl} DLs.`);
  try {
    const [listingId] = await knexInstance('market_listings').insert({
      seller_user_id: sellerUserId,
      locked_world_id: lockedWorldId,
      price_dl: priceDl,
      listing_note: listingNote,
      // listed_on_date will use defaultTo(knex.fn.now())
    }).returning('id'); // Correct way to get ID in PostgreSQL, for SQLite it's often lastID

    // For SQLite, Knex typically returns the last inserted ID directly or an array with it.
    // If listingId is an object like { id: newId }, extract it.
    const newListingId = (typeof listingId === 'object' && listingId !== null) ? listingId.id : listingId;


    if (newListingId) {
      logger.info(`[DB] Market listing created with ID: ${newListingId}`);
      return { success: true, listingId: newListingId };
    } else {
      // This path might be taken if .returning('id') isn't fully supported or if insert fails silently (unlikely for errors)
      // Fallback for SQLite if direct ID isn't returned by .returning('id') - though it usually is for autoIncrement.
      // This part might be redundant if knex handles SQLite's `lastID` correctly with `.returning('id')`.
      // A more robust way for SQLite specifically would be another query for `last_insert_rowid()` if needed,
      // but knex tries to abstract this.
      logger.warn('[DB] Market listing possibly created, but ID not returned directly by insert. This might indicate an issue or specific DB driver behavior.');
      // For now, assume success if no error, but log that ID retrieval was not direct.
      // This case should be tested with the specific DB (SQLite).
      // Knex documentation suggests .returning('id') should work for SQLite as well.
      return { success: true, listingId: null }; // Or attempt a last_insert_rowid() if critical
    }
  } catch (error) {
    logger.error(`[DB] Error creating market listing for locked_world_id ${lockedWorldId}:`, error);
    if (error.message && error.message.includes('UNIQUE constraint failed: market_listings.locked_world_id')) {
        return { success: false, error: 'already_listed' }; // More specific error
    }
    return { success: false, error: 'db_error' };
  }
}

async function getUserDiamondLocksBalance(userId) {
  logger.debug(`[DB] Fetching diamond_locks_balance for user ${userId}.`);
  try {
    const user = await knexInstance('users')
      .where({ id: userId })
      .select('diamond_locks_balance')
      .first();
    return user ? user.diamond_locks_balance : 0; // Default to 0 if user not found or balance is null
  } catch (error) {
    logger.error(`[DB] Error fetching diamond_locks_balance for user ${userId}:`, error);
    return 0; // Default to 0 on error
  }
}

async function getMarketListings(options = {}) {
  const {
    page = 1,
    pageSize = 10, // Default page size
    min_price,
    max_price,
    seller_user_id,
    seller_bot_username, // For lookup before calling this, or handle join here
    // world_name_search, // Future
  } = options;

  logger.debug('[DB] getMarketListings called with options:', options);

  try {
    const query = knexInstance('market_listings as ml')
      .leftJoin('locked_worlds as lw', 'ml.locked_world_id', 'lw.id')
      .leftJoin('users as u', 'ml.seller_user_id', 'u.id')
      .select(
        'ml.id as listing_id',
        'lw.world_name',
        'ml.price_dl',
        'u.bot_username as seller_bot_username',
        'u.username as seller_discord_tag', // Fallback or additional info
        'ml.listing_note',
        'lw.note as locked_world_note',
        'lw.lock_type',
        'ml.listed_on_date'
      );

    const countQuery = knexInstance('market_listings as ml')
      .leftJoin('users as u', 'ml.seller_user_id', 'u.id'); // Join for seller_bot_username filter

    if (min_price !== undefined && min_price !== null) {
      query.andWhere('ml.price_dl', '>=', min_price);
      countQuery.andWhere('ml.price_dl', '>=', min_price);
    }
    if (max_price !== undefined && max_price !== null) {
      query.andWhere('ml.price_dl', '<=', max_price);
      countQuery.andWhere('ml.price_dl', '<=', max_price);
    }
    if (seller_user_id) {
      query.andWhere('ml.seller_user_id', seller_user_id);
      countQuery.andWhere('ml.seller_user_id', seller_user_id);
    }
    if (seller_bot_username) {
      // This assumes seller_bot_username is unique or we accept multiple users if not.
      // For exact match, ensure bot_username is handled case insensitively if desired.
      query.andWhereRaw('LOWER(u.bot_username) = LOWER(?)', [seller_bot_username]);
      countQuery.andWhereRaw('LOWER(u.bot_username) = LOWER(?)', [seller_bot_username]);
    }
    // Add other filters like world_name_search here if implemented

    // Get total count
    const totalResult = await countQuery.count({ total: '*' }).first();
    const total = totalResult ? Number(totalResult.total) : 0;

    // Get paginated results
    query
      .orderBy('ml.listed_on_date', 'desc') // Default sort: newest first
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const listings = await query;

    // Post-process seller_bot_username to use seller_discord_tag if bot_username is null
    const processedListings = listings.map(listing => ({
        ...listing,
        seller_display_name: listing.seller_bot_username || listing.seller_discord_tag || 'Unknown Seller'
    }));


    logger.debug(`[DB] getMarketListings fetched ${processedListings.length} listings, total count ${total}`);
    return { listings: processedListings, total };

  } catch (error) {
    logger.error('[DB] Error fetching market listings:', error);
    return { listings: [], total: 0 };
  }
}

async function cancelMarketListing(listingId, sellerUserId) {
  logger.info(`[DB] User ${sellerUserId} attempting to cancel market listing ID ${listingId}.`);
  try {
    const deletedCount = await knexInstance('market_listings')
      .where({
        id: listingId,
        seller_user_id: sellerUserId,
      })
      .del();

    if (deletedCount > 0) {
      logger.info(`[DB] Market listing ID ${listingId} cancelled successfully by user ${sellerUserId}.`);
      return { success: true };
    } else {
      logger.warn(`[DB] Market listing ID ${listingId} not found or not owned by user ${sellerUserId}. No rows deleted.`);
      // Check if listing exists at all to differentiate "not found" vs "not owner"
      const listingExists = await knexInstance('market_listings').where({ id: listingId }).first();
      if (!listingExists) {
          return { success: false, error: 'not_found' };
      }
      return { success: false, error: 'not_owner' };
    }
  } catch (error) {
    logger.error(`[DB] Error cancelling market listing ID ${listingId} for user ${sellerUserId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function updateMarketListingPrice(listingId, sellerUserId, newPrice) {
  logger.info(`[DB] User ${sellerUserId} attempting to update price for listing ID ${listingId} to ${newPrice} DLs.`);

  if (typeof newPrice !== 'number' || newPrice <= 0 || !Number.isInteger(newPrice)) {
    logger.warn(`[DB] Invalid price provided for update: ${newPrice}`);
    return { success: false, error: 'invalid_price' };
  }

  try {
    const updatedCount = await knexInstance('market_listings')
      .where({
        id: listingId,
        seller_user_id: sellerUserId,
      })
      .update({
        price_dl: newPrice,
        // Potentially update listed_on_date here if desired, e.g., listed_on_date: knexInstance.fn.now()
      });

    if (updatedCount > 0) {
      logger.info(`[DB] Price for market listing ID ${listingId} updated successfully to ${newPrice} DLs by user ${sellerUserId}.`);
      return { success: true };
    } else {
      logger.warn(`[DB] Market listing ID ${listingId} not found or not owned by user ${sellerUserId} for price update. No rows updated.`);
      const listingExists = await knexInstance('market_listings').where({ id: listingId }).first();
      if (!listingExists) {
          return { success: false, error: 'not_found' };
      }
      return { success: false, error: 'not_owner' };
    }
  } catch (error) {
    logger.error(`[DB] Error updating price for market listing ID ${listingId} by user ${sellerUserId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function getMarketListingById(listingId) {
  logger.debug(`[DB] Fetching market listing by ID: ${listingId}`);
  try {
    const listing = await knexInstance('market_listings as ml')
      .leftJoin('locked_worlds as lw', 'ml.locked_world_id', 'lw.id')
      .leftJoin('users as u', 'ml.seller_user_id', 'u.id')
      .where('ml.id', listingId)
      .select(
        'ml.id as listing_id',
        'ml.seller_user_id',
        'ml.locked_world_id', // This is lw.id essentially
        'ml.price_dl',
        'ml.listing_note',
        'ml.listed_on_date',
        'lw.world_name',
        'lw.lock_type',
        'u.bot_username as seller_bot_username',
        'u.username as seller_discord_tag' // Original Discord tag of seller
      )
      .first();

    if (listing) {
        // For consistency with getMarketListings display name logic
        listing.seller_display_name = listing.seller_bot_username || listing.seller_discord_tag || 'Unknown Seller';
    }
    return listing || null;
  } catch (error) {
    logger.error(`[DB] Error fetching market listing by ID ${listingId}:`, error);
    return null;
  }
}

// Renamed from addLockedWorld for clarity, and adapted for transfer.
// oldUserId is used for verification if needed, but transaction implies seller owns it.
async function transferLockedWorld(lockedWorldId, newUserId, oldUserId, buyerUsername, sellerUsername, trx) {
  logger.info(`[DB] Transferring locked world ID ${lockedWorldId} from user ${oldUserId} to ${newUserId} (Buyer: ${buyerUsername}, Seller: ${sellerUsername})`);
  try {
    const worldToTransfer = await (trx || knexInstance)('locked_worlds').where({ id: lockedWorldId, user_id: oldUserId }).first();
    if (!worldToTransfer) {
        logger.warn(`[DB] transferLockedWorld: World ID ${lockedWorldId} not found or not owned by seller ${oldUserId}.`);
        return false; // World not found or not owned by seller
    }

    const updatedCount = await (trx || knexInstance)('locked_worlds')
      .where({ id: lockedWorldId, user_id: oldUserId }) // Ensure it's still owned by seller
      .update({
        user_id: newUserId,
        note: `Purchased from ${sellerUsername || oldUserId} by ${buyerUsername || newUserId}. Original note: ${worldToTransfer.note || ''}`.substring(0, 255), // Max length for notes
        locked_on_date: knexInstance.fn.now(), // Reset locked_on_date for new owner
        // world_name, lock_type remain the same
      });
    return updatedCount > 0;
  } catch (error) {
    logger.error(`[DB] Error transferring locked world ID ${lockedWorldId}:`, error);
    throw error; // Re-throw to be caught by transaction
  }
}

async function processMarketPurchase(buyerUserId, sellerUserId, listingId, lockedWorldId, priceDl, buyerUsername, sellerUsername, worldName) {
  logger.info(`[DB] Processing market purchase: Buyer ${buyerUserId} (${buyerUsername}), Seller ${sellerUserId} (${sellerUsername}), Listing ${listingId}, World ${lockedWorldId} (${worldName}), Price ${priceDl} DLs`);

  return knexInstance.transaction(async (trx) => {
    try {
      // 1. Verify and decrement buyer's balance
      const buyer = await trx('users').where({ id: buyerUserId }).select('diamond_locks_balance').firstForUpdate(); // Lock row
      if (!buyer || buyer.diamond_locks_balance < priceDl) {
        logger.warn(`[DB] Purchase failed: Buyer ${buyerUserId} has insufficient funds (${buyer ? buyer.diamond_locks_balance : 'N/A'}) for price ${priceDl}.`);
        throw new Error('insufficient_funds');
      }
      await trx('users').where({ id: buyerUserId }).decrement('diamond_locks_balance', priceDl);
      logger.info(`[DB] Decremented ${priceDl} DLs from buyer ${buyerUserId}.`);

      // 2. Increment seller's balance
      await trx('users').where({ id: sellerUserId }).increment('diamond_locks_balance', priceDl);
      logger.info(`[DB] Incremented ${priceDl} DLs to seller ${sellerUserId}.`);

      // 3. Transfer locked world ownership
      const transferred = await transferLockedWorld(lockedWorldId, buyerUserId, sellerUserId, buyerUsername, sellerUsername, trx);
      if (!transferred) {
        logger.error(`[DB] Purchase failed: World transfer failed for locked_world_id ${lockedWorldId}.`);
        throw new Error('world_transfer_failed');
      }
      logger.info(`[DB] Transferred locked_world_id ${lockedWorldId} to buyer ${buyerUserId}.`);

      // 4. Delete the market listing
      const deletedListingCount = await trx('market_listings').where({ id: listingId }).del();
      if (deletedListingCount === 0) {
        logger.warn(`[DB] Purchase issue: Listing ID ${listingId} not found during deletion (อาจถูกซื้อไปแล้วหรือถูกยกเลิก).`);
        throw new Error('listing_not_found_during_delete'); // Listing vanished mid-transaction
      }
      logger.info(`[DB] Deleted market listing ID ${listingId}.`);

      return { success: true, worldName: worldName };

    } catch (error) {
      logger.error(`[DB] Market purchase transaction failed for listing ${listingId}:`, error.message);
      // Convert specific errors or re-throw
      if (error.message === 'insufficient_funds' ||
          error.message === 'world_transfer_failed' ||
          error.message === 'listing_not_found_during_delete') {
        // These are custom errors thrown above that we want to propagate with a specific code
        // For Knex transaction, throwing an error automatically rolls back.
        // The return { success: false, error: error.message } will be handled by the calling command.
         throw error; // Let it be caught by the final catch block of this function
      }
      throw new Error('db_error'); // Generic DB error for other issues
    }
  })
  .then(result => result) // If transaction succeeds
  .catch(err => { // If transaction fails (rollback)
    logger.error(`[DB] Transaction explicitly rolled back or failed for purchase of listing ${listingId}: ${err.message}`);
    return { success: false, error: err.message || 'db_error' };
  });
}

async function removeTeamMember(teamId, memberUserIdToRemove, currentOwnerUserId) {
  logger.info(`[DB] Owner ${currentOwnerUserId} attempting to remove member ${memberUserIdToRemove} from team ${teamId}`);
  try {
    const team = await knexInstance('teams').where({ id: teamId }).first();
    if (!team) return { success: false, error: 'team_not_found' };
    if (team.owner_user_id !== currentOwnerUserId) return { success: false, error: 'not_owner' };
    if (memberUserIdToRemove === currentOwnerUserId) return { success: false, error: 'cannot_kick_self' };

    const memberExists = await knexInstance('team_members').where({ team_id: teamId, user_id: memberUserIdToRemove }).first();
    if (!memberExists) return { success: false, error: 'member_not_found' };

    const deletedCount = await knexInstance('team_members')
      .where({ team_id: teamId, user_id: memberUserIdToRemove })
      .del();

    return deletedCount > 0 ? { success: true } : { success: false, error: 'db_error' }; // Should be >0 if memberExists
  } catch (error) {
    logger.error(`[DB] Error removing team member ${memberUserIdToRemove} from team ${teamId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function transferTeamOwnership(teamId, currentOwnerUserId, newOwnerUserId) {
  logger.info(`[DB] Owner ${currentOwnerUserId} attempting to transfer ownership of team ${teamId} to ${newOwnerUserId}`);
  try {
    const team = await knexInstance('teams').where({ id: teamId }).first();
    if (!team) return { success: false, error: 'team_not_found' };
    if (team.owner_user_id !== currentOwnerUserId) return { success: false, error: 'not_owner' };
    if (newOwnerUserId === currentOwnerUserId) return { success: false, error: 'cannot_transfer_to_self' };

    const newOwnerIsMember = await knexInstance('team_members')
      .where({ team_id: teamId, user_id: newOwnerUserId })
      .first();
    if (!newOwnerIsMember) return { success: false, error: 'new_owner_not_member' };

    await knexInstance('teams')
      .where({ id: teamId })
      .update({ owner_user_id: newOwnerUserId });

    return { success: true };
  } catch (error) {
    logger.error(`[DB] Error transferring ownership of team ${teamId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function disbandTeam(teamId, currentOwnerUserId) {
  logger.info(`[DB] Owner ${currentOwnerUserId} attempting to disband team ${teamId}`);
  return knexInstance.transaction(async (trx) => {
    try {
      const team = await trx('teams').where({ id: teamId }).first();
      if (!team) throw new Error('team_not_found');
      if (team.owner_user_id !== currentOwnerUserId) throw new Error('not_owner');

      // Cascading deletes are defined in schema, but explicit deletion is safer for clarity
      // and ensures order if cascading isn't fully trusted or if specific logging per step is needed.
      // However, for this implementation, we'll rely on schema's onDelete('CASCADE') for members, invites, worlds.
      // If not using CASCADE, delete in this order:
      // await trx('team_worlds').where({ team_id: teamId }).del();
      // await trx('team_invitations').where({ team_id: teamId }).del();
      // await trx('team_members').where({ team_id: teamId }).del();

      // The 'teams' table deletion will trigger cascades for team_members, team_invitations, team_worlds
      // if foreign keys are set up with ON DELETE CASCADE.
      // The migration file does specify ON DELETE CASCADE for these.
      const deletedTeamCount = await trx('teams').where({ id: teamId }).del();
      if (deletedTeamCount === 0) throw new Error('team_not_found_during_delete'); // Should not happen if first check passed

      return { success: true };
    } catch (error) {
      logger.error(`[DB] Error in disbandTeam transaction for team ${teamId}:`, error);
      if (error.message === 'not_owner' || error.message === 'team_not_found' || error.message === 'team_not_found_during_delete') {
        throw error; // Propagate specific errors
      }
      throw new Error('db_error');
    }
  })
  .then(result => result)
  .catch(err => {
    logger.error(`[DB] disbandTeam final catch for team ${teamId}: ${err.message}`);
    return { success: false, error: err.message || 'db_error' };
  });
}

// --- Team Database Functions ---

async function getTeamByName(teamName) {
  try {
    const team = await knexInstance('teams')
      .whereRaw('LOWER(name) = LOWER(?)', [teamName])
      .first();
    return team || null;
  } catch (error) {
    logger.error(`[DB] Error getting team by name ${teamName}:`, error);
    return null;
  }
}

async function isUserInAnyTeam(userId) {
  try {
    const member = await knexInstance('team_members').where({ user_id: userId }).first();
    return !!member;
  } catch (error) {
    logger.error(`[DB] Error checking if user ${userId} is in any team:`, error);
    return false; // Default to false on error
  }
}

async function getUserTeam(userId) {
  try {
    const teamMembership = await knexInstance('team_members as tm')
      .join('teams as t', 'tm.team_id', 't.id')
      .where('tm.user_id', userId)
      .select('t.*') // Select all columns from the 'teams' table
      .first();
    return teamMembership || null;
  } catch (error) {
    logger.error(`[DB] Error fetching user's team for ${userId}:`, error);
    return null;
  }
}

async function generateTeamInvitationCode(teamId, creatorUserId, trx = null) {
  const dbInstance = trx || knexInstance;
  let code;
  let isUnique = false;
  const MAX_TRIES = 5; // Prevent infinite loop in rare cases
  let tries = 0;

  while (!isUnique && tries < MAX_TRIES) {
    code = Math.random().toString(36).substring(2, 10).toUpperCase(); // 8 char alphanumeric
    const existing = await dbInstance('team_invitations').where({ code }).first();
    if (!existing) {
      isUnique = true;
    }
    tries++;
  }

  if (!isUnique) {
    // Fallback or error if unique code couldn't be generated
    logger.error(`[DB] Could not generate a unique invitation code for team ${teamId} after ${MAX_TRIES} tries.`);
    // throw new Error('failed_to_generate_unique_code'); // Or use a timestamp based one as fallback
    code = `FALLBACK${Date.now()}`.substring(0,10); // Highly unlikely to collide but not ideal
  }

  await dbInstance('team_invitations').insert({
    team_id: teamId,
    code: code,
    created_by_user_id: creatorUserId,
  });
  return code;
}

async function createTeam(teamName, ownerUserId) {
  logger.info(`[DB] Attempting to create team "${teamName}" by user ${ownerUserId}`);
  const existingTeamByName = await getTeamByName(teamName);
  if (existingTeamByName) {
    return { success: false, error: 'name_taken' };
  }

  // Check if user is already in a team (should ideally be checked by command logic first)
  const userAlreadyInTeam = await isUserInAnyTeam(ownerUserId);
  if (userAlreadyInTeam) {
      // This case should ideally be prevented by command logic calling getUserTeam first.
      logger.warn(`[DB] User ${ownerUserId} attempted to create team "${teamName}" but is already in a team.`);
      return { success: false, error: 'already_in_team' };
  }

  return knexInstance.transaction(async (trx) => {
    try {
      const [teamIdObj] = await trx('teams').insert({
        name: teamName,
        owner_user_id: ownerUserId,
      }).returning('id');

      const teamId = (typeof teamIdObj === 'object') ? teamIdObj.id : teamIdObj;


      if (!teamId) { // Fallback for SQLite if returning('id') is problematic
          const teamQuery = await trx('teams').where({name: teamName, owner_user_id: ownerUserId}).first();
          if (!teamQuery || !teamQuery.id) {
            logger.error(`[DB] Failed to retrieve teamId after insert for team ${teamName}`);
            throw new Error('Team ID retrieval failed post-insert.');
          }
          // teamId = teamQuery.id; // This line is problematic if teamId is const above
          const newTeamId = teamQuery.id;
          logger.warn(`[DB] createTeam used fallback for teamId retrieval for team ${teamName}, got ${newTeamId}`);

          await trx('team_members').insert({
            team_id: newTeamId,
            user_id: ownerUserId,
          });
          const initialInviteCode = await generateTeamInvitationCode(newTeamId, ownerUserId, trx);
          return { success: true, teamId: newTeamId, initialInviteCode };
      } else {
          await trx('team_members').insert({
            team_id: teamId,
            user_id: ownerUserId,
          });
           const initialInviteCode = await generateTeamInvitationCode(teamId, ownerUserId, trx);
           return { success: true, teamId, initialInviteCode };
      }

    } catch (error) {
      logger.error(`[DB] Error in createTeam transaction for "${teamName}":`, error);
      if (error.message.includes('UNIQUE constraint failed: teams.name')) { // More specific check
          throw new Error('name_taken'); // Re-throw to be caught by outer catch
      }
      throw error; // Re-throw other errors
    }
  })
  .then(result => result)
  .catch(err => {
    logger.error(`[DB] createTeam final catch for "${teamName}": ${err.message}`);
    return { success: false, error: err.message === 'name_taken' ? 'name_taken' : 'db_error' };
  });
}

async function validateAndUseTeamInvitation(teamName, invitationCode, joiningUserId) {
  logger.info(`[DB] User ${joiningUserId} attempting to join team "${teamName}" with code "${invitationCode}"`);

  // User should not be in any team already (this check is also in command logic)
  const userCurrentTeam = await getUserTeam(joiningUserId);
  if (userCurrentTeam) {
      return { success: false, error: 'already_in_team', teamName: userCurrentTeam.name };
  }

  return knexInstance.transaction(async (trx) => {
    try {
      const team = await trx('teams').whereRaw('LOWER(name) = LOWER(?)', [teamName]).first();
      if (!team) {
        throw new Error('invalid_code_or_team');
      }

      const invitation = await trx('team_invitations')
        .where({ team_id: team.id, code: invitationCode })
        .first();

      if (!invitation) {
        throw new Error('invalid_code_or_team');
      }
      if (invitation.used_at) {
        throw new Error('invitation_already_used');
      }

      // Add user to team_members
      await trx('team_members').insert({
        team_id: team.id,
        user_id: joiningUserId,
      });

      // Mark invitation as used
      await trx('team_invitations')
        .where({ id: invitation.id })
        .update({
          used_at: knexInstance.fn.now(),
          used_by_user_id: joiningUserId,
        });

      logger.info(`[DB] User ${joiningUserId} successfully joined team ${team.name} (ID: ${team.id}) using code ${invitationCode}`);
      return { success: true, teamName: team.name, teamId: team.id };

    } catch (error) {
      logger.error(`[DB] Error in validateAndUseTeamInvitation for team "${teamName}", code "${invitationCode}":`, error);
      if (['invalid_code_or_team', 'invitation_already_used', 'already_in_team'].includes(error.message)) {
        throw error; // Re-throw specific known errors
      }
      throw new Error('db_error'); // General DB error
    }
  })
  .then(result => result)
  .catch(err => {
    logger.error(`[DB] validateAndUseTeamInvitation final catch for "${teamName}", code "${invitationCode}": ${err.message}`);
    return { success: false, error: err.message || 'db_error' };
  });
}


async function getTeamWorlds(teamId, page = 1, pageSize = 10, filters = {}) {
  logger.debug(`[DB] Fetching worlds for team ID ${teamId}, page ${page}, filters:`, filters);
  try {
    const query = knexInstance('team_worlds as tw')
      .leftJoin('users as u', 'tw.added_by_user_id', 'u.id')
      .where('tw.team_id', teamId)
      .select(
        'tw.id as team_world_id',
        'tw.world_name',
        'tw.expiry_date',
        'tw.note',
        'tw.added_by_user_id',
        'tw.added_date',
        'u.username as added_by_discord_tag',
        'u.bot_username as added_by_bot_username',
        // Calculate days_left: JULIANDAY(tw.expiry_date) - JULIANDAY('now')
        knexInstance.raw("CAST(JULIANDAY(tw.expiry_date) - JULIANDAY('now') AS INTEGER) as days_left")
      );

    const countQuery = knexInstance('team_worlds').where({ team_id: teamId });

    if (filters.added_by_user_id) {
      query.andWhere('tw.added_by_user_id', filters.added_by_user_id);
      countQuery.andWhere('tw.added_by_user_id', filters.added_by_user_id);
    }
    // TODO: searchTerm filter if needed: .andWhere(builder => builder.whereRaw('LOWER(tw.world_name) LIKE ?', [`%${filters.searchTerm.toLowerCase()}%`]).orWhereRaw('LOWER(tw.note) LIKE ?', [`%${filters.searchTerm.toLowerCase()}%`]))


    const totalResult = await countQuery.count({ total: '*' }).first();
    const total = totalResult ? Number(totalResult.total) : 0;

    query.orderBy('days_left', 'asc') // Expiring soonest first
         .limit(pageSize)
         .offset((page - 1) * pageSize);

    const worlds = await query;
    const processedWorlds = worlds.map(w => ({
        ...w,
        added_by_display_name: w.added_by_bot_username || w.added_by_discord_tag || 'Unknown'
    }));

    return { worlds: processedWorlds, total };
  } catch (error) {
    logger.error(`[DB] Error fetching worlds for team ID ${teamId}:`, error);
    return { worlds: [], total: 0 };
  }
}

async function addWorldToTeam(teamId, worldName, daysOwned, note, addedByUserId) {
  logger.info(`[DB] User ${addedByUserId} adding world "${worldName}" to team ID ${teamId}`);
  if (daysOwned < 1 || daysOwned > 180) {
    return { success: false, error: 'invalid_days' };
  }
  const worldNameUpper = worldName.toUpperCase();

  try {
    const existing = await knexInstance('team_worlds')
      .where({ team_id: teamId, world_name: worldNameUpper })
      .first();
    if (existing) {
      return { success: false, error: 'already_exists' };
    }

    const now = new Date();
    const expiryDate = new Date(now.getTime() + (180 - daysOwned) * 24 * 60 * 60 * 1000);
    const expiryDateISO = expiryDate.toISOString();

    await knexInstance('team_worlds').insert({
      team_id: teamId,
      world_name: worldNameUpper,
      days_owned: daysOwned,
      expiry_date: expiryDateISO,
      note: note,
      added_by_user_id: addedByUserId,
    });
    return { success: true };
  } catch (error) {
    logger.error(`[DB] Error adding world "${worldName}" to team ID ${teamId}:`, error);
    if (error.message && error.message.includes('UNIQUE constraint failed: team_worlds.team_id, team_worlds.world_name')) {
        return { success: false, error: 'already_exists' }; // Should be caught by explicit check above
    }
    return { success: false, error: 'db_error' };
  }
}

async function removeWorldFromTeam(teamId, worldName, removerUserId) {
    logger.info(`[DB] User ${removerUserId} attempting to remove world "${worldName}" from team ID ${teamId}`);
    const worldNameUpper = worldName.toUpperCase();
    try {
        const team = await knexInstance('teams').where({ id: teamId }).first();
        if (!team) {
            return { success: false, error: 'team_not_found' }; // Should not happen if command logic is correct
        }
        const teamOwnerId = team.owner_user_id;

        const worldEntry = await knexInstance('team_worlds')
            .where({ team_id: teamId, world_name: worldNameUpper })
            .first();

        if (!worldEntry) {
            return { success: false, error: 'not_found' };
        }

        if (removerUserId !== teamOwnerId && removerUserId !== worldEntry.added_by_user_id) {
            return { success: false, error: 'permission_denied' };
        }

        const deletedCount = await knexInstance('team_worlds')
            .where({ id: worldEntry.id }) // Delete by primary key for safety
            .del();

        return deletedCount > 0 ? { success: true } : { success: false, error: 'db_error' }; // Should be >0 if entry found
    } catch (error) {
        logger.error(`[DB] Error removing world "${worldName}" from team ID ${teamId}:`, error);
        return { success: false, error: 'db_error' };
    }
}

async function getAllFilteredWorlds(userId, filters = {}) {
    logger.debug(`[DB] getAllFilteredWorlds called - User: ${userId}, Filters: ${JSON.stringify(filters)}`);
    try {
        let query = knexInstance('worlds as w')
            .leftJoin('users as u', 'w.user_id', 'u.id')
            .select('w.*', 'u.username as added_by_tag');

        // Handle Private vs. Public Context
        if (filters.guildId) {
            // Public worlds for a specific guild
            query.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
        } else if (userId) {
            // Private worlds for a specific user
            query.where('w.user_id', userId)
                 .andWhere(function() {
                     this.where('w.is_public', false).orWhereNull('w.is_public');
                 });
        } else {
            logger.warn('[DB] getAllFilteredWorlds called without userId (for private) or guildId (for public). Returning empty array.');
            return [];
        }

        // Prefix filter
        if (filters.prefix) {
            const prefixLower = filters.prefix.toLowerCase();
            query.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
        }

        // LockType filter
        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query.andWhere('w.lock_type', filters.lockType);
        }
        
        // ExpiryDay filter (day of week)
        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
            }
        }

        // Days Owned filter
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
        
        // Name Length Filters
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

        // Ordering
        query.orderBy('w.expiry_date', 'asc');
        
        const worlds = await query;
        const formattedWorlds = worlds.map(w => ({ ...w, is_public: !!w.is_public })); 

        logger.debug(`[DB] getAllFilteredWorlds returning ${formattedWorlds.length} worlds`);
        return formattedWorlds;

    } catch (error) {
        logger.error(`[DB] Error in getAllFilteredWorlds (User: ${userId}, Filters: ${JSON.stringify(filters)}):`, error);
        return []; // Return empty array on error
    }
}

async function getTeamDetails(teamId) {
    logger.debug(`[DB] Fetching details for team ID ${teamId}`);
    try {
        const teamInfo = await knexInstance('teams as t')
            .leftJoin('users as owner_user', 't.owner_user_id', 'owner_user.id')
            .where('t.id', teamId)
            .select(
                't.id',
                't.name',
                't.owner_user_id',
                't.creation_date',
                'owner_user.username as owner_discord_tag',
                'owner_user.bot_username as owner_bot_username'
            )
            .first();

        if (!teamInfo) return null;
        teamInfo.owner_display_name = teamInfo.owner_bot_username || teamInfo.owner_discord_tag || 'Unknown Owner';


        const members = await knexInstance('team_members as tm')
            .join('users as u', 'tm.user_id', 'u.id')
            .where('tm.team_id', teamId)
            .select('u.id', 'u.username as discord_tag', 'u.bot_username', 'tm.join_date')
            .orderBy('tm.join_date', 'asc');

        const processedMembers = members.map(m => ({
            ...m,
            display_name: m.bot_username || m.discord_tag || 'Unknown Member'
        }));

        const worldCountResult = await knexInstance('team_worlds')
            .where({ team_id: teamId })
            .count({ total: '*' })
            .first();
        const totalWorlds = worldCountResult ? Number(worldCountResult.total) : 0;

        return { ...teamInfo, members: processedMembers, totalWorlds };
    } catch (error) {
        logger.error(`[DB] Error fetching details for team ID ${teamId}:`, error);
        return null;
    }
}

async function leaveTeam(userId, teamId) {
    logger.info(`[DB] User ${userId} attempting to leave team ID ${teamId}`);
    try {
        const team = await knexInstance('teams').where({ id: teamId }).first();
        if (!team) return { success: false, error: 'team_not_found' };
        if (team.owner_user_id === userId) {
            return { success: false, error: 'is_owner' };
        }

        const deletedCount = await knexInstance('team_members')
            .where({ team_id: teamId, user_id: userId })
            .del();

        return deletedCount > 0 ? { success: true, teamName: team.name } : { success: false, error: 'not_member' };
    } catch (error) {
        logger.error(`[DB] Error user ${userId} leaving team ID ${teamId}:`, error);
        return { success: false, error: 'db_error' };
    }
}


// --- End Team Database Functions ---


// --- User Direct Messaging Functions ---

async function getUserForNotification(userId) { // Simplified version of getUser for this specific need
  try {
    const user = await knexInstance('users')
      .where({ id: userId })
      .select('id', 'username', 'bot_username', 'notify_on_new_message')
      .first();
    return user || null;
  } catch (error) {
    logger.error(`[DB] Error getting user ${userId} for notification settings:`, error);
    return null;
  }
}

async function sendMessage(senderUserId, recipientUserId, content, parentMessageId = null) {
  logger.info(`[DB] Sending message from ${senderUserId} to ${recipientUserId}. Parent: ${parentMessageId}`);
  try {
    const [messageIdObj] = await knexInstance('direct_messages').insert({
      sender_user_id: senderUserId,
      recipient_user_id: recipientUserId,
      message_content: content,
      parent_message_id: parentMessageId,
      // sent_at and is_read have defaults
    }).returning('id');

    const messageId = (typeof messageIdObj === 'object') ? messageIdObj.id : messageIdObj;

    if (messageId) {
      return { success: true, messageId };
    }
    // Fallback for SQLite if .returning('id') is not fully reliable without specific driver config
    // though knex generally handles this for auto-increment PKs.
    const result = await knexInstance.raw('SELECT last_insert_rowid() as id');
    if (result && result[0] && result[0].id) {
        logger.warn(`[DB] sendMessage: Used last_insert_rowid() for message ID for user ${senderUserId}`);
        return { success: true, messageId: result[0].id };
    }

    logger.error('[DB] sendMessage: Failed to obtain message ID after insert.');
    return { success: false, error: 'id_retrieval_failed' };

  } catch (error) {
    logger.error(`[DB] Error sending direct message from ${senderUserId} to ${recipientUserId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

async function getReceivedMessages(userId, options = {}) {
  const { page = 1, pageSize = 10, unreadOnly = false } = options;
  logger.debug(`[DB] Getting received messages for user ${userId}, page ${page}, unreadOnly: ${unreadOnly}`);
  try {
    const query = knexInstance('direct_messages as dm')
      .leftJoin('users as sender', 'dm.sender_user_id', 'sender.id')
      .where('dm.recipient_user_id', userId)
      .select(
        'dm.id',
        'dm.message_content',
        'dm.sent_at',
        'dm.is_read',
        'dm.parent_message_id',
        'sender.username as sender_discord_tag',
        'sender.bot_username as sender_bot_username'
      )
      .orderBy('dm.sent_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    if (unreadOnly) {
      query.andWhere('dm.is_read', false);
    }

    const messages = await query;

    const countQuery = knexInstance('direct_messages').where({ recipient_user_id: userId });
    if (unreadOnly) {
      countQuery.andWhere('is_read', false);
    }
    const totalResult = await countQuery.count({ total: '*' }).first();
    const total = totalResult ? Number(totalResult.total) : 0;

    const processedMessages = messages.map(msg => ({
        ...msg,
        sender_display_name: msg.sender_bot_username || msg.sender_discord_tag || 'Unknown Sender'
    }));

    return { messages: processedMessages, total };
  } catch (error) {
    logger.error(`[DB] Error getting received messages for user ${userId}:`, error);
    return { messages: [], total: 0 };
  }
}

async function getMessageById(messageId, recipientUserId) {
  logger.debug(`[DB] Getting message ID ${messageId} for recipient ${recipientUserId}`);
  try {
    const message = await knexInstance('direct_messages as dm')
      .leftJoin('users as sender', 'dm.sender_user_id', 'sender.id')
      .where('dm.id', messageId)
      .andWhere('dm.recipient_user_id', recipientUserId) // Security: user can only fetch their own received messages by ID
      .select(
        'dm.*',
        'sender.username as sender_discord_tag',
        'sender.bot_username as sender_bot_username'
      )
      .first();
    if (message) {
        message.sender_display_name = message.sender_bot_username || message.sender_discord_tag || 'Unknown Sender';
    }
    return message || null;
  } catch (error) {
    logger.error(`[DB] Error getting message ID ${messageId}:`, error);
    return null;
  }
}

async function markMessageAsRead(messageId, recipientUserId) {
  logger.info(`[DB] Marking message ID ${messageId} as read for recipient ${recipientUserId}`);
  try {
    const updatedCount = await knexInstance('direct_messages')
      .where({ id: messageId, recipient_user_id: recipientUserId })
      .update({ is_read: true });
    return updatedCount > 0;
  } catch (error) {
    logger.error(`[DB] Error marking message ID ${messageId} as read:`, error);
    return false;
  }
}
async function markMessageAsUnread(messageId, recipientUserId) {
  logger.info(`[DB] Marking message ID ${messageId} as unread for recipient ${recipientUserId}`);
  try {
    const updatedCount = await knexInstance('direct_messages')
      .where({ id: messageId, recipient_user_id: recipientUserId })
      .update({ is_read: false });
    return updatedCount > 0;
  } catch (error) {
    logger.error(`[DB] Error marking message ID ${messageId} as unread:`, error);
    return false;
  }
}

async function deleteMessage(messageId, userId) {
  // User can delete messages they received or messages they sent.
  logger.info(`[DB] User ${userId} attempting to delete message ID ${messageId}`);
  try {
    // Check if user is recipient
    const message = await knexInstance('direct_messages').where({ id: messageId }).first();
    if (!message) return { success: false, error: 'not_found' };

    if (message.recipient_user_id !== userId && message.sender_user_id !== userId) {
        return { success: false, error: 'not_owner' }; // Not sender or recipient
    }

    // If user is recipient, they can delete it.
    // If user is sender, they can also delete it (optional: implement different logic if sender deletion is not allowed or should 'hide' it)
    // Current logic: if user is involved as sender or recipient, they can delete.
    // For simplicity, this example allows deletion if user is the recipient.
    // To allow sender to delete, the condition would be:
    // .where({ id: messageId }).andWhere(function() { this.where('recipient_user_id', userId).orWhere('sender_user_id', userId)})

    const deletedCount = await knexInstance('direct_messages')
      .where({ id: messageId, recipient_user_id: userId }) // Only recipient can delete for now
      .del();

    if (deletedCount > 0) {
      return { success: true };
    }
    // If not deleted because not recipient (and sender deletion not implemented this way)
    if (message.recipient_user_id !== userId) {
         return { success: false, error: 'not_recipient_for_delete' };
    }
    return { success: false, error: 'not_found_or_already_deleted' }; // Or generic db_error

  } catch (error) {
    logger.error(`[DB] Error deleting message ID ${messageId} by user ${userId}:`, error);
    return { success: false, error: 'db_error' };
  }
}

// --- End User Direct Messaging Functions ---


// --- End Marketplace Functions ---

// --- End Bot Profile Functions ---

async function addWorld(userId, worldName, daysOwned, lockType = 'mainlock', customId = null, username = null, guildId = null) {
    const worldNameUpper = worldName.toUpperCase();
    const normalizedLockType = String(lockType).toLowerCase() === 'o' || String(lockType).toLowerCase() === 'outlock' ? 'outlock' : 'mainlock';
    let normalizedCustomId = customId ? String(customId).trim().toUpperCase() : null;
    const publicStatus = false;
    const daysOwnedNum = Math.max(1, Math.min(parseInt(daysOwned, 10) || 1, 180));
    if (worldNameUpper.includes(' ')) { return { success: false, message: 'World names cannot contain spaces.' }; }
    if (normalizedCustomId === '') { normalizedCustomId = null; }
    const now = new Date(); const daysLeft = 180 - daysOwnedNum; const expiryDate = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000); const expiryDateISO = expiryDate.toISOString();
    try {
        await knexInstance('worlds').insert({ name: worldNameUpper, days_owned: daysOwnedNum, expiry_date: expiryDateISO, lock_type: normalizedLockType, is_public: publicStatus, user_id: userId, custom_id: normalizedCustomId, added_by: username, guild_id: guildId });
        logger.info(`[DB] Added world ${worldNameUpper} for user ${userId}`);
        return { success: true, message: `**${worldNameUpper}** added.` };
    } catch (error) {
        logger.error(`[DB] Error adding world ${worldNameUpper} for user ${userId}:`, error);
        if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.toLowerCase().includes('unique constraint failed'))) { if (error.message.includes('worlds.uq_worlds_name_user')) { return { success: false, message: `You are already tracking **${worldNameUpper}**.` }; } else if (error.message.includes('worlds.uq_worlds_customid_user') && normalizedCustomId) { return { success: false, message: `Custom ID **${normalizedCustomId}** already in use by you.` }; } }
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

        // Handle Private vs. Public Context
        if (filters.guildId) {
            // Public worlds for a specific guild
            query.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
            countQueryBase.where('w.is_public', true).andWhere('w.guild_id', filters.guildId);
        } else if (userId) {
            // Private worlds for a specific user
            query.where('w.user_id', userId)
                 .andWhere(function() {
                     this.where('w.is_public', false).orWhereNull('w.is_public');
                 });
            countQueryBase.where('w.user_id', userId)
                          .andWhere(function() {
                              this.where('w.is_public', false).orWhereNull('w.is_public');
                          });
        } else {
            // No userId and no guildId signifies an invalid request context.
            logger.warn('[DB] getFilteredWorlds called without userId (for private) or guildId (for public). Returning empty.');
            return { worlds: [], total: 0 };
        }

        // Prefix filter
        if (filters.prefix) {
            const prefixLower = filters.prefix.toLowerCase();
            query.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
            countQueryBase.andWhereRaw('lower(w.name) LIKE ?', [`${prefixLower}%`]);
        }

        // LockType filter
        if (filters.lockType === 'mainlock' || filters.lockType === 'outlock') {
            query.andWhere('w.lock_type', filters.lockType);
            countQueryBase.andWhere('w.lock_type', filters.lockType);
        }
        
        // ExpiryDay filter (day of week)
        if (filters.expiryDay) {
            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayNum = dayMap[filters.expiryDay.toLowerCase()];
            if (dayNum !== undefined) {
                query.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
                countQueryBase.andWhereRaw("strftime('%w', date(w.expiry_date)) = ?", [dayNum.toString()]);
            }
        }

        // Days Owned filter (NEW)
        // This filter is mutually exclusive with expiringDays (which was removed)
        if (filters.daysOwned !== undefined && filters.daysOwned !== null) {
            const daysOwnedInput = parseInt(filters.daysOwned);
            if (!isNaN(daysOwnedInput)) {
                if (daysOwnedInput === 180) { // Worlds that are already expired (or will expire today)
                    const todayEnd = new Date(); // Consider "today" up to its very end for this condition
                    todayEnd.setUTCHours(23, 59, 59, 999);
                    query.andWhere('w.expiry_date', '<=', todayEnd.toISOString());
                    countQueryBase.andWhere('w.expiry_date', '<=', todayEnd.toISOString());
                } else if (daysOwnedInput >= 0 && daysOwnedInput < 180) {
                    // Calculate the exact day for days_left = 180 - daysOwnedInput
                    const targetDaysLeft = 180 - daysOwnedInput;
                    
                    const targetDate = new Date(); // Start with today
                    targetDate.setUTCHours(0,0,0,0); // Start of today UTC
                    targetDate.setUTCDate(targetDate.getUTCDate() + targetDaysLeft); // Add targetDaysLeft

                    const targetStartDateISO = targetDate.toISOString();
                    
                    const targetEndDate = new Date(targetDate);
                    targetEndDate.setUTCDate(targetDate.getUTCDate() + 1); // Start of the next day
                    const targetEndDateISO = targetEndDate.toISOString();

                    query.andWhere('w.expiry_date', '>=', targetStartDateISO)
                         .andWhere('w.expiry_date', '<', targetEndDateISO);
                    countQueryBase.andWhere('w.expiry_date', '>=', targetStartDateISO)
                                  .andWhere('w.expiry_date', '<', targetEndDateISO);
                }
            }
        }
        
        // Count query execution
        const totalResult = await countQueryBase.count({ total: '*' }).first();
        const totalCount = totalResult ? Number(totalResult.total) : 0;

        // Main query execution with pagination and ordering
        query.orderBy('w.expiry_date', 'asc') // Fewer days left = more days owned = higher in sort
             .limit(pageSize)
             .offset((page - 1) * pageSize);
        
        const worlds = await query;
        const formattedWorlds = worlds.map(w => ({ ...w, is_public: !!w.is_public })); // Ensure boolean

        logger.debug(`[DB] getFilteredWorlds returning ${formattedWorlds.length} worlds, total: ${totalCount}`);
        return { worlds: formattedWorlds, total: totalCount };

    } catch (error) {
        logger.error(`[DB] Error in getFilteredWorlds (User: ${userId}, Filters: ${JSON.stringify(filters)}, Page: ${page}):`, error);
        return { worlds: [], total: 0 }; // Consistent return type on error
    }
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
            .select('name', 'expiry_date', 'custom_id'); // Added custom_id

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
  getWorldByCustomId,
  getPublicWorldsByGuild,
  getPublicWorldByName,
  getPublicWorldByCustomId,
  findWorldByIdentifier,
  getFilteredWorlds,
  getAllFilteredWorlds, // Added new function
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
  getAllWorldsByDaysLeft, // NEW: Added function to export

  // Bot Profile Functions
  setBotUsername,
  getBotUsername,
  getUserByBotUsername,
  getUser, // Added
  getUserProfileStats, // Added

  // Marketplace Functions
  getLockedWorldForListing,
  isWorldListed,
  createMarketListing,
  getUserDiamondLocksBalance,
  getMarketListings,
  cancelMarketListing,
  updateMarketListingPrice,
  getMarketListingById,
  processMarketPurchase,
  transferLockedWorld,

  // Team Database Functions
  getTeamByName,
  isUserInAnyTeam,
  createTeam,
  generateTeamInvitationCode,
  validateAndUseTeamInvitation,
  getUserTeam,
  getTeamWorlds,
  addWorldToTeam,
  removeWorldFromTeam,
  getTeamDetails,
  leaveTeam,
  removeTeamMember,
  transferTeamOwnership,
  disbandTeam,

  // User Direct Messaging Functions
  getUserForNotification,
  sendMessage,
  getReceivedMessages,
  getMessageById,
  markMessageAsRead,
  markMessageAsUnread, // Added
  deleteMessage,

  // --- Locked Worlds Functions ---
  addLockedWorld,
  getLockedWorlds,
  removeLockedWorld,
  findLockedWorldByName,
  moveWorldToLocks
};

// --- Locked Worlds Functions Implementation ---

async function addLockedWorld(userId, worldName, lockType = 'main', note = null) {
  const worldNameUpper = worldName.toUpperCase();
  // Normalize lockType: 'main' or 'out'. Default to 'main' if invalid.
  const normalizedLockType = ['main', 'out'].includes(String(lockType).toLowerCase()) ? String(lockType).toLowerCase() : 'main';

  try {
    await knexInstance('locked_worlds').insert({
      user_id: userId,
      world_name: worldNameUpper,
      lock_type: normalizedLockType,
      note: note
    });
    logger.info(`[DB] Added world ${worldNameUpper} to locked_worlds for user ${userId} with lock_type ${normalizedLockType}`);
    return { success: true, message: 'World added to locks.' };
  } catch (error) {
    logger.error(`[DB] Error adding world ${worldNameUpper} to locked_worlds for user ${userId}:`, error);
    if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('UNIQUE constraint failed: locked_worlds.user_id, locked_worlds.world_name')) {
      return { success: false, message: `World ${worldNameUpper} is already in your locked list.` };
    }
    // Check for foreign key constraint if users table is involved, though users table FK was on user_id
    if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('FOREIGN KEY constraint failed')) {
        logger.error(`[DB] Foreign key constraint failed for user ${userId} when adding ${worldNameUpper} to locks. User might not exist.`);
        return { success: false, message: 'Failed to add world to locks due to a user reference error.' };
    }
    return { success: false, message: 'Failed to add world to locks due to a database error.' };
  }
}

async function getLockedWorlds(userId, page = 1, pageSize = 10, filters = {}) {
  logger.debug(`[DB] Getting locked worlds for user ${userId}, page ${page}, pageSize ${pageSize}, filters: ${JSON.stringify(filters)}`);
  try {
    const query = knexInstance('locked_worlds').where({ user_id: userId });
    const countQuery = knexInstance('locked_worlds').where({ user_id: userId });

    // Apply filters
    if (filters.nameLength) {
      if (filters.nameLength.min) {
        query.andWhereRaw('LENGTH(world_name) >= ?', [filters.nameLength.min]);
        countQuery.andWhereRaw('LENGTH(world_name) >= ?', [filters.nameLength.min]);
      }
      if (filters.nameLength.max) {
        query.andWhereRaw('LENGTH(world_name) <= ?', [filters.nameLength.max]);
        countQuery.andWhereRaw('LENGTH(world_name) <= ?', [filters.nameLength.max]);
      }
    }
    if (filters.prefix) {
      query.andWhereRaw('UPPER(world_name) LIKE ?', [filters.prefix.toUpperCase() + '%']);
      countQuery.andWhereRaw('UPPER(world_name) LIKE ?', [filters.prefix.toUpperCase() + '%']);
    }
    if (filters.lockType && ['main', 'out'].includes(filters.lockType.toLowerCase())) {
      query.where('lock_type', filters.lockType.toLowerCase());
      countQuery.where('lock_type', filters.lockType.toLowerCase());
    }
    if (filters.note) {
      query.andWhereRaw('UPPER(note) LIKE ?', ['%' + filters.note.toUpperCase() + '%']);
      countQuery.andWhereRaw('UPPER(note) LIKE ?', ['%' + filters.note.toUpperCase() + '%']);
    }

    // Get total count
    const totalResult = await countQuery.count({ total: '*' }).first();
    const totalCount = totalResult ? Number(totalResult.total) : 0;

    // Get paginated results
    query.limit(pageSize).offset((page - 1) * pageSize)
         .orderByRaw('LENGTH(world_name) ASC')
         .orderBy('world_name', 'ASC');

    const worlds = await query;

    logger.info(`[DB] Fetched ${worlds.length} locked worlds for user ${userId} (total: ${totalCount})`);
    return { worlds, total: totalCount };

  } catch (error) {
    logger.error(`[DB] Error getting locked worlds for user ${userId}:`, error);
    return { worlds: [], total: 0 };
  }
}

async function removeLockedWorld(userId, worldName) {
  const worldNameUpper = worldName.toUpperCase();
  logger.debug(`[DB] Attempting to remove locked world ${worldNameUpper} for user ${userId}`);
  try {
    const deletedCount = await knexInstance('locked_worlds')
      .where({ user_id: userId })
      .andWhereRaw('world_name = ?', [worldNameUpper]) // Ensure case-sensitive match after uppercasing input
      .del();

    if (deletedCount > 0) {
      logger.info(`[DB] Removed locked world ${worldNameUpper} for user ${userId}`);
      return true;
    } else {
      logger.warn(`[DB] Locked world ${worldNameUpper} not found for user ${userId} or already removed.`);
      return false;
    }
  } catch (error) {
    logger.error(`[DB] Error removing locked world ${worldNameUpper} for user ${userId}:`, error);
    return false;
  }
}

async function findLockedWorldByName(userId, worldName) {
  const worldNameUpper = worldName.toUpperCase();
  logger.debug(`[DB] Searching for locked world ${worldNameUpper} for user ${userId}`);
  try {
    const world = await knexInstance('locked_worlds')
      .where({ user_id: userId })
      .andWhereRaw('world_name = ?', [worldNameUpper]) // Ensure case-sensitive match
      .first();

    if (world) {
      logger.info(`[DB] Found locked world ${worldNameUpper} for user ${userId}`);
    } else {
      logger.debug(`[DB] Locked world ${worldNameUpper} not found for user ${userId}`);
    }
    return world || null;
  } catch (error) {
    logger.error(`[DB] Error finding locked world ${worldNameUpper} for user ${userId}:`, error);
    return null;
  }
}

async function moveWorldToLocks(userId, worldIdToRemove, targetLockType, targetNote) {
  logger.info(`[DB] Attempting to move world ID ${worldIdToRemove} to locks for user ${userId} with type ${targetLockType}`);

  // Normalize lockType: 'main' or 'out'. Default to 'main' if invalid.
  const normalizedTargetLockType = ['main', 'out'].includes(String(targetLockType).toLowerCase())
                                   ? String(targetLockType).toLowerCase()
                                   : 'main';
  try {
    return await knexInstance.transaction(async (trx) => {
      // 1. Fetch the world from `worlds` table
      const worldToMove = await trx('worlds')
        .where({ id: worldIdToRemove, user_id: userId })
        .first();

      if (!worldToMove) {
        logger.warn(`[DB] World ID ${worldIdToRemove} not found in active worlds for user ${userId} during move operation.`);
        // Throw an error to rollback and be caught by the outer catch block
        throw new Error('ACTIVE_WORLD_NOT_FOUND');
      }

      const worldNameUpper = worldToMove.name.toUpperCase(); // Name is already uppercase in `worlds` table based on `addWorld`

      // 2. Check if the world (by name) already exists in `locked_worlds` for that user
      const existingLockedWorld = await trx('locked_worlds')
        .where({ user_id: userId, world_name: worldNameUpper })
        .first();

      if (existingLockedWorld) {
        logger.warn(`[DB] World ${worldNameUpper} (from active world ID ${worldIdToRemove}) already exists in locked_worlds for user ${userId}.`);
        throw new Error('ALREADY_IN_LOCKED_LIST');
      }

      // 3. Delete the world from `worlds` table
      const deletedFromActive = await trx('worlds')
        .where({ id: worldIdToRemove, user_id: userId })
        .del();

      if (deletedFromActive === 0) {
        // This should theoretically be caught by the first check, but as a safeguard:
        logger.error(`[DB] Failed to delete world ID ${worldIdToRemove} from active worlds for user ${userId} during move. It might have been deleted concurrently.`);
        throw new Error('ACTIVE_WORLD_DELETE_FAILED');
      }
      logger.info(`[DB] Deleted world ${worldNameUpper} (ID: ${worldIdToRemove}) from active list for user ${userId}`);

      // 4. Insert the world into `locked_worlds`
      await trx('locked_worlds').insert({
        user_id: userId,
        world_name: worldNameUpper,
        lock_type: normalizedTargetLockType,
        note: targetNote,
        // locked_on_date will default to knex.fn.now() via table schema
      });
      logger.info(`[DB] Inserted ${worldNameUpper} into locked_worlds for user ${userId} with type ${normalizedTargetLockType}`);

      return { success: true, message: `World **${worldNameUpper}** moved to your locked list.` };
    });
  } catch (error) {
    logger.error(`[DB] Error moving world ID ${worldIdToRemove} to locks for user ${userId}:`, error);
    if (error.message === 'ACTIVE_WORLD_NOT_FOUND') {
      return { success: false, message: 'The world to move was not found in your active list.' };
    } else if (error.message === 'ALREADY_IN_LOCKED_LIST') {
      return { success: false, message: 'This world is already in your locked list.' };
    } else if (error.message === 'ACTIVE_WORLD_DELETE_FAILED') {
        return { success: false, message: 'Failed to remove the world from your active list during the move. Please try again.' };
    }
    // Check for unique constraint on locked_worlds again, in case of race conditions if transaction isolation is not perfect
    // or if the ALREADY_IN_LOCKED_LIST check above was bypassed due to complex scenarios.
    if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('UNIQUE constraint failed: locked_worlds.user_id, locked_worlds.world_name')) {
        return { success: false, message: 'This world is already in your locked list (detected during final insert).' };
    }
    return { success: false, message: 'Failed to move world to locks due to a database error.' };
  }
}
