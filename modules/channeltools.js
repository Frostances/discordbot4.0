/**
 * channeltools.js — extra channel moderation tools
 * Commands: .naughty, .permissions, .dump, .newmembers, .clearinvites
 */
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getGuildDb }   = require('./database');
const { COLORS, base } = require('../utils/embeds');
const { chunk, sendPaginated } = require('../utils/paginator');

function staffCheck(ctx) {
    const { isStaffOrAdmin } = require('./helpers');
    return isStaffOrAdmin(ctx.member);
}
function getAuthorId(ctx) { return ctx.author?.id || ctx.user?.id; }

// ══════════════════════════════════════════════════════════
//  .naughty [#channel] — toggle NSFW on a text channel
// ══════════════════════════════════════════════════════════
async function handleNaughty(ctx, args) {
    if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const ch = ctx.mentions?.channels?.first() || ctx.channel;
    if (ch.type !== ChannelType.GuildText) return ctx.reply({ content: '❌ Only works on text channels.' });

    const newState = !ch.nsfw;
    await ch.setNSFW(newState, `Toggled by ${ctx.author?.tag || ctx.user?.tag}`);
    return ctx.reply({
        embeds: [base(newState ? COLORS.error : COLORS.success)
            .setTitle(`${newState ? '🔞 Channel Marked NSFW' : '✅ NSFW Removed'}`)
            .addFields({ name: 'Channel', value: `<#${ch.id}>`, inline: true }, { name: 'NSFW', value: newState ? 'Enabled' : 'Disabled', inline: true })],
    });
}

// ══════════════════════════════════════════════════════════
//  .permissions [#channel] — show permission overwrites
// ══════════════════════════════════════════════════════════
async function handlePermissions(ctx, args) {
    if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const ch = ctx.mentions?.channels?.first() || ctx.channel;

    const overwrites = [...ch.permissionOverwrites.cache.values()];
    if (!overwrites.length) return ctx.reply({ content: `No permission overwrites on <#${ch.id}>.` });

    const lines = [];
    for (const ow of overwrites) {
        const isRole = ow.type === 0;
        const entity = isRole
            ? (ctx.guild.roles.cache.get(ow.id)?.name ? `@${ctx.guild.roles.cache.get(ow.id).name}` : `Role \`${ow.id}\``)
            : `<@${ow.id}>`;

        const allowed = ow.allow.toArray();
        const denied  = ow.deny.toArray();
        const parts   = [];
        if (allowed.length) parts.push(`✅ Allow: \`${allowed.join('`, `')}\``);
        if (denied.length)  parts.push(`❌ Deny: \`${denied.join('`, `')}\``);

        if (parts.length) lines.push(`**${entity}**\n${parts.join('\n')}`);
    }

    const pages = chunk(lines, 5).map((pg, i) => ({
        title:       `🔐 Permissions — #${ch.name} (Page ${i + 1})`,
        description: pg.join('\n\n'),
        color:       COLORS.primary,
    }));

    return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
}

