/**
 * giveaways.js — Full giveaway system
 * Commands: .giveaways start/end/reroll/cancel/list/edit
 */
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { getGuildDb, getUserDb } = require('./database');
const { COLORS, base, ok, err } = require('../utils/embeds');
const { isStaffOrAdmin }        = require('./helpers');

// ── Parse duration string → ms ──
function parseDuration(str) {
    if (!str) return null;
    const map = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    const match = str.match(/^(\d+)([smhdw])$/i);
    if (!match) return null;
    return parseInt(match[1]) * (map[match[2].toLowerCase()] || 0);
}

// ── Format ms into human-readable ──
function formatDuration(ms) {
    if (!ms) return null;
    const s = Math.floor(ms / 1000);
    if (s < 60)   return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)   return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)   return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7)    return `${d}d`;
    return `${Math.floor(d / 7)}w`;
}

// ── Parse a Discord message link ──
function parseMessageLink(link) {
    const match = link.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// ── Get all giveaways for a guild ──
function getGiveaways(guildId) {
    return getGuildDb(guildId).get('giveaways', {});
}

// ── Save giveaways for a guild ──
function saveGiveaways(guildId, data) {
    getGuildDb(guildId).set('giveaways', data);
}

// ── Build the giveaway embed ──
function buildGiveawayEmbed(gw, messageId) {
    const color = gw.color || '#FF6B6B';
    const endUnix = Math.floor(gw.endAt / 1000);

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎉 ${gw.prize}`)
        .setFooter({ text: `ID: ${messageId}` })
        .setTimestamp(gw.endAt);

    const lines = [];
    if (gw.description) lines.push(`${gw.description}\n`);
    lines.push(`⏰ **Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)`);
    lines.push(`🏆 **Winners:** ${gw.winnersCount}`);
    lines.push(`🎟️ **Entries:** ${gw.entries.length}`);
    lines.push(`👤 **Hosted by:** <@${gw.hostId}>`);

    if (gw.requiredRoles && gw.requiredRoles.length > 0) {
        lines.push(`\n🔒 **Required Roles:** ${gw.requiredRoles.map(r => `<@&${r}>`).join(', ')}`);
    }
    if (gw.minLevel != null) lines.push(`📊 **Min Level:** ${gw.minLevel}`);
    if (gw.maxLevel != null) lines.push(`📊 **Max Level:** ${gw.maxLevel}`);
    if (gw.minAge   != null) lines.push(`📅 **Min Account Age:** ${gw.minAge} day(s)`);
    if (gw.minStay  != null) lines.push(`📅 **Min Server Stay:** ${gw.minStay} day(s)`);
    if (gw.requiredMessages != null) {
        const chanText = gw.gwMsgChannelId ? ` in <#${gw.gwMsgChannelId}>` : ' (any channel)';
        lines.push(`💬 **Required Messages:** ${gw.requiredMessages}${chanText}`);
    }
    if (gw.requiredVoiceSecs != null) {
        lines.push(`🎙️ **Required Voice Time:** ${formatDuration(gw.requiredVoiceSecs * 1000)}`);
    }

    embed.setDescription(lines.join('\n'));

    if (gw.imageUrl)     embed.setImage(gw.imageUrl);
    if (gw.thumbnailUrl) embed.setThumbnail(gw.thumbnailUrl);

    return embed;
}

