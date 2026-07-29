/**
 * welcomeSystem.js — Welcome, Goodbye, Boost, and Level-Up message system
 *
 * Embed code format (start with {embed}$v):
 *   {embed}$v{message: text}$v{color: hex}$v{thumbnail: url}$v
 *   {title: text}$v{description: text}$v{footer: text && iconUrl}$v
 *   {image: url}$v{author: name && iconUrl && url}$v
 *   {field: Name && Value}$v{field: Name && Value && true (inline)}$v
 *   {button: link && Label && https://url}$v{timestamp}$v{url: https://link}
 *
 * All supported variables are listed in buildVars() below.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { getGuildDb } = require('./database');

// ══════════════════════════════════════════════════════════
//  ORDINAL HELPER
// ══════════════════════════════════════════════════════════
function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ══════════════════════════════════════════════════════════
//  VARIABLE SUBSTITUTION
// ══════════════════════════════════════════════════════════

/** Replace all {key} / {key.subkey} tokens in a string. */
function substituteVars(str, vars) {
    // Match {anything without newlines}
    return str.replace(/\{[^{}]+\}/g, (match) => {
        return vars[match] !== undefined ? vars[match] : match;
    });
}

// ══════════════════════════════════════════════════════════
//  EMBED CODE PARSER
// ══════════════════════════════════════════════════════════

/**
 * Parse an embed code string and return { content, embed, components }.
 * If the string doesn't start with {embed}, returns { content: str, embed: null, components: [] }.
 */
function parseEmbedCode(raw, vars) {
    const str = substituteVars(raw.trim(), vars);

    // Plain-text: no embed prefix
    if (!str.startsWith('{embed}')) {
        return { content: str || null, embed: null, components: [] };
    }

    const parts      = str.split('$v').map(p => p.trim()).filter(Boolean);
    const embed      = new EmbedBuilder().setColor('#5865F2');
    let   content    = null;
    const components = [];
    const buttons    = [];

    for (const part of parts) {
        if (part === '{embed}') continue;
        if (!part.startsWith('{') || !part.endsWith('}')) continue;

        const inner = part.slice(1, -1);
        const colon = inner.indexOf(':');
        if (colon === -1) {
            // {timestamp} has no colon
            if (inner.trim().toLowerCase() === 'timestamp') embed.setTimestamp();
            continue;
        }
        const key   = inner.slice(0, colon).trim().toLowerCase();
        const value = inner.slice(colon + 1).trim();

        switch (key) {
            case 'message':
                content = value || null;
                break;

            case 'color':
                try { embed.setColor(value.startsWith('#') ? value : `#${value}`); } catch {}
                break;

            case 'thumbnail':
                if (value.startsWith('http')) embed.setThumbnail(value);
                break;

            case 'image':
                if (value.startsWith('http')) embed.setImage(value);
                break;

            case 'title':
                embed.setTitle(value.slice(0, 256));
                break;

            case 'description':
                embed.setDescription(value.slice(0, 4096));
                break;

            case 'url':
                if (value.startsWith('http')) embed.setURL(value);
                break;

            case 'timestamp':
                embed.setTimestamp();
                break;

            case 'footer': {
                // {footer: text}  OR  {footer: text && iconUrl}
                const sep     = value.includes('&&') ? '&&' : '|';
                const fparts  = value.split(sep).map(s => s.trim());
                const [ftext, ficon] = fparts;
                const footerOpts = { text: (ftext || '\u200b').slice(0, 2048) };
                if (ficon?.startsWith('http')) footerOpts.iconURL = ficon;
                try { embed.setFooter(footerOpts); } catch {}
                break;
            }

            case 'author': {
                // {author: name}  OR  {author: name && iconUrl && url}
                const sep    = value.includes('&&') ? '&&' : '|';
                const aparts = value.split(sep).map(s => s.trim());
                const [aname, aicon, aurl] = aparts;
                const authorOpts = { name: (aname || 'Author').slice(0, 256) };
                if (aicon?.startsWith('http')) authorOpts.iconURL = aicon;
                if (aurl?.startsWith('http'))  authorOpts.url     = aurl;
                try { embed.setAuthor(authorOpts); } catch {}
                break;
            }

            case 'field': {
                // {field: Name && Value}  OR  {field: Name && Value && true}
                const fparts2 = value.split('&&').map(s => s.trim());
                const [fname, fvalue, finline] = fparts2;
                if (fname && fvalue) {
                    try {
                        embed.addFields({
                            name:   fname.slice(0, 256),
                            value:  fvalue.slice(0, 1024),
                            inline: finline?.toLowerCase() === 'true' || finline?.toLowerCase() === 'inline',
                        });
                    } catch {}
                }
                break;
            }

            case 'button': {
                // {button: type && label && url && enabled|disabled}
                // type: Link | Blurple | Green | Grey | Red
                const bparts = value.split('&&').map(s => s.trim());
                const [styleStr, label, burl, state] = bparts;
                const styleMap = {
                    link:      ButtonStyle.Link,
                    blurple:   ButtonStyle.Primary,
                    blue:      ButtonStyle.Primary,
                    primary:   ButtonStyle.Primary,
                    green:     ButtonStyle.Success,
                    success:   ButtonStyle.Success,
                    grey:      ButtonStyle.Secondary,
                    gray:      ButtonStyle.Secondary,
                    secondary: ButtonStyle.Secondary,
                    red:       ButtonStyle.Danger,
                    danger:    ButtonStyle.Danger,
                };
                const bstyle = styleMap[styleStr?.toLowerCase()] ?? ButtonStyle.Link;
                const disabled = state?.toLowerCase() === 'disabled';

                if (label) {
                    const btn = new ButtonBuilder().setStyle(bstyle).setLabel(label.slice(0, 80));
                    if (bstyle === ButtonStyle.Link) {
                        if (burl?.startsWith('http')) {
                            btn.setURL(burl);
                            if (disabled) btn.setDisabled(true);
                            buttons.push(btn);
                        }
                    } else {
                        // Non-link buttons need a customId — use a hash of label
                        btn.setCustomId(`ce_btn_${label.slice(0, 20).replace(/\W/g, '_')}_${Math.random().toString(36).slice(2, 7)}`);
                        if (disabled) btn.setDisabled(true);
                        buttons.push(btn);
                    }
                }
                break;
            }
        }
    }

    // Pack buttons into rows (max 5 per row, max 5 rows)
    for (let i = 0; i < buttons.length && i < 25; i += 5) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }

    return { content, embed, components };
}

