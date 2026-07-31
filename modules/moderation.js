/**
 * moderation.js — main dispatch hub
 * Routes every moderation command to the correct sub-module.
 */
const {
 EmbedBuilder, ActionRowBuilder, ButtonBuilder,
 ButtonStyle, PermissionFlagsBits
} = require('discord.js');
const { getGuildDb } = require('./database');
const { COLORS, base } = require('../utils/embeds');
const {
 createCase, sendModLog, parseDuration, formatDuration,
 cmdCase, cmdReason, cmdProof,
 cmdHistory, cmdHistoryRemove, cmdHistoryRemoveAll,
 cmdModStats, cmdWarnings,
} = require('./cases');

// ── Sub-module imports ──
const { handlePurge } = require('./purge');
const { handleJail, handleUnjail, handleJailList, handleJailSetup } = require('./jail');
const { handleMute, handleUnmute, handleIMute, handleIUnmute,
 handleRMute, handleRUnmute, handleSetupMute } = require('./mute');
const { handleRole, handleTempRole } = require('./roles');
const { handleLock, handleUnlock, handleUnlockAll, handleLockdown, handleLockdownIgnore,
 handleHide, handleUnhide, handleTalk,
 handleSlowmode, handleTopic, handleChannelRename, handleRevokeFiles } = require('./channels');
const { handleThread } = require('./threads');
const { handleRename, handleForceNickname, handleStripStaff } = require('./nicknames');
const { handleMoveAll, handleDrag } = require('./voice');
const { handleStickyRole } = require('./stickyroles');
const { handleRemind } = require('./reminders');
const { handleNaughty, handlePermissions, handleDump, handleNewMembers, handleClearInvites } = require('./channeltools');
const { handleNuke } = require('./nuke');

