const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

const joinTracker = new Map(); // guildId -> [timestamps]

async function handleMemberJoin(member) {
    const db = getGuildDb(member.guild.id);
    const cfg = db.get('antiraid', {});
    if (!cfg.enabled) return;

    const whitelist = cfg.whitelist || [];
    if (whitelist.includes(member.id)) return;

    // New account detection
    if (cfg.newAccounts) {
        const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        const minAge = cfg.minAccountAge || 7;
        if (ageDays < minAge) {
            await punishMember(member, cfg.newAccountAction || 'kick', `AntiRaid: Account too new (${Math.round(ageDays)} days)`);
            await logRaid(member.guild, `🚨 New account blocked: **${member.user.tag}** (${Math.round(ageDays)} days old)`, cfg);
            return;
        }
    }

    // Avatar requirement
    if (cfg.avatarRequired && !member.user.avatar) {
        await punishMember(member, cfg.avatarAction || 'kick', 'AntiRaid: No avatar');
        await logRaid(member.guild, `🚨 No-avatar account blocked: **${member.user.tag}**`, cfg);
        return;
    }

    // Mass join detection
    if (cfg.massJoin) {
        const gid = member.guild.id;
        if (!joinTracker.has(gid)) joinTracker.set(gid, []);
        const times = joinTracker.get(gid);
        times.push(Date.now());
        // Keep only last 10 seconds
        const recent = times.filter(t => Date.now() - t < 10000);
        joinTracker.set(gid, recent);
        const limit = cfg.massJoinLimit || 10;
        if (recent.length >= limit) {
            // Raid detected
            const state = db.get('raidState', false);
            if (!state) {
                db.set('raidState', true);
                await logRaid(member.guild, `🚨 **RAID DETECTED** — ${recent.length} joins in 10 seconds. Raid mode activated.`, cfg);
            }
        }
    }

    // If raid state active, action new joins
    if (db.get('raidState', false)) {
        await punishMember(member, cfg.raidAction || 'kick', 'AntiRaid: Raid in progress');
    }
}

async function punishMember(member, action, reason) {
    try {
        if (action === 'ban') await member.ban({ reason });
        else if (action === 'kick') await member.kick(reason);
        else if (action === 'timeout') await member.timeout(10 * 60 * 1000, reason);
    } catch {}
}

async function logRaid(guild, text, cfg) {
    if (!cfg.logChannel) return;
    const ch = guild.channels.cache.get(cfg.logChannel);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setTitle('🚨 AntiRaid').setDescription(text).setColor('#FF0000').setTimestamp()] }).catch(() => {});
}

async function handleAntiRaidCommand(message, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(message.member) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only administrators can configure AntiRaid.');
    }

    const db = getGuildDb(message.guild.id);
    const cfg = db.get('antiraid', { enabled: false });
    const sub = args[0];

    if (!sub) {
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🚨 AntiRaid Configuration')
            .setColor('#FF4444')
            .addFields(
                { name: 'Enabled', value: cfg.enabled ? '✅' : '❌', inline: true },
                { name: 'Raid State', value: db.get('raidState', false) ? '🔴 ACTIVE' : '🟢 Normal', inline: true },
                { name: 'Mass Join', value: cfg.massJoin ? `✅ (limit: ${cfg.massJoinLimit || 10}/10s)` : '❌', inline: true },
                { name: 'New Accounts', value: cfg.newAccounts ? `✅ (min: ${cfg.minAccountAge || 7} days)` : '❌', inline: true },
                { name: 'Avatar Required', value: cfg.avatarRequired ? '✅' : '❌', inline: true },
                { name: 'Whitelist', value: (cfg.whitelist || []).map(id => `<@${id}>`).join(', ') || 'None' }
            )
            .setFooter({ text: '.antiraid enable | .antiraid state | .antiraid massjoin | .antiraid newaccounts | .antiraid avatar' })] });
    }

    if (sub === 'enable') { cfg.enabled = true; db.set('antiraid', cfg); return message.reply('✅ AntiRaid **enabled**.'); }
    if (sub === 'disable') { cfg.enabled = false; db.set('antiraid', cfg); return message.reply('🔴 AntiRaid **disabled**.'); }

    if (sub === 'state') {
        const state = !db.get('raidState', false);
        db.set('raidState', state);
        return message.reply(`Raid mode is now **${state ? '🔴 ACTIVE' : '🟢 Normal'}**.`);
    }

    if (sub === 'massjoin') {
        cfg.massJoin = !cfg.massJoin;
        const limit = parseInt(args[1]);
        if (!isNaN(limit)) cfg.massJoinLimit = limit;
        db.set('antiraid', cfg);
        return message.reply(`✅ Mass join detection **${cfg.massJoin ? 'enabled' : 'disabled'}**${!isNaN(limit) ? ` (limit: ${limit}/10s)` : ''}.`);
    }

    if (sub === 'newaccounts') {
        cfg.newAccounts = !cfg.newAccounts;
        const days = parseInt(args[1]);
        if (!isNaN(days)) cfg.minAccountAge = days;
        db.set('antiraid', cfg);
        return message.reply(`✅ New account filter **${cfg.newAccounts ? 'enabled' : 'disabled'}**${!isNaN(days) ? ` (min age: ${days} days)` : ''}.`);
    }

    if (sub === 'avatar') {
        cfg.avatarRequired = !cfg.avatarRequired;
        db.set('antiraid', cfg);
        return message.reply(`✅ Avatar requirement **${cfg.avatarRequired ? 'enabled' : 'disabled'}**.`);
    }

    if (sub === 'config') {
        const ch = message.mentions.channels.first();
        if (ch) { cfg.logChannel = ch.id; db.set('antiraid', cfg); return message.reply(`✅ AntiRaid logs → <#${ch.id}>.`); }
        return message.reply('❌ Mention a log channel: `.antiraid config #channel`');
    }

    if (sub === 'whitelist') {
        const action = args[1];
        const target = message.mentions.users.first();
        cfg.whitelist = cfg.whitelist || [];
        if (!target) {
            if (action === 'view') {
                return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🚨 AntiRaid Whitelist')
                    .setDescription(cfg.whitelist.map(id => `<@${id}>`).join('\n') || 'Empty').setColor('#5865F2')] });
            }
            return message.reply('❌ Mention a user.');
        }
        if (action === 'add' && !cfg.whitelist.includes(target.id)) cfg.whitelist.push(target.id);
        else if (action === 'remove') cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
        db.set('antiraid', cfg);
        return message.reply(`✅ <@${target.id}> ${action === 'add' ? 'added to' : 'removed from'} whitelist.`);
    }

    return message.reply('❌ Unknown subcommand. Use `.antiraid` for help.');
}

module.exports = { handleMemberJoin, handleAntiRaidCommand };