// ── Build ended giveaway embed ──
function buildEndedEmbed(gw, messageId, winners) {
    const color = gw.color || '#FF6B6B';
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🎉 ${gw.prize} (ENDED)`)
        .setFooter({ text: `ID: ${messageId}` })
        .setTimestamp();

    const lines = [];
    if (gw.description) lines.push(`${gw.description}\n`);

    if (winners && winners.length > 0) {
        lines.push(`🏆 **Winners:** ${winners.map(w => `<@${w}>`).join(', ')}`);
    } else {
        lines.push(`🏆 **Winners:** No valid entries`);
    }
    lines.push(`🎟️ **Total Entries:** ${gw.entries.length}`);
    lines.push(`👤 **Hosted by:** <@${gw.hostId}>`);

    embed.setDescription(lines.join('\n'));
    if (gw.imageUrl)     embed.setImage(gw.imageUrl);
    if (gw.thumbnailUrl) embed.setThumbnail(gw.thumbnailUrl);
    return embed;
}

// ── Pick random winners ──
function pickWinners(entries, count, client) {
    const pool = [...new Set(entries)].filter(id => {
        const user = client.users.cache.get(id);
        return !user || !user.bot;
    });
    const winners = [];
    const available = [...pool];
    while (winners.length < count && available.length > 0) {
        const idx = Math.floor(Math.random() * available.length);
        winners.push(available.splice(idx, 1)[0]);
    }
    return winners;
}

// ── In-memory timers ──
const activeTimers = new Map(); // messageId → timeout

// ── Schedule end of giveaway ──
function scheduleGiveaway(client, guildId, messageId, endAt) {
    if (activeTimers.has(messageId)) {
        clearTimeout(activeTimers.get(messageId));
    }
    const delay = endAt - Date.now();
    if (delay <= 0) {
        endGiveaway(client, guildId, messageId).catch(() => {});
        return;
    }
    const timer = setTimeout(() => {
        endGiveaway(client, guildId, messageId).catch(() => {});
    }, delay);
    activeTimers.set(messageId, timer);
}

// ── End a giveaway (timer or forced) ──
async function endGiveaway(client, guildId, messageId) {
    const giveaways = getGiveaways(guildId);
    const gw = giveaways[messageId];
    if (!gw || gw.ended) return;

    const winners = pickWinners(gw.entries, gw.winnersCount, client);
    gw.ended   = true;
    gw.winners = winners;
    saveGiveaways(guildId, giveaways);

    if (activeTimers.has(messageId)) {
        clearTimeout(activeTimers.get(messageId));
        activeTimers.delete(messageId);
    }

    try {
        const channel = await client.channels.fetch(gw.channelId).catch(() => null);
        if (!channel) return;
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const embed = buildEndedEmbed(gw, messageId, winners);
        // Disable the enter button
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway_enter_${messageId}`)
                .setLabel('Giveaway Ended')
                .setEmoji('🎉')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
        await message.edit({ embeds: [embed], components: [disabledRow] }).catch(() => {});

        if (winners.length > 0) {
            await channel.send({
                content: `🎉 Congratulations ${winners.map(w => `<@${w}>`).join(', ')}! You won **${gw.prize}**!\n> Giveaway: ${message.url}`,
            }).catch(() => {});
        } else {
            await channel.send({
                content: `😔 No valid entries for the **${gw.prize}** giveaway. No winners selected.`,
            }).catch(() => {});
        }
    } catch (e) {
        // Silent fail
    }
}

// ──────────────────────────────────────────────────────────────
//  COMMAND HANDLERS
// ──────────────────────────────────────────────────────────────

