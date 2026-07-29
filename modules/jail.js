// Jail system — strips roles, assigns jail role, auto-releases
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb }  = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');

const JAIL_TIMERS = new Map(); // `guildId:userId` -> timer

// ── Setup jail role ──
async function setupJail(guild) {
    const db  = getGuildDb(guild.id);
    const cfg = db.get('jailConfig', {});

    if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

    // Create jail role
    const role = await guild.roles.create({
        name: 'Jailed', color: '#808080', permissions: [],
        reason: 'Jail system setup',
    });

    // Deny access to all text channels
    for (const [, ch] of guild.channels.cache) {
        if (ch.type === 0 || ch.type === 5) {
            await ch.permissionOverwrites.edit(role, { ViewChannel: false }).catch(() => {});
        }
    }

    // Jail channel (if configured)
    let jailChId = cfg.jailChannelId;
    if (jailChId) {
        const jailCh = guild.channels.cache.get(jailChId);
        if (jailCh) {
            await jailCh.permissionOverwrites.edit(role, {
                ViewChannel: true, SendMessages: true, ReadMessageHistory: true
            }).catch(() => {});
        }
    }

    cfg.roleId = role.id;
    db.set('jailConfig', cfg);
    return role.id;
}

async function jailMember(guild, member, reason, duration, executorId, client) {
    const db     = getGuildDb(guild.id);
    const cfg    = db.get('jailConfig', {});
    const roleId = cfg.roleId || await setupJail(guild);

    // Save current roles (excluding @everyone and jail role)
    const savedRoles = member.roles.cache
        .filter(r => r.id !== guild.roles.everyone.id && r.id !== roleId)
        .map(r => r.id);

    // Store in DB
    const jailed = db.get('jailed', {});
    jailed[member.id] = {
        userId: member.id, savedRoles, reason, by: executorId,
        at: Date.now(), expires: duration ? Date.now() + duration : null,
    };
    db.set('jailed', jailed);

    // Remove all roles, add jail role
    await member.roles.set([guild.roles.everyone.id, roleId]).catch(() => {});

    const c = createCase(guild.id, {
        type: 'jail', targetId: member.id, executorId, reason,
        duration: duration ? formatDuration(duration) : 'Permanent',
        expires: duration ? Date.now() + duration : null,
    });

    // Schedule auto-release
    if (duration) scheduleRelease(guild, member.id, duration, client);

    return c;
}

async function unjailMember(guild, memberId, reason, executorId, client) {
    const db     = getGuildDb(guild.id);
    const jailed = db.get('jailed', {});
    const entry  = jailed[memberId];
    if (!entry) return null;

    const member = await guild.members.fetch(memberId).catch(() => null);
    if (member) {
        const rolesToRestore = (entry.savedRoles || []).filter(id => guild.roles.cache.has(id));
        await member.roles.set([guild.roles.everyone.id, ...rolesToRestore]).catch(() => {});
    }

    delete jailed[memberId];
    db.set('jailed', jailed);

    // Cancel timer
    const key = `${guild.id}:${memberId}`;
    if (JAIL_TIMERS.has(key)) { clearTimeout(JAIL_TIMERS.get(key)); JAIL_TIMERS.delete(key); }

    createCase(guild.id, { type: 'unjail', targetId: memberId, executorId, reason: reason || 'Released from jail' });
    return true;
}

function scheduleRelease(guild, userId, ms, client) {
    const key = `${guild.id}:${userId}`;
    if (JAIL_TIMERS.has(key)) clearTimeout(JAIL_TIMERS.get(key));
    const timer = setTimeout(async () => {
        JAIL_TIMERS.delete(key);
        await unjailMember(guild, userId, 'Auto-released (time served)', guild.client?.user?.id || 'system', client);
        const db  = getGuildDb(guild.id);
        const cfg = db.get('jailConfig', {});
        if (cfg.jailChannelId) {
            const ch = guild.channels.cache.get(cfg.jailChannelId);
            if (ch) await ch.send(`🔓 <@${userId}> has been released from jail.`).catch(() => {});
        }
    }, ms);
    JAIL_TIMERS.set(key, timer);
}

