/**
 * stats.js — User Stats System
 *
 * Commands:
 *   .voicetime [@user]   — voice time stats (today, week, month)
 *   .messages [@user]     — message stats (today, week, month)
 *   .streamtime [@user]   — stream time stats (today, week, month)
 *   .cameratime [@user]   — camera time stats (today, week, month)
 *
 * Storage (guild DB):
 *   'vcStats'     → { [guildId]: { [userId]: { totalMs, daily, weekly, monthly, streamMs, cameraMs, streamDaily, cameraDaily, lastJoin, lastStreamJoin, lastCameraJoin, inVc, streaming, cameraOn } } }
 *   'messageStats'  → { [guildId]: { [userId]: { daily: {}, weekly: {}, monthly: {}, total: 0 } } }
 */

const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { base, COLORS } = require('../utils/embeds');

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function getWeekKey() {
    const d = new Date();
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().split('T')[0];
}

function getMonthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return '0m';
    const totalMinutes = Math.floor(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return hours + 'h ' + minutes + 'm';
    if (hours > 0) return hours + 'h';
    return minutes + 'm';
}

/**
 * Calculate total from daily entries for a given date range.
 * For week: sums last 7 days (including today).
 * For month: sums all entries matching current month prefix.
 */
function getDailyTotal(data, period, field) {
    const obj = data[field] || {};
    if (period === 'today') {
        return obj[getTodayStr()] || 0;
    }
    if (period === 'week') {
        // Sum all daily entries from the last 7 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 6);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        let total = 0;
        for (const [date, ms] of Object.entries(obj)) {
            if (date >= cutoffStr) total += ms;
        }
        return total;
    }
    if (period === 'month') {
        // Sum all daily entries for current month
        const monthPrefix = getMonthKey(); // e.g. "2026-07"
        let total = 0;
        for (const [date, ms] of Object.entries(obj)) {
            if (date.startsWith(monthPrefix)) total += ms;
        }
        return total;
    }
    return 0;
}

/**
 * Add live session time if user is currently in VC/streaming/camera.
 */
function addLiveTime(data, field, period) {
    const now = Date.now();
    let extra = 0;

    if (field === 'daily' && data.inVc && data.lastJoin) {
        extra = now - data.lastJoin;
    }
    if (field === 'streamDaily' && data.streaming && data.lastStreamJoin) {
        extra = now - data.lastStreamJoin;
    }
    if (field === 'cameraDaily' && data.cameraOn && data.lastCameraJoin) {
        extra = now - data.lastCameraJoin;
    }

    // For week/month, only add if the session started within the period
    if (period === 'today') return extra;
    if (period === 'week') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 6);
        const sessionStart = field === 'daily' ? data.lastJoin :
                            field === 'streamDaily' ? data.lastStreamJoin :
                            field === 'cameraDaily' ? data.lastCameraJoin : null;
        if (sessionStart) {
            const sessionStartStr = new Date(sessionStart).toISOString().split('T')[0];
            if (sessionStartStr >= cutoff.toISOString().split('T')[0]) return extra;
        }
        return 0;
    }
    if (period === 'month') {
        const monthPrefix = getMonthKey();
        const sessionStart = field === 'daily' ? data.lastJoin :
                            field === 'streamDaily' ? data.lastStreamJoin :
                            field === 'cameraDaily' ? data.lastCameraJoin : null;
        if (sessionStart) {
            const sessionStartStr = new Date(sessionStart).toISOString().split('T')[0];
            if (sessionStartStr.startsWith(monthPrefix)) return extra;
        }
        return 0;
    }
    return 0;
}

// ─── Message Tracking ───────────────────────────────────────────────────────────

function trackMessage(guildId, userId, db) {
    const stats = db.get('messageStats', {});
    if (!stats[guildId]) stats[guildId] = {};
    if (!stats[guildId][userId]) {
        stats[guildId][userId] = { daily: {}, weekly: {}, monthly: {}, total: 0 };
    }
    const today = getTodayStr();
    const week = getWeekKey();
    const month = getMonthKey();

    stats[guildId][userId].daily[today] = (stats[guildId][userId].daily[today] || 0) + 1;
    stats[guildId][userId].weekly[week] = (stats[guildId][userId].weekly[week] || 0) + 1;
    stats[guildId][userId].monthly[month] = (stats[guildId][userId].monthly[month] || 0) + 1;
    stats[guildId][userId].total += 1;
    db.set('messageStats', stats);
}

