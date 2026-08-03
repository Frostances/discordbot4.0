// modules/filter.js — Chat Filter System (36 commands)
const { EmbedBuilder, PermissionFlagsBits, AutoModerationRuleEventType, AutoModerationActionType, AutoModerationRuleTriggerType } = require('discord.js');
const { getGuildDb } = require('./database');
const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
const { isAdmin } = require('./helpers');

// ══════════════════════════════════════════════════════════
// IN-MEMORY SPAM TRACKER
// ══════════════════════════════════════════════════════════
const spamTracker = new Map();

function getSpamTracker(guildId, userId) {
  if (!spamTracker.has(guildId)) spamTracker.set(guildId, new Map());
  const guildMap = spamTracker.get(guildId);
  if (!guildMap.has(userId)) guildMap.set(userId, []);
  return guildMap.get(userId);
}

function pruneSpamTracker(guildId, userId, windowMs) {
  const now = Date.now();
  const arr = getSpamTracker(guildId, userId);
  const filtered = arr.filter(t => now - t < windowMs);
  spamTracker.get(guildId).set(userId, filtered);
  return filtered;
}

// ══════════════════════════════════════════════════════════
// DATA HELPERS
// ══════════════════════════════════════════════════════════
function getFilterData(guildId) {
  const db = getGuildDb(guildId);
  return db.get('filters', {
    words: [],
    wordExempts: [],
    wordWhitelist: [],
    invites: { enabled: false, exempts: [] },
    massmention: { enabled: false, threshold: 5, exempts: [] },
    spoilers: { enabled: false, threshold: 5, exempts: [] },
    links: { enabled: false, exempts: [], whitelist: [] },
    regex: { patterns: [], exempts: [] },
    emoji: { enabled: false, threshold: 10, exempts: [] },
    musicfiles: { enabled: false, exempts: [] },
    spam: { enabled: false, threshold: 5, window: 5000, exempts: [] },
    caps: { enabled: false, threshold: 70, exempts: [] },
    snipe: { types: [] },
  });
}

function setFilterData(guildId, data) {
  const db = getGuildDb(guildId);
  db.set('filters', data);
}

// ══════════════════════════════════════════════════════════
// PERMISSION / EXEMPTION HELPERS
// ══════════════════════════════════════════════════════════
function hasManageChannels(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function hasManageGuild(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function isExempt(member, exemptRoleIds) {
  if (!exemptRoleIds || !exemptRoleIds.length) return false;
  return exemptRoleIds.some(id => member.roles.cache.has(id));
}

// ══════════════════════════════════════════════════════════
// EMOJI COUNTING
// ══════════════════════════════════════════════════════════
function countEmojis(text) {
  let count = 0;
  const custom = text.match(/<(a)?:\w+:\d+>/g);
  if (custom) count += custom.length;
  const unicode = text.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]|[\u{0030}-\u{0039}]\u{FE0F}\u{20E3}|[\u{0023}]\u{FE0F}\u{20E3}|[\u{002A}]\u{FE0F}\u{20E3}|[\u{2B50}]|[\u{2B55}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{24C2}]|[\u{25B6}]|[\u{25C0}]|[\u{2194}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{2934}-\u{2935}]|[\u{25AA}-\u{25AB}]|[\u{25FB}-\u{25FE}]|[\u{2328}]|[\u{23CF}]|[\u{238C}]|[\u{2B06}]|[\u{2B07}]|[\u{2B05}]|[\u{27A1}]/gu);
  if (unicode) count += unicode.length;
  return count;
}

