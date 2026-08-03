/**
 * help.js — Greed-style paginated help command
 *
 * ,help               — browse all commands, 1 per page
 * ,help <command>     — jump to that command's page
 * ,help <category>    — jump to first command in that category
 *
 * UI: ◀ ▶ 🔀 ✕  buttons. Author = invoker. Footer = page/total • module.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getAll, getByCategory, resolve } = require('../handlers/commandRegistry');
const { COLORS } = require('../utils/embeds');

const TIMEOUT = 120_000; // 2 min

const CATEGORY_META = {
    moderation:  { emoji: '🔨', label: 'moderation' },
    security:    { emoji: '🛡️', label: 'security' },
    staff:       { emoji: '👮', label: 'staff' },
    levels:      { emoji: '📊', label: 'levels' },
    tickets:     { emoji: '🎫', label: 'tickets' },
    voicemaster: { emoji: '🎙️', label: 'voice' },
    config:      { emoji: '⚙️', label: 'config' },
    info:        { emoji: '🔍', label: 'info' },
    fun:         { emoji: '🎮', label: 'fun' },
    utility:     { emoji: '🔧', label: 'utility' },
    reaction:    { emoji: '👍', label: 'reaction' },
};

function catLabel(cat) {
    return CATEGORY_META[cat]?.label ?? cat;
}

// ── Build list of all commands ─────────────────────────────────────────────

function getAllPages() {
    return getAll().filter(c => !c.hidden);
}

// ── Build one command embed ────────────────────────────────────────────────

function buildCommandEmbed(def, page, total, invoker, prefix = ',') {
    const pf  = prefix;
    const cat = catLabel(def.category);

    // Aliases
    const aliases = def.aliases?.length
        ? def.aliases.map(a => `${pf}${a}`).join(', ')
        : 'n/a';

    // Parameters (extracted from usage string, e.g. ",ban @user [reason]" → "@user [reason]")
    let params = 'n/a';
    if (def.usage) {
        const stripped = def.usage.replace(/^[,.]?\w+\s*/, '').trim();
        params = stripped || 'n/a';
    }

    // Information (permissions / admin / staff)
    const infoLines = [];
    if (def.adminOnly)        infoLines.push('Admin Only');
    else if (def.staffOnly)   infoLines.push('Staff Only');
    if (def.permissions?.length) {
        for (const p of def.permissions) infoLines.push(p);
    }
    const info = infoLines.length ? infoLines.join(', ') : 'n/a';

    // Usage block
    const syntax  = `${pf}${def.name}${params !== 'n/a' ? ' ' + params : ''}`;
    const example = def.examples?.[0] ?? syntax;
    const usageBlock = `\`\`\`\nSyntax:  ${syntax}\nExample: ${example}\n\`\`\``;

    const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setAuthor({
            name:    invoker.displayName ?? invoker.username,
            iconURL: invoker.displayAvatarURL?.({ size: 64 }),
        })
        .setTitle(def.name)
        .setDescription(def.description || 'No description.')
        .addFields(
            { name: 'Aliases',     value: aliases, inline: true },
            { name: 'Parameters',  value: params,  inline: true },
            { name: 'Information', value: info,    inline: true },
            { name: 'Usage',       value: usageBlock, inline: false },
        )
        .setFooter({ text: `Page ${page}/${total} (${total} entries) • Module: ${cat}` });

    return embed;
}

// ── Nav buttons ────────────────────────────────────────────────────────────