// .giveaways start <#channel> <duration> <winners> <prize...>
async function cmdStart(message, args) {
    if (!isStaffOrAdmin(message.member))
        return message.reply(err('You need Staff or Admin to start giveaways.'));

    if (args.length < 4)
        return message.reply(err('Usage: `giveaways start <#channel> <duration> <winners> <prize...>`'));

    const channelMention = args[0];
    const durationStr    = args[1];
    const winnersStr     = args[2];
    const prize          = args.slice(3).join(' ');

    // Resolve channel
    const channelId = channelMention.replace(/[<#>]/g, '');
    const channel   = message.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased())
        return message.reply(err('Invalid channel. Mention a text channel.'));

    // Parse duration
    const durationMs = parseDuration(durationStr);
    if (!durationMs)
        return message.reply(err('Invalid duration. Use formats like `1m`, `2h`, `3d`, `1w`.'));

    // Parse winners
    const winnersCount = parseInt(winnersStr);
    if (isNaN(winnersCount) || winnersCount < 1)
        return message.reply(err('Winners must be a positive number.'));

    if (!prize.trim())
        return message.reply(err('Please provide a prize name.'));

    const endAt = Date.now() + durationMs;
    const hostId = message.author.id;

    // Send placeholder embed first so we get the message ID
    const enterButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_enter_PLACEHOLDER')
            .setLabel('Enter Giveaway')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Primary)
    );

    const tempEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle(`🎉 ${prize}`)
        .setDescription('Starting...');

    const giveawayMsg = await channel.send({ embeds: [tempEmbed], components: [enterButton] });
    const messageId   = giveawayMsg.id;

    // ── Parse optional flags from the prize string ──
    // e.g. "10$ ROBUX --host @user --description text --required_messages 200 #channel --required_voice 1h"
    let hostId2 = hostId;
    let description2 = null;
    let requiredMessages = null;
    let gwMsgChannelId = null;
    let requiredVoiceSecs = null;

    // Split prize on ' --'
    const prizeParts = prize.split(/\s+--/);
    const cleanPrize = prizeParts[0].trim();
    for (let i = 1; i < prizeParts.length; i++) {
        const flag = prizeParts[i].trim();
        const spaceIdx = flag.indexOf(' ');
        const flagName = (spaceIdx === -1 ? flag : flag.slice(0, spaceIdx)).toLowerCase().replace(/-/g, '_');
        const flagVal  = spaceIdx === -1 ? '' : flag.slice(spaceIdx + 1).trim();

        if (flagName === 'host') {
            const uid = flagVal.replace(/[<@!>,\s]/g, '');
            if (uid) hostId2 = uid;
        } else if (flagName === 'description') {
            description2 = flagVal || null;
        } else if (flagName === 'required_messages') {
            const parts = flagVal.split(/\s+/);
            const num = parseInt(parts[0]);
            if (!isNaN(num) && num > 0) {
                requiredMessages = num;
                // optional channel mention
                const chanMatch = parts[1]?.match(/^<#(\d+)>$|^(\d+)$/);
                if (chanMatch) gwMsgChannelId = chanMatch[1] || chanMatch[2];
            }
        } else if (flagName === 'required_voice') {
            const ms = parseDuration(flagVal);
            if (ms) requiredVoiceSecs = Math.floor(ms / 1000);
        }
    }

    // Build giveaway data
    const gwData = {
        channelId:        channel.id,
        prize:            cleanPrize,
        winnersCount,
        hostId:           hostId2,
        startAt:          Date.now(),
        endAt,
        entries:          [],
        ended:            false,
        winners:          [],
        description:      description2,
        color:            '#FF6B6B',
        imageUrl:         null,
        thumbnailUrl:     null,
        requiredRoles:    [],
        minLevel:         null,
        maxLevel:         null,
        minAge:           null,
        minStay:          null,
        requiredMessages,
        gwMsgChannelId,
        requiredVoiceSecs,
        gwMsgCounts:      {},
        gwVoiceSecs:      {},
    };

    // Save
    const giveaways = getGiveaways(message.guild.id);
    giveaways[messageId] = gwData;
    saveGiveaways(message.guild.id, giveaways);

    // Update the message with real button ID and embed
    const realButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`giveaway_enter_${messageId}`)
            .setLabel('Enter Giveaway')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Primary)
    );
    const realEmbed = buildGiveawayEmbed(gwData, messageId);
    await giveawayMsg.edit({ embeds: [realEmbed], components: [realButton] });

    scheduleGiveaway(message.client, message.guild.id, messageId, endAt);

    return message.reply({
        embeds: [base(COLORS.success)
            .setTitle('🎉 Giveaway Started!')
            .setDescription(`Giveaway for **${prize}** started in ${channel}!\nEnds <t:${Math.floor(endAt / 1000)}:R>\n[Jump to Giveaway](${giveawayMsg.url})`)
        ]
    });
}

// .giveaways end <message link>
async function cmdEnd(message, args) {
    if (!isStaffOrAdmin(message.member))
        return message.reply(err('You need Staff or Admin to end giveaways.'));

    if (!args[0]) return message.reply(err('Provide a message link.'));
    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));

    const { guildId, messageId } = parsed;
    if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

    const giveaways = getGiveaways(guildId);
    const gw = giveaways[messageId];
    if (!gw) return message.reply(err('Giveaway not found.'));
    if (gw.ended) return message.reply(err('This giveaway has already ended.'));

    await message.reply({ embeds: [base(COLORS.info).setTitle('⏳ Ending giveaway...').setDescription('Please wait.')] });
    await endGiveaway(message.client, guildId, messageId);
    return message.channel.send({ embeds: [base(COLORS.success).setTitle('✅ Giveaway Ended').setDescription(`The giveaway for **${gw.prize}** has been ended.`)] });
}

