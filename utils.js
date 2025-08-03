const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuOptionBuilder } = require('discord.js');
const { formatDistance, addDays } = require('date-fns');
const { table, getBorderCharacters } = require('table');

// Calculate days until expiration (180 - days_owned)
// This function might be deprecated if days_left is directly calculated from expiry_date
function calculateDaysLeft_old(daysOwned) {
  // Ensure daysOwned is treated as a number and use simple formula: 180 - daysOwned
  const owned = parseInt(daysOwned) || 0;
  return Math.max(0, 180 - owned);
}

// Calculate expiration date based on days owned
// This function might be deprecated if expiry_date is directly stored
function calculateExpiryDate_old(daysOwned) {
  const daysLeft = calculateDaysLeft_old(daysOwned);
  return addDays(new Date(), daysLeft);
}

// Get the day of week for a date
function getDayOfWeek(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getUTCDay()]; // Use getUTCDay for consistency with UTC dates
}

// Format a world as a string for display (potentially deprecated by new table formatter)
function formatWorld(world) {
  const daysLeft = calculateDaysLeft_old(world.days_owned);
  const expiryDate = calculateExpiryDate_old(world.days_owned);
  
  return {
    name: world.name,
    daysOwned: world.days_owned,
    daysLeft: daysLeft,
    expiryDate: formatDate(expiryDate), // formatDate is still useful
    expiryDay: getDayOfWeek(expiryDate), // getDayOfWeek is still useful
    lockType: world.lock_type || 'M',
    isPublic: world.is_public ? 'Public' : 'Private',
    addedBy: world.added_by
  };
}

// Format world details for the info command (review if this needs updates based on new date logic)
function formatWorldDetails(world) {
  if (!world) {
    return 'World not found.';
  }

  // Assuming world.expiry_date is available and is a UTC date string
  const expiryDate = new Date(world.expiry_date);
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expiryDateUTC = new Date(Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()));
  const daysLeft = Math.ceil((expiryDateUTC.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));
  const daysOwned = daysLeft > 0 ? 180 - daysLeft : 180;

  // For display, adjust expiryDate by timezoneOffset if available, otherwise show as UTC
  // This part depends on how timezoneOffset is passed or stored for info command.
  // For simplicity, showing UTC here. Adapt if offset is available.
  const displayExpiryDate = `${expiryDate.getUTCMonth() + 1}/${expiryDate.getUTCDate()}/${expiryDate.getUTCFullYear()} (${getDayOfWeek(expiryDate)})`;

  return `
**World Information: ${world.name.toUpperCase()}**

🌐 **Basic Details**
• Days Owned: ${daysOwned}
• Days Left: ${daysLeft > 0 ? daysLeft : 'EXPIRED'}
• Expires On: ${displayExpiryDate}
• Lock Type: ${(world.lock_type || 'MAIN').toUpperCase()}

📊 **Tracking Info**
• Added By: ${world.added_by_username || 'Unknown'}
• Visibility: ${world.is_public ? 'Public' : 'Private'}
• ID: ${world.id}
  `;
}


// Format world statistics
function formatWorldStats(stats) {
  if (!stats) {
    return 'No statistics available.';
  }

  // Format letter count distribution
  let letterCountText = '';
  Object.keys(stats.letterCounts).sort((a, b) => a - b).forEach(length => {
    letterCountText += `• ${length} letters: ${stats.letterCounts[length]} worlds\n`;
  });
  if (!letterCountText) letterCountText = '• No data\n';

  return `
**World Statistics**

📊 **Totals**
• Total Worlds: ${stats.totalWorlds}
• Private Worlds: ${stats.privateWorlds}
• Public Worlds: ${stats.publicWorlds}
• Expiring Soon (7 days): ${stats.expiringWorlds}

📏 **Name Lengths**
${letterCountText}
🔒 **Lock Types**
• M (mainlock): ${stats.Mainlock || 0} worlds
• O (outlock): ${stats.Outlock || 0} worlds

⏱️ **Ownership**
• Average Days Owned: ${stats.averageDaysOwned || 0} days
  `;
}

// Create cooldown for buttons to prevent spam
const cooldowns = new Map();