// ══════════════════════════════════════════════════════════
//  BUILD VARS — all supported template variables
// ══════════════════════════════════════════════════════════

function buildVars(member, extra = {}) {
    const user      = member.user ?? member;
    const guild     = member.guild ?? null;
    const memberObj = guild ? member : null;

    // ── Join position ──────────────────────────────────────
    let joinPos = '?';
    try {
        if (guild) {
            const sorted = guild.members.cache
                .filter(m => m.joinedTimestamp)
                .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
            const idx = sorted.findIndex(m => m.id === user.id);
            if (idx !== -1) joinPos = String(idx + 1);
        }
    } catch {}

    // ── Top role & color ───────────────────────────────────
    const topRoleObj = memberObj?.roles.cache
        .filter(r => r.id !== guild?.id)
        .sort((a, b) => b.position - a.position)
        .first() ?? null;

    const topRole  = topRoleObj ? `<@&${topRoleObj.id}>` : 'N/A';
    const topRoleName = topRoleObj?.name ?? 'N/A';
    const userColor = topRoleObj?.hexColor ?? '#000000';

    // ── Role lists ─────────────────────────────────────────
    const sortedRoles = memberObj?.roles.cache
        .filter(r => r.id !== guild?.id)
        .sort((a, b) => b.position - a.position) ?? { map: () => [] };

    const roleList     = [...(sortedRoles.values?.() ?? [])].map(r => `<@&${r.id}>`).join(', ') || 'N/A';
    const roleTextList = [...(sortedRoles.values?.() ?? [])].map(r => r.name).join(', ')          || 'N/A';

    // ── Date / time ────────────────────────────────────────
    const now  = new Date();
    const pad  = n => String(n).padStart(2, '0');

    // UTC
    const utcD = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const utcT24 = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    const utcT12 = now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const utcProper = now.toUTCString();
    const utcShort  = `${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${now.getUTCFullYear()}`;
    const utcShorter = `${now.getUTCMonth() + 1}/${now.getUTCDate()}/${now.getUTCFullYear()}`;

    // PST
    const pstD  = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    const pstT12 = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const pstT24 = now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const pstProper = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const pstShort  = pstD;
    const pstShorter = (() => {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', year: 'numeric' }).formatToParts(now);
        const mp = Object.fromEntries(p.map(x => [x.type, x.value]));
        return `${mp.month}/${mp.day}/${mp.year}`;
    })();

    const unixNow = Math.floor(now.getTime() / 1000).toString();

    // ── Guild channels breakdown ───────────────────────────
    const textChCount  = guild?.channels.cache.filter(c => c.type === ChannelType.GuildText).size  ?? 0;
    const voiceChCount = guild?.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size ?? 0;
    const catChCount   = guild?.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size ?? 0;

    const vars = {
        // ── User ────────────────────────────────────────────
        '{user}':                     user.discriminator && user.discriminator !== '0'
                                        ? `${user.username}#${user.discriminator}`
                                        : user.username,
        '{user.id}':                  user.id,
        '{user.mention}':             `<@${user.id}>`,
        '{user.name}':                user.username,
        '{user.username}':            user.username,
        '{user.tag}':                 user.discriminator && user.discriminator !== '0'
                                        ? user.discriminator : '0',
        '{user.display_name}':        memberObj?.displayName ?? user.displayName ?? user.username,
        '{user.avatar}':              user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
        '{user.guild_avatar}':        memberObj?.avatarURL?.({ size: 256, extension: 'png' })
                                        ?? user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
        '{user.display_avatar}':      memberObj?.displayAvatarURL?.({ size: 256, extension: 'png' })
                                        ?? user.displayAvatarURL?.({ size: 256, extension: 'png' }) ?? '',
        '{user.join_position}':       joinPos,
        '{user.join_position_suffix}':ordinal(parseInt(joinPos) || 0),
        '{user.boost}':               memberObj?.premiumSince ? 'Yes' : 'No',
        '{user.boost_since}':         memberObj?.premiumSince
                                        ? `<t:${Math.floor(memberObj.premiumSinceTimestamp / 1000)}:D>` : 'N/A',
        '{user.boost_since_timestamp}':memberObj?.premiumSinceTimestamp
                                        ? Math.floor(memberObj.premiumSinceTimestamp / 1000).toString() : 'N/A',
        '{user.color}':               userColor,
        '{user.top_role}':            topRole,
        '{user.role_list}':           roleList,
        '{user.role_text_list}':      roleTextList,
        '{user.bot}':                 user.bot ? 'Yes' : 'No',
        '{user.badges}':              'N/A',
        '{user.badges_icons}':        'N/A',
        '{user.created_at}':          `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,
        '{user.created_at_timestamp}':Math.floor(user.createdTimestamp / 1000).toString(),
        '{user.joined_at}':           memberObj?.joinedTimestamp
                                        ? `<t:${Math.floor(memberObj.joinedTimestamp / 1000)}:D>` : 'N/A',
        '{user.joined_at_timestamp}': memberObj?.joinedTimestamp
                                        ? Math.floor(memberObj.joinedTimestamp / 1000).toString() : 'N/A',

        // ── Guild ───────────────────────────────────────────
        '{guild.name}':                  guild?.name ?? '',
        '{guild.id}':                    guild?.id ?? '',
        '{guild.count}':                 (guild?.memberCount ?? 0).toString(),
        '{guild.members}':               (guild?.memberCount ?? 0).toString(),
        '{guild.shard}':                 (guild?.shardId ?? 0).toString(),
        '{guild.owner_id}':              guild?.ownerId ?? 'N/A',
        '{guild.created_at}':            guild ? `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` : 'N/A',
        '{guild.created_at_timestamp}':  guild ? Math.floor(guild.createdTimestamp / 1000).toString() : 'N/A',
        '{guild.emoji_count}':           (guild?.emojis.cache.size ?? 0).toString(),
        '{guild.role_count}':            (guild?.roles.cache.size ?? 0).toString(),
        '{guild.roles_count}':           (guild?.roles.cache.size ?? 0).toString(),
        '{guild.boost_count}':           (guild?.premiumSubscriptionCount ?? 0).toString(),
        '{guild.boost_tier}':            guild?.premiumTier ? `Level ${guild.premiumTier}` : 'No Level',
        '{guild.preferred_locale}':      guild?.preferredLocale ?? 'en-US',
        '{guild.key_features}':          guild?.features?.length ? guild.features.join(', ') : 'N/A',
        '{guild.icon}':                  guild?.iconURL({ size: 256, extension: 'png' }) ?? 'N/A',
        '{guild.banner}':                guild?.bannerURL({ size: 1024 }) ?? 'N/A',
        '{guild.splash}':                guild?.splashURL({ size: 1024 }) ?? 'N/A',
        '{guild.discovery}':             guild?.discoverySplashURL?.({ size: 1024 }) ?? 'N/A',
        '{guild.vanity}':                guild?.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : 'None',
        '{guild.max_presences}':         (guild?.maximumPresences ?? 0).toString(),
        '{guild.max_members}':           (guild?.maximumMembers ?? 0).toString(),
        '{guild.max_video_channel_users}':(guild?.maxVideoChannelUsers ?? 0).toString(),
        '{guild.afk_timeout}':           (guild?.afkTimeout ?? 0).toString(),
        '{guild.afk_channel}':           guild?.afkChannelId ? `<#${guild.afkChannelId}>` : 'N/A',
        '{guild.channels_count}':        (guild?.channels.cache.size ?? 0).toString(),
        '{guild.text_channels_count}':   textChCount.toString(),
        '{guild.voice_channels_count}':  voiceChCount.toString(),
        '{guild.category_channels_count}':catChCount.toString(),
        '{guild.region}':                'N/A', // deprecated in Discord API v9+

        // ── Channel (filled by callers who pass channel in extra) ──
        '{channel.name}':          'N/A',
        '{channel.id}':            'N/A',
        '{channel.mention}':       'N/A',
        '{channel.topic}':         'N/A',
        '{channel.type}':          'N/A',
        '{channel.category_id}':   'N/A',
        '{channel.category_name}': 'N/A',
        '{channel.position}':      'N/A',
        '{channel.slowmode_delay}':'0',

        // ── Date / time ─────────────────────────────────────
        '{date.now}':                 pstD,
        '{date.now_proper}':          pstProper,
        '{date.now_short}':           pstShort,
        '{date.now_shorter}':         pstShorter,
        '{date.utc_now}':             `${utcD} ${utcT24} UTC`,
        '{date.utc_now_proper}':      utcProper,
        '{date.utc_now_short}':       utcD,
        '{date.utc_now_shorter}':     utcShorter,
        '{date.utc_timestamp}':       unixNow,

        '{time.now}':                 pstT12,
        '{time.now_military}':        pstT24,
        '{time.utc_now}':             utcT12,
        '{time.utc_now_military}':    utcT24,

        // ── Level ────────────────────────────────────────────
        '{level}':          '0',
        '{level.new_rank}': '0',
        '{level.user_xp}':  '0',

        // ── Boost ────────────────────────────────────────────
        '{boost.count}': memberObj?.premiumSince ? '1' : '0',

        // ── Caller overrides always win ──────────────────────
        ...extra,
    };

    return vars;
}