// .giveaways reroll <message link> [count]
async function cmdReroll(message, args) {
    if (!isStaffOrAdmin(message.member))
        return message.reply(err('You need Staff or Admin to reroll giveaways.'));

    if (!args[0]) return message.reply(err('Provide a message link.'));
    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));

    const { guildId, messageId } = parsed;
    if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

    const giveaways = getGiveaways(guildId);
    const gw = giveaways[messageId];
    if (!gw) return message.reply(err('Giveaway not found.'));
    if (!gw.ended) return message.reply(err('This giveaway has not ended yet. Use `giveaways end` first.'));

    const count = args[1] ? parseInt(args[1]) : gw.winnersCount;
    if (isNaN(count) || count < 1) return message.reply(err('Invalid winner count.'));

    const newWinners = pickWinners(gw.entries, count, message.client);
    gw.winners = newWinners;
    saveGiveaways(guildId, giveaways);

    try {
        const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (msg) {
                const embed = buildEndedEmbed(gw, messageId, newWinners);
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`giveaway_enter_${messageId}`)
                        .setLabel('Giveaway Ended')
                        .setEmoji('🎉')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                await msg.edit({ embeds: [embed], components: [disabledRow] }).catch(() => {});
            }
        }
    } catch (e) {}

    if (newWinners.length > 0) {
        return message.reply({
            content: `🎉 Reroll complete! New winners: ${newWinners.map(w => `<@${w}>`).join(', ')} for **${gw.prize}**!`,
        });
    } else {
        return message.reply({ content: `😔 No valid entries to reroll for **${gw.prize}**.` });
    }
}

// .giveaways cancel <message link>
async function cmdCancel(message, args) {
    if (!isStaffOrAdmin(message.member))
        return message.reply(err('You need Staff or Admin to cancel giveaways.'));

    if (!args[0]) return message.reply(err('Provide a message link.'));
    const parsed = parseMessageLink(args[0]);
    if (!parsed) return message.reply(err('Invalid message link.'));

    const { guildId, messageId } = parsed;
    if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

    const giveaways = getGiveaways(guildId);
    const gw = giveaways[messageId];
    if (!gw) return message.reply(err('Giveaway not found.'));
    if (gw.ended) return message.reply(err('This giveaway has already ended.'));

    gw.ended   = true;
    gw.winners = [];
    gw.cancelled = true;
    saveGiveaways(guildId, giveaways);

    if (activeTimers.has(messageId)) {
        clearTimeout(activeTimers.get(messageId));
        activeTimers.delete(messageId);
    }

    try {
        const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (msg) {
                const cancelEmbed = new EmbedBuilder()
                    .setColor('#808080')
                    .setTitle(`🚫 ${gw.prize} (CANCELLED)`)
                    .setDescription(`This giveaway was cancelled by <@${message.author.id}>.`)
                    .setTimestamp();
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`giveaway_enter_${messageId}`)
                        .setLabel('Cancelled')
                        .setEmoji('🚫')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true)
                );
                await msg.edit({ embeds: [cancelEmbed], components: [disabledRow] }).catch(() => {});
            }
        }
    } catch (e) {}

    return message.reply({
        embeds: [base(COLORS.success).setTitle('✅ Giveaway Cancelled').setDescription(`The giveaway for **${gw.prize}** has been cancelled.`)]
    });
}

// .giveaways list
async function cmdList(message) {
    const giveaways = getGiveaways(message.guild.id);
    const active = Object.entries(giveaways).filter(([, gw]) => !gw.ended);

    if (active.length === 0)
        return message.reply({ embeds: [base(COLORS.info).setTitle('🎉 Active Giveaways').setDescription('No active giveaways in this server.')] });

    const lines = active.map(([msgId, gw]) => {
        const endUnix = Math.floor(gw.endAt / 1000);
        const channelStr = `<#${gw.channelId}>`;
        return `• **${gw.prize}** — ${channelStr} — Ends <t:${endUnix}:R> — 🏆 ${gw.winnersCount} winner(s) — 🎟️ ${gw.entries.length} entries\n  [Jump](https://discord.com/channels/${message.guild.id}/${gw.channelId}/${msgId})`;
    });

    const embed = base(COLORS.primary)
        .setTitle(`🎉 Active Giveaways (${active.length})`)
        .setDescription(lines.join('\n\n'));

    return message.reply({ embeds: [embed] });
}