// Cooldown system to prevent command spam
function checkCooldown(userId, command, cooldownTime = 3) {
  const now = Date.now();
  const key = `${userId}-${command}`;
  const cooldownInfo = cooldowns.get(key);

  // Check if command is on cooldown
  if (cooldownInfo && cooldownInfo.expirationTime > now) {
    const timeLeft = Math.ceil((cooldownInfo.expirationTime - now) / 1000);
    return { onCooldown: true, timeLeft };
  }

  // Add cooldown
  cooldowns.set(key, {
    expirationTime: now + cooldownTime * 1000
  });

  return { onCooldown: false };
}

// Format date as MM/DD/YYYY (kept for other uses if any)
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}

// Calculate days remaining until expiry (potentially deprecated by new logic in table func)
function calculateDaysRemaining(expiryDate) {
  const today = new Date();
  const diff = expiryDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Generate a colorful status for days left
function getDaysLeftStatus(daysLeft) {
  if (daysLeft <= 0) {
    return '🔴 EXPIRED';
  } else if (daysLeft <= 7) {
    return `🟠 ${daysLeft} DAYS LEFT`;
  } else if (daysLeft <= 30) {
    return `🟡 ${daysLeft} DAYS LEFT`;
  } else {
    return `🟢 ${daysLeft} DAYS LEFT`;
  }
}

// Get the day name of a date (kept for other uses if any)
function getDayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}



// Update all worlds' days by 1 in UTC-5 timezone
function updateWorldsDaily(db) {
  try {
    // Get the current date in UTC-5 timezone
    const now = new Date();
    // Convert to UTC-5 (Eastern Time)
    const utcMinus5Date = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    
    console.log(`[Daily Update] Starting daily world update at ${utcMinus5Date.toISOString()}`);
    
    return db.updateAllWorldDays()
      .then(result => {
        console.log(`[Daily Update] Successfully updated ${result} worlds`);
        return result;
      })
      .catch(err => {
        console.error('[Daily Update] Error updating world days:', err);
        return 0;
      });
  } catch (error) {
    console.error('[Daily Update] Unexpected error:', error);
    return 0;
  }
}

// Remove worlds older than 180 days
function removeExpiredWorlds(db) {
  try {
    console.log('[Cleanup] Starting expired worlds cleanup');

    return db.removeExpiredWorlds()
      .then(result => {
        console.log(`[Cleanup] Successfully removed ${result} expired worlds`);
        return result;
      })
      .catch(err => {
        console.error('[Cleanup] Error removing expired worlds:', err);
        return 0;
      });
  } catch (error) {
    console.error('[Cleanup] Unexpected error:', error);
    return 0;
  }
}

const formatWorldData = (world) => {
  return {
    name: world.name.toUpperCase(),
    daysOwned: world.days_owned || 0, // This might need recalculation based on expiry_date
    expiryDate: world.expiry_date || new Date().toISOString(),
    lockType: world.lock_type || 'M',
    isPublic: world.is_public || false,
    customId: world.custom_id ? world.custom_id.toUpperCase() : null,
    addedBy: world.added_by || null
  };
};

const formatStats = (stats) => {
  return `📊 **World Statistics**
• Total Worlds: ${stats.total || 0}
• Public Worlds: ${stats.public || 0}
• Private Worlds: ${stats.private || 0}
• Lock Types:
  • M (mainlock): ${stats.mainlock || 0} worlds
  • O (outlock): ${stats.outlock || 0} worlds
• Expiring Soon: ${stats.expiringSoon || 0}
• Expired: ${stats.expired || 0}`;
};

function createPaginationRow(baseCustomId, currentPage, totalPages) {
    const row = new ActionRowBuilder();
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${baseCustomId}_prev_${currentPage}`)
            .setLabel('⬅️ Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage <= 1),
        new ButtonBuilder()
            .setCustomId(`${baseCustomId}_display_${currentPage}_${totalPages}`)
            .setLabel(`Page ${currentPage}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`${baseCustomId}_next_${currentPage}`)
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages)
    );
    return row;
}