// ══════════════════════════════════════════════════════════
// FILTER CHECK FUNCTIONS
// ══════════════════════════════════════════════════════════
async function runFilters(message) {
  if (message.author.bot || !message.guild) return false;
  const member = message.member;
  if (!member) return false;
  if (isAdmin(member)) return false;

  const data = getFilterData(message.guild.id);
  const content = message.content;
  const lower = content.toLowerCase();
  let deleted = false;

  const del = async () => {
    if (deleted) return true;
    try { await message.delete(); deleted = true; } catch {}
    return deleted;
  };

  // ── Word Filter ──
  if (data.words.length) {
    if (!isExempt(member, data.wordExempts)) {
      for (const word of data.words) {
        if (data.wordWhitelist.includes(word.toLowerCase())) continue;
        if (lower.includes(word.toLowerCase())) { await del(); break; }
      }
    }
  }
  if (deleted) return true;

  // ── Invite Filter ──
  if (data.invites.enabled) {
    if (!isExempt(member, data.invites.exempts)) {
      if (/discord\.gg\/[a-zA-Z0-9-]+/i.test(content) ||
          /discord(?:app)?\.com\/invite\/[a-zA-Z0-9-]+/i.test(content)) {
        await del();
      }
    }
  }
  if (deleted) return true;

  // ── Mass Mention Filter ──
  if (data.massmention.enabled) {
    if (!isExempt(member, data.massmention.exempts)) {
      const mentions = content.match(/<@!?(\d+)>/g) || [];
      if (mentions.length > data.massmention.threshold) await del();
    }
  }
  if (deleted) return true;

  // ── Spoiler Filter ──
  if (data.spoilers.enabled) {
    if (!isExempt(member, data.spoilers.exempts)) {
      const spoilers = content.match(/\|\|.*?\|\|/g) || [];
      if (spoilers.length > data.spoilers.threshold) await del();
    }
  }
  if (deleted) return true;

  // ── Link Filter ──
  if (data.links.enabled) {
    if (!isExempt(member, data.links.exempts)) {
      const hasLink = /https?:\/\/|www\./i.test(content);
      if (hasLink) {
        let whitelisted = false;
        for (const url of data.links.whitelist || []) {
          if (lower.includes(url.toLowerCase())) { whitelisted = true; break; }
        }
        if (!whitelisted) await del();
      }
    }
  }
  if (deleted) return true;

  // ── Regex Filter ──
  if (data.regex.patterns.length) {
    if (!isExempt(member, data.regex.exempts)) {
      for (const entry of data.regex.patterns) {
        try {
          const regex = new RegExp(entry.pattern, 'i');
          if (regex.test(content)) { await del(); break; }
        } catch {}
      }
    }
  }
  if (deleted) return true;

  // ── Emoji Filter ──
  if (data.emoji.enabled) {
    if (!isExempt(member, data.emoji.exempts)) {
      const emojiCount = countEmojis(content);
      if (emojiCount > data.emoji.threshold) await del();
    }
  }
  if (deleted) return true;

  // ── Music Files Filter ──
  if (data.musicfiles.enabled) {
    if (!isExempt(member, data.musicfiles.exempts)) {
      const musicExts = ['.mp3','.wav','.flac','.aac','.ogg','.m4a','.wma','.opus','.weba'];
      const hasMusic = message.attachments.some(att =>
        musicExts.some(ext => att.name.toLowerCase().endsWith(ext))
      );
      if (hasMusic) await del();
    }
  }
  if (deleted) return true;

  // ── Spam Filter ──
  if (data.spam.enabled) {
    if (!isExempt(member, data.spam.exempts)) {
      const arr = pruneSpamTracker(message.guild.id, message.author.id, data.spam.window);
      arr.push(Date.now());
      if (arr.length > data.spam.threshold) await del();
    }
  }
  if (deleted) return true;

  // ── Caps Filter ──
  if (data.caps.enabled) {
    if (!isExempt(member, data.caps.exempts)) {
      const letters = content.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 5) {
        const upper = letters.replace(/[^A-Z]/g, '');
        const pct = (upper.length / letters.length) * 100;
        if (pct > data.caps.threshold) await del();
      }
    }
  }

  return deleted;
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════