async function handleJail(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });

    const target   = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    if (target.id === ctx.author?.id || target.id === ctx.user?.id) return ctx.reply({ content: '❌ You cannot jail yourself.', ephemeral: true });

    const db     = getGuildDb(ctx.guild.id);
    const jailed = db.get('jailed', {});
    if (jailed[target.id]) return ctx.reply({ content: `❌ **${target.user.username}** is already jailed.`, ephemeral: true });

    // Parse optional duration and reason: .jail @user [duration] [reason]
    let durationStr = null, reason = 'No reason provided';
    if (args[1]) {
        const maybeMs = parseDuration(args[1]);
        if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
        else { reason = args.slice(1).join(' '); }
    }
    const durationMs = durationStr ? parseDuration(durationStr) : null;
    const authorId   = ctx.author?.id || ctx.user?.id;

    const c = await jailMember(ctx.guild, target, reason, durationMs, authorId, client);

    const embed = base(COLORS.error)
        .setTitle('🏛️ Member Jailed')
        .setThumbnail(target.user.displayAvatarURL())
        .addFields(
            { name: '👤 User',      value: `${target.user} (${target.id})`,               inline: true },
            { name: '👮 Moderator', value: `<@${authorId}>`,                               inline: true },
            { name: '📝 Reason',    value: reason },
            { name: '⏱️ Duration',  value: durationStr || 'Permanent',                    inline: true },
            { name: '🏷️ Case',     value: `#${c.id}`,                                    inline: true },
        );

    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
}

async function handleUnjail(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first() || ctx.mentions?.users?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const authorId = ctx.author?.id || ctx.user?.id;
    const reason   = args.slice(1).join(' ') || 'Released by staff';
    const result   = await unjailMember(ctx.guild, target.id, reason, authorId, client);
    if (!result) return ctx.reply({ content: `❌ **${target.user?.username || target.username}** is not jailed.`, ephemeral: true });

    const embed = base(COLORS.success).setTitle('🔓 Member Released from Jail')
        .addFields(
            { name: '👤 User',      value: `<@${target.id}>`,    inline: true },
            { name: '👮 Moderator', value: `<@${authorId}>`,     inline: true },
            { name: '📝 Reason',    value: reason },
        );
    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
}

async function handleJailList(ctx) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const jailed = getGuildDb(ctx.guild.id).get('jailed', {});
    const entries = Object.values(jailed);
    if (!entries.length) return ctx.reply({ content: '✅ No members currently jailed.' });

    const lines = entries.map(e => {
        const exp = e.expires ? `Expires <t:${Math.floor(e.expires / 1000)}:R>` : 'Permanent';
        return `<@${e.userId}> — ${e.reason} *(${exp})*`;
    }).join('\n');

    return ctx.reply({ embeds: [base(COLORS.primary).setTitle('🏛️ Jailed Members').setDescription(lines)] });
}

async function handleJailSetup(ctx, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(ctx.author?.id || ctx.user?.id)) return ctx.reply({ content: '❌ Admin only.', ephemeral: true });
    const db  = getGuildDb(ctx.guild.id);
    const cfg = db.get('jailConfig', {});
    if (args[0] === 'channel') {
        const ch = ctx.mentions?.channels?.first();
        if (!ch) return ctx.reply({ content: '❌ Mention a channel.' });
        cfg.jailChannelId = ch.id;
        db.set('jailConfig', cfg);
        return ctx.reply({ content: `✅ Jail channel set to <#${ch.id}>.` });
    }
    const roleId = await setupJail(ctx.guild);
    return ctx.reply({ content: `✅ Jail system set up! Role: <@&${roleId}>` });
}

// Restore jail timers on bot restart
async function restoreJailTimers(client) {
    for (const guild of client.guilds.cache.values()) {
        const jailed = getGuildDb(guild.id).get('jailed', {});
        for (const [uid, entry] of Object.entries(jailed)) {
            if (entry.expires && entry.expires > Date.now()) {
                const remaining = entry.expires - Date.now();
                scheduleRelease(guild, uid, remaining, client);
            } else if (entry.expires && entry.expires <= Date.now()) {
                // Already expired, release now
                await unjailMember(guild, uid, 'Auto-released (time served)', 'system', client).catch(() => {});
            }
        }
    }
}

module.exports = { handleJail, handleUnjail, handleJailList, handleJailSetup, restoreJailTimers };