// ══════════════════════════════════════════════════════════
//  BUILD CHANNEL VARS  (for use when channel context is known)
// ══════════════════════════════════════════════════════════

function buildChannelVars(channel) {
    if (!channel) return {};
    const catName = channel.parent?.name ?? 'N/A';
    return {
        '{channel.name}':           channel.name,
        '{channel.id}':             channel.id,
        '{channel.mention}':        `<#${channel.id}>`,
        '{channel.topic}':          channel.topic || 'N/A',
        '{channel.type}':           channel.type === ChannelType.GuildText ? 'text'
                                    : channel.type === ChannelType.GuildNews ? 'news'
                                    : channel.type === ChannelType.GuildVoice ? 'voice' : 'unknown',
        '{channel.category_id}':    channel.parentId ?? 'N/A',
        '{channel.category_name}':  catName,
        '{channel.position}':       channel.position?.toString() ?? 'N/A',
        '{channel.slowmode_delay}': (channel.rateLimitPerUser ?? 0).toString(),
    };
}

// ══════════════════════════════════════════════════════════
//  SEND SYSTEM MESSAGE
// ══════════════════════════════════════════════════════════

/** Send a system message to a channel using a template. */
async function sendSystemMessage(channel, template, vars) {
    if (!channel || !template) return;
    try {
        const { content, embed, components } = parseEmbedCode(template, vars);
        const payload = {};
        if (content)              payload.content    = content;
        if (embed)                payload.embeds     = [embed];
        if (components?.length)  payload.components = components;
        if (!payload.content && !payload.embeds) return;
        await channel.send(payload);
    } catch {}
}