async function handleFilterBase(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const embed = new EmbedBuilder()
    .setTitle('🧹 Filter System')
    .setColor('#5865F2')
    .setDescription('Use the commands below to configure chat filters.')
    .addFields(
      { name: 'Word Filter', value: `${data.words.length} word(s) | ${data.wordExempts.length} exempt role(s)`, inline: true },
      { name: 'Invite Filter', value: data.invites.enabled ? '✅ On' : '❌ Off', inline: true },
      { name: 'Mass Mention', value: data.massmention.enabled ? `✅ On (${data.massmention.threshold})` : '❌ Off', inline: true },
      { name: 'Spoiler Filter', value: data.spoilers.enabled ? `✅ On (${data.spoilers.threshold})` : '❌ Off', inline: true },
      { name: 'Link Filter', value: data.links.enabled ? '✅ On' : '❌ Off', inline: true },
      { name: 'Regex Filter', value: `${data.regex.patterns.length} pattern(s)`, inline: true },
      { name: 'Emoji Filter', value: data.emoji.enabled ? `✅ On (${data.emoji.threshold})` : '❌ Off', inline: true },
      { name: 'Music Files', value: data.musicfiles.enabled ? '✅ On' : '❌ Off', inline: true },
      { name: 'Spam Filter', value: data.spam.enabled ? `✅ On (${data.spam.threshold}/${data.spam.window}ms)` : '❌ Off', inline: true },
      { name: 'Caps Filter', value: data.caps.enabled ? `✅ On (${data.caps.threshold}%)` : '❌ Off', inline: true },
      { name: 'Snipe Restrictions', value: data.snipe.types.length ? data.snipe.types.join(', ') : 'None', inline: true },
    );
  return message.reply({ embeds: [embed] });
}

async function handleFilterAdd(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const word = args[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter add <word>`')] });
  const data = getFilterData(message.guild.id);
  if (data.words.includes(word)) return message.reply({ embeds: [mkError('Duplicate', `**${word}** is already filtered.`)] });
  data.words.push(word);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Word Added', `Added **${word}** to the filter list.`)] });
}

async function handleFilterRemove(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const word = args[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter remove <word>`')] });
  const data = getFilterData(message.guild.id);
  if (!data.words.includes(word)) return message.reply({ embeds: [mkError('Not Found', `**${word}** is not in the filter list.`)] });
  data.words = data.words.filter(w => w !== word);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Word Removed', `Removed **${word}** from the filter list.`)] });
}

async function handleFilterList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.words.length) return message.reply({ embeds: [mkInfo('Filtered Words', 'No words are currently filtered.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Filtered Words')
    .setDescription(data.words.map(w => `• ${w}`).join('\n'))
    .setColor('#5865F2')
    .setFooter({ text: `${data.words.length} word(s)` });
  return message.reply({ embeds: [embed] });
}

async function handleFilterReset(message) {
  if (!hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Guild** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const count = data.words.length;
  data.words = [];
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Filter Reset', `Cleared **${count}** filtered word(s).`)] });
}

async function handleFilterWhitelist(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const word = args[0]?.toLowerCase();
  if (!word) return message.reply({ embeds: [mkError('Missing Word', 'Usage: `,filter whitelist <word>`')] });
  const data = getFilterData(message.guild.id);
  if (data.wordWhitelist.includes(word)) {
    data.wordWhitelist = data.wordWhitelist.filter(w => w !== word);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Removed **${word}** from the whitelist.`)] });
  }
  data.wordWhitelist.push(word);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Added **${word}** to the whitelist.`)] });
}

async function handleFilterExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.wordExempts.includes(role.id)) {
    data.wordExempts = data.wordExempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from word filter exemptions.`)] });
  }
  data.wordExempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to word filter exemptions.`)] });
}

