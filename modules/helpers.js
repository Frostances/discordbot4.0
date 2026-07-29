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
 *   1. A global bot owner (creator), or
 *   2. The guild owner, or
 *   3. Has the optional bot-admin role configured via .botadmin set @role
 */
function isAdmin(member) {
    if (!member) return false;
    if (isBotOwner(member.id ?? member.user?.id)) return true;
    if (!member.guild) return false;
    if (member.guild.ownerId === member.id) return true;
    const db     = getGuildDb(member.guild.id);
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
 * perm must be a key of PermissionFlagsBits (e.g. 'BanMembers', 'ManageChannels').
 *
 * @param {GuildMember} member
 * @param {string} perm  — key of PermissionFlagsBits
 */
function hasDiscordPerm(member, perm) {
    if (!member) return false;
    if (isAdmin(member)) return true;
    const flag = PermissionFlagsBits[perm];
    if (!flag) return false;
    return member.permissions.has(flag);
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
    isCommandRestricted, checkRestriction,
};
