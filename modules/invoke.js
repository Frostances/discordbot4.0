/**
 * invoke.js — Invoke Message System
 *
 * Customizes bot responses and DMs for moderation commands.
 * Commands supported: jail, unjail, kick, ban, unban, tempban, softban, hardban,
 *                     timeout, untimeout, warn, mute, unmute, imute, iunmute,
 *                     rmute, runmute
 *
 * Variables:
 * {user.mention} {user.name} {user.id} {user.avatar}
 * {mod.mention} {mod.name} {mod.id} {mod.icon}
 * {moderator.mention} {moderator.name} {moderator.id} {moderator.icon}
 * {reason} {guild.name} {guild.id} {guild.icon}
 * {case.id} {duration} {timestamp}
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
// DEFAULT MESSAGES
// ══════════════════════════════════════════════════════════
const DEFAULT_MESSAGES = {
 jail:       { message: '👍', dm: 'You have been jailed in **{guild.name}**.' },
 unjail:     { message: '👍', dm: 'You have been released from jail in **{guild.name}**.' },
 kick:       { message: '👍', dm: 'You have been kicked from **{guild.name}**.\nReason: {reason}' },
 ban:        { message: '👍', dm: 'You have been banned from **{guild.name}**.\nReason: {reason}' },
 unban:      { message: '👍', dm: '' },
 tempban:    { message: '👍', dm: 'You have been temporarily banned from **{guild.name}**.\nDuration: {duration}\nReason: {reason}' },
 softban:    { message: '👍', dm: 'You have been softbanned from **{guild.name}** (messages cleared).\nReason: {reason}' },
 hardban:    { message: '👍', dm: 'You have been permanently banned from **{guild.name}**.\nReason: {reason}' },
 timeout:    { message: '👍', dm: 'You have been timed out in **{guild.name}**.\nDuration: {duration}\nReason: {reason}' },
 untimeout:  { message: '👍', dm: 'Your timeout has been removed in **{guild.name}**.' },
 warn:       { message: '👍', dm: 'You have received a warning in **{guild.name}**.\nReason: {reason}' },
 mute:       { message: '👍', dm: 'You have been muted in **{guild.name}**.\nReason: {reason}' },
 unmute:     { message: '👍', dm: 'You have been unmuted in **{guild.name}**.' },
 imute:      { message: '👍', dm: 'You have been image-muted in **{guild.name}**.\nReason: {reason}' },
 iunmute:    { message: '👍', dm: 'Your image mute has been removed in **{guild.name}**.' },
 rmute:      { message: '👍', dm: 'You have been reaction-muted in **{guild.name}**.\nReason: {reason}' },
 runmute:    { message: '👍', dm: 'Your reaction mute has been removed in **{guild.name}**.' },
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
 result = result.replace(/{user\.mention}/gi, vars.userMention || vars.targetMention || '{user.mention}');
 result = result.replace(/{user\.name}/gi, vars.userName || vars.targetName || '{user.name}');
 result = result.replace(/{user\.id}/gi, vars.userId || vars.targetId || '{user.id}');
 result = result.replace(/{user\.avatar}/gi, vars.userAvatar || vars.targetAvatar || '');

 // Target aliases (backward compat)
 result = result.replace(/{target\.mention}/gi, vars.targetMention || vars.userMention || '{target.mention}');
 result = result.replace(/{target\.name}/gi, vars.targetName || vars.userName || '{target.name}');
 result = result.replace(/{target\.id}/gi, vars.targetId || vars.userId || '{target.id}');
 result = result.replace(/{target\.avatar}/gi, vars.targetAvatar || vars.userAvatar || '');

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
 result = result.replace(/{timestamp}/gi, '');

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
 const segments = body.split(/\$\v\{/g).filter(s => s.trim());

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
       const footerParts = value.split(/\s*&&\s*/);
       embed.setFooter({
         text: footerParts[0] || '',
         iconURL: footerParts[1] || undefined
       });
       break;
     case 'author':
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
       const fieldMatch = value.match(/^(.+?)\s*&&\s*(.+?)(?:\s+(inline))?$/i);
       if (fieldMatch) {
         embed.addFields({
           name: fieldMatch[1].trim(),
           value: fieldMatch[2].trim(),
           inline: !!fieldMatch[3]
         });
       } else {
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

 if (text.trim().startsWith('{embed}')) {
   return parseEmbedCode(raw, vars);
 }

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
// PREVIEW VARIABLES (used for showing previews)
// ══════════════════════════════════════════════════════════
function getPreviewVars(guild) {
 return {
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
   guildName: guild?.name || 'Server Name',
   guildId: guild?.id || '000000000',
   guildIcon: guild?.iconURL?.() || '',
   caseId: '#42',
   duration: '1d',
 };
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLER: ,invoke
// ══════════════════════════════════════════════════════════
async function handleInvokeCommand(message, args) {
 // Permission check: Manage Guild
 if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
   return message.reply({
     embeds: [base(COLORS.error).setTitle('❌ Access Denied').setDescription('You need **Manage Server** permission to manage invoke messages.')]
   });
 }

 const db = getGuildDb(message.guild.id);
 const subCmd = args[0]?.toLowerCase();

 // ── LIST ALL SETTINGS ──
 if (!subCmd || subCmd === 'list') {
   const invokes = db.get('invokeMessages', {});

   // Build paginated embeds — one per command that has custom settings
   const pages = [];

   for (const cmd of VALID_COMMANDS) {
     const settings = invokes[cmd];
     const hasCustom = settings?.message || settings?.dm;

     const embed = base(COLORS.primary)
       .setTitle(`📨 ${cmd.charAt(0).toUpperCase() + cmd.slice(1)} — Invoke Settings`)
       .setFooter({ text: `Use ,invoke ${cmd} message/dm <text> to edit` });

     // Default values
     const defMsg = DEFAULT_MESSAGES[cmd]?.message || '👍';
     const defDm = DEFAULT_MESSAGES[cmd]?.dm || '(none)';

     // Show current custom or default
     const msgText = settings?.message || defMsg;
     const dmText = settings?.dm || defDm;

     const previewVars = getPreviewVars(message.guild);

     // Message preview
     if (settings?.message) {
       const msgPreview = parseInvokeMessage(msgText, previewVars);
       embed.addFields({
         name: '💬 Public Reply (custom)',
         value: msgPreview.content || '(embed)',
         inline: false
       });
       if (msgPreview.embeds?.[0]) {
         embed.addFields({
           name: '🎨 Embed Preview',
           value: `Title: ${msgPreview.embeds[0].data?.title || '(none)'}\nDescription: ${msgPreview.embeds[0].data?.description?.substring(0, 100) || '(none)'}`,
           inline: false
         });
       }
     } else {
       embed.addFields({
         name: '💬 Public Reply (default)',
         value: msgText.length > 1000 ? msgText.substring(0, 1000) + '...' : msgText,
         inline: false
       });
     }

     // DM preview
     if (settings?.dm) {
       const dmPreview = parseInvokeMessage(dmText, previewVars);
       embed.addFields({
         name: '📩 DM (custom)',
         value: dmPreview.content || '(embed)',
         inline: false
       });
       if (dmPreview.embeds?.[0]) {
         embed.addFields({
           name: '🎨 DM Embed Preview',
           value: `Title: ${dmPreview.embeds[0].data?.title || '(none)'}\nDescription: ${dmPreview.embeds[0].data?.description?.substring(0, 100) || '(none)'}`,
           inline: false
         });
       }
     } else {
       embed.addFields({
         name: '📩 DM (default)',
         value: dmText.length > 1000 ? dmText.substring(0, 1000) + '...' : dmText,
         inline: false
       });
     }

     // Copy-paste ready code block
     const copyCode = `\`\`\`\n,invoke ${cmd} message ${settings?.message || ''}\n,invoke ${cmd} dm ${settings?.dm || ''}\n\`\`\``;
     embed.addFields({
       name: '📋 Copy-Paste Commands',
       value: copyCode,
       inline: false
     });

     pages.push(embed);
   }

   if (!pages.length) {
     return message.reply({
       embeds: [base(COLORS.primary).setTitle('📨 Invoke Messages').setDescription('No custom invoke messages set. Use `,invoke <command> message/dm <text>` to configure.')]
     });
   }

   // Send as paginated if multiple, or single if one
   const { sendPaginatedEmbeds } = require('../utils/paginator');
   return sendPaginatedEmbeds(message.channel, pages, message.author.id);
 }

 // ── VALIDATE COMMAND ──
 if (!VALID_COMMANDS.includes(subCmd)) {
   return message.reply({
     embeds: [base(COLORS.error).setTitle('❌ Invalid Command').setDescription(
       'Valid commands: ' + VALID_COMMANDS.map(c => `\`${c}\``).join(', ')
     )]
   });
 }

 const type = args[1]?.toLowerCase(); // 'message', 'dm', 'view', or reset sub-type
 const rawText = args.slice(2).join(' ').trim();

 // ── RESET ENTIRE COMMAND ──
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

 // ── VIEW MODE: ,invoke <cmd> view ──
 if (type === 'view') {
   const invokes = db.get('invokeMessages', {});
   const settings = invokes[subCmd] || {};
   const previewVars = getPreviewVars(message.guild);

   const embed = base(COLORS.primary)
     .setTitle(`📨 ${subCmd.charAt(0).toUpperCase() + subCmd.slice(1)} — Current Settings`)
     .setFooter({ text: `Use ,invoke ${subCmd} message/dm <text> to edit` });

   const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
   const defDm = DEFAULT_MESSAGES[subCmd]?.dm || '(none)';

   const msgText = settings.message || defMsg;
   const dmText = settings.dm || defDm;

   // Message section
   if (settings.message) {
     const msgPreview = parseInvokeMessage(msgText, previewVars);
     embed.addFields({ name: '💬 Public Reply (custom)', value: msgPreview.content || '(embed)', inline: false });
   } else {
     embed.addFields({ name: '💬 Public Reply (default)', value: msgText.length > 1000 ? msgText.substring(0, 1000) + '...' : msgText, inline: false });
   }

   // DM section
   if (settings.dm) {
     const dmPreview = parseInvokeMessage(dmText, previewVars);
     embed.addFields({ name: '📩 DM (custom)', value: dmPreview.content || '(embed)', inline: false });
   } else {
     embed.addFields({ name: '📩 DM (default)', value: dmText.length > 1000 ? dmText.substring(0, 1000) + '...' : dmText, inline: false });
   }

   // Copy-paste commands
   const copyCode = `\`\`\`\n,invoke ${subCmd} message ${settings.message || ''}\n,invoke ${subCmd} dm ${settings.dm || ''}\n\`\`\``;
   embed.addFields({ name: '📋 Copy-Paste Commands', value: copyCode, inline: false });

   return message.reply({ embeds: [embed] });
 }

 // ── SUBCOMMAND HANDLER: ,invoke <cmd> message/dm/view ──
 // Check for sub-subcommands like "message view" or "dm view"
 const subType = args[2]?.toLowerCase();
 const isViewSub = subType === 'view';
 const actualRawText = isViewSub ? '' : args.slice(2).join(' ').trim();

 // Handle ,invoke <cmd> message view
 if (type === 'message' && subType === 'view') {
   const invokes = db.get('invokeMessages', {});
   const settings = invokes[subCmd] || {};
   const previewVars = getPreviewVars(message.guild);

   const embed = base(COLORS.primary)
     .setTitle(`💬 ${subCmd.charAt(0).toUpperCase() + subCmd.slice(1)} — Public Reply`);

   const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
   const msgText = settings.message || defMsg;

   if (settings.message) {
     const msgPreview = parseInvokeMessage(msgText, previewVars);
     embed.setDescription(`**Current custom:**\n${msgPreview.content || '(embed)'}`);
     if (msgPreview.embeds?.[0]) {
       return message.reply({ embeds: [embed, msgPreview.embeds[0]] });
     }
   } else {
     embed.setDescription(`**Default:**\n${msgText}`);
   }

   const copyCode = `\`\`\`\n,invoke ${subCmd} message ${settings.message || ''}\n\`\`\``;
   embed.addFields({ name: '📋 Copy-Paste', value: copyCode, inline: false });
   return message.reply({ embeds: [embed] });
 }

 // Handle ,invoke <cmd> dm view
 if (type === 'dm' && subType === 'view') {
   const invokes = db.get('invokeMessages', {});
   const settings = invokes[subCmd] || {};
   const previewVars = getPreviewVars(message.guild);

   const embed = base(COLORS.primary)
     .setTitle(`📩 ${subCmd.charAt(0).toUpperCase() + subCmd.slice(1)} — DM Message`);

   const defDm = DEFAULT_MESSAGES[subCmd]?.dm || '(none)';
   const dmText = settings.dm || defDm;

   if (settings.dm) {
     const dmPreview = parseInvokeMessage(dmText, previewVars);
     embed.setDescription(`**Current custom:**\n${dmPreview.content || '(embed)'}`);
     if (dmPreview.embeds?.[0]) {
       return message.reply({ embeds: [embed, dmPreview.embeds[0]] });
     }
   } else {
     embed.setDescription(`**Default:**\n${dmText}`);
   }

   const copyCode = `\`\`\`\n,invoke ${subCmd} dm ${settings.dm || ''}\n\`\`\``;
   embed.addFields({ name: '📋 Copy-Paste', value: copyCode, inline: false });
   return message.reply({ embeds: [embed] });
 }

 // ── RESET SUB-TYPE: ,invoke <cmd> message reset / dm reset ──
 if (subType === 'reset') {
   const invokes = db.get('invokeMessages', {});
   if (!invokes[subCmd]) invokes[subCmd] = {};
   if (type === 'message') delete invokes[subCmd].message;
   if (type === 'dm') delete invokes[subCmd].dm;
   // Clean up empty object
   if (!invokes[subCmd].message && !invokes[subCmd].dm) delete invokes[subCmd];
   db.set('invokeMessages', invokes);
   return message.reply({
     embeds: [base(COLORS.success).setTitle('✅ Reset').setDescription(`\`${type}\` for \`${subCmd}\` reset to default.`)]
   });
 }

 // ── VALIDATE TYPE ──
 if (!['message', 'dm'].includes(type)) {
   return message.reply({
     embeds: [base(COLORS.error).setTitle('❌ Invalid Type').setDescription(
       `Usage:\n` +
       `\`,invoke ${subCmd} message <text>\` — set public reply\n` +
       `\`,invoke ${subCmd} dm <text>\` — set DM to user\n` +
       `\`,invoke ${subCmd} message view\` — view public reply\n` +
       `\`,invoke ${subCmd} dm view\` — view DM\n` +
       `\`,invoke ${subCmd} reset\` — reset entire command\n` +
       `\`,invoke ${subCmd} message reset\` — reset public reply\n` +
       `\`,invoke ${subCmd} dm reset\` — reset DM\n` +
       `\`,invoke list\` — view all settings\n\n` +
       `**Example:**\n` +
       `\`,invoke jail message {user.mention} has been jailed for {reason}\`\n` +
       `\`,invoke jail dm You were jailed for {reason}\``
     )]
   });
 }

 // ── VIEW WITHOUT TEXT (show current) ──
 if (!actualRawText && !isViewSub) {
   const invokes = db.get('invokeMessages', {});
   const settings = invokes[subCmd] || {};
   const previewVars = getPreviewVars(message.guild);

   const embed = base(COLORS.primary)
     .setTitle(`📨 ${subCmd.charAt(0).toUpperCase() + subCmd.slice(1)} — ${type === 'message' ? 'Public Reply' : 'DM'}`);

   if (type === 'message') {
     const defMsg = DEFAULT_MESSAGES[subCmd]?.message || '👍';
     const msgText = settings.message || defMsg;
     if (settings.message) {
       const msgPreview = parseInvokeMessage(msgText, previewVars);
       embed.setDescription(`**Current custom:**\n${msgPreview.content || '(embed)'}`);
       if (msgPreview.embeds?.[0]) {
         return message.reply({ embeds: [embed, msgPreview.embeds[0]] });
       }
     } else {
       embed.setDescription(`**Default:**\n${msgText}`);
     }
     const copyCode = `\`\`\`\n,invoke ${subCmd} message ${settings.message || ''}\n\`\`\``;
     embed.addFields({ name: '📋 Copy-Paste', value: copyCode, inline: false });
   } else {
     const defDm = DEFAULT_MESSAGES[subCmd]?.dm || '(none)';
     const dmText = settings.dm || defDm;
     if (settings.dm) {
       const dmPreview = parseInvokeMessage(dmText, previewVars);
       embed.setDescription(`**Current custom:**\n${dmPreview.content || '(embed)'}`);
       if (dmPreview.embeds?.[0]) {
         return message.reply({ embeds: [embed, dmPreview.embeds[0]] });
       }
     } else {
       embed.setDescription(`**Default:**\n${dmText}`);
     }
     const copyCode = `\`\`\`\n,invoke ${subCmd} dm ${settings.dm || ''}\n\`\`\``;
     embed.addFields({ name: '📋 Copy-Paste', value: copyCode, inline: false });
   }

   return message.reply({ embeds: [embed] });
 }

 // ── SAVE ──
 const invokes = db.get('invokeMessages', {});
 if (!invokes[subCmd]) invokes[subCmd] = {};
 invokes[subCmd][type] = actualRawText;
 db.set('invokeMessages', invokes);

 // Preview with all variables
 const previewVars = getPreviewVars(message.guild);
 const preview = parseInvokeMessage(actualRawText, previewVars);

 const embed = base(COLORS.success)
   .setTitle('✅ Invoke ' + (type === 'message' ? 'Reply' : 'DM') + ' Updated')
   .setDescription(`Command: \`${subCmd}\`\nType: \`${type}\``);

 if (preview.content) {
   embed.addFields({ name: 'Content Preview', value: preview.content.substring(0, 1000) || '*None*' });
 }

 // Copy-paste ready
 const copyCode = `\`\`\`\n,invoke ${subCmd} ${type} ${actualRawText}\n\`\`\``;
 embed.addFields({ name: '📋 Copy-Paste Command', value: copyCode, inline: false });

 return message.reply({ embeds: [embed, ...(preview.embeds || [])] });
}

module.exports = {
 handleInvokeCommand,
 getInvokeReply,
 getInvokeDm,
 sendInvokeDm,
 replaceVars,
 VALID_COMMANDS,
 DEFAULT_MESSAGES,
};