async function handleFilterExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.wordExempts.length) return message.reply({ embeds: [mkInfo('Word Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Word Filter Exemptions')
    .setDescription(data.wordExempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterWordMigrate(message) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.words.length) return message.reply({ embeds: [mkError('No Words', 'There are no filtered words to migrate.')] });
  try {
    const words = data.words.filter(w => w.length >= 2 && w.length <= 60);
    if (!words.length) return message.reply({ embeds: [mkError('Invalid Words', 'No valid words to migrate (must be 2–60 chars).')] });
    await message.guild.autoModerationRules.create({
      name: 'Migrated Word Filter',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: words },
      actions: [
        { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Your message contained a blocked word.' } },
        { type: AutoModerationActionType.SendAlertMessage, metadata: { channelId: message.channel.id } },
      ],
      enabled: true,
    });
    return message.reply({ embeds: [mkSuccess('Words Migrated', `Migrated **${words.length}** word(s) to Discord AutoMod. The legacy list remains intact. You may want to run \`,filter reset\` to clear legacy words.`)] });
  } catch (err) {
    return message.reply({ embeds: [mkError('Migration Failed', err.message)] });
  }
}

async function handleFilterInvites(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.invites.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.invites.enabled = false;
  else data.invites.enabled = !data.invites.enabled;
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Invite Filter', `Invite filter is now **${data.invites.enabled ? 'enabled' : 'disabled'}**.`)] });
}

async function handleFilterInvitesExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter invites exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.invites.exempts.includes(role.id)) {
    data.invites.exempts = data.invites.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from invite filter exemptions.`)] });
  }
  data.invites.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to invite filter exemptions.`)] });
}

async function handleFilterInvitesExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.invites.exempts.length) return message.reply({ embeds: [mkInfo('Invite Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Invite Filter Exemptions')
    .setDescription(data.invites.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterMassMention(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.massmention.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.massmention.enabled = false;
  else {
    const threshold = parseInt(args[0]);
    if (!isNaN(threshold) && threshold > 0) {
      data.massmention.threshold = threshold;
      data.massmention.enabled = true;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Mass Mention Filter', `Set threshold to **${threshold}** mentions and enabled.`)] });
    }
    data.massmention.enabled = !data.massmention.enabled;
  }
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Mass Mention Filter', `Mass mention filter is now **${data.massmention.enabled ? 'enabled' : 'disabled'}** (threshold: ${data.massmention.threshold}).`)] });
}

async function handleFilterMassMentionExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter massmention exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.massmention.exempts.includes(role.id)) {
    data.massmention.exempts = data.massmention.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from mass mention exemptions.`)] });
  }
  data.massmention.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to mass mention exemptions.`)] });
}

async function handleFilterMassMentionExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.massmention.exempts.length) return message.reply({ embeds: [mkInfo('Mass Mention Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Mass Mention Exemptions')
    .setDescription(data.massmention.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterSpoilers(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.spoilers.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.spoilers.enabled = false;
  else {
    const threshold = parseInt(args[0]);
    if (!isNaN(threshold) && threshold > 0) {
      data.spoilers.threshold = threshold;
      data.spoilers.enabled = true;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Spoiler Filter', `Set threshold to **${threshold}** spoilers and enabled.`)] });
    }
    data.spoilers.enabled = !data.spoilers.enabled;
  }
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Spoiler Filter', `Spoiler filter is now **${data.spoilers.enabled ? 'enabled' : 'disabled'}** (threshold: ${data.spoilers.threshold}).`)] });
}

async function handleFilterSpoilersExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter spoilers exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.spoilers.exempts.includes(role.id)) {
    data.spoilers.exempts = data.spoilers.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from spoiler filter exemptions.`)] });
  }
  data.spoilers.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to spoiler filter exemptions.`)] });
}

async function handleFilterSpoilersExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.spoilers.exempts.length) return message.reply({ embeds: [mkInfo('Spoiler Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Spoiler Filter Exemptions')
    .setDescription(data.spoilers.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterLinks(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.links.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.links.enabled = false;
  else data.links.enabled = !data.links.enabled;
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Link Filter', `Link filter is now **${data.links.enabled ? 'enabled' : 'disabled'}**.`)] });
}

async function handleFilterLinksExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter links exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.links.exempts.includes(role.id)) {
    data.links.exempts = data.links.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from link filter exemptions.`)] });
  }
  data.links.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to link filter exemptions.`)] });
}

