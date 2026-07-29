/**
 * fakepermissions.js — Fake bot-level permissions for roles
 *
 * Allows server owners to grant bot command permissions to roles without
 * giving them native Discord permissions.
 *
 * Storage (guild DB): 'fakePerms' → { [roleId]: ['ban_members', 'kick_members', ...] }
 *
 * Commands (owner-only):
 *   ,fakepermissions add @role perm1, perm2
 *   ,fakepermissions remove @role perm1, perm2
 *   ,fakepermissions list [@role]
 *   ,fakepermissions reset
 *
 * Permissions reference — any PermissionFlagsBits key in snake_case, e.g.:
 *   ban_members, kick_members, manage_messages, manage_channels, manage_guild,
 *   moderate_members, mute_members, deafen_members, move_members, etc.
 */

const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { greedOk, greedWarn, base, COLORS } = require('../utils/embeds');

// Map snake_case permission names to PermissionFlagsBits keys
const PERM_ALIASES = {};
for (const [key, val] of Object.entries(PermissionFlagsBits)) {
    // e.g. 'BanMembers' → 'ban_members'
    const snake = key.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`).replace(/^_/, '');
    PERM_ALIASES[snake] = key;
    PERM_ALIASES[key.toLowerCase()] = key;
    PERM_ALIASES[key] = key;
}

function resolvePermName(raw) {
    const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_');
    return PERM_ALIASES[normalized] || PERM_ALIASES[raw.trim()] || null;
}

// ── Check if a member has a fake permission via any of their roles ─────────

function hasFakePerm(member, permName) {
    if (!member?.guild) return false;
    // resolvedPermName: canonical PermissionFlagsBits key
    const resolved = resolvePermName(permName);
    if (!resolved) return false;

    const db   = getGuildDb(member.guild.id);
    const fp   = db.get('fakePerms', {});
    const snake = resolved.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`).replace(/^_/, '');

    for (const role of member.roles.cache.values()) {
        const rolePerms = fp[role.id] || [];
        if (rolePerms.includes(snake) || rolePerms.includes(resolved)) return true;
    }
    return false;
}

// ── Command handler ────────────────────────────────────────────────────────

async function handleFakePermissions(message, args) {
    // Only server owner can manage fake permissions
    if (message.author.id !== message.guild.ownerId) {
        return message.reply(greedWarn(message.member,
            'Only the **server owner** can manage fake permissions.'));
    }

    const db  = getGuildDb(message.guild.id);
    const fp  = db.get('fakePerms', {});
    const sub = (args[0] || '').toLowerCase();

    // ── list ──────────────────────────────────────────────────────────────
    if (sub === 'list') {
        const targetRole = message.mentions.roles.first();

        if (targetRole) {
            const perms = fp[targetRole.id] || [];
            if (!perms.length)
                return message.reply(greedWarn(message.member,
                    `<@&${targetRole.id}> has no fake permissions.`));
            return message.channel.send({ embeds: [
                base(COLORS.primary)
                    .setTitle(`🔑 Fake Permissions — <@&${targetRole.id}>`)
                    .setDescription(perms.map(p => `\`${p}\``).join('\n')),
            ] });
        }

        const entries = Object.entries(fp).filter(([, v]) => v.length > 0);
        if (!entries.length)
            return message.reply(greedWarn(message.member, 'No fake permissions configured.'));

        const lines = entries.map(([roleId, perms]) =>
            `<@&${roleId}> — ${perms.map(p => `\`${p}\``).join(', ')}`
        ).join('\n');

        return message.channel.send({ embeds: [
            base(COLORS.primary)
                .setTitle('🔑 All Fake Permissions')
                .setDescription(lines),
        ] });
    }

    // ── reset ─────────────────────────────────────────────────────────────
    if (sub === 'reset') {
        db.set('fakePerms', {});
        return message.reply(greedOk(message.member, 'All fake permissions have been **reset**.'));
    }

    // ── add / remove ──────────────────────────────────────────────────────
    if (sub === 'add' || sub === 'remove') {
        const role = message.mentions.roles.first();
        if (!role)
            return message.reply(greedWarn(message.member,
                `Usage: \`,fakepermissions ${sub} @role perm1, perm2\``));

        // Remaining args after the role mention: join, split on commas
        const rawPerms = args.slice(1).join(' ')
            .replace(/<@&\d+>/g, '') // remove role mention noise
            .split(/[,\s]+/)
            .map(p => p.trim())
            .filter(Boolean);

        if (!rawPerms.length)
            return message.reply(greedWarn(message.member,
                `Provide at least one permission name.\n` +
                `Example: \`,fakepermissions add @role ban_members, kick_members\``));

        const resolved = [];
        const invalid  = [];
        for (const raw of rawPerms) {
            const name = resolvePermName(raw);
            if (name) resolved.push(name.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`).replace(/^_/, ''));
            else invalid.push(raw);
        }

        if (invalid.length)
            return message.reply(greedWarn(message.member,
                `Unknown permissions: ${invalid.map(p => `\`${p}\``).join(', ')}`));

        if (!fp[role.id]) fp[role.id] = [];

        if (sub === 'add') {
            for (const p of resolved) {
                if (!fp[role.id].includes(p)) fp[role.id].push(p);
            }
            db.set('fakePerms', fp);
            return message.reply(greedOk(message.member,
                `Granted \`${resolved.join(', ')}\` to <@&${role.id}>.`));
        } else {
            fp[role.id] = fp[role.id].filter(p => !resolved.includes(p));
            if (!fp[role.id].length) delete fp[role.id];
            db.set('fakePerms', fp);
            return message.reply(greedOk(message.member,
                `Revoked \`${resolved.join(', ')}\` from <@&${role.id}>.`));
        }
    }

    // ── help ──────────────────────────────────────────────────────────────
    return message.channel.send({ embeds: [
        base(COLORS.primary)
            .setTitle('🔑 Fake Permissions')
            .setDescription(
                'Grant bot command permissions to roles without native Discord permissions.\n\n' +
                '**Commands (server owner only):**\n' +
                '`,fakepermissions add @role ban_members, kick_members`\n' +
                '`,fakepermissions remove @role ban_members`\n' +
                '`,fakepermissions list [@role]`\n' +
                '`,fakepermissions reset`\n\n' +
                '**Example permissions:** `ban_members` `kick_members` `manage_messages` ' +
                '`manage_channels` `manage_guild` `moderate_members` `mute_members`'
            ),
    ] });
}

module.exports = { hasFakePerm, handleFakePermissions };
