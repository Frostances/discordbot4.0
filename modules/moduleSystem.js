const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS } = require('../utils/embeds');

// All available modules. name -> default enabled
const MODULES = {
    moderation:   { label: 'Moderation',   emoji: '🔨', description: 'Kick, ban, warn, purge, etc.' },
    automod:      { label: 'AutoMod',      emoji: '🤖', description: 'Automatic message filtering' },
    antinuke:     { label: 'AntiNuke',     emoji: '🛡️', description: 'Protect against nukes' },
    antiraid:     { label: 'AntiRaid',     emoji: '🚨', description: 'Detect and stop raids' },
    levels:       { label: 'Levels',       emoji: '📊', description: 'XP and level system' },
    tickets:      { label: 'Tickets',      emoji: '🎫', description: 'Support ticket system' },
    voicemaster:  { label: 'VoiceMaster',  emoji: '🎙️', description: 'Temporary voice channels' },
    streaks:      { label: 'Streaks',      emoji: '🔥', description: 'Daily streak tracking' },
    swears:       { label: 'Swear Tracking', emoji: '🤬', description: 'Track swear word usage' },
    guessword:    { label: 'GuessWord',    emoji: '🎯', description: 'Word guessing game' },
};

function getModules(guildId) {
    const db = getGuildDb(guildId);
    return db.get('modules', {});
}

function isModuleEnabled(guildId, moduleName) {
    const mods = getModules(guildId);
    // Default all enabled unless explicitly disabled
    return mods[moduleName] !== false;
}

async function handleModuleCommand(message, args) {
    const { isStaffOrAdmin } = require('./helpers');
    if (!isStaffOrAdmin(message.member)) return message.reply('❌ No permission.');

    const db = getGuildDb(message.guild.id);
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'list') {
        const mods = getModules(message.guild.id);
        const lines = Object.entries(MODULES).map(([key, val]) => {
            const enabled = mods[key] !== false;
            return `${val.emoji} **${val.label}** — ${enabled ? '✅ Enabled' : '❌ Disabled'}\n↳ ${val.description}`;
        });

        const embed = new EmbedBuilder()
            .setTitle('🧩 Module Status')
            .setDescription(lines.join('\n\n'))
            .setColor(COLORS.primary)
            .setFooter({ text: 'Use .config module enable/disable <name>' })
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    if (sub === 'enable' || sub === 'disable') {
        const name = args[1]?.toLowerCase();
        if (!name || !MODULES[name]) {
            return message.reply(`❌ Unknown module. Valid: ${Object.keys(MODULES).join(', ')}`);
        }
        const mods = getModules(message.guild.id);
        mods[name] = sub === 'enable';
        db.set('modules', mods);
        const mod = MODULES[name];
        return message.reply(`${sub === 'enable' ? '✅' : '🔴'} **${mod.label}** module **${sub}d**.`);
    }

    return message.reply('❌ Usage: `.config module list` | `.config module enable <name>` | `.config module disable <name>`');
}

module.exports = { MODULES, isModuleEnabled, getModules, handleModuleCommand };
