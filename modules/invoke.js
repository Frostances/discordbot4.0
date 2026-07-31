/**
 * invoke.js — Invoke Message System
 * 
 * Customizes bot responses and DMs for moderation commands.
 * Commands supported: jail, kick, ban, tempban, softban, hardban, timeout, warn
 * 
 * Variables:
 * {user.mention} {user.name} {user.id} {user.avatar}
 * {mod.mention} {mod.name} {mod.id} {mod.icon}
 * {moderator.mention} {moderator.name} {moderator.id} {moderator.icon}
 * {reason} {guild.name} {guild.id} {guild.icon}
 * {case.id} {duration} {timestamp}
 */

const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// DEFAULT MESSAGES
// ══════════════════════════════════════════════════════════
const DEFAULT_MESSAGES = {
    jail:    { message: '👍', dm: 'You have been jailed in **{guild.name}**.' },
    kick:    { message: '👍', dm: 'You have been kicked from **{guild.name}**.\nReason: {reason}' },
    ban:     { message: '👍', dm: 'You have been banned from **{guild.name}**.\nReason: {reason}' },
    tempban: { message: '👍', dm: 'You have been temporarily banned from **{guild.name}**.\nDuration: {duration}\nReason: {reason}' },
    softban: { message: '👍', dm: 'You have been softbanned from **{guild.name}** (messages cleared).\nReason: {reason}' },
    hardban: { message: '👍', dm: 'You have been permanently banned from **{guild.name}**.\nReason: {reason}' },
    timeout: { message: '👍', dm: 'You have been timed out in **{guild.name}**.\nDuration: {duration}\nReason: {reason}' },
    warn:    { message: '👍', dm: 'You have received a warning in **{guild.name}**.\nReason: {reason}' },
};

const VALID_COMMANDS = Object.keys(DEFAULT_MESSAGES);

// ══════════════════════════════════════════════════════════
// VARIABLE REPLACEMENT
// Supports both {mod.xxx} and {moderator.xxx} aliases
// ══════════════════════════════════════════════════════════
function replaceVars(template, vars) {
    if (!template) return template;

    let result = template;

    // User variables
    result = result.replace(/{user\.mention}/gi, vars.targetMention || vars.userMention || '{user.mention}');
    result = result.replace(/{user\.name}/gi, vars.targetName || vars.userName || '{user.name}');
    result = result.replace(/{user\.id}/gi, vars.targetId || vars.userId || '{user.id}');
    result = result.replace(/{user\.avatar}/gi, vars.targetAvatar || vars.userAvatar || '');

    // Mod variables (both {mod.xxx} and {moderator.xxx})
    const modMention = vars.modMention || vars.moderatorMention || '{mod.mention}';
    const modName = vars.modName || vars.moderatorName || '{mod.name}';
    const modId = vars.modId || vars.moderatorId || '{mod.id}';
    const modIcon = vars.modIcon || vars.moderatorIcon || vars.modAvatar || vars.moderatorAvatar || '';

    result = result.replace(/{mod\.mention}/gi, modMention);
    result = result.replace(/{moderator\.mention}/gi, modMention);
    result = result.replace(/{mod\.name}/gi, modName);
    result = result.replace(/{moderator\.name}/gi, modName);
    result = result.replace(/{mod\.id}/gi, modId);
    result = result.replace(/{moderator\.id}/gi, modId);
    result = result.replace(/{mod\.icon}/gi, modIcon);
    result = result.replace(/{moderator\.icon}/gi, modIcon);
    result = result.replace(/{mod\.avatar}/gi, modIcon);
    result = result.replace(/{moderator\.avatar}/gi, modIcon);

    // Guild variables
    result = result.replace(/{guild\.name}/gi, vars.guildName || '{guild.name}');
    result = result.replace(/{guild\.id}/gi, vars.guildId || '{guild.id}');
    result = result.replace(/{guild\.icon}/gi, vars.guildIcon || '');

    // Other variables
    result = result.replace(/{reason}/gi, vars.reason || 'No reason provided');
    result = result.replace(/{case\.id}/gi, vars.caseId || '{case.id}');
    result = result.replace(/{duration}/gi, vars.duration || '');
    result = result.replace(/{timestamp}/gi, '<t:' + Math.floor(Date.now() / 1000) + ':F>');

    return result;
}