// ──────────────────────────────────────────────────────────
// CONFIRMATION HELPER
// ──────────────────────────────────────────────────────────
async function askConfirmation(ctx, embed) {
 const isInter = !!ctx.deferReply;
 const row = new ActionRowBuilder().addComponents(
 new ButtonBuilder().setCustomId('mod_confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
 new ButtonBuilder().setCustomId('mod_cancel') .setLabel('Cancel') .setStyle(ButtonStyle.Danger),
 );

 let msg;
 if (isInter) { await ctx.editReply({ embeds: [embed], components: [row] }); msg = await ctx.fetchReply(); }
 else msg = await ctx.channel.send({ embeds: [embed], components: [row] });

 return new Promise(resolve => {
 const authorId = ctx.user?.id || ctx.author?.id;
 const col = msg.createMessageComponentCollector({ time: 30000, max: 1,
 filter: i => { if (i.user.id !== authorId) { i.reply({ content: '❌ Not your menu.', ephemeral: true }); return false; } return true; }
 });
 col.on('collect', async i => { await i.deferUpdate(); resolve(i.customId === 'mod_confirm'); });
 col.on('end', (_, reason) => { if (reason === 'time') { msg.edit({ components: [] }).catch(()=>{}); resolve(false); } });
 });
}

// ──────────────────────────────────────────────────────────
// INVOKE HELPER — sends custom reply or fallback
// ──────────────────────────────────────────────────────────
function buildInvokeVars(ctx, target, reason, duration, caseId) {
  const authorId = ctx.author?.id || ctx.user?.id;
  const guild = ctx.guild;
  const modMember = ctx.member;

  return {
      targetMention: target ? `<@${target.id}>` : '',
      targetName: target ? (target.user?.username || target.username || 'Unknown') : 'Unknown',
      targetId: target ? target.id : '',
      targetAvatar: target ? (target.user?.displayAvatarURL?.() || target.displayAvatarURL?.() || '') : '',
      userMention: target ? `<@${target.id}>` : '',
      userName: target ? (target.user?.username || target.username || 'Unknown') : 'Unknown',
      userId: target ? target.id : '',
      userAvatar: target ? (target.user?.displayAvatarURL?.() || target.displayAvatarURL?.() || '') : '',
      modMention: `<@${authorId}>`,
      modName: modMember?.user?.username || modMember?.username || 'Unknown',
      modId: authorId,
      modIcon: modMember?.user?.displayAvatarURL?.() || modMember?.displayAvatarURL?.() || '',
      moderatorMention: `<@${authorId}>`,
      moderatorName: modMember?.user?.username || modMember?.username || 'Unknown',
      moderatorId: authorId,
      moderatorIcon: modMember?.user?.displayAvatarURL?.() || modMember?.displayAvatarURL?.() || '',
      guildName: guild?.name || '',
      guildId: guild?.id || '',
      guildIcon: guild?.iconURL?.() || '',
      reason: reason || 'No reason provided',
      caseId: caseId ? '#' + caseId : '',
      duration: duration || '',
  };
}

function sendInvokeReply(ctx, guildId, command, target, reason, duration, caseId) {
  try {
      const { getInvokeReply } = require('./invoke');
      const vars = buildInvokeVars(ctx, target, reason, duration, caseId);
      const invMsg = getInvokeReply(guildId, command, vars);
      if (invMsg && (invMsg.content || invMsg.embeds?.length)) {
          if (ctx.editReply) return ctx.editReply(invMsg);
          return ctx.reply(invMsg);
      }
  } catch { /* invoke module not loaded */ }
  if (ctx.editReply) return ctx.editReply({ content: '👍', embeds: [], components: [] });
  return ctx.reply('👍');
}

// ──────────────────────────────────────────────────────────
// MAIN DISPATCH
// ──────────────────────────────────────────────────────────
async function handleModerationCommand(ctx, command, args, client) {
 const { isStaffOrAdmin, isAdmin, checkRestriction, hasDiscordPerm } = require('./helpers');

 // Restriction check
 if (typeof ctx.channel !== 'undefined' && checkRestriction(ctx, command)) return;

 const guild = ctx.guild;
 const authorId = ctx.author?.id || ctx.user?.id;
 const db = getGuildDb(guild.id);

 // ════════════════════════════════════════════
 // KICK
 // ════════════════════════════════════════════
 if (command === 'kick') {
 const { hasFakePerm } = require('./fakepermissions');
 if (!isStaffOrAdmin(ctx.member) && !hasFakePerm(ctx.member, 'kick_members'))
 return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user to kick.', ephemeral: true });
 if (!target.kickable) return ctx.reply({ content: '❌ I cannot kick that user (higher role or missing permissions).', ephemeral: true });
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || 'No reason provided';

 // Booster confirmation
 if (target.premiumSince) {
 const boosterEmbed = base(COLORS.warning)
 .setTitle('⚠️ Target is a Server Booster')
 .setDescription(`**${target.user.username}** is currently **boosting this server**!\nAre you sure you want to kick them?\n\n**Reason:** ${reason}`);
 const confirmed = await askConfirmation(ctx, boosterEmbed);
 if (!confirmed) {
 const cancelMsg = { content: '❌ Kick cancelled.', embeds: [], components: [] };
 return ctx.editReply ? ctx.editReply(cancelMsg) : ctx.channel.send('❌ Kick cancelled.');
 }
 }

 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(target.user, guild.id, 'kick', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 await target.kick(reason);
 const c = createCase(guild.id, { type: 'kick', targetId: target.id, executorId: authorId, reason });
 const logEmbed = base(COLORS.error).setTitle('👢 Member Kicked')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'kick', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed to kick: ${err.message}`, ephemeral: true }); }
 }

 // ════════════════════════════════════════════
 // BAN
 // ════════════════════════════════════════════
 if (command === 'ban') {
 const { hasFakePerm } = require('./fakepermissions');
 if (!isStaffOrAdmin(ctx.member) && !hasFakePerm(ctx.member, 'ban_members'))
 return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first() ||
 (args[0]?.match(/^\d+$/) ? await client.users.fetch(args[0]).catch(() => null) : null);
 if (!target) return ctx.reply({ content: '❌ Mention a user or provide their ID.', ephemeral: true });
 const targetUser = target.user || target;
 const targetMember = target.user ? target : null;
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || 'No reason provided';
 if (targetMember?.bannable === false || target.bannable === false) return ctx.reply({ content: '❌ I cannot ban that user.', ephemeral: true });

 // Booster-only confirmation
 if (targetMember?.premiumSince) {
 const boosterEmbed = base(COLORS.warning)
 .setTitle('⚠️ Target is a Server Booster')
 .setDescription(`**${targetUser.username}** is currently **boosting this server**!\nAre you sure you want to ban them?\n\n**Reason:** ${reason}`);
 if (!!ctx.deferReply) await ctx.deferReply();
 const confirmed = await askConfirmation(ctx, boosterEmbed);
 if (!confirmed) {
 const cancelMsg = { content: '❌ Ban cancelled.', embeds: [], components: [] };
 return ctx.editReply ? ctx.editReply(cancelMsg) : ctx.channel.send('❌ Ban cancelled.');
 }
 }

 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(targetUser, guild.id, 'ban', {
 targetMention: `<@${targetUser.id}>`, targetName: targetUser.username, targetId: targetUser.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 await guild.bans.create(targetUser.id, { reason, deleteMessageSeconds: 0 });
 const c = createCase(guild.id, { type: 'ban', targetId: targetUser.id, executorId: authorId, reason });
 const logEmbed = base(COLORS.error).setTitle('🔨 Member Banned')
 .addFields(
 { name: '👤 User', value: `${targetUser} (${targetUser.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'ban', {
 targetMention: `<@${targetUser.id}>`, targetName: targetUser.username, targetId: targetUser.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed to ban: ${err.message}`, ephemeral: true }); }
 }

 // ════════════════════════════════════════════
 // SOFTBAN
 // ════════════════════════════════════════════
 if (command === 'softban') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || 'Softban — message history cleared';
 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(target.user, guild.id, 'softban', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 await target.ban({ deleteMessageSeconds: 604800, reason });
 await guild.bans.remove(target.id, 'Softban — immediately unbanned');
 const c = createCase(guild.id, { type: 'softban', targetId: target.id, executorId: authorId, reason });
 const logEmbed = base(COLORS.warning).setTitle('🧹 Member Softbanned')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'softban', {
 targetName: target.user.username, targetId: target.id, targetMention: `<@${target.id}>`,
 modMention: `<@${authorId}>`, reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }

 // ════════════════════════════════════════════
 // HARDBAN
 // ════════════════════════════════════════════
 if (command === 'hardban') {
 if (!isAdmin(authorId) && !ctx.member.permissions.has(PermissionFlagsBits.Administrator))
 return ctx.reply({ content: '❌ Administrator only.', ephemeral: true });
 const target = ctx.mentions?.members?.first() ||
 (args[0]?.match(/^\d+$/) ? await client.users.fetch(args[0]).catch(() => null) : null);
 if (!target) return ctx.reply({ content: '❌ Mention a user or provide their ID.', ephemeral: true });
 const targetUser = target.user || target;
 const targetMember = target.user ? target : null;
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || 'Hardban';

 // Booster confirmation
 if (targetMember?.premiumSince) {
 const boosterEmbed = base(COLORS.warning)
 .setTitle('⚠️ Target is a Server Booster')
 .setDescription(`**${targetUser.username}** is currently **boosting this server**!\nAre you sure you want to hardban them?\n\n**Reason:** ${reason}`);
 const confirmed = await askConfirmation(ctx, boosterEmbed);
 if (!confirmed) return ctx.channel.send('❌ Hardban cancelled.');
 }

 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(targetUser, guild.id, 'hardban', {
 targetMention: `<@${targetUser.id}>`, targetName: targetUser.username, targetId: targetUser.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 await guild.bans.create(targetUser.id, { deleteMessageSeconds: 604800, reason: `HARDBAN: ${reason}` });
 const hardbans = db.get('hardbans', []);
 if (!hardbans.includes(targetUser.id)) { hardbans.push(targetUser.id); db.set('hardbans', hardbans); }
 const c = createCase(guild.id, { type: 'hardban', targetId: targetUser.id, executorId: authorId, reason });
 const logEmbed = base(COLORS.error).setTitle('🔒 Member Hardbanned')
 .addFields(
 { name: '👤 User', value: `${targetUser} (${targetUser.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 { name: '⚠️ Info', value: 'Hardbanned — cannot be unbanned without admin override' },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'hardban', {
 targetName: targetUser.username, targetId: targetUser.id, targetMention: `<@${targetUser.id}>`,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }


 // ════════════════════════════════════════════
 // TEMPBAN
 // ════════════════════════════════════════════
 if (command === 'tempban') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

 const cleanArgs = args.filter(a => !a.startsWith('<@'));
 const durStr = cleanArgs[0];
 const duration = parseDuration(durStr);
 if (!duration) return ctx.reply({ content: '❌ Usage: `.tempban @user <duration> [reason]`\nTime: `10m` `2h` `7d`', ephemeral: true });

 const reason = cleanArgs.slice(1).join(' ') || 'Temporary ban';
 const expires = Date.now() + duration;
 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(target.user, guild.id, 'tempban', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, duration: formatDuration(duration), guildName: guild.name, guildId: guild.id,
 });
 await target.ban({ reason: `TEMPBAN [${durStr}]: ${reason}` });
 const c = createCase(guild.id, { type: 'tempban', targetId: target.id, executorId: authorId, reason, duration: formatDuration(duration), expires });

 const tempbans = db.get('tempbans', {});
 tempbans[target.id] = { userId: target.id, guildId: guild.id, expires, reason, executorId: authorId, caseId: c.id };
 db.set('tempbans', tempbans);

 setTimeout(async () => {
 try { await guild.bans.remove(target.id, 'Temporary ban expired'); } catch {}
 const _db = getGuildDb(guild.id);
 const _tbs = _db.get('tempbans', {}); delete _tbs[target.id]; _db.set('tempbans', _tbs);
 createCase(guild.id, { type: 'unban', targetId: target.id, executorId: 'system', reason: 'Temp-ban expired' });
 }, duration);

 const logEmbed = base(COLORS.error).setTitle('⏱️ Member Temp-Banned')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '⏱️ Duration', value: formatDuration(duration), inline: true },
 { name: '⌛ Expires', value: `<t:${Math.floor(expires / 1000)}:R>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'tempban', {
 targetName: target.user.username, targetId: target.id, targetMention: `<@${target.id}>`,
 modMention: `<@${authorId}>`, reason, duration: formatDuration(duration),
 guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }

 // ════════════════════════════════════════════
 // UNBAN
 // ════════════════════════════════════════════
 if (command === 'unban') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const id = args[0]?.replace(/[<@!>]/g, '');
 if (!id) return ctx.reply({ content: '❌ Provide a user ID to unban.', ephemeral: true });

 const hardbans = db.get('hardbans', []);
 if (hardbans.includes(id) && !isAdmin(authorId))
 return ctx.reply({ content: '❌ That user is **hardbanned**. Only an admin can unban them.', ephemeral: true });

 const reason = args.slice(1).join(' ') || 'No reason provided';
 try {
 const ban = await guild.bans.fetch(id).catch(() => null);
 if (!ban) return ctx.reply({ content: '❌ That user is not banned.', ephemeral: true });
 await guild.bans.remove(id, reason);
 const c = createCase(guild.id, { type: 'unban', targetId: id, executorId: authorId, reason });
 const logEmbed = base(COLORS.success).setTitle('🔓 Member Unbanned')
 .addFields(
 { name: '👤 User', value: `${ban.user} (${id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'unban', {
 targetName: ban.user.username, targetId: id, targetMention: `<@${id}>`,
 modMention: `<@${authorId}>`, reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }

 // ════════════════════════════════════════════
 // UNBANALL
 // ════════════════════════════════════════════
 if (command === 'unbanall') {
 if (!isAdmin(authorId) && !ctx.member.permissions.has(PermissionFlagsBits.Administrator))
 return ctx.reply({ content: '❌ Administrator only.', ephemeral: true });

 if (args[0] === 'cancel') {
 db.set('unbanallRunning', false);
 return ctx.reply({ content: '❌ Unbanall cancelled.' });
 }

 if (!!ctx.deferReply) await ctx.deferReply();
 const ok = await askConfirmation(ctx,
 base(COLORS.error).setTitle('⚠️ Unban All Confirmation')
 .setDescription('This will unban **every** member in the ban list. Are you sure?'));
 if (!ok) return ctx.editReply?.({ content: '❌ Cancelled.', embeds: [], components: [] }) || ctx.channel.send('❌ Cancelled.');

 db.set('unbanallRunning', true);
 const bans = await guild.bans.fetch();
 const msg = await (ctx.editReply || ((d) => ctx.channel.send(d)))({ content: `⏳ Unbanning **${bans.size}** users...`, embeds: [], components: [] });

 let done = 0, failed = 0;
 for (const [id, ban] of bans) {
 if (!db.get('unbanallRunning')) break;
 try { await guild.bans.remove(id, 'Unbanall command'); done++; } catch { failed++; }
 if (done % 10 === 0) await msg?.edit(`⏳ Progress: ${done}/${bans.size}…`).catch(() => {});
 }

 createCase(guild.id, { type: 'unban', targetId: 'mass', executorId: authorId, reason: `Unbanall: ${done} unbanned` });
 db.set('unbanallRunning', false);
 return msg?.edit({ content: '', embeds: [base(COLORS.success).setTitle('🔓 Unbanall Complete')
 .addFields({ name: '✅ Unbanned', value: done.toString(), inline: true }, { name: '❌ Failed', value: failed.toString(), inline: true })
 ] }).catch(() => {});
 }

 // ════════════════════════════════════════════
 // BAN LIST / RECENT BANS
 // ════════════════════════════════════════════
 if (command === 'banlist' || command === 'recentban') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const bans = await guild.bans.fetch();
 if (!bans.size) return ctx.reply({ content: '✅ No active bans.' });

 const list = command === 'recentban'
 ? [...bans.values()].slice(0, 10)
 : [...bans.values()];

 const { chunk } = require('../utils/paginator');
 const { sendPaginated } = require('../utils/paginator');
 const pages = chunk(list, 10).map((page, i) => ({
 title: `🔨 ${command === 'recentban' ? 'Recent Bans' : 'Ban List'} [${bans.size}]`,
 description: page.map((b, n) => `**${n + 1}.** ${b.user.tag} (\`${b.user.id}\`)\n↳ ${b.reason || 'No reason'}`).join('\n\n'),
 color: COLORS.error,
 }));
 return sendPaginated(ctx.channel, pages, authorId);
 }

 // ════════════════════════════════════════════
 // TIMEOUT
 // ════════════════════════════════════════════
 if (command === 'timeout') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });

 const cleanArgs = args.filter(a => !a.startsWith('<@'));
 const durStr = cleanArgs[0] || '10m';
 const duration = parseDuration(durStr);
 if (!duration) return ctx.reply({ content: '❌ Usage: `.timeout @user <duration> [reason]`\nTime: `1m` `1h` `1d`', ephemeral: true });
 if (duration > 28 * 24 * 60 * 60 * 1000) return ctx.reply({ content: '❌ Max timeout is 28 days.', ephemeral: true });

 const reason = cleanArgs.slice(1).join(' ') || 'No reason provided';
 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(target.user, guild.id, 'timeout', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, duration: formatDuration(duration), guildName: guild.name, guildId: guild.id,
 });
 await target.timeout(duration, reason);
 const c = createCase(guild.id, { type: 'timeout', targetId: target.id, executorId: authorId, reason, duration: formatDuration(duration), expires: Date.now() + duration });
 const logEmbed = base(COLORS.warning).setTitle('🔇 Member Timed Out')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '⏱️ Duration', value: formatDuration(duration), inline: true },
 { name: '⌛ Expires', value: `<t:${Math.floor((Date.now() + duration) / 1000)}:R>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'timeout', {
 targetName: target.user.username, targetId: target.id, targetMention: `<@${target.id}>`,
 modMention: `<@${authorId}>`, reason, duration: formatDuration(duration),
 guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }

 // ════════════════════════════════════════════
 // UNTIMEOUT
 // ════════════════════════════════════════════
 if (command === 'untimeout') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim() || 'Timeout removed';
 try {
 await target.timeout(null, reason);
 const c = createCase(guild.id, { type: 'untimeout', targetId: target.id, executorId: authorId, reason });
 const logEmbed = base(COLORS.success).setTitle('🔊 Timeout Removed')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'untimeout', {
 targetName: target.user.username, targetId: target.id, targetMention: `<@${target.id}>`,
 modMention: `<@${authorId}>`, reason, guildName: guild.name, guildId: guild.id,
 });
 } catch (err) { return ctx.reply({ content: `❌ Failed: ${err.message}` }); }
 }

 // ════════════════════════════════════════════
 // TIMEOUT LIST
 // ════════════════════════════════════════════
 if (command === 'timeoutlist') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const members = await guild.members.fetch();
 const timed = [...members.values()].filter(m => m.communicationDisabledUntil && m.communicationDisabledUntil > new Date());
 if (!timed.length) return ctx.reply({ content: '✅ No members currently timed out.' });
 const lines = timed.map(m => `${m.user.tag} — expires <t:${Math.floor(m.communicationDisabledUntil.getTime() / 1000)}:R>`).join('\n');
 return ctx.reply({ embeds: [base(COLORS.warning).setTitle(`🔇 Timed-Out Members [${timed.length}]`).setDescription(lines)] });
 }

 // ════════════════════════════════════════════
 // WARN
 // ════════════════════════════════════════════
 if (command === 'warn') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const target = ctx.mentions?.members?.first();
 if (!target) return ctx.reply({ content: '❌ Mention a user.', ephemeral: true });
 const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim();
 if (!reason) return ctx.reply({ content: '❌ Provide a reason: `.warn @user <reason>`', ephemeral: true });

 const c = createCase(guild.id, { type: 'warn', targetId: target.id, executorId: authorId, reason });
 const total = require('./cases').getAllCases(guild.id).filter(x => x.targetId === target.id && x.type === 'warn' && x.status !== 'pardoned').length;

 // DM the user
 try {
 const { sendInvokeDm } = require('./invoke');
 await sendInvokeDm(target.user, guild.id, 'warn', {
 targetMention: `<@${target.id}>`, targetName: target.user.username, targetId: target.id,
 modMention: `<@${authorId}>`, modName: ctx.member?.user?.username ?? authorId,
 reason, guildName: guild.name, guildId: guild.id,
 });
 } catch {}

 // Warn escalation
 const escCfg = db.get('warnEscalation', {});
 if (escCfg[total]) {
 const action = escCfg[total];
 if (action === 'kick' && target.kickable) await target.kick(`Auto-kick: ${total} warnings`).catch(()=>{});
 if (action === 'ban') await guild.bans.create(target.id, { reason: `Auto-ban: ${total} warnings` }).catch(()=>{});
 if (action === 'timeout') await target.timeout(3600000, `Auto-timeout: ${total} warnings`).catch(()=>{});
 }

 const logEmbed = base(COLORS.warning).setTitle('⚠️ Warning Issued')
 .addFields(
 { name: '👤 User', value: `${target.user} (${target.id})`, inline: true },
 { name: '👮 Moderator', value: `<@${authorId}>`, inline: true },
 { name: '📝 Reason', value: reason },
 { name: '🏷️ Case', value: `#${c.id}`, inline: true },
 { name: '⚠️ Total Warnings', value: total.toString(), inline: true },
 );
 await sendModLog(guild, logEmbed);
 return sendInvokeReply(ctx, guild.id, 'warn', {
 targetName: target.user.username, targetId: target.id, targetMention: `<@${target.id}>`,
 modMention: `<@${authorId}>`, reason, guildName: guild.name, guildId: guild.id,
 });
 }

 // ════════════════════════════════════════════
 // PURGE
 // ════════════════════════════════════════════
 if (command === 'purge') return handlePurge(ctx, args);

 // ════════════════════════════════════════════
 // LOCK / UNLOCK
 // ════════════════════════════════════════════
 if (command === 'lock') return handleLock(ctx, args);
 if (command === 'unlockall') return handleUnlockAll(ctx, args.slice(1));
 if (command === 'unlock') return handleUnlock(ctx, args);
 if (command === 'lockdown') {
 if (args[0] === 'ignore') return handleLockdownIgnore(ctx, args);
 return handleLockdown(ctx, args);
 }

 // ════════════════════════════════════════════
 // CHANNEL COMMANDS
 // ════════════════════════════════════════════
 if (command === 'hide') return handleHide(ctx, args);
 if (command === 'unhide') return handleUnhide(ctx, args);
 if (command === 'talk') return handleTalk(ctx, args);
 if (command === 'slowmode') return handleSlowmode(ctx, args);
 if (command === 'topic') return handleTopic(ctx, args);
 if (command === 'chanrename') return handleChannelRename(ctx, args);
 if (command === 'revokefiles') return handleRevokeFiles(ctx, args);

 // ════════════════════════════════════════════
 // NICK / FORCENICK / STRIPSTAFF
 // ════════════════════════════════════════════
 if (command === 'nick' || command === 'rename') return handleRename(ctx, args);
 if (command === 'forcenickname' || command === 'fn') return handleForceNickname(ctx, args, client);
 if (command === 'stripstaff') return handleStripStaff(ctx, args);

 // ════════════════════════════════════════════
 // MUTE SYSTEM
 // ════════════════════════════════════════════
 if (command === 'mute') return handleMute(ctx, args, client);
 if (command === 'unmute') return handleUnmute(ctx, args, client);
 if (command === 'imute') return handleIMute(ctx, args);
 if (command === 'iunmute') return handleIUnmute(ctx, args);
 if (command === 'rmute') return handleRMute(ctx, args);
 if (command === 'runmute') return handleRUnmute(ctx, args);
 if (command === 'setupmute') return handleSetupMute(ctx, args);

 // ════════════════════════════════════════════
 // JAIL SYSTEM
 // ════════════════════════════════════════════
 if (command === 'jail') {
 if (args[0] === 'setup') return handleJailSetup(ctx, args);
 return handleJail(ctx, args, client);
 }
 if (command === 'unjail') return handleUnjail(ctx, args, client);
 if (command === 'jaillist') return handleJailList(ctx);

 // ════════════════════════════════════════════
 // ROLE MANAGEMENT
 // ════════════════════════════════════════════
 if (command === 'role') return handleRole(ctx, args, client);
 if (command === 'temprole') return handleTempRole(ctx, args, client);

 // ════════════════════════════════════════════
 // THREAD
 // ════════════════════════════════════════════
 if (command === 'thread') return handleThread(ctx, args, client);

 // ════════════════════════════════════════════
 // VOICE
 // ════════════════════════════════════════════
 if (command === 'moveall') return handleMoveAll(ctx, args);
 if (command === 'drag') return handleDrag(ctx, args);

 // ════════════════════════════════════════════
 // STICKY ROLES
 // ════════════════════════════════════════════
 if (command === 'stickyrole') return handleStickyRole(ctx, args, client);

 // ════════════════════════════════════════════
 // CASE / HISTORY / NOTES
 // ════════════════════════════════════════════
 if (command === 'case') return cmdCase(ctx, args, client);
 if (command === 'reason') return cmdReason(ctx, args, client);
 if (command === 'proof') return cmdProof(ctx, args, client);
 if (command === 'history') {
 if (args[0] === 'remove') return cmdHistoryRemove(ctx, args.slice(1), client);
 if (args[0] === 'removeall') return cmdHistoryRemoveAll(ctx, args.slice(1), client);
 return cmdHistory(ctx, args, client);
 }
 if (command === 'modstats') return cmdModStats(ctx, args, client);
 if (command === 'warnings') return cmdWarnings(ctx, args, client);

 if (command === 'note' || command === 'notes') {
 if (!isStaffOrAdmin(ctx.member)) return ctx.reply({ content: '❌ No permission.', ephemeral: true });
 const sub = args[0]?.toLowerCase();
 const target = ctx.mentions?.users?.first();
 const notes = db.get('notes', {});

 if (sub === 'add' && target) {
 const text = args.slice(2).join(' ').replace(/<@!?\d+>/g, '').trim();
 if (!text) return ctx.reply({ content: '❌ Provide note text.' });
 if (!notes[target.id]) notes[target.id] = [];
 notes[target.id].push({ text, by: authorId, at: Date.now() });
 db.set('notes', notes);
 return ctx.reply({ content: `✅ Note added for **${target.username}**.` });
 }
 if (sub === 'remove' && target) {
 const idx = parseInt(args[2]) - 1;
 if (isNaN(idx) || !notes[target.id]?.[idx]) return ctx.reply({ content: '❌ Invalid note number.' });
 notes[target.id].splice(idx, 1);
 db.set('notes', notes);
 return ctx.reply({ content: `✅ Note #${idx + 1} removed for **${target.username}**.` });
 }
 if (sub === 'clear' && target) {
 delete notes[target.id];
 db.set('notes', notes);
 return ctx.reply({ content: `✅ All notes cleared for **${target.username}**.` });
 }
 const noteTarget = target || (args[0]?.match(/^\d+$/) ? null : null);
 if (target) {
 const userNotes = notes[target.id] || [];
 if (!userNotes.length) return ctx.reply({ content: `No notes for **${target.username}**.` });
 const { sendPaginated } = require('../utils/paginator');
 const { chunk } = require('../utils/paginator');
 const pages = chunk(userNotes, 8).map(pg => ({
 title: `📝 Notes — ${target.username}`,
 description: pg.map((n, i) => `**${i + 1}.** ${n.text}\n↳ by <@${n.by}> <t:${Math.floor(n.at / 1000)}:R>`).join('\n\n'),
 color: COLORS.primary,
 }));
 return sendPaginated(ctx.channel, pages, authorId);
 }
 if (command === 'note' && target) {
 const text = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim();
 if (!text) return ctx.reply({ content: '❌ Provide note text: `.note @user <text>`' });
 if (!notes[target.id]) notes[target.id] = [];
 notes[target.id].push({ text, by: authorId, at: Date.now() });
 db.set('notes', notes);
 return ctx.reply({ content: `✅ Note added for **${target.username}**.` });
 }
 return ctx.reply({ content: '❌ Usage: `.notes @user` `.notes add @user <text>` `.notes remove @user #` `.notes clear @user`' });
 }

 // ════════════════════════════════════════════
 // REMINDERS
 // ════════════════════════════════════════════
 if (command === 'remind' || command === 'reminders')
 return handleRemind(ctx, command === 'reminders' ? ['list'] : args, client);

 // ════════════════════════════════════════════
 // CHANNEL TOOLS
 // ════════════════════════════════════════════
 if (command === 'nuke') return handleNuke(ctx, args, client);
 if (command === 'naughty') return handleNaughty(ctx, args);
 if (command === 'permissions') return handlePermissions(ctx, args);
 if (command === 'dump') return handleDump(ctx, args);
 if (command === 'newmembers') return handleNewMembers(ctx, args);
 if (command === 'clearinvites') return handleClearInvites(ctx, args);

 // ════════════════════════════════════════════
 // ALIASES
 // ════════════════════════════════════════════
 if (command === 'caselog') return cmdCase(ctx, args, client);
 if (command === 'moderationhistory') return cmdHistory(ctx, args, client);

 return ctx.reply({ content: `❌ Unknown moderation command: \`${command}\`.` });
}

// ──────────────────────────────────────────────────────────
// TEMPBAN RESTART RECOVERY
// ──────────────────────────────────────────────────────────
async function restoreTempBans(client) {
 let restored = 0, expired = 0;
 for (const guild of client.guilds.cache.values()) {
 const db = getGuildDb(guild.id);
 const tempbans = db.get('tempbans', {});
 const now = Date.now();

 for (const [userId, data] of Object.entries(tempbans)) {
 if (data.expires <= now) {
 try { await guild.bans.remove(userId, 'Temp-ban expired (bot restart recovery)'); } catch {}
 const tbs = db.get('tempbans', {}); delete tbs[userId]; db.set('tempbans', tbs);
 createCase(guild.id, { type: 'unban', targetId: userId, executorId: 'system', reason: 'Temp-ban expired (restart recovery)' });
 expired++;
 } else {
 const remaining = data.expires - now;
 setTimeout(async () => {
 try { await guild.bans.remove(userId, 'Temporary ban expired'); } catch {}
 const _db = getGuildDb(guild.id);
 const _tbs = _db.get('tempbans', {}); delete _tbs[userId]; _db.set('tempbans', _tbs);
 createCase(guild.id, { type: 'unban', targetId: userId, executorId: 'system', reason: 'Temp-ban expired' });
 }, remaining);
 restored++;
 }
 }
 }
 const logger = require('../utils/logger');
 logger.info('TEMPBAN', `Restored ${restored} active tempban(s); processed ${expired} overdue`);
}

module.exports = { handleModerationCommand, parseDuration, formatDuration, restoreTempBans };