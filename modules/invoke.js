/**
 * invoke.js — Invoke Message System
 * 
 * Customizes bot responses and DMs for moderation commands.
 * Commands supported: jail, kick, ban, tempban, softban, hardban, timeout, warn
 * 
 * Variables:
 * {user.mention} {user.name} {user.id}
 * {mod.mention} {mod.name} {mod.id}
 * {reason} {guild.name} {guild.id}
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
// ══════════════════════════════════════════════════════════
function replaceVars(template, vars) {
    if (!template) return template;
    return template
        .replace(/{user\.mention}/gi, vars.targetMention || '{user.mention}')
        .replace(/{user\.name}/gi, vars.targetName || '{user.name}')
        .replace(/{user\.id}/gi, vars.targetId || '{user.id}')
        .replace(/{mod\.mention}/gi, vars.modMention || '{mod.mention}')
        .replace(/{mod\.name}/gi, vars.modName || '{mod.name}')
        .replace(/{mod\.id}/gi, vars.modId || '{mod.id}')
        .replace(/{reason}/gi, vars.reason || 'No reason provided')
        .replace(/{guild\.name}/gi, vars.guildName || '{guild.name}')
        .replace(/{guild\.id}/gi, vars.guildId || '{guild.id}')
        .replace(/{case\.id}/gi, vars.caseId || '{case.id}')
        .replace(/{duration}/gi, vars.duration || '')
        .replace(/{timestamp}/gi, `<t:${Math.floor(Date.now() / 1000)}:F>`);
}

// ══════════════════════════════════════════════════════════
// PARSE MESSAGE (detects embed code vs plain text)
// ══════════════════════════════════════════════════════════
function parseInvokeMessage(raw, vars) {
    const text = replaceVars(raw, vars);

    // Check if it's embed code
    if (text.trim().startsWith('{embed}')) {
        const { parseEmbedCode, buildVars } = require('./welcomeSystem');
        const embedVars = buildVars({ guild: { id: vars.guildId, name: vars.guildName } });
        const result = parseEmbedCode(text, { ...embedVars, ...vars });
        return result;
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
            await user.send({ embeds: dmPayload.embeds, components: dmPayload.components || [] });
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
        let desc = '**Customized Commands:**\\n';
        let hasAny = false;

        for (const cmd of VALID_COMMANDS) {
            const settings = invokes[cmd];
            if (settings?.message || settings?.dm) {
                hasAny = true;
                desc += `\\n**${cmd}**\\n`;
                if (settings.message) desc += `• Message: \\`${settings.message.substring(0, 50)}${settings.message.length > 50 ? '...' : ''}\\`\\n`;
                if (settings.dm) desc += `• DM: \\`${settings.dm.substring(0, 50)}${settings.dm.length > 50 ? '...' : ''}\\`\\n`;
            }
        }

        if (!hasAny) desc += '\\n*No custom invoke messages set. Use `,invoke <command> message/dm <text>`*';

        return message.reply({
            embeds: [base(COLORS.primary).setTitle('📨 Invoke Messages').setDescription(desc)]
        });
    }

    // Validate command
    if (!VALID_COMMANDS.includes(subCmd)) {
        return message.reply({
            embeds: [base(COLORS.error).setTitle('❌ Invalid Command').setDescription(
                `Valid commands: ${VALID_COMMANDS.map(c => `\`${c}\``).join(', ')}`
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
            embeds: [base(COLORS.success).setTitle('✅ Reset').setDescription(`Invoke settings for \`${subCmd}\` have been reset to defaults.`)]
        });
    }

    // Validate type
    if (!['message', 'dm'].includes(type)) {
        return message.reply({
            embeds: [base(COLORS.error).setTitle('❌ Invalid Type').setDescription(
                'Usage:\\n' +
                '`,invoke <command> message <text>` — set public reply\\n' +
                '`,invoke <command> dm <text>` — set DM to user\\n' +
                '`,invoke <command> reset` — reset to defaults\\n' +
                '`,invoke list` — view all settings\\n\\n' +
                '**Example:**\\n' +
                '`,invoke jail message {user.mention} has been jailed for {reason}`\\n' +
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

    // Preview
    const previewVars = {
        targetMention: '@User',
        targetName: 'ExampleUser',
        targetId: '123456789',
        modMention: '@Moderator',
        modName: 'Moderator',
        modId: '987654321',
        reason: 'Example reason',
        guildName: message.guild.name,
        guildId: message.guild.id,
        caseId: '#42',
        duration: '1d',
    };

    const preview = parseInvokeMessage(rawText, previewVars);

    const embed = base(COLORS.success)
        .setTitle(`✅ Invoke ${type === 'message' ? 'Reply' : 'DM'} Updated`)
        .setDescription(`Command: \`${subCmd}\`\\nType: \`${type}\``)
        .addFields({ name: 'Preview', value: preview.content || '*Embed message*' });

    return message.reply({ embeds: [embed] });
}

module.exports = {
    handleInvokeCommand,
    getInvokeReply,
    getInvokeDm,
    sendInvokeDm,
    replaceVars,
    VALID_COMMANDS,
};