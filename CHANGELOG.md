# Changelog

## [Unreleased]
- Refactored interaction handling for better maintainability.
- Standardized `customId` format for components and modals.
- Migrated database interactions to use Knex ORM consistently.
- Improved error handling and logging across modules.
- Added/improved autocomplete for relevant commands.
- Fixed various minor bugs in command logic and display.
- Added confirmation step for world removal via `/list` modal.
- Enhanced `/info` display and added Share/Unshare buttons.
- Updated `/help` command with corrected button IDs and clearer descriptions.
- Ensured daily task correctly updates `days_owned`.

## [1.0.0] - 2025-04-07
### Added
- Slash commands: addworld, list, info, remove, share, unshare, stats, search, sync, help
- Unique share links with expiration
- World expiration tracking and reminders
- Audit logs for add, remove, share, unshare
- SQLite database with migrations
- CI/CD pipeline with GitHub Actions
- Dockerfile for containerization
- Help command with categories and examples
- Admin permission checks
- Input validation and rate limiting
- Accessibility improvements
- Initial documentation