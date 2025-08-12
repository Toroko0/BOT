module.exports = {
  PAGE_SIZE: 8, // Number of worlds per page in /list
  MAX_SELECT_OPTIONS: 25, // Discord limit for select menu options & autocomplete

  // Custom ID prefixes (Still useful for clarity if used internally)
  // LIST_PREFIX: 'list',
  // REMOVE_PREFIX: 'remove',
  // SHARE_PREFIX: 'share',
  // INFO_PREFIX: 'info',
  // EDIT_PREFIX: 'edit',
  // ADDWORLD_PREFIX: 'addworld',
  // SEARCH_PREFIX: 'search',
  // STATS_PREFIX: 'stats',

  // Component Type Identifiers (used in custom IDs)
  COMPONENT_TYPE: {
      BUTTON: 'button',
      SELECT: 'select',
      MODAL: 'modal',
  },

  // Add other constants relevant to your bot logic
  DEFAULT_COOLDOWN_SECONDS: 3,
  SEARCH_CACHE_TTL_MINUTES: 5,
};