function formatWorldsToTable(worlds, viewMode, listType, timezoneOffset, targetUsername = null) {
  const tableData = [];
  const now = new Date(); // Current time in UTC
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isAnotherUser = targetUsername && worlds.some(w => w.added_by_username.toLowerCase() !== targetUsername.toLowerCase());

  if (viewMode === 'pc') {
      const headers = ['WORLD', 'OWNED', 'LEFT', 'EXPIRES ON', 'LOCK'];
      if (isAnotherUser) headers.push('ADDED BY');
      tableData.push(headers);

    for (const world of worlds) {
      const expiryDate = new Date(world.expiry_date); // Assuming expiry_date is UTC
      const expiryDateUTC = new Date(Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()));

      const days_left = Math.ceil((expiryDateUTC.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));
      const days_owned = days_left > 0 ? Math.max(0, 180 - days_left) : 180;

      const userLocalExpiry = new Date(expiryDate.getTime() + timezoneOffset * 3600000);
      const displayExpiryDate = `${userLocalExpiry.getUTCMonth() + 1}/${userLocalExpiry.getUTCDate()}/${userLocalExpiry.getUTCFullYear()} (${getDayOfWeek(userLocalExpiry)})`;

      let lockTypeDisplay = (world.lock_type || 'MAIN').toUpperCase();
      if (lockTypeDisplay === 'MAINLOCK') lockTypeDisplay = 'MAIN';
      if (lockTypeDisplay === 'OUTLOCK') lockTypeDisplay = 'OUT';

        const row = [
        world.name.toUpperCase(),
        days_owned.toString(),
        days_left > 0 ? days_left.toString() : 'EXP',
        displayExpiryDate,
        lockTypeDisplay
        ];
        if (isAnotherUser) row.push(world.added_by_username);
        tableData.push(row);
    }
  } else { // Mobile Mode
      const headers = ['WORLD', 'OWNED'];
      if (isAnotherUser) headers.push('BY');
      tableData.push(headers);
    for (const world of worlds) {
      const expiryDate = new Date(world.expiry_date); // Assuming expiry_date is UTC
      const expiryDateUTC = new Date(Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()));

      const days_left = Math.ceil((expiryDateUTC.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));
      const days_owned = days_left > 0 ? Math.max(0, 180 - days_left) : 180;

      let lockTypeChar = (world.lock_type || 'M').charAt(0).toUpperCase();
      if (world.lock_type && world.lock_type.toLowerCase() === 'mainlock') lockTypeChar = 'M';
      if (world.lock_type && world.lock_type.toLowerCase() === 'outlock') lockTypeChar = 'O';


        const row = [
        `(${lockTypeChar}) ${world.name.toUpperCase()}`,
        days_owned.toString()
        ];
        if (isAnotherUser) row.push(world.added_by_username);
        tableData.push(row);
    }
  }

  const baseTitle = listType === 'private' ? 'Your Worlds' : 'Public Worlds';
  const tableConfig = {
    border: getBorderCharacters('norc'),
    header: {
      alignment: 'center',
      content: `${baseTitle} (View: ${viewMode === 'pc' ? 'PC' : 'Mobile'})`
    },
    columns: viewMode === 'pc' ?
      { 0: { width: 15 }, 1: { width: 6, alignment: 'right'}, 2: { width: 5, alignment: 'right' }, 3: { width: 15 }, 4: { width: 6 } } :
      { 0: { width: 15 }, 1: { width: 6, alignment: 'right' } }
  };
  return { data: tableData, config: tableConfig };
}

function createWorldSelectOption(world, timezoneOffset) {
  const expiryDate = new Date(world.expiry_date); // Assuming expiry_date is UTC
  const userLocalExpiry = new Date(expiryDate.getTime() + timezoneOffset * 3600000);

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const expiryDateUTC = new Date(Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()));
  const daysLeft = Math.ceil((expiryDateUTC.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));

  return new StringSelectMenuOptionBuilder()
    .setLabel(`${world.name.substring(0, 25)} (${world.custom_id || 'No ID'})`)
    .setValue(world.id.toString())
    .setDescription(`Expires: ${userLocalExpiry.getUTCMonth() + 1}/${userLocalExpiry.getUTCDate()}/${userLocalExpiry.getUTCFullYear()} (${daysLeft > 0 ? daysLeft : 'EXP'}d left)`);
}

module.exports = {
  calculateDaysLeft: calculateDaysLeft_old, // Keep old one if other parts of code use it, or update them
  calculateDaysRemaining,
  calculateExpiryDate: calculateExpiryDate_old, // Keep old one if other parts of code use it
  formatDate,
  getDayOfWeek,
  formatWorld, // Might be deprecated by new table formatter
  formatWorldDetails,
  formatWorldStats,
  checkCooldown,
  updateWorldsDaily,
  removeExpiredWorlds,
  createPaginationRow,
  formatWorldsToTable,
  createWorldSelectOption,
  // Potentially export new date/day calculation if needed elsewhere, or keep them local to new functions
};