// ══════════════════════════════════════════════════════════
// PARSE EMBED CODE
// Handles {embed}$v{...} format with invoke variables
// ══════════════════════════════════════════════════════════
function parseEmbedCode(raw, vars) {
    const text = replaceVars(raw, vars);

    if (!text.trim().startsWith('{embed}')) {
        return { content: text, embeds: [], components: [] };
    }

    const embed = new EmbedBuilder();
    let content = '';

    // Remove {embed} prefix
    const body = text.replace(/^\{embed\}/i, '').trim();

    // Parse $v{...} segments
    const segments = body.split(/\$v\{/g).filter(s => s.trim());

    for (const seg of segments) {
        const clean = seg.replace(/\}$/, '').trim();
        if (!clean) continue;

        const colonIdx = clean.indexOf(':');
        if (colonIdx === -1) continue;

        const key = clean.slice(0, colonIdx).trim().toLowerCase();
        const value = clean.slice(colonIdx + 1).trim();

        switch (key) {
            case 'message':
            case 'content':
                content = value;
                break;
            case 'title':
                embed.setTitle(value);
                break;
            case 'description':
                embed.setDescription(value);
                break;
            case 'color':
                embed.setColor(value.replace('#', ''));
                break;
            case 'footer':
                // Handle "text && iconURL" format
                const footerParts = value.split(/\s*&&\s*/);
                embed.setFooter({ 
                    text: footerParts[0] || '', 
                    iconURL: footerParts[1] || undefined 
                });
                break;
            case 'author':
                // Handle "name && iconURL" format
                const authorParts = value.split(/\s*&&\s*/);
                embed.setAuthor({ 
                    name: authorParts[0] || '', 
                    iconURL: authorParts[1] || undefined 
                });
                break;
            case 'thumbnail':
                embed.setThumbnail(value);
                break;
            case 'image':
                embed.setImage(value);
                break;
            case 'timestamp':
                embed.setTimestamp();
                break;
            case 'field':
                // Parse field: "Name && Value inline" or "Name && Value"
                const fieldMatch = value.match(/^(.+?)\s*&&\s*(.+?)(?:\s+(inline))?$/i);
                if (fieldMatch) {
                    embed.addFields({
                        name: fieldMatch[1].trim(),
                        value: fieldMatch[2].trim(),
                        inline: !!fieldMatch[3]
                    });
                } else {
                    // Simple field without &&
                    const parts = value.split(/\s*&&\s*/);
                    embed.addFields({
                        name: parts[0] || '\u200B',
                        value: parts[1] || '\u200B',
                        inline: false
                    });
                }
                break;
        }
    }

    return { content: content || undefined, embeds: [embed], components: [] };
}

// ══════════════════════════════════════════════════════════
// PARSE MESSAGE (detects embed code vs plain text)
// ══════════════════════════════════════════════════════════
function parseInvokeMessage(raw, vars) {
    const text = replaceVars(raw, vars);

    // Check if it's embed code
    if (text.trim().startsWith('{embed}')) {
        return parseEmbedCode(raw, vars);
    }

    // Plain text
    return { content: text, embeds: [], components: [] };
}

// ══════════════════════════════════════════════════════════
// GET INVOKE MESSAGE (public reply)
// ══════════════════════════════════════════════════════════
function getInvokeReply(guildId, command, vars) {
    const db = getGuildDb(guildId);
    const invokes = db.get('invokeMessages', {});
    const custom = invokes[command]?.message;

    const raw = custom || DEFAULT_MESSAGES[command]?.message || '👍';
    return parseInvokeMessage(raw, vars);
}

// ══════════════════════════════════════════════════════════
// GET INVOKE DM (DM sent to punished user)
// ══════════════════════════════════════════════════════════
function getInvokeDm(guildId, command, vars) {
    const db = getGuildDb(guildId);
    const invokes = db.get('invokeMessages', {});
    const custom = invokes[command]?.dm;

    const raw = custom || DEFAULT_MESSAGES[command]?.dm || '';
    if (!raw) return null;
    return parseInvokeMessage(raw, vars);
}

