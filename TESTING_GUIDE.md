# Testing Guide

This guide provides step-by-step instructions for testing the new and modified features of the Growtopia Tracker bot.

## 1. `/search` Command

**Objective:** Verify that the `/search` command now returns all matching worlds and that pagination works correctly.

**Steps:**

1.  Use the `/search` command with a query that you know should return more than one result. For example, if you have multiple worlds with the prefix "TEST", use `/search prefix:TEST`.
2.  Verify that the bot returns a paginated list of all matching worlds.
3.  Use the "Next" and "Prev" buttons to navigate through the pages of results.
4.  Verify that the "Page X/Y" indicator is correct.
5.  Use the "Refresh" button to refresh the search results.
6.  Use the "Export All Names" button to export the names of all matching worlds.

## 2. `/list` Command

**Objective:** Verify the new permissions and display changes for the `/list` command.

**Steps:**

1.  Use the `/list` command without any options. Verify that you see your own list of worlds and that the "Add" and "Remove" buttons are enabled.
2.  Use the `/list user:<another_user>` command to view another user's list.
3.  Verify that you can see the other user's list and that the "Add" and "Remove" buttons are disabled.
4.  Verify that the "ADDED BY" column is present and correctly displays the username of the user who added the world.
5.  Switch to phone view mode using the `/settings` command.
6.  Use the `/list` command again and verify that the "BY" column is present in the phone view.

## 3. `/info` Command

**Objective:** Verify the new permissions for the `/info` command.

**Steps:**

1.  Use the `/info` command to view information about a world that you own.
2.  Verify that you can see the world's information and that the "Edit" and "Remove" buttons are visible.
3.  Use the `/info` command to view information about a world owned by another user.
4.  Verify that you can see the world's information and that the "Edit" and "Remove" buttons are **not** visible.

## 4. `/leaderboard` Command

**Objective:** Verify the consolidation of the `/stats` command into the `/leaderboard` command.

**Steps:**

1.  Use the `/leaderboard` command.
2.  Verify that the leaderboard is displayed correctly.
3.  Verify that the global stats (Total Worlds, Mainlocks, Outlocks) are displayed at the bottom of the leaderboard.
4.  Use the select menu to view the stats for a specific user on the leaderboard.
5.  Verify that the user-specific stats are displayed correctly.

## 5. Removed Commands

**Objective:** Verify that the `/stats`, `/share`, and `/unshare` commands have been removed.

**Steps:**

1.  Try to use the `/stats`, `/share`, and `/unshare` commands.
2.  Verify that these commands are no longer available and do not appear in the slash command list.

## 6. `/help` Command

**Objective:** Verify that the `/help` command has been updated.

**Steps:**

1.  Use the `/help` command.
2.  Verify that the help message reflects the new command structure and that the removed commands are no longer listed.
3.  Verify that the buttons in the help message work correctly.