function buildNav(page, total, moduleFilter = false) {
    const sortLabel = moduleFilter ? '🌐' : '🔀';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('h_prev')
            .setEmoji('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId('h_next')
            .setEmoji('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= total),
        new ButtonBuilder()
            .setCustomId('h_sort')
            .setEmoji(sortLabel)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('h_close')
            .setEmoji('✕')
            .setStyle(ButtonStyle.Danger),
    );
}

// ── Main handler ───────────────────────────────────────────────────────────

async function handleHelp(ctx, args, client, prefix = ',') {
    const isInteraction = !!ctx.deferReply;
    if (isInteraction) {
        try { await ctx.deferReply(); } catch {}
    }

    const invoker  = isInteraction ? (ctx.member ?? ctx.user) : ctx.member;
    const authorId = isInteraction ? ctx.user.id : ctx.author.id;
    const query    = (args[0] || '').toLowerCase();

    // Gather all commands
    let allCmds = getAllPages();
    let startIdx = 0; // 0-based index

    if (query) {
        // Try exact command match
        const def = resolve(query);
        if (def) {
            startIdx = allCmds.findIndex(c => c.name === def.name);
            if (startIdx === -1) startIdx = 0;
        } else {
            // Try category match → jump to first command in that category
            const catCmds = getByCategory(query);
            if (catCmds.length) {
                startIdx = allCmds.findIndex(c => c.category === query);
                if (startIdx === -1) startIdx = 0;
            } else {
                const errMsg = `<:warn:1528892150698348727> <@${authorId}>: No command or category matching \`${query}\` found.`;
                if (isInteraction) return ctx.editReply({ content: errMsg });
                return ctx.channel.send({ content: errMsg });
            }
        }
    }

    let page        = startIdx + 1;  // 1-based
    let moduleMode  = false;         // false = show all, true = show only current module
    let filteredCmds = allCmds;

    function getPage() {
        const total = filteredCmds.length;
        const idx   = Math.min(Math.max(page - 1, 0), total - 1);
        const def   = filteredCmds[idx];
        return { def, total, idx };
    }

    const { def: firstDef, total: firstTotal } = getPage();
    if (!firstDef) {
        const msg = `<:warn:1528892150698348727> <@${authorId}>: No commands available.`;
        if (isInteraction) return ctx.editReply({ content: msg });
        return ctx.channel.send({ content: msg });
    }

    const firstEmbed = buildCommandEmbed(firstDef, page, firstTotal, invoker, prefix);
    const payload    = { embeds: [firstEmbed], components: [buildNav(page, firstTotal, moduleMode)] };

    let sent;
    try {
        if (isInteraction) {
            await ctx.editReply(payload);
            sent = await ctx.fetchReply().catch(() => null);
        } else {
            sent = await ctx.channel.send(payload);
        }
    } catch { return; }

    if (!sent) return;

    const collector = sent.createMessageComponentCollector({
        time: TIMEOUT,
        filter: i => {
            if (i.user.id !== authorId) {
                i.reply({ content: '❌ This menu belongs to someone else.', ephemeral: true });
                return false;
            }
            return true;
        },
    });

    collector.on('collect', async i => {
        try {
            if (i.customId === 'h_close') {
                collector.stop('closed');
                return i.message.delete().catch(() =>
                    i.update({ components: [] })
                );
            }

            if (i.customId === 'h_sort') {
                // Toggle module filter
                moduleMode = !moduleMode;
                const cur = filteredCmds[Math.min(page - 1, filteredCmds.length - 1)];
                if (moduleMode && cur) {
                    filteredCmds = allCmds.filter(c => c.category === cur.category);
                } else {
                    filteredCmds = allCmds;
                }
                page = 1;
            } else if (i.customId === 'h_prev') {
                page = Math.max(1, page - 1);
            } else if (i.customId === 'h_next') {
                page = Math.min(filteredCmds.length, page + 1);
            }

            const { def, total } = getPage();
            if (!def) return i.deferUpdate();

            await i.update({
                embeds: [buildCommandEmbed(def, page, total, invoker, prefix)],
                components: [buildNav(page, total, moduleMode)],
            });
        } catch {}
    });

    collector.on('end', (_c, reason) => {
        if (reason === 'closed') return;
        sent.edit({ components: [] }).catch(() => {});
    });
}

module.exports = { handleHelp };