// ══════════════════════════════════════════════════════════
// SEND INVOKE DM
// ══════════════════════════════════════════════════════════
async function sendInvokeDm(user, guildId, command, vars) {
    const dmPayload = getInvokeDm(guildId, command, vars);
    if (!dmPayload) return;

    try {
        if (dmPayload.embeds?.length) {
            await user.send({ content: dmPayload.content, embeds: dmPayload.embeds });
        } else if (dmPayload.content) {
            await user.send(dmPayload.content);
        }
    } catch (err) {
        // User has DMs closed — silently fail
    }
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER: ,invoke
// ══════════════════════════════════════════════════════════
async function handleInvokeCommand(message, args) {
    const { isAdmin } = require('./helpers');
    if (!isAdmin(message.member)) {
        return message.reply({ 
            embeds: [base(COLORS.error).setTitle('❌ Access Denied').setDescription('Only admins can manage invoke messages.')] 
        });
    }

    const db = getGuildDb(message.guild.id);
    const subCmd = args[0]?.toLowerCase();
    const type = args[1]?.toLowerCase(); // 'message' or 'dm'
    const rawText = args.slice(2).join(' ').trim();

    // Show current settings
    if (!subCmd || subCmd === 'list') {
        const invokes = db.get('invokeMessages', {});
        let desc = '**Customized Commands:**\n';
        let hasAny = false;

        for (const cmd of VALID_COMMANDS) {
            const settings = invokes[cmd];
            if (settings?.message || settings?.dm) {
                hasAny = true;
                desc += '\n**' + cmd + '**\n';
                if (settings.message) {
                    const preview = settings.message.substring(0, 50) + (settings.message.length > 50 ? '...' : '');
                    desc += '• Message: `' + preview + '`\n';
                }
                if (settings.dm) {
                    const preview = settings.dm.substring(0, 50) + (settings.dm.length > 50 ? '...' : '');
                    desc += '• DM: `' + preview + '`\n';
                }
            }
        }

        if (!hasAny) desc += '\n*No custom invoke messages set. Use `,invoke <command> message/dm <text>`*';

        return message.reply({
            embeds: [base(COLORS.primary).setTitle('📨 Invoke Messages').setDescription(desc)]
        });
    }

    // Validate command
    if (!VALID_COMMANDS.includes(subCmd)) {
        return message.reply({
            embeds: [base(COLORS.error).setTitle('❌ Invalid Command').setDescription(
                'Valid commands: ' + VALID_COMMANDS.map(c => '`' + c + '`').join(', ')
            )]
        });
    }

    // Reset a command
    if (type === 'reset') {
        const invokes = db.get('invokeMessages', {});
        if (invokes[subCmd]) {
            delete invokes[subCmd];
            db.set('invokeMessages', invokes);
        }
        return message.reply({
            embeds: [base(COLORS.success).setTitle('✅ Reset').setDescription('Invoke settings for `' + subCmd + '` have been reset to defaults.')]
        });
    }

    // Validate type
    if (!['message', 'dm'].includes(type)) {
        return message.reply({
            embeds: [base(COLORS.error).setTitle('❌ Invalid Type').setDescription(
                'Usage:\n' +
                '`,invoke <command> message <text>` — set public reply\n' +
                '`,invoke <command> dm <text>` — set DM to user\n' +
                '`,invoke <command> reset` — reset to defaults\n' +
                '`,invoke list` — view all settings\n\n' +
                '**Example:**\n' +
                '`,invoke jail message {user.mention} has been jailed for {reason}`\n' +
                '`,invoke jail dm You were jailed for {reason}`'
            )]
        });
    }

    if (!rawText) {
        return message.reply({
            embeds: [base(COLORS.error).setTitle('❌ Missing Text').setDescription('Provide the message text or embed code.')]
        });
    }

    // Save
    const invokes = db.get('invokeMessages', {});
    if (!invokes[subCmd]) invokes[subCmd] = {};
    invokes[subCmd][type] = rawText;
    db.set('invokeMessages', invokes);

    // Preview with all variables
    const previewVars = {
        targetMention: '@User',
        targetName: 'ExampleUser',
        targetId: '123456789',
        targetAvatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        userMention: '@User',
        userName: 'ExampleUser',
        userId: '123456789',
        userAvatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        modMention: '@Moderator',
        modName: 'Moderator',
        modId: '987654321',
        modIcon: 'https://cdn.discordapp.com/embed/avatars/1.png',
        moderatorMention: '@Moderator',
        moderatorName: 'Moderator',
        moderatorId: '987654321',
        moderatorIcon: 'https://cdn.discordapp.com/embed/avatars/1.png',
        reason: 'Example reason',
        guildName: message.guild.name,
        guildId: message.guild.id,
        guildIcon: message.guild.iconURL() || '',
        caseId: '#42',
        duration: '1d',
    };

    const preview = parseInvokeMessage(rawText, previewVars);

    const embed = base(COLORS.success)
        .setTitle('✅ Invoke ' + (type === 'message' ? 'Reply' : 'DM') + ' Updated')
        .setDescription('Command: `' + subCmd + '`\nType: `' + type + '`');

    if (preview.content) {
        embed.addFields({ name: 'Content Preview', value: preview.content.substring(0, 1000) || '*None*' });
    }

    return message.reply({ embeds: [embed, ...(preview.embeds || [])] });
}

module.exports = {
    handleInvokeCommand,
    getInvokeReply,
    getInvokeDm,
    sendInvokeDm,
    replaceVars,
    VALID_COMMANDS,
};