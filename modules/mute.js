// Mute system (role-based) + image/reaction mute variants
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { createCase, sendModLog, parseDuration, formatDuration } = require('./cases');

const MUTE_TIMERS = new Map();

async function getOrCreateMuteRole(guild) {
    const db  = getGuildDb(guild.id);
    const cfg = db.get('muteConfig', {});
    if (cfg.roleId && guild.roles.cache.has(cfg.roleId)) return cfg.roleId;

    const role = await guild.roles.create({
        name: 'Muted', color: '#818386', permissions: [],
        reason: 'Mute system setup',
    });

    for (const [, ch] of guild.channels.cache) {
        if (ch.type === 0 || ch.type === 5) {
            await ch.permissionOverwrites.edit(role, { SendMessages: false, AddReactions: false }).catch(() => {});
        }
        if (ch.type === 2) {
            await ch.permissionOverwrites.edit(role, { Speak: false }).catch(() => {});
        }
    }

    cfg.roleId = role.id;
    db.set('muteConfig', cfg);
    return role.id;
}

async function muteMember(guild, member, reason, duration, executorId) {
    const roleId = await getOrCreateMuteRole(guild);
    await member.roles.add(roleId, reason);

    const c = createCase(guild.id, {
        type: 'mute', targetId: member.id, executorId, reason,
        duration: duration ? formatDuration(duration) : 'Permanent',
        expires: duration ? Date.now() + duration : null,
    });

    if (duration) scheduleMuteRelease(guild, member.id, duration);
    return c;
}

async function unmuteMember(guild, memberId, reason, executorId) {
    const db  = getGuildDb(guild.id);
    const cfg = db.get('muteConfig', {});
    if (!cfg.roleId) return null;
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) return null;
    await member.roles.remove(cfg.roleId, reason).catch(() => {});
    const key = `${guild.id}:${memberId}`;
    if (MUTE_TIMERS.has(key)) { clearTimeout(MUTE_TIMERS.get(key)); MUTE_TIMERS.delete(key); }
    createCase(guild.id, { type: 'unmute', targetId: memberId, executorId, reason: reason || 'Unmuted by staff' });
    return true;
}

function scheduleMuteRelease(guild, userId, ms) {
    const key = `${guild.id}:${userId}`;
    if (MUTE_TIMERS.has(key)) clearTimeout(MUTE_TIMERS.get(key));
    const timer = setTimeout(async () => {
        MUTE_TIMERS.delete(key);
        await unmuteMember(guild, userId, 'Auto-unmuted (time expired)', guild.client?.user?.id || 'system');
    }, ms);
    MUTE_TIMERS.set(key, timer);
}

async function handleMute(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

    let durationStr = null, reason = 'No reason provided';
    const maybeMs = parseDuration(args[1]);
    if (maybeMs) { durationStr = args[1]; reason = args.slice(2).join(' ') || reason; }
    else { reason = args.slice(1).join(' ') || reason; }
    const authorId = ctx.author?.id || ctx.user?.id;

    const c = await muteMember(ctx.guild, target, reason, durationStr ? parseDuration(durationStr) : null, authorId);
    const embed = base(COLORS.error).setTitle('🔇 Member Muted')
        .addFields(
            { name: '👤 User',      value: `${target.user} (${target.id})`, inline: true },
            { name: '👮 Moderator', value: `<@${authorId}>`,                inline: true },
            { name: '⏱️ Duration',  value: durationStr || 'Permanent',      inline: true },
            { name: '📝 Reason',    value: reason },
            { name: '🏷️ Case',     value: `#${c.id}`,                       inline: true },
        );
    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
}

async function handleUnmute(ctx, args, client) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const reason   = args.slice(1).join(' ') || 'Unmuted by staff';
    const authorId = ctx.author?.id || ctx.user?.id;
    const result = await unmuteMember(ctx.guild, target.id, reason, authorId);
    if (!result) return ctx.reply({ content: '❌ Could not unmute. No mute role set up?' });
    const embed = base(COLORS.success).setTitle('🔊 Member Unmuted')
        .addFields(
            { name: '👤 User',      value: `${target.user}`, inline: true },
            { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
            { name: '📝 Reason',    value: reason },
        );
    await sendModLog(ctx.guild, embed);
    return ctx.reply({ embeds: [embed] });
}

// imute — mute images/attachments only
async function handleIMute(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const ch = ctx.channel;
    await ch.permissionOverwrites.edit(target.id, { AttachFiles: false, EmbedLinks: false });
    const authorId = ctx.author?.id || ctx.user?.id;
    createCase(ctx.guild.id, { type: 'imute', targetId: target.id, executorId: authorId, reason: args.slice(1).join(' ') || 'Image mute' });
    return ctx.reply({ content: `🔇 Image/attachment mute applied to **${target.user.username}** in this channel.` });
}

async function handleIUnmute(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const ch = ctx.channel;
    await ch.permissionOverwrites.edit(target.id, { AttachFiles: null, EmbedLinks: null });
    return ctx.reply({ content: `🔊 Image mute removed from **${target.user.username}** in this channel.` });
}

// rmute — reaction mute
async function handleRMute(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    const ch = ctx.channel;
    await ch.permissionOverwrites.edit(target.id, { AddReactions: false });
    const authorId = ctx.author?.id || ctx.user?.id;
    createCase(ctx.guild.id, { type: 'rmute', targetId: target.id, executorId: authorId, reason: args.slice(1).join(' ') || 'Reaction mute' });
    return ctx.reply({ content: `🔇 Reaction mute applied to **${target.user.username}** in this channel.` });
}

async function handleRUnmute(ctx, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const target = ctx.mentions?.members?.first();
    if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
    await ctx.channel.permissionOverwrites.edit(target.id, { AddReactions: null });
    return ctx.reply({ content: `🔊 Reaction mute removed from **${target.user.username}**.` });
}

// setupmute — create/configure mute role
async function handleSetupMute(ctx, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(ctx.author?.id || ctx.user?.id)) return ctx.reply({ content: '❌ Admin only.', ephemeral: true });
    const roleId = await getOrCreateMuteRole(ctx.guild);
    const role   = ctx.guild.roles.cache.get(roleId);
    return ctx.reply({ embeds: [base(COLORS.success).setTitle('🔇 Mute System Set Up')
        .setDescription(`Mute role: <@&${roleId}> (\`${roleId}\`)\n\nAll channels have been configured with deny permissions.`)
        .addFields({ name: 'Role Name', value: role?.name || 'Muted', inline: true })] });
}

async function restoreMuteTimers(client) {
    for (const guild of client.guilds.cache.values()) {
        const db  = getGuildDb(guild.id);
        const cases = db.get('cases', []).filter(c =>
            c.type === 'mute' && c.expires && c.expires > Date.now() && c.status !== 'pardoned'
        );
        for (const c of cases) {
            const remaining = c.expires - Date.now();
            scheduleMuteRelease(guild, c.targetId, remaining);
        }
    }
}

module.exports = {
    handleMute, handleUnmute, handleIMute, handleIUnmute,
    handleRMute, handleRUnmute, handleSetupMute, restoreMuteTimers,
};