// ══════════════════════════════════════════════════════════
//  .dump roles|members|channels — data export
// ══════════════════════════════════════════════════════════
async function handleDump(ctx, args) {
    if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const sub = args[0]?.toLowerCase();

    // .dump roles
    if (sub === 'roles') {
        const roles = [...ctx.guild.roles.cache.values()]
            .filter(r => r.id !== ctx.guild.id)
            .sort((a, b) => b.position - a.position);
        const lines = roles.map(r => `<@&${r.id}> — \`${r.id}\` — **${r.members.size}** members — ${r.color !== 0 ? `\`#${r.color.toString(16).padStart(6,'0')}\`` : 'no color'}`);
        const pages = chunk(lines, 12).map((pg, i) => ({ title: `🎭 Roles [${roles.length}] — Page ${i + 1}`, description: pg.join('\n'), color: COLORS.primary }));
        return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
    }

    // .dump members [@role]
    if (sub === 'members') {
        const role = ctx.mentions?.roles?.first();
        await ctx.guild.members.fetch();
        let members = [...ctx.guild.members.cache.values()];
        if (role) members = members.filter(m => m.roles.cache.has(role.id));
        members = members.filter(m => !m.user.bot).sort((a, b) => a.user.username.localeCompare(b.user.username));
        if (!members.length) return ctx.reply({ content: `No members found${role ? ` with role <@&${role.id}>` : ''}.` });
        const lines = members.map(m => `<@${m.id}> — \`${m.id}\` — joined <t:${Math.floor(m.joinedTimestamp / 1000)}:D>`);
        const pages = chunk(lines, 15).map((pg, i) => ({
            title: `👥 Members${role ? ` with ${role.name}` : ''} [${members.length}] — Page ${i + 1}`,
            description: pg.join('\n'),
            color: COLORS.primary,
        }));
        return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
    }

    // .dump channels
    if (sub === 'channels') {
        const channels = [...ctx.guild.channels.cache.values()]
            .filter(c => !c.isThread())
            .sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || a.position - b.position);
        const lines = channels.map(c => `<#${c.id}> — \`${c.id}\` — ${c.type === ChannelType.GuildVoice ? '🔊 Voice' : c.type === ChannelType.GuildCategory ? '📂 Category' : '💬 Text'}${c.nsfw ? ' 🔞' : ''}`);
        const pages = chunk(lines, 15).map((pg, i) => ({ title: `📋 Channels [${channels.length}] — Page ${i + 1}`, description: pg.join('\n'), color: COLORS.primary }));
        return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
    }

    return ctx.reply({ embeds: [base(COLORS.primary).setTitle('📦 Dump Commands').setDescription([
        '`.dump roles` — all roles with member counts',
        '`.dump members [@role]` — all (human) members, optionally filtered by role',
        '`.dump channels` — all channels with type info',
    ].join('\n'))] });
}

// ══════════════════════════════════════════════════════════
//  .newmembers [days] — recently joined members
// ══════════════════════════════════════════════════════════
async function handleNewMembers(ctx, args) {
    if (!staffCheck(ctx)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
    const days   = Math.min(parseInt(args[0]) || 7, 30);
    const cutoff = Date.now() - days * 86_400_000;

    await ctx.guild.members.fetch();
    const recent = [...ctx.guild.members.cache.values()]
        .filter(m => !m.user.bot && m.joinedTimestamp > cutoff)
        .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);

    if (!recent.length) return ctx.reply({ content: `No new members in the last **${days}** day(s).` });

    const lines = recent.map((m, i) =>
        `**${i + 1}.** <@${m.id}> — joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>`
    );

    const pages = chunk(lines, 15).map((pg, i) => ({
        title:       `🆕 New Members — Last ${days} Day(s) [${recent.length}] — Page ${i + 1}`,
        description: pg.join('\n'),
        color:       COLORS.success,
    }));
    return sendPaginated(ctx.channel, pages, getAuthorId(ctx));
}

// ══════════════════════════════════════════════════════════
//  .clearinvites — delete all server invites
// ══════════════════════════════════════════════════════════
async function handleClearInvites(ctx, args) {
    const { isAdmin } = require('./helpers');
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isAdmin(getAuthorId(ctx)))
        return ctx.reply({ content: '❌ You need **Manage Server** permission.' });

    const invites = await ctx.guild.invites.fetch();
    if (!invites.size) return ctx.reply({ content: '✅ No invites to delete.' });

    let deleted = 0, failed = 0;
    for (const [, invite] of invites) {
        await invite.delete(`Invites cleared by ${ctx.author?.tag || ctx.user?.tag}`).then(() => deleted++).catch(() => failed++);
    }

    return ctx.reply({ embeds: [base(COLORS.success)
        .setTitle('🧹 Invites Cleared')
        .addFields(
            { name: '✅ Deleted', value: deleted.toString(), inline: true },
            { name: '❌ Failed',  value: failed.toString(),  inline: true },
            { name: '📊 Total',  value: invites.size.toString(), inline: true },
        )] });
}

module.exports = { handleNaughty, handlePermissions, handleDump, handleNewMembers, handleClearInvites };