async function handleFilterLinksExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.links.exempts.length) return message.reply({ embeds: [mkInfo('Link Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Link Filter Exemptions')
    .setDescription(data.links.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterLinksWhitelist(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const url = args[0]?.toLowerCase();
  if (!url) return message.reply({ embeds: [mkError('Missing URL', 'Usage: `,filter links whitelist <url>`')] });
  const data = getFilterData(message.guild.id);
  if (data.links.whitelist.includes(url)) {
    data.links.whitelist = data.links.whitelist.filter(u => u !== url);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Removed **${url}** from the link whitelist.`)] });
  }
  data.links.whitelist.push(url);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Whitelist Updated', `Added **${url}** to the link whitelist.`)] });
}

async function handleFilterRegex(message, args) {
  if (!hasManageChannels(message.member) || !hasManageGuild(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need **Manage Channels** and **Manage Guild** permissions.')] });
  }
  const pattern = args[0];
  if (!pattern) {
    const data = getFilterData(message.guild.id);
    if (!data.regex.patterns.length) return message.reply({ embeds: [mkInfo('Regex Patterns', 'No regex patterns configured.')] });
    const embed = new EmbedBuilder()
      .setTitle('📋 Regex Patterns')
      .setDescription(data.regex.patterns.map((p, i) => `${i + 1}. \`${p.name}\` — \`${p.pattern}\``).join('\n'))
      .setColor('#5865F2');
    return message.reply({ embeds: [embed] });
  }
  const data = getFilterData(message.guild.id);
  const existing = data.regex.patterns.find(p => p.pattern === pattern);
  if (existing) {
    data.regex.patterns = data.regex.patterns.filter(p => p.pattern !== pattern);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Pattern Removed', `Removed regex pattern \`${pattern}\`.`)] });
  }
  try { new RegExp(pattern); } catch {
    return message.reply({ embeds: [mkError('Invalid Regex', 'That is not a valid regular expression.')] });
  }
  data.regex.patterns.push({ name: pattern, pattern });
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Pattern Added', `Added regex pattern \`${pattern}\`.`)] });
}

async function handleFilterEmoji(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.emoji.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.emoji.enabled = false;
  else {
    const threshold = parseInt(args[0]);
    if (!isNaN(threshold) && threshold > 0) {
      data.emoji.threshold = threshold;
      data.emoji.enabled = true;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Emoji Filter', `Set threshold to **${threshold}** emojis and enabled.`)] });
    }
    data.emoji.enabled = !data.emoji.enabled;
  }
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Emoji Filter', `Emoji filter is now **${data.emoji.enabled ? 'enabled' : 'disabled'}** (threshold: ${data.emoji.threshold}).`)] });
}

async function handleFilterEmojiExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter emoji exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.emoji.exempts.includes(role.id)) {
    data.emoji.exempts = data.emoji.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from emoji filter exemptions.`)] });
  }
  data.emoji.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to emoji filter exemptions.`)] });
}

async function handleFilterEmojiExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.emoji.exempts.length) return message.reply({ embeds: [mkInfo('Emoji Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Emoji Filter Exemptions')
    .setDescription(data.emoji.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterMusicFiles(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.musicfiles.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.musicfiles.enabled = false;
  else data.musicfiles.enabled = !data.musicfiles.enabled;
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Music Files Filter', `Music files filter is now **${data.musicfiles.enabled ? 'enabled' : 'disabled'}**.`)] });
}

async function handleFilterMusicFilesExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter musicfiles exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.musicfiles.exempts.includes(role.id)) {
    data.musicfiles.exempts = data.musicfiles.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from music files exemptions.`)] });
  }
  data.musicfiles.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to music files exemptions.`)] });
}