// ══════════════════════════════════════════════════════════
//  EVENT TRIGGERS
// ══════════════════════════════════════════════════════════

async function triggerWelcome(member) {
    const db  = getGuildDb(member.guild.id);
    const cfg = db.get('welcomeConfig', {});
    if (!cfg.enabled || !cfg.channelId) return;
    const ch  = member.guild.channels.cache.get(cfg.channelId);
    if (!ch) return;
    const template = cfg.message
        || '👋 Welcome to **{guild.name}**, {user.mention}! You are member **#{guild.count}**.';
    await sendSystemMessage(ch, template,
        { ...buildVars(member), ...buildChannelVars(ch) });
}

async function triggerGoodbye(member) {
    const db  = getGuildDb(member.guild.id);
    const cfg = db.get('goodbyeConfig', {});
    if (!cfg.enabled || !cfg.channelId) return;
    const ch  = member.guild.channels.cache.get(cfg.channelId);
    if (!ch) return;
    const template = cfg.message
        || '👋 **{user.name}** left the server. We now have **{guild.count}** members.';
    await sendSystemMessage(ch, template,
        { ...buildVars(member), ...buildChannelVars(ch) });
}

async function triggerBoost(member) {
    const db  = getGuildDb(member.guild.id);
    const cfg = db.get('boostConfig', {});
    if (!cfg.enabled || !cfg.channelId) return;
    const ch  = member.guild.channels.cache.get(cfg.channelId);
    if (!ch) return;
    const template = cfg.message
        || '🚀 {user.mention} just boosted **{guild.name}**! Thank you! 💜\n`{guild.boost_count}` boosts · {guild.boost_tier}';
    await sendSystemMessage(ch, template,
        { ...buildVars(member), ...buildChannelVars(ch) });
}