// ── Edit subcommand router ──
async function cmdEdit(message, args) {
    if (!isStaffOrAdmin(message.member))
        return message.reply(err('You need Staff or Admin to edit giveaways.'));

    const subSub = args[0]?.toLowerCase();
    const link   = args[1];
    const rest   = args.slice(2);

    const validSubs = ['prize','winners','duration','description','color','image','thumbnail','host','requiredroles','minlevel','maxlevel','age','stay','requiredmessages','requiredvoice'];
    if (!subSub || !validSubs.includes(subSub))
        return message.reply(err(`Valid edit options: \`${validSubs.join('`, `')}\``));

    if (!link) return message.reply(err('Provide a message link.'));
    const parsed = parseMessageLink(link);
    if (!parsed) return message.reply(err('Invalid message link.'));

    const { guildId, messageId } = parsed;
    if (guildId !== message.guild.id) return message.reply(err('That giveaway is not from this server.'));

    const giveaways = getGiveaways(guildId);
    const gw = giveaways[messageId];
    if (!gw) return message.reply(err('Giveaway not found.'));
    if (gw.ended) return message.reply(err('Cannot edit an ended giveaway.'));

    if (rest.length === 0 && !['requiredroles'].includes(subSub))
        return message.reply(err('Provide a new value.'));

    switch (subSub) {
        case 'prize':
            gw.prize = rest.join(' ');
            break;

        case 'winners': {
            const n = parseInt(rest[0]);
            if (isNaN(n) || n < 1) return message.reply(err('Provide a valid winner count.'));
            gw.winnersCount = n;
            break;
        }

        case 'duration': {
            const ms = parseDuration(rest[0]);
            if (!ms) return message.reply(err('Invalid duration. Use formats like `1h`, `2d`.'));
            gw.endAt = Date.now() + ms;
            scheduleGiveaway(message.client, guildId, messageId, gw.endAt);
            break;
        }

        case 'description':
            gw.description = rest.join(' ') || null;
            break;

        case 'color': {
            const hex = rest[0];
            if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return message.reply(err('Provide a valid hex color (e.g. `#FF6B6B`).'));
            gw.color = hex.startsWith('#') ? hex : `#${hex}`;
            break;
        }

        case 'image':
            gw.imageUrl = rest[0] || null;
            break;

        case 'thumbnail':
            gw.thumbnailUrl = rest[0] || null;
            break;

        case 'host': {
            const userId = rest[0]?.replace(/[<@!>]/g, '');
            if (!userId) return message.reply(err('Mention a user.'));
            gw.hostId = userId;
            break;
        }

        case 'requiredroles': {
            if (rest.length === 0) {
                gw.requiredRoles = [];
            } else {
                gw.requiredRoles = rest.map(r => r.replace(/[<@&>]/g, '')).filter(r => /^\d+$/.test(r));
            }
            break;
        }

        case 'minlevel': {
            const lvl = parseInt(rest[0]);
            if (isNaN(lvl) || lvl < 0) return message.reply(err('Provide a valid level.'));
            gw.minLevel = lvl;
            break;
        }

        case 'maxlevel': {
            const lvl = parseInt(rest[0]);
            if (isNaN(lvl) || lvl < 0) return message.reply(err('Provide a valid level.'));
            gw.maxLevel = lvl;
            break;
        }

        case 'age': {
            const days = parseInt(rest[0]);
            if (isNaN(days) || days < 0) return message.reply(err('Provide valid days.'));
            gw.minAge = days;
            break;
        }

        case 'stay': {
            const days = parseInt(rest[0]);
            if (isNaN(days) || days < 0) return message.reply(err('Provide valid days.'));
            gw.minStay = days;
            break;
        }

        case 'requiredmessages': {
            if (rest.length === 0) { gw.requiredMessages = null; gw.gwMsgChannelId = null; break; }
            const num = parseInt(rest[0]);
            if (isNaN(num) || num < 0) return message.reply(err('Provide a valid message count (or 0 to remove).'));
            gw.requiredMessages = num || null;
            // optional channel
            const chanMatch = rest[1]?.match(/^<#(\d+)>$|^(\d+)$/);
            gw.gwMsgChannelId = chanMatch ? (chanMatch[1] || chanMatch[2]) : null;
            if (!gw.gwMsgCounts) gw.gwMsgCounts = {};
            break;
        }

        case 'requiredvoice': {
            if (rest.length === 0 || rest[0] === '0') { gw.requiredVoiceSecs = null; break; }
            const ms = parseDuration(rest[0]);
            if (!ms) return message.reply(err('Invalid duration. Use formats like `1h`, `30m`.'));
            gw.requiredVoiceSecs = Math.floor(ms / 1000);
            if (!gw.gwVoiceSecs) gw.gwVoiceSecs = {};
            break;
        }
    }

    saveGiveaways(guildId, giveaways);

    // Update the live message
    try {
        const channel = await message.client.channels.fetch(gw.channelId).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (msg) {
                const updatedEmbed = buildGiveawayEmbed(gw, messageId);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`giveaway_enter_${messageId}`)
                        .setLabel('Enter Giveaway')
                        .setEmoji('🎉')
                        .setStyle(ButtonStyle.Primary)
                );
                await msg.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => {});
            }
        }
    } catch (e) {}

    return message.reply({
        embeds: [base(COLORS.success).setTitle('✅ Giveaway Updated').setDescription(`Successfully updated **${subSub}** for the **${gw.prize}** giveaway.`)]
    });
}

