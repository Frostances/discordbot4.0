const { EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');

// Track rapid actions per user
const actionTracker = new Map(); // key: `guildId:userId:type` -> { count, timer }

function track(guildId, userId, type, limit) {
    const key = `${guildId}:${userId}:${type}`;
    const now = Date.now();
    if (!actionTracker.has(key)) actionTracker.set(key, { count: 0, first: now });
    const entry = actionTracker.get(key);
    if (now - entry.first > 10000) { entry.count = 1; entry.first = now; }
    else entry.count++;
    if (entry.count >= limit) {
        actionTracker.delete(key);
        return true; // triggered
    }
    return false;
}

async function handleAntiNuke(client, guild, type, executorId) {
    const db = getGuildDb(guild.id);
    const cfg = db.get('antinuke', {});
    if (!cfg.enabled) return;

    const modules = cfg.modules || {};
    if (!modules[type]) return;

    // Whitelist check
    const whitelist = cfg.whitelist || [];
    if (whitelist.includes(executorId)) return;

    const limit = modules[type].limit || 3;
    const triggered = track(guild.id, executorId, type, limit);
    if (!triggered) return;

    // Punish
    const action = modules[type].action || 'ban';
    const logChannelId = cfg.logChannel;

    try {
        const member = await guild.members.fetch(executorId).catch(() => null);
        if (member) {
            if (action === 'ban') await guild.bans.create(executorId, { reason: `AntiNuke: ${type}` }).catch(() => {});
            else if (action === 'kick') await member.kick(`AntiNuke: ${type}`).catch(() => {});
            else if (action === 'strip') {
                const dangerousPerms = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers];
                for (const role of member.roles.cache.values()) {
                    if (dangerousPerms.some(p => role.permissions.has(p))) {
                        await member.roles.remove(role).catch(() => {});
                    }
                }
            }
        }
    } catch {}

    if (logChannelId) {
        const ch = guild.channels.cache.get(logChannelId);
        if (ch) {
            await ch.send({ embeds: [new EmbedBuilder()
                .setTitle('🛡️ AntiNuke Triggered')
                .setColor('#FF0000')
                .addFields(
                    { name: 'Type', value: type, inline: true },
                    { name: 'Executor', value: `<@${executorId}> (${executorId})`, inline: true },
                    { name: 'Action', value: action, inline: true }
                )
                .setTimestamp()] }).catch(() => {});
        }
    }
}

async function handleAntiNukeCommand(message, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only administrators can configure AntiNuke.');
    }

    const db = getGuildDb(message.guild.id);
    const cfg = db.get('antinuke', { enabled: false, modules: {}, whitelist: [] });
    const sub = args[0];

    if (!sub || sub === 'list') {
        const mods = cfg.modules || {};
        const lines = Object.entries(mods).map(([k, v]) => `**${k}**: limit=${v.limit}, action=${v.action}`);
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🛡️ AntiNuke Status')
            .setColor('#FF4444')
            .addFields(
                { name: 'Enabled', value: cfg.enabled ? '✅' : '❌', inline: true },
                { name: 'Whitelist', value: (cfg.whitelist || []).map(id => `<@${id}>`).join(', ') || 'None', inline: true },
                { name: 'Modules', value: lines.join('\n') || 'None configured' }
            )
            .setFooter({ text: '.antinuke enable | .antinuke <module> <limit> <action>' })] });
    }

    if (sub === 'enable') { cfg.enabled = true; db.set('antinuke', cfg); return message.reply('✅ AntiNuke **enabled**.'); }
    if (sub === 'disable') { cfg.enabled = false; db.set('antinuke', cfg); return message.reply('🔴 AntiNuke **disabled**.'); }

    if (sub === 'whitelist') {
        const action = args[1];
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mention a user.');
        cfg.whitelist = cfg.whitelist || [];
        if (action === 'add') {
            if (!cfg.whitelist.includes(target.id)) cfg.whitelist.push(target.id);
            db.set('antinuke', cfg);
            return message.reply(`✅ <@${target.id}> whitelisted from AntiNuke.`);
        }
        if (action === 'remove') {
            cfg.whitelist = cfg.whitelist.filter(id => id !== target.id);
            db.set('antinuke', cfg);
            return message.reply(`✅ <@${target.id}> removed from whitelist.`);
        }
        if (action === 'view') {
            const list = cfg.whitelist.map(id => `<@${id}>`).join('\n') || 'Empty';
            return message.channel.send({ embeds: [new EmbedBuilder().setTitle('🛡️ AntiNuke Whitelist').setDescription(list).setColor('#5865F2')] });
        }
    }

    if (sub === 'config') {
        const logCh = message.mentions.channels.first();
        if (logCh) { cfg.logChannel = logCh.id; db.set('antinuke', cfg); return message.reply(`✅ AntiNuke logs → <#${logCh.id}>.`); }
        return message.reply('❌ Mention a log channel.');
    }

    // Module config: .antinuke channel 3 ban
    const modules = ['channel', 'role', 'ban', 'kick', 'webhook', 'botadd', 'emoji', 'vanity', 'permissions'];
    if (modules.includes(sub)) {
        const limit = parseInt(args[1]) || 3;
        const action = args[2] || 'ban';
        cfg.modules = cfg.modules || {};
        cfg.modules[sub] = { limit, action };
        db.set('antinuke', cfg);
        return message.reply(`✅ AntiNuke **${sub}**: limit=${limit}, action=${action}.`);
    }

    if (sub === 'admin') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('❌ Mention a user.');
        cfg.whitelist = cfg.whitelist || [];
        if (!cfg.whitelist.includes(target.id)) cfg.whitelist.push(target.id);
        db.set('antinuke', cfg);
        return message.reply(`✅ <@${target.id}> added as AntiNuke admin (whitelisted).`);
    }

    return message.reply(`❌ Unknown subcommand. Modules: ${modules.join(', ')}`);
}

// Attach audit log listeners
async function setupAntiNukeListeners(client) {
    client.on('guildAuditLogEntryCreate', async (entry, guild) => {
        if (!guild) return;
        const executorId = entry.executorId;
        if (!executorId) return;

        const typeMap = {
            [AuditLogEvent.ChannelCreate]: 'channel',
            [AuditLogEvent.ChannelDelete]: 'channel',
            [AuditLogEvent.RoleCreate]: 'role',
            [AuditLogEvent.RoleDelete]: 'role',
            [AuditLogEvent.MemberBanAdd]: 'ban',
            [AuditLogEvent.MemberKick]: 'kick',
            [AuditLogEvent.WebhookCreate]: 'webhook',
            [AuditLogEvent.BotAdd]: 'botadd',
            [AuditLogEvent.EmojiCreate]: 'emoji',
            [AuditLogEvent.EmojiDelete]: 'emoji',
            [AuditLogEvent.GuildUpdate]: 'vanity',
            [AuditLogEvent.RoleUpdate]: 'permissions',
        };

        const type = typeMap[entry.action];
        if (type) await handleAntiNuke(client, guild, type, executorId);
    });
}

module.exports = { handleAntiNukeCommand, setupAntiNukeListeners };