async function triggerLevelUp(message, level) {
    const db      = getGuildDb(message.guild.id);
    const levelCfg = db.get('levelMsgConfig', {});
    const cfg      = db.get('levelsConfig', {});

    const enabled  = levelCfg.enabled !== false;
    if (!enabled) return;

    const mode     = levelCfg.mode || cfg.messageMode || 'channel';
    const template = levelCfg.message || cfg.levelMessage
        || '🎉 {user.mention} reached level **{level.new_rank}**!';

    // Get user XP
    let userXp = 0;
    try {
        const { getUserDb } = require('./database');
        const udb = getUserDb(message.guild.id, message.author.id);
        userXp = udb.data.xp || 0;
    } catch {}

    const vars = {
        ...buildVars(message.member),
        ...buildChannelVars(message.channel),
        '{level}':          level.toString(),
        '{level.new_rank}': level.toString(),
        '{level.user_xp}':  userXp.toString(),
    };

    const { content, embed, components } = parseEmbedCode(template, vars);
    const payload = {};
    if (content)              payload.content    = content;
    if (embed)                payload.embeds     = [embed];
    if (components?.length)  payload.components = components;
    if (!payload.content && !payload.embeds) return;

    try {
        if (mode === 'dm') {
            await message.author.send(payload).catch(() => {});
        } else if (mode === 'custom' && (levelCfg.channelId || cfg.levelChannel)) {
            const ch = message.guild.channels.cache.get(levelCfg.channelId || cfg.levelChannel);
            if (ch) await ch.send(payload).catch(() => {});
        } else {
            await message.channel.send(payload).catch(() => {});
        }
    } catch {}
}

// ══════════════════════════════════════════════════════════
//  COMMAND HANDLER  — shared logic for all 4 systems
// ══════════════════════════════════════════════════════════

const SYSTEM_KEYS = {
    welcome:    'welcomeConfig',
    goodbye:    'goodbyeConfig',
    boosts:     'boostConfig',
    levelupmsg: 'levelMsgConfig',
};

const SYSTEM_LABELS = {
    welcome:    'Welcome',
    goodbye:    'Goodbye',
    boosts:     'Boost',
    levelupmsg: 'Level-Up',
};