// ──────────────────────────────────────────────────────────────
//  MAIN COMMAND HANDLER
// ──────────────────────────────────────────────────────────────

async function handleGiveawayCommand(message, args) {
    const sub = args[0]?.toLowerCase();

    if (!sub) {
        return message.reply({
            embeds: [base(COLORS.info)
                .setTitle('🎉 Giveaway Commands')
                .setDescription([
                    '`,giveaways start <#channel> <duration> <winners> <prize>`',
                    '`,giveaways end <message link>`',
                    '`,giveaways reroll <message link> [count]`',
                    '`,giveaways cancel <message link>`',
                    '`,giveaways list`',
                    '`,giveaways edit <prize|winners|duration|description|color|image|thumbnail|host|requiredroles|minlevel|maxlevel|age|stay> <message link> <value>`',
                ].join('\n'))
            ]
        });
    }

    const subArgs = args.slice(1);

    switch (sub) {
        case 'start':    return cmdStart(message, subArgs);
        case 'end':      return cmdEnd(message, subArgs);
        case 'reroll':   return cmdReroll(message, subArgs);
        case 'cancel':   return cmdCancel(message, subArgs);
        case 'list':     return cmdList(message);
        case 'edit':     return cmdEdit(message, subArgs);
        default:
            return message.reply(err(`Unknown subcommand \`${sub}\`. Use \`giveaways\` to see available commands.`));
    }
}

// ──────────────────────────────────────────────────────────────
//  BUTTON HANDLER
// ──────────────────────────────────────────────────────────────

