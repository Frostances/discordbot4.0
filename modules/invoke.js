/**
 * invoke.js — Custom moderation response messages
 *
 * Customize the channel reply and DM sent after moderation actions.
 *
 * Storage: guild DB 'invokeMessages' → { [action]: { message: string, dm: string } }
 *
 * Supported actions:
 *   ban, hardban, softban, tempban, unban,
 *   kick, jail, unjail, mute, unmute, imute, iunmute, rmute, runmute,
 *   timeout, untimeout, warn
 *
 * Commands:
 *   ,invoke <action> message <text or embed code>
 *   ,invoke <action> dm <text or embed code>
 *   ,invoke <action> message view
 *   ,invoke <action> dm view
 *   ,invoke                  → show overview
 *
 * Variables in messages:
 *   {user.mention} {user.name} {reason} {duration} {moderator.mention} {moderator.name}
 *   {guild.name} {guild.id} {date.now} {time.now}
 */

const { getGuildDb } = require('./database');
const { greedOk, greedWarn, base, COLORS } = require('../utils/embeds');
const { parseEmbedCode } = require('./welcomeSystem');

const VALID_ACTIONS = new Set([
    'ban', 'hardban', 'softban', 'tempban', 'unban',
    'kick', 'jail', 'unjail',
    'mute', 'unmute', 'imute', 'iunmute', 'rmute', 'runmute',
    'timeout', 'untimeout', 'warn',
]);

// ── Get stored invoke message ──────────────────────────────────────────────

function getInvokeMessage(guildId, action, type = 'message') {
    const db  = getGuildDb(guildId);
    const inv = db.get('invokeMessages', {});
    return inv[action]?.[type] || null;
}

// ── Build variable map ─────────────────────────────────────────────────────

function buildInvokeVars(opts = {}) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return {
        '{user.mention}':       opts.targetMention  || 'N/A',
        '{user.name}':          opts.targetName      || 'N/A',
        '{user.id}':            opts.targetId        || 'N/A',
        '{moderator.mention}':  opts.modMention      || 'N/A',
        '{moderator.name}':     opts.modName         || 'N/A',
        '{reason}':             opts.reason          || 'No reason provided',
        '{duration}':           opts.duration        || 'N/A',
        '{guild.name}':         opts.guildName       || 'N/A',
        '{guild.id}':           opts.guildId         || 'N/A',
        '{date.now}':           `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}`,
        '{time.now}':           now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true }),
    };
}

// ── Send DM to target using invoke DM template ─────────────────────────────

async function sendInvokeDm(targetUser, guildId, action, vars = {}) {
    const template = getInvokeMessage(guildId, action, 'dm');
    if (!template) return;
    try {
        const { content, embed, components } = parseEmbedCode(template, buildInvokeVars(vars));
        const payload = {};
        if (content)            payload.content    = content;
        if (embed)              payload.embeds     = [embed];
        if (components?.length) payload.components = components;
        if (!payload.content && !payload.embeds) return;
        await targetUser.send(payload).catch(() => {});
    } catch {}
}

// ── Get channel reply payload using invoke message template ───────────────

function getInvokeReply(guildId, action, vars = {}) {
    const template = getInvokeMessage(guildId, action, 'message');
    if (!template) return null;
    try {
        const { content, embed, components } = parseEmbedCode(template, buildInvokeVars(vars));
        const payload = {};
        if (content)            payload.content    = content;
        if (embed)              payload.embeds     = [embed];
        if (components?.length) payload.components = components;
        return (payload.content || payload.embeds) ? payload : null;
    } catch { return null; }
}

// ── Command handler ────────────────────────────────────────────────────────

async function handleInvokeCommand(message, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(message.member) && !message.member.permissions.has(BigInt(0x00000020))) { // ManageGuild
        return message.reply(greedWarn(message.member, 'You need **Manage Guild** or admin to configure invoke messages.'));
    }

    const db  = getGuildDb(message.guild.id);
    const inv = db.get('invokeMessages', {});
    const action = (args[0] || '').toLowerCase();
    const type   = (args[1] || '').toLowerCase();  // 'message' or 'dm'

    // ── Overview ──────────────────────────────────────────────────────────
    if (!action) {
        const configured = Object.entries(inv)
            .filter(([, v]) => v.message || v.dm)
            .map(([a, v]) => `**${a}** — ${[v.message && 'msg', v.dm && 'dm'].filter(Boolean).join(', ')}`);

        return message.channel.send({ embeds: [
            base(COLORS.primary)
                .setTitle('📢 Invoke Messages')
                .setDescription(
                    '**Customize moderation command replies and DMs.**\n\n' +
                    '`,invoke <action> message <text or embed code>`\n' +
                    '`,invoke <action> dm <text or embed code>`\n' +
                    '`,invoke <action> message view` — view current message\n' +
                    '`,invoke <action> dm view` — view current dm\n\n' +
                    '**Actions:** `' + [...VALID_ACTIONS].join('`, `') + '`\n\n' +
                    '**Variables:** `{user.mention}` `{user.name}` `{reason}` `{duration}` `{moderator.mention}` `{guild.name}` `{date.now}` `{time.now}`\n\n' +
                    (configured.length ? '**Configured:**\n' + configured.join('\n') : '*None configured yet.*')
                ),
        ] });
    }

    if (!VALID_ACTIONS.has(action))
        return message.reply(greedWarn(message.member,
            `Unknown action \`${action}\`. Valid: \`${[...VALID_ACTIONS].join(', ')}\``));

    if (type !== 'message' && type !== 'dm')
        return message.reply(greedWarn(message.member,
            `Usage: \`,invoke ${action} <message|dm> <text>\``));

    const rest = args.slice(2).join(' ').trim();

    // ── View ──────────────────────────────────────────────────────────────
    if (rest === 'view' || !rest) {
        const current = inv[action]?.[type];
        if (!current)
            return message.reply(greedWarn(message.member,
                `No custom **${type}** set for \`${action}\`.`));
        return message.channel.send({ embeds: [
            base(COLORS.info)
                .setTitle(`📢 Invoke: ${action} ${type}`)
                .setDescription(`\`\`\`\n${current.slice(0, 1900)}\n\`\`\``),
        ] });
    }

    // ── Set ───────────────────────────────────────────────────────────────
    if (!inv[action]) inv[action] = {};
    inv[action][type] = rest;
    db.set('invokeMessages', inv);
    return message.reply(greedOk(message.member,
        `**Invoke ${type}** for \`${action}\` has been updated.`));
}

module.exports = { handleInvokeCommand, getInvokeMessage, getInvokeReply, sendInvokeDm };