async function handleSystemCommand(message, system, args) {
    const { isAdmin }             = require('./helpers');
    const { greedOk, greedWarn, base, COLORS } = require('../utils/embeds');

    if (!isAdmin(message.member))
        return message.reply(greedWarn(message.member, 'Only admins can configure this system.'));

    const db    = getGuildDb(message.guild.id);
    const key   = SYSTEM_KEYS[system];
    const label = SYSTEM_LABELS[system];
    const cfg   = db.get(key, {});
    const sub   = args[0]?.toLowerCase();

    if (sub === 'enable') {
        cfg.enabled = true; db.set(key, cfg);
        return message.reply(greedOk(message.member, `**${label}** messages enabled.`));
    }
    if (sub === 'disable') {
        cfg.enabled = false; db.set(key, cfg);
        return message.reply(greedOk(message.member, `**${label}** messages disabled.`));
    }
    if (sub === 'channel') {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply(greedWarn(message.member, `Mention a channel: \`,${system} channel #channel\``));
        cfg.channelId = ch.id; db.set(key, cfg);
        return message.reply(greedOk(message.member, `**${label}** channel set to <#${ch.id}>.`));
    }
    if (sub === 'message') {
        const msg = args.slice(1).join(' ');
        if (!msg) {
            const varList = [
                '`{user.mention}` `{user.name}` `{user.display_name}` `{user.id}` `{user.avatar}`',
                '`{user.join_position}` `{user.join_position_suffix}` `{user.top_role}` `{user.color}`',
                '`{user.boost}` `{user.boost_since}` `{user.created_at}` `{user.joined_at}`',
                '`{guild.name}` `{guild.count}` `{guild.id}` `{guild.vanity}` `{guild.boost_count}` `{guild.boost_tier}`',
                '`{guild.icon}` `{guild.banner}` `{guild.emoji_count}` `{guild.role_count}` `{guild.owner_id}`',
                '`{guild.channels_count}` `{guild.text_channels_count}` `{guild.voice_channels_count}`',
                '`{channel.name}` `{channel.mention}` `{channel.topic}` `{channel.position}`',
                '`{date.now}` `{date.utc_now}` `{date.utc_timestamp}` `{time.now}` `{time.now_military}`',
                '`{boost.count}` (for boosts) `{level.new_rank}` `{level.user_xp}` (for levelup)',
            ];
            return message.reply([
                greedWarn(message.member, `Usage: \`,${system} message <text or embed code>\``),
                '',
                '**Plain text:** `,welcome message Welcome {user.mention}!`',
                '**Embed:** `,welcome message {embed}$v{title: Welcome!}$v{description: Hi {user.mention}}$v{color: 5865F2}$v{thumbnail: {user.avatar}}`',
                '',
                '**Variables:**',
                ...varList,
            ].join('\n'));
        }
        cfg.message = msg; db.set(key, cfg);
        return message.reply(greedOk(message.member, `**${label}** message updated.`));
    }
    if (sub === 'preview' || sub === 'test') {
        if (!cfg.message) return message.reply(greedWarn(message.member, `No message set. Use \`,${system} message <text>\``));
        const vars = {
            ...buildVars(message.member),
            ...buildChannelVars(message.channel),
            '{level}': '5', '{level.new_rank}': '5', '{level.user_xp}': '1250',
            '{boost.count}': '3',
        };
        const { content, embed, components } = parseEmbedCode(cfg.message, vars);
        const payload = { content: `**Preview of ${label} message:**\n${content || ''}`.trim() };
        if (embed)              payload.embeds     = [embed];
        if (components?.length) payload.components = components;
        return message.channel.send(payload);
    }
    if (sub === 'reset') {
        db.set(key, {}); return message.reply(greedOk(message.member, `**${label}** config reset.`));
    }
    if (!sub || sub === 'view' || sub === 'config') {
        return message.channel.send({ embeds: [base(COLORS.primary)
            .setTitle(`⚙️ ${label} System Config`)
            .addFields(
                { name: 'Status',   value: cfg.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Channel',  value: cfg.channelId ? `<#${cfg.channelId}>` : 'Not set', inline: true },
                { name: 'Message',  value: cfg.message ? `\`\`\`\n${cfg.message.slice(0, 500)}\n\`\`\`` : '*(default)*' },
            )] });
    }

    return message.reply(
        `**${label} Commands:**\n` +
        `\`,${system} enable/disable\`\n` +
        `\`,${system} channel #channel\`\n` +
        `\`,${system} message <text or embed code>\`\n` +
        `\`,${system} preview\` / \`,${system} test\`\n` +
        `\`,${system} view\` — view config\n` +
        `\`,${system} reset\` — reset config`
    );
}

module.exports = {
    triggerWelcome,
    triggerGoodbye,
    triggerBoost,
    triggerLevelUp,
    handleSystemCommand,
    parseEmbedCode,
    buildVars,
    buildChannelVars,
};