async function handleGiveawayButton(interaction) {
    const messageId = interaction.customId.replace('giveaway_enter_', '');
    const guildId   = interaction.guild.id;

    const giveaways = getGiveaways(guildId);
    const gw        = giveaways[messageId];

    if (!gw) {
        return interaction.reply({ content: '❌ This giveaway no longer exists.', ephemeral: true });
    }
    if (gw.ended) {
        return interaction.reply({ content: '❌ This giveaway has already ended.', ephemeral: true });
    }
    if (Date.now() > gw.endAt) {
        return interaction.reply({ content: '❌ This giveaway has expired.', ephemeral: true });
    }

    const userId = interaction.user.id;
    const member = interaction.member;

    // ── Requirement checks ──

    // Required roles
    if (gw.requiredRoles && gw.requiredRoles.length > 0) {
        const hasRole = gw.requiredRoles.some(r => member.roles.cache.has(r));
        if (!hasRole) {
            const roleList = gw.requiredRoles.map(r => `<@&${r}>`).join(', ');
            return interaction.reply({
                content: `❌ You need one of the required roles to enter this giveaway: ${roleList}`,
                ephemeral: true
            });
        }
    }

    // Min/max level (from XP system)
    if (gw.minLevel != null || gw.maxLevel != null) {
        const userDb = getUserDb(guildId, userId);
        const level  = userDb.data.level || 0;
        if (gw.minLevel != null && level < gw.minLevel) {
            return interaction.reply({
                content: `❌ You need to be at least level **${gw.minLevel}** to enter this giveaway. (Your level: ${level})`,
                ephemeral: true
            });
        }
        if (gw.maxLevel != null && level > gw.maxLevel) {
            return interaction.reply({
                content: `❌ You must be below level **${gw.maxLevel}** to enter this giveaway. (Your level: ${level})`,
                ephemeral: true
            });
        }
    }

    // Min account age
    if (gw.minAge != null) {
        const accountCreated = interaction.user.createdTimestamp;
        const ageMs  = Date.now() - accountCreated;
        const ageDays = ageMs / 86400000;
        if (ageDays < gw.minAge) {
            const needed = Math.ceil(gw.minAge - ageDays);
            return interaction.reply({
                content: `❌ Your account must be at least **${gw.minAge}** day(s) old to enter. (${needed} more day(s) needed)`,
                ephemeral: true
            });
        }
    }

    // Min server stay
    if (gw.minStay != null) {
        const joinedAt = member.joinedTimestamp;
        if (!joinedAt) {
            return interaction.reply({ content: '❌ Could not verify your server join date.', ephemeral: true });
        }
        const stayMs   = Date.now() - joinedAt;
        const stayDays = stayMs / 86400000;
        if (stayDays < gw.minStay) {
            const needed = Math.ceil(gw.minStay - stayDays);
            return interaction.reply({
                content: `❌ You must be in this server for at least **${gw.minStay}** day(s) to enter. (${needed} more day(s) needed)`,
                ephemeral: true
            });
        }
    }

    // Required messages
    if (gw.requiredMessages != null && gw.requiredMessages > 0) {
        const userMsgs = (gw.gwMsgCounts || {})[userId] || 0;
        if (userMsgs < gw.requiredMessages) {
            const chanText = gw.gwMsgChannelId ? ` in <#${gw.gwMsgChannelId}>` : '';
            return interaction.reply({
                content: `❌ You need to send at least **${gw.requiredMessages}** message(s)${chanText} since this giveaway started. You have sent **${userMsgs}**.`,
                ephemeral: true
            });
        }
    }

    // Required voice time
    if (gw.requiredVoiceSecs != null && gw.requiredVoiceSecs > 0) {
        const stored = (gw.gwVoiceSecs || {})[userId] || 0;
        // Also count any active (ongoing) VC session at the moment of button click
        const vcKey = `${guildId}_${userId}`;
        const activeJoin = gwVoiceJoinMap.get(vcKey);
        let activeBonus = 0;
        if (activeJoin) {
            const effectiveJoin = Math.max(activeJoin, gw.startAt || 0);
            activeBonus = Math.max(0, Math.floor((Date.now() - effectiveJoin) / 1000));
        }
        const userSecs = stored + activeBonus;
        if (userSecs < gw.requiredVoiceSecs) {
            const needed = gw.requiredVoiceSecs - userSecs;
            return interaction.reply({
                content: `❌ You need **${formatDuration(gw.requiredVoiceSecs * 1000)}** of voice time in this server since this giveaway started. You have **${formatDuration(userSecs * 1000)}** (need ${formatDuration(needed * 1000)} more).`,
                ephemeral: true
            });
        }
    }

    // Toggle entry
    const idx = gw.entries.indexOf(userId);
    if (idx === -1) {
        gw.entries.push(userId);
        saveGiveaways(guildId, giveaways);

        // Update entry count on embed
        try {
            const embed = buildGiveawayEmbed(gw, messageId);
            await interaction.message.edit({ embeds: [embed] }).catch(() => {});
        } catch (e) {}

        return interaction.reply({
            content: `🎉 You have entered the giveaway for **${gw.prize}**! Good luck! (Total entries: ${gw.entries.length})`,
            ephemeral: true
        });
    } else {
        gw.entries.splice(idx, 1);
        saveGiveaways(guildId, giveaways);

        // Update entry count on embed
        try {
            const embed = buildGiveawayEmbed(gw, messageId);
            await interaction.message.edit({ embeds: [embed] }).catch(() => {});
        } catch (e) {}

        return interaction.reply({
            content: `😢 You have left the giveaway for **${gw.prize}**. (Total entries: ${gw.entries.length})`,
            ephemeral: true
        });
    }
}

// ──────────────────────────────────────────────────────────────
//  RESTORE TIMERS ON BOT START
// ──────────────────────────────────────────────────────────────