// ─── Stats Embed Builder ──────────────────────────────────────────────────────

async function buildStatsEmbed(title, icon, color, target, todayVal, weekVal, monthVal, formatter) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(icon + ' ' + title + ' — ' + (target.displayName || target.user?.username || 'Unknown'))
        .setThumbnail(target.displayAvatarURL?.() || target.user?.displayAvatarURL?.() || null)
        .addFields(
            { name: '\u200B', value: '**📅 Today**\n' + formatter(todayVal), inline: true },
            { name: '\u200B', value: '**📆 This Week**\n' + formatter(weekVal), inline: true },
            { name: '\u200B', value: '**📊 This Month**\n' + formatter(monthVal), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Kaido Stats' });
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleVoiceTimeStats(message, args) {
    const target = message.mentions.members?.first() || message.member;
    const db = getGuildDb(message.guild.id);
    const stats = db.get('vcStats', {});
    const userData = (stats[message.guild.id] || {})[target.id] || {};

    const todayMs = getDailyTotal(userData, 'today', 'daily') + addLiveTime(userData, 'daily', 'today');
    const weekMs = getDailyTotal(userData, 'week', 'daily') + addLiveTime(userData, 'daily', 'week');
    const monthMs = getDailyTotal(userData, 'month', 'daily') + addLiveTime(userData, 'daily', 'month');

    const embed = await buildStatsEmbed('Voice Time', '\uD83C\uDF99', '#5865F2', target, todayMs, weekMs, monthMs, formatDuration);
    return message.reply({ embeds: [embed] });
}

async function handleMessageStats(message, args) {
    const target = message.mentions.members?.first() || message.member;
    const db = getGuildDb(message.guild.id);
    const stats = db.get('messageStats', {});
    const userData = (stats[message.guild.id] || {})[target.id] || { daily: {}, weekly: {}, monthly: {}, total: 0 };

    const todayCount = userData.daily[getTodayStr()] || 0;
    const weekCount = userData.weekly[getWeekKey()] || 0;
    const monthCount = userData.monthly[getMonthKey()] || 0;

    const embed = await buildStatsEmbed('Messages', '\uD83D\uDCAC', '#57F287', target, todayCount, weekCount, monthCount, v => (v || 0) + ' messages');
    return message.reply({ embeds: [embed] });
}

async function handleStreamTimeStats(message, args) {
    const target = message.mentions.members?.first() || message.member;
    const db = getGuildDb(message.guild.id);
    const stats = db.get('vcStats', {});
    const userData = (stats[message.guild.id] || {})[target.id] || {};

    const todayMs = getDailyTotal(userData, 'today', 'streamDaily') + addLiveTime(userData, 'streamDaily', 'today');
    const weekMs = getDailyTotal(userData, 'week', 'streamDaily') + addLiveTime(userData, 'streamDaily', 'week');
    const monthMs = getDailyTotal(userData, 'month', 'streamDaily') + addLiveTime(userData, 'streamDaily', 'month');

    const embed = await buildStatsEmbed('Stream Time', '\uD83D\uDCE1', '#FF69B4', target, todayMs, weekMs, monthMs, formatDuration);
    return message.reply({ embeds: [embed] });
}

async function handleCameraTimeStats(message, args) {
    const target = message.mentions.members?.first() || message.member;
    const db = getGuildDb(message.guild.id);
    const stats = db.get('vcStats', {});
    const userData = (stats[message.guild.id] || {})[target.id] || {};

    const todayMs = getDailyTotal(userData, 'today', 'cameraDaily') + addLiveTime(userData, 'cameraDaily', 'today');
    const weekMs = getDailyTotal(userData, 'week', 'cameraDaily') + addLiveTime(userData, 'cameraDaily', 'week');
    const monthMs = getDailyTotal(userData, 'month', 'cameraDaily') + addLiveTime(userData, 'cameraDaily', 'month');

    const embed = await buildStatsEmbed('Camera Time', '\uD83D\uDCF7', '#FF8C00', target, todayMs, weekMs, monthMs, formatDuration);
    return message.reply({ embeds: [embed] });
}

module.exports = {
    handleVoiceTimeStats,
    handleMessageStats,
    handleStreamTimeStats,
    handleCameraTimeStats,
    trackMessage,
};