async function handleFilterMusicFilesExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.musicfiles.exempts.length) return message.reply({ embeds: [mkInfo('Music Files Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Music Files Exemptions')
    .setDescription(data.musicfiles.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterSpam(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.spam.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.spam.enabled = false;
  else {
    const threshold = parseInt(args[0]);
    if (!isNaN(threshold) && threshold > 0) {
      data.spam.threshold = threshold;
      data.spam.enabled = true;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Spam Filter', `Set threshold to **${threshold}** messages and enabled.`)] });
    }
    data.spam.enabled = !data.spam.enabled;
  }
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Spam Filter', `Spam filter is now **${data.spam.enabled ? 'enabled' : 'disabled'}** (threshold: ${data.spam.threshold} msgs / ${data.spam.window}ms).`)] });
}

async function handleFilterSpamExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter spam exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.spam.exempts.includes(role.id)) {
    data.spam.exempts = data.spam.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from spam filter exemptions.`)] });
  }
  data.spam.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to spam filter exemptions.`)] });
}

async function handleFilterSpamExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.spam.exempts.length) return message.reply({ embeds: [mkInfo('Spam Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Spam Filter Exemptions')
    .setDescription(data.spam.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterCaps(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  const setting = args[0]?.toLowerCase();
  if (setting === 'on' || setting === 'enable' || setting === 'true') data.caps.enabled = true;
  else if (setting === 'off' || setting === 'disable' || setting === 'false') data.caps.enabled = false;
  else {
    const threshold = parseInt(args[0]);
    if (!isNaN(threshold) && threshold > 0 && threshold <= 100) {
      data.caps.threshold = threshold;
      data.caps.enabled = true;
      setFilterData(message.guild.id, data);
      return message.reply({ embeds: [mkSuccess('Caps Filter', `Set threshold to **${threshold}%** and enabled.`)] });
    }
    data.caps.enabled = !data.caps.enabled;
  }
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Caps Filter', `Caps filter is now **${data.caps.enabled ? 'enabled' : 'disabled'}** (threshold: ${data.caps.threshold}%).`)] });
}

async function handleFilterCapsExempt(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const role = message.mentions.roles.first();
  if (!role) return message.reply({ embeds: [mkError('Missing Role', 'Mention a role: `,filter caps exempt @Role`')] });
  const data = getFilterData(message.guild.id);
  if (data.caps.exempts.includes(role.id)) {
    data.caps.exempts = data.caps.exempts.filter(id => id !== role.id);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Exemption Removed', `Removed <@&${role.id}> from caps filter exemptions.`)] });
  }
  data.caps.exempts.push(role.id);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Exemption Added', `Added <@&${role.id}> to caps filter exemptions.`)] });
}

async function handleFilterCapsExemptList(message) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const data = getFilterData(message.guild.id);
  if (!data.caps.exempts.length) return message.reply({ embeds: [mkInfo('Caps Filter Exemptions', 'No roles are exempt.')] });
  const embed = new EmbedBuilder()
    .setTitle('📋 Caps Filter Exemptions')
    .setDescription(data.caps.exempts.map(id => `<@&${id}>`).join('\n'))
    .setColor('#5865F2');
  return message.reply({ embeds: [embed] });
}

async function handleFilterSnipe(message, args) {
  if (!hasManageChannels(message.member)) {
    return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Channels** permission.')] });
  }
  const type = args[0]?.toLowerCase();
  const validTypes = ['images', 'links', 'mentions', 'invites'];
  const data = getFilterData(message.guild.id);
  if (!type) {
    return message.reply({ embeds: [mkInfo('Snipe Restrictions', `Restricted types: ${data.snipe.types.length ? data.snipe.types.join(', ') : 'None'}`)] });
  }
  if (!validTypes.includes(type)) {
    return message.reply({ embeds: [mkError('Invalid Type', `Valid types: ${validTypes.join(', ')}`)] });
  }
  if (data.snipe.types.includes(type)) {
    data.snipe.types = data.snipe.types.filter(t => t !== type);
    setFilterData(message.guild.id, data);
    return message.reply({ embeds: [mkSuccess('Snipe Updated', `Removed **${type}** from snipe restrictions.`)] });
  }
  data.snipe.types.push(type);
  setFilterData(message.guild.id, data);
  return message.reply({ embeds: [mkSuccess('Snipe Updated', `Added **${type}** to snipe restrictions.`)] });
}

// ══════════════════════════════════════════════════════════
// MAIN ROUTER
// ══════════════════════════════════════════════════════════
async function handleFilter(message, args) {
  const sub = args[0]?.toLowerCase();
  const sub2 = args[1]?.toLowerCase();

  if (sub === 'add') return handleFilterAdd(message, args.slice(1));
  if (sub === 'remove') return handleFilterRemove(message, args.slice(1));
  if (sub === 'list') return handleFilterList(message);
  if (sub === 'reset') return handleFilterReset(message);
  if (sub === 'whitelist') return handleFilterWhitelist(message, args.slice(1));
  if (sub === 'exempt' && sub2 !== 'list') return handleFilterExempt(message, args.slice(1));
  if (sub === 'exempt' && sub2 === 'list') return handleFilterExemptList(message);
  if (sub === 'wordmigrate') return handleFilterWordMigrate(message);
  if (sub === 'invites' && sub2 !== 'exempt') return handleFilterInvites(message, args.slice(1));
  if (sub === 'invites' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterInvitesExempt(message, args.slice(2));
  if (sub === 'invites' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterInvitesExemptList(message);
  if (sub === 'massmention' && sub2 !== 'exempt') return handleFilterMassMention(message, args.slice(1));
  if (sub === 'massmention' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterMassMentionExempt(message, args.slice(2));
  if (sub === 'massmention' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterMassMentionExemptList(message);
  if (sub === 'spoilers' && sub2 !== 'exempt') return handleFilterSpoilers(message, args.slice(1));
  if (sub === 'spoilers' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterSpoilersExempt(message, args.slice(2));
  if (sub === 'spoilers' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterSpoilersExemptList(message);
  if (sub === 'links' && sub2 !== 'exempt' && sub2 !== 'whitelist') return handleFilterLinks(message, args.slice(1));
  if (sub === 'links' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterLinksExempt(message, args.slice(2));
  if (sub === 'links' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterLinksExemptList(message);
  if (sub === 'links' && sub2 === 'whitelist') return handleFilterLinksWhitelist(message, args.slice(2));
  if (sub === 'regex') return handleFilterRegex(message, args.slice(1));
  if (sub === 'emoji' && sub2 !== 'exempt') return handleFilterEmoji(message, args.slice(1));
  if (sub === 'emoji' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterEmojiExempt(message, args.slice(2));
  if (sub === 'emoji' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterEmojiExemptList(message);
  if (sub === 'musicfiles' && sub2 !== 'exempt') return handleFilterMusicFiles(message, args.slice(1));
  if (sub === 'musicfiles' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterMusicFilesExempt(message, args.slice(2));
  if (sub === 'musicfiles' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterMusicFilesExemptList(message);
  if (sub === 'spam' && sub2 !== 'exempt') return handleFilterSpam(message, args.slice(1));
  if (sub === 'spam' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterSpamExempt(message, args.slice(2));
  if (sub === 'spam' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterSpamExemptList(message);
  if (sub === 'caps' && sub2 !== 'exempt') return handleFilterCaps(message, args.slice(1));
  if (sub === 'caps' && sub2 === 'exempt' && args[2]?.toLowerCase() !== 'list') return handleFilterCapsExempt(message, args.slice(2));
  if (sub === 'caps' && sub2 === 'exempt' && args[2]?.toLowerCase() === 'list') return handleFilterCapsExemptList(message);
  if (sub === 'snipe') return handleFilterSnipe(message, args.slice(1));

  return handleFilterBase(message);
}

module.exports = {
  handleFilter,
  onMessageCreate: runFilters,
};