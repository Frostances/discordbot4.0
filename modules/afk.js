/**
 * afk.js — AFK system
 *
 * ,afk [message]   — marks the user as AFK
 * Pinging an AFK user → bot replies with their AFK status
 * AFK user sends a message → removes AFK, sends welcome back
 */

const { getGuildDb } = require('./database');
const { greedOk, greedWarn } = require('../utils/embeds');

// ── Helpers ────────────────────────────────────────────────────────────────

function humanDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)  return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
}

// ── Set AFK ────────────────────────────────────────────────────────────────

async function setAfk(message, args) {
    const db  = getGuildDb(message.guild.id);
    const afk = db.get('afk', {});

    const reason = args.join(' ').trim() || 'AFK';
    afk[message.author.id] = { since: Date.now(), reason };
    db.set('afk', afk);

    // Try to add [AFK] prefix to nickname
    try {
        const nick = message.member.displayName;
        if (!nick.startsWith('[AFK]')) {
            await message.member.setNickname(`[AFK] ${nick}`.slice(0, 32)).catch(() => {});
        }
    } catch {}

    return message.reply(greedOk(message.member, `You are now **AFK**: *${reason}*`));
}

// ── Check Pings (call from messageCreate) ─────────────────────────────────

async function checkAfkPing(message) {
    if (!message.guild || message.author.bot) return;

    const db  = getGuildDb(message.guild.id);
    const afk = db.get('afk', {});

    // ── Welcome back: AFK user sent a message ─────────────────────────────
    if (afk[message.author.id]) {
        const entry = afk[message.author.id];
        const elapsed = humanDuration(Date.now() - entry.since);
        delete afk[message.author.id];
        db.set('afk', afk);

        // Remove [AFK] prefix from nickname
        try {
            const nick = message.member.displayName;
            if (nick.startsWith('[AFK] ')) {
                await message.member.setNickname(nick.slice(6)).catch(() => {});
            }
        } catch {}

        try {
            await message.reply(greedOk(message.member,
                `Welcome back! You were AFK for **${elapsed}**.`));
        } catch {}
        return;
    }

    // ── Notify: someone pinged an AFK user ────────────────────────────────
    const mentioned = message.mentions.members;
    if (!mentioned?.size) return;

    const afkMentions = [];
    for (const [id, member] of mentioned) {
        if (afk[id]) {
            const entry = afk[id];
            const elapsed = humanDuration(Date.now() - entry.since);
            afkMentions.push(`**${member.user.username}** has been AFK for **${elapsed}**: *${entry.reason}*`);
        }
    }

    if (afkMentions.length) {
        try {
            await message.reply(greedWarn(message.member, afkMentions.join('\n')));
        } catch {}
    }
}

module.exports = { setAfk, checkAfkPing };