async function restoreGiveawayTimers(client) {
    const { readdirSync, existsSync } = require('fs');
    const { join } = require('path');
    const DB_DIR = join(__dirname, '..', 'db');
    if (!existsSync(DB_DIR)) return;

    let files;
    try { files = readdirSync(DB_DIR); } catch { return; }

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const guildId  = file.replace('.json', '');
        const db       = getGuildDb(guildId);
        const giveaways = db.get('giveaways', {});

        for (const [messageId, gw] of Object.entries(giveaways)) {
            if (gw.ended) continue;

            if (Date.now() >= gw.endAt) {
                // Already expired — end it now
                endGiveaway(client, guildId, messageId).catch(() => {});
            } else {
                scheduleGiveaway(client, guildId, messageId, gw.endAt);
            }
        }

        // Seed gwVoiceJoinMap for members already in VC at startup so
        // ongoing sessions aren't lost across restarts.
        const hasActiveVoiceGiveaway = Object.values(giveaways).some(
            gw => !gw.ended && Date.now() < gw.endAt && gw.requiredVoiceSecs != null
        );
        if (hasActiveVoiceGiveaway) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                for (const channel of guild.channels.cache.values()) {
                    if (!channel.isVoiceBased || !channel.isVoiceBased()) continue;
                    for (const [memberId] of channel.members) {
                        const key = `${guildId}_${memberId}`;
                        if (!gwVoiceJoinMap.has(key)) {
                            // Use now as the baseline; effective join will be clamped
                            // to gw.startAt per-giveaway when time is accumulated.
                            gwVoiceJoinMap.set(key, Date.now());
                        }
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────
//  GIVEAWAY TRACKING — called from index.js events
// ──────────────────────────────────────────────────────────────

// In-memory: guildId_userId → joinTimestamp (for active voice sessions)
const gwVoiceJoinMap = new Map();

/**
 * Call from messageCreate to track messages for giveaways with required_messages.
 */
function trackGiveawayMessage(guildId, userId, channelId) {
    const db = getGuildDb(guildId);
    const giveaways = db.get('giveaways', {});
    let dirty = false;
    for (const gw of Object.values(giveaways)) {
        if (gw.ended || Date.now() >= gw.endAt) continue;
        if (gw.requiredMessages == null) continue;
        // Channel filter
        if (gw.gwMsgChannelId && channelId !== gw.gwMsgChannelId) continue;
        if (!gw.gwMsgCounts) gw.gwMsgCounts = {};
        gw.gwMsgCounts[userId] = (gw.gwMsgCounts[userId] || 0) + 1;
        dirty = true;
    }
    if (dirty) db.set('giveaways', giveaways);
}

/**
 * Call from voiceStateUpdate to track voice time for giveaways with required_voice.
 * @param {string} guildId
 * @param {string} userId
 * @param {'join'|'leave'} event
 */
function trackGiveawayVoice(guildId, userId, event) {
    const key = `${guildId}_${userId}`;
    if (event === 'join') {
        gwVoiceJoinMap.set(key, Date.now());
        return;
    }
    // leave / switch
    const joinTime = gwVoiceJoinMap.get(key);
    gwVoiceJoinMap.delete(key);
    if (!joinTime) return;

    const leaveTime = Date.now();

    const db = getGuildDb(guildId);
    const giveaways = db.get('giveaways', {});
    let dirty = false;
    for (const gw of Object.values(giveaways)) {
        if (gw.ended || leaveTime >= gw.endAt) continue;
        if (gw.requiredVoiceSecs == null) continue;
        // Only count voice time that occurred after this giveaway started
        const effectiveJoin = Math.max(joinTime, gw.startAt || 0);
        const elapsed = Math.floor((leaveTime - effectiveJoin) / 1000);
        if (elapsed <= 0) continue;
        if (!gw.gwVoiceSecs) gw.gwVoiceSecs = {};
        gw.gwVoiceSecs[userId] = (gw.gwVoiceSecs[userId] || 0) + elapsed;
        dirty = true;
    }
    if (dirty) db.set('giveaways', giveaways);
}

module.exports = {
    handleGiveawayCommand,
    handleGiveawayButton,
    restoreGiveawayTimers,
    trackGiveawayMessage,
    trackGiveawayVoice,
};
