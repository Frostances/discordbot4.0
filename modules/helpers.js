const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

// ── Global bot owners — bypass all permission checks in every server ──
let _owners = null;
function getBotOwners() {
    if (!_owners) {
        try { _owners = require('../config/botOwners.json').owners || []; }
        catch { _owners = []; }
    }
    return _owners;
}

/** Returns true if this user is a global bot owner (creator-level access). */
function isBotOwner(userId) {
    return getBotOwners().includes(String(userId));
}

/**
 * Returns true if the member is:
 * 1. A global bot owner (creator), or
 * 2. The guild owner, or
 * 3. Has the optional bot-admin role configured via .botadmin set @role
 */
function isAdmin(member) {
    if (!member) return false;
    if (isBotOwner(member.id ?? member.user?.id)) return true;
    if (!member.guild) return false;
    if (member.guild.ownerId === member.id) return true;
    const db = getGuildDb(member.guild.id);
    const roleId = db.get('botAdminRoleId', null);
    return roleId ? member.roles.cache.has(roleId) : false;
}

function isStaff(member, db) {
    if (!member || !member.roles) return false;
    const staffRoles = db.get('staffRoles', []);
    return staffRoles.some(id => member.roles.cache.has(id));
}

function isStaffOrAdmin(member) {
    if (!member) return false;
    const db = getGuildDb(member.guild.id);
    return isAdmin(member) || isStaff(member, db);
}

/**
 * Returns true if the member has a specific Discord permission flag OR is an admin.
 * Checks REAL Discord permissions first, then falls back to FAKE permissions.
 * 
 * perm must be a key of PermissionFlagsBits (e.g. 'BanMembers', 'ManageChannels').
 *
 * @param {GuildMember} member
 * @param {string} perm — key of PermissionFlagsBits
 */
function hasDiscordPerm(member, perm) {
    if (!member) return false;
    if (isAdmin(member)) return true;

    // Check real Discord permission
    const flag = PermissionFlagsBits[perm];
    if (flag && member.permissions.has(flag)) return true;

    // Check fake permission (from fakepermissions module)
    try {
        const { hasFakePermission } = require('./fakepermissions');
        // Convert PascalCase to snake_case for fake permission lookup
        const permName = perm.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
        if (hasFakePermission(member, permName)) return true;
    } catch { /* fakepermissions not loaded yet */ }

    return false;
}

/**
 * NEW: Check if member has a permission using fake permission system.
 * Preferred way for moderation commands.
 * 
 * @param {GuildMember} member
 * @param {string} permName — permission name like 'ban_members', 'kick_members', etc.
 */
function hasPermission(member, permName) {
    if (!member) return false;
    if (isAdmin(member)) return true;

    // Check fake permission first
    try {
        const { hasFakePermission } = require('./fakepermissions');
        if (hasFakePermission(member, permName)) return true;
    } catch { /* fakepermissions not loaded yet */ }

    // Check real Discord permission
    const flagKey = permName.toLowerCase().replace(/_/g, '');
    for (const [key, value] of Object.entries(PermissionFlagsBits)) {
        if (key.toLowerCase() === flagKey) {
            return member.permissions.has(value);
        }
    }

    return false;
}

// Delegate to restrictcommand module (avoids circular deps — lazy require)
function checkRestriction(ctx, command) {
    try {
        const { checkRestriction: check } = require('./restrictcommand');
        return check(ctx, command);
    } catch { return false; }
}

function isCommandRestricted(member, command) {
    if (!member?.guild) return false;
    try {
        const { isRestricted } = require('./restrictcommand');
        return isRestricted(member, command, member.guild.id);
    } catch { return false; }
}

module.exports = {
    isAdmin, isBotOwner, isStaff, isStaffOrAdmin,
    hasDiscordPerm,
    hasPermission,  // NEW: fake permission aware
    isCommandRestricted, checkRestriction,
};