/**
 * boosterRole.js — Custom booster roles (full-featured)
 *
 * Admin commands:  .boosterrole enable/disable/sharemax/base/filter
 * User commands:   .boosterrole create/rename/color/reset/share/unshare/shares/dominant/random/view
 *
 * Storage (guild DB):
 *   'boosterRoleConfig'  → { enabled, shareMax, baseRoleId, filterWords: [] }
 *   'boosterRoles'       → { [userId]: { roleId, sharedWith: [] } }
 */

const https = require('https');
const { PermissionFlagsBits } = require('discord.js');
const { getGuildDb } = require('./database');
const { isAdmin } = require('./helpers');
const { base, COLORS } = require('../utils/embeds');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a named color string OR hex string to a Discord-safe hex. */
const NAMED_COLORS = {
    red: '#FF0000', blue: '#0000FF', green: '#00FF00', yellow: '#FFFF00',
    orange: '#FF8C00', purple: '#8B008B', pink: '#FF69B4', cyan: '#00FFFF',
    white: '#FFFFFF', black: '#000000', magenta: '#FF00FF', lime: '#00FF7F',
    teal: '#008080', gold: '#FFD700', silver: '#C0C0C0', brown: '#8B4513',
    coral: '#FF6347', turquoise: '#40E0D0', violet: '#EE82EE', indigo: '#4B0082',
};

function resolveColor(raw) {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
    return null;
}

/** Check if the name contains any blacklisted words (case-insensitive). */
function isFilteredName(name, filterWords) {
    const lower = name.toLowerCase();
    return filterWords.some(w => lower.includes(w.toLowerCase()));
}

/** Fetch a URL as a Buffer using Node's built-in https module. */
function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 8000 }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

/**
 * Extract the dominant bright color from a PNG/JPEG buffer by sampling pixels.
 * Uses a very simple approach: reads raw bytes assuming an uncompressed format
 * won't work for PNG/JPEG, so we fall back to a smarter approach:
 * We fetch the image as a JPEG (Discord avatar URLs support ?size=64&format=jpeg),
 * and use a manual JPEG byte scan to pick common bright pixels.
 *
 * Since we can't use sharp/canvas without installing npm packages, we do a
 * lightweight approach: sample the raw buffer bytes at regular intervals and
 * look for repeating RGB-like patterns. For JPEG, pixel data isn't directly
 * accessible without a decoder — so we instead use a fallback heuristic:
 * scan the buffer for bytes that look like color components and find the most
 * common "bright" byte triplet.
 *
 * Returns a hex color string or null on failure.
 */
async function getDominantColor(avatarURL) {
    try {
        // Request a small 64x64 PNG from Discord
        const url = avatarURL.replace(/\?.*$/, '') + '?size=64&format=png';
        const buf = await fetchBuffer(url);

        // PNG structure: after the 8-byte signature and IHDR chunk,
        // IDAT chunk(s) contain zlib-compressed scanlines. We can't
        // decompress without zlib bindings, but Node has zlib built-in!
        const zlib = require('zlib');

        // Find all IDAT chunk data
        const idatChunks = [];
        let offset = 8; // skip PNG signature
        while (offset < buf.length - 12) {
            const length = buf.readUInt32BE(offset);
            const type = buf.slice(offset + 4, offset + 8).toString('ascii');
            if (type === 'IHDR') {
                // width = buf.readUInt32BE(offset + 8), height = buf.readUInt32BE(offset + 12)
                // bit depth = buf[offset + 16], color type = buf[offset + 17]
            }
            if (type === 'IDAT') {
                idatChunks.push(buf.slice(offset + 8, offset + 8 + length));
            }
            if (type === 'IEND') break;
            offset += 12 + length;
        }

        if (idatChunks.length === 0) return null;

        // Decompress IDAT data
        const compressed = Buffer.concat(idatChunks);
        const decompressed = await new Promise((res, rej) => {
            zlib.inflate(compressed, (err, result) => err ? rej(err) : res(result));
        });

        // Read IHDR for width/height
        let width = 64, height = 64;
        let ihdrOffset = 8;
        while (ihdrOffset < buf.length - 12) {
            const len = buf.readUInt32BE(ihdrOffset);
            const t = buf.slice(ihdrOffset + 4, ihdrOffset + 8).toString('ascii');
            if (t === 'IHDR') {
                width  = buf.readUInt32BE(ihdrOffset + 8);
                height = buf.readUInt32BE(ihdrOffset + 12);
                break;
            }
            ihdrOffset += 12 + len;
        }

        // Each scanline is prefixed by a filter byte
        // Assume RGBA (color type 6) = 4 bytes per pixel
        const bytesPerPixel = 4;
        const colorMap = new Map();

        for (let y = 0; y < height; y += 4) {
            const rowStart = y * (width * bytesPerPixel + 1) + 1; // skip filter byte
            for (let x = 0; x < width; x += 4) {
                const px = rowStart + x * bytesPerPixel;
                if (px + 3 >= decompressed.length) continue;
                const r = decompressed[px];
                const g = decompressed[px + 1];
                const b = decompressed[px + 2];
                const a = decompressed[px + 3];
                if (a < 128) continue; // skip transparent pixels
                // Only consider pixels with reasonable brightness and saturation
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                if (max < 60) continue; // too dark
                if (max - min < 30 && max < 200) continue; // too gray/dull
                // Quantize to reduce noise
                const qr = Math.round(r / 32) * 32;
                const qg = Math.round(g / 32) * 32;
                const qb = Math.round(b / 32) * 32;
                const key = `${qr},${qg},${qb}`;
                colorMap.set(key, (colorMap.get(key) || 0) + 1);
            }
        }

        if (colorMap.size === 0) return null;

        // Find most common color
        let bestKey = null, bestCount = 0;
        for (const [key, count] of colorMap) {
            if (count > bestCount) { bestCount = count; bestKey = key; }
        }

        if (!bestKey) return null;
        const [r, g, b] = bestKey.split(',').map(Number);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
        return null;
    }
}

/** Generate a random bright/vibrant color hex string. */
function randomBrightColor() {
    const h = Math.random();
    const s = 0.7 + Math.random() * 0.3;
    const v = 0.8 + Math.random() * 0.2;
    // HSV to RGB
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Attempt to place the role just below the configured base role (or below bot's highest). */
async function placeRole(guild, role, baseRoleId) {
    try {
        if (baseRoleId) {
            const baseRole = guild.roles.cache.get(baseRoleId);
            if (baseRole) {
                await role.setPosition(Math.max(1, baseRole.position - 1)).catch(() => {});
                return;
            }
        }
        const botTop = guild.members.me.roles.highest.position;
        await role.setPosition(Math.max(1, botTop - 1)).catch(() => {});
    } catch { /* best effort */ }
}

// ─── Main command handler ─────────────────────────────────────────────────────

async function handleBoosterRoleCommand(message, args) {
    const sub = (args[0] || '').toLowerCase();
    const db  = getGuildDb(message.guild.id);

    const cfg = db.get('boosterRoleConfig', { enabled: false, shareMax: 0, baseRoleId: null, filterWords: [] });
    const map = db.get('boosterRoles', {}); // { [userId]: { roleId, sharedWith: [] } }

    const hasManageRoles = message.member.permissions.has(PermissionFlagsBits.ManageRoles);
    const memberIsAdmin  = isAdmin(message.member);
    const canAdmin       = hasManageRoles || memberIsAdmin;

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN SUBCOMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    if (sub === 'enable') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        cfg.enabled = true;
        db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Booster Roles Enabled').setDescription('The booster role system is now **enabled** for this server.')] });
    }

    if (sub === 'disable') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        cfg.enabled = false;
        db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.warning).setTitle('⚠️ Booster Roles Disabled').setDescription('The booster role system has been **disabled**. Existing roles are untouched.')] });
    }

    if (sub === 'sharemax') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        const val = parseInt(args[1], 10);
        if (isNaN(val) || val < 0 || val > 99)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Invalid Value').setDescription('Provide a number between **0** and **99**. `0` disables sharing.')] });
        cfg.shareMax = val;
        db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Share Limit Updated').setDescription(val === 0 ? 'Role sharing has been **disabled**.' : `Boosters can now share their role with up to **${val}** user(s).`)] });
    }

    if (sub === 'base') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        const mentioned = message.mentions.roles.first();
        if (!mentioned)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Role').setDescription('Mention a role. Usage: `.boosterrole base @role`')] });
        cfg.baseRoleId = mentioned.id;
        db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Base Role Set').setDescription(`Booster roles will be placed just below <@&${mentioned.id}>.`)] });
    }

    if (sub === 'filter') {
        if (!canAdmin) return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Permission').setDescription('You need **Manage Roles** or admin to use this command.')] });
        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];

        const action = (args[1] || '').toLowerCase();

        if (action === 'list') {
            if (cfg.filterWords.length === 0)
                return message.reply({ embeds: [base(COLORS.info).setTitle('🔍 Filter List').setDescription('No blacklisted words yet.')] });
            return message.reply({ embeds: [base(COLORS.info).setTitle('🔍 Blacklisted Words').setDescription(cfg.filterWords.map((w, i) => `\`${i + 1}.\` ${w}`).join('\n'))] });
        }

        if (action === 'remove') {
            const word = args.slice(2).join(' ').trim().toLowerCase();
            if (!word) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a word to remove.')] });
            const idx = cfg.filterWords.findIndex(w => w.toLowerCase() === word);
            if (idx === -1) return message.reply({ embeds: [base(COLORS.warning).setTitle('Not Found').setDescription(`\`${word}\` is not in the blacklist.`)] });
            cfg.filterWords.splice(idx, 1);
            db.set('boosterRoleConfig', cfg);
            return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Word Removed').setDescription(`\`${word}\` has been removed from the filter list.`)] });
        }

        // Add a word
        const word = args.slice(1).join(' ').trim();
        if (!word) return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Usage:\n`.boosterrole filter <word>` — add\n`.boosterrole filter remove <word>` — remove\n`.boosterrole filter list` — view all')] });
        if (cfg.filterWords.includes(word.toLowerCase())) return message.reply({ embeds: [base(COLORS.warning).setTitle('Already Exists').setDescription(`\`${word}\` is already in the filter list.`)] });
        cfg.filterWords.push(word.toLowerCase());
        db.set('boosterRoleConfig', cfg);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Word Added').setDescription(`\`${word}\` has been added to the filter list. Boosters cannot use it in role names.`)] });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // USER SUBCOMMANDS — require system enabled (admins bypass)
    // ══════════════════════════════════════════════════════════════════════════

    if (!cfg.enabled && !memberIsAdmin)
        return message.reply({ embeds: [base(COLORS.error).setTitle('❌ System Disabled').setDescription('The booster role system is not enabled on this server.')] });

    const isBooster = message.member.premiumSince != null;

    // ── create ──────────────────────────────────────────────────────────────
    if (sub === 'create') {
        if (!isBooster && !memberIsAdmin)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Not a Booster').setDescription('Only **server boosters** can create a custom booster role.')] });

        const entry = map[message.author.id];
        if (entry && message.guild.roles.cache.has(entry.roleId))
            return message.reply({ embeds: [base(COLORS.warning).setTitle('Already Exists').setDescription(`You already have a booster role: <@&${entry.roleId}>\nUse \`.boosterrole view\` to see it.`)] });

        const customName = args.slice(1).join(' ').trim();
        const roleName   = customName || `${message.author.username}'s Role`;

        if (roleName.length > 100)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Name Too Long').setDescription('Role names must be 100 characters or fewer.')] });

        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];
        if (isFilteredName(roleName, cfg.filterWords))
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Filtered Name').setDescription('That name contains a blacklisted word. Please choose a different name.')] });

        try {
            const botTop = message.guild.members.me.roles.highest.position;
            const role   = await message.guild.roles.create({
                name:   roleName,
                color:  '#5865F2',
                position: Math.max(1, botTop - 1),
                reason: `Custom booster role for ${message.author.tag}`,
            });
            await placeRole(message.guild, role, cfg.baseRoleId);
            await message.member.roles.add(role).catch(() => {});
            map[message.author.id] = { roleId: role.id, sharedWith: [] };
            db.set('boosterRoles', map);
            return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Booster Role Created')
                .setDescription(`Your custom role <@&${role.id}> has been created!`)
                .addFields(
                    { name: 'Customise', value: '`.boosterrole rename <name>` — rename it\n`.boosterrole color <hex>` — change color\n`.boosterrole dominant` — use your avatar color\n`.boosterrole random` — random bright color', inline: false }
                )] });
        } catch (e) {
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription(`Could not create role: ${e.message}`)] });
        }
    }

    // For all remaining user commands, the user must have an existing role
    const entry = map[message.author.id];
    const role  = entry ? message.guild.roles.cache.get(entry.roleId) : null;

    // Helper to show "no role" error
    function noRole() {
        return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Booster Role').setDescription('You don\'t have a booster role yet. Create one with `.boosterrole create`.')] });
    }

    // ── view ─────────────────────────────────────────────────────────────────
    if (sub === 'view' || sub === '') {
        if (!entry || !role) return noRole();
        const shared = entry.sharedWith || [];
        const sharedList = shared.length > 0 ? shared.map(id => `<@${id}>`).join(', ') : 'No one';
        return message.reply({ embeds: [base(COLORS.primary).setTitle('🎨 Your Booster Role')
            .addFields(
                { name: 'Role',     value: `<@&${role.id}>`,              inline: true },
                { name: 'Name',     value: role.name,                      inline: true },
                { name: 'Color',    value: role.hexColor || 'Default',     inline: true },
                { name: 'Position', value: String(role.position),          inline: true },
                { name: 'Members',  value: String(role.members.size),      inline: true },
                { name: 'Shared With', value: sharedList,                  inline: false },
            )
            .setFooter({ text: 'Kaido' })] });
    }

    // ── rename ───────────────────────────────────────────────────────────────
    if (sub === 'rename') {
        if (!entry || !role) return noRole();
        const name = args.slice(1).join(' ').trim();
        if (!name || name.length > 100)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a name (1–100 characters). Usage: `.boosterrole rename <name>`')] });
        if (!Array.isArray(cfg.filterWords)) cfg.filterWords = [];
        if (isFilteredName(name, cfg.filterWords))
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Filtered Name').setDescription('That name contains a blacklisted word. Choose a different name.')] });
        await role.setName(name);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Renamed').setDescription(`Your booster role is now called **${name}**.`)] });
    }

    // ── color / colour ───────────────────────────────────────────────────────
    if (sub === 'color' || sub === 'colour') {
        if (!entry || !role) return noRole();
        const raw = args.slice(1).join(' ').trim();
        if (!raw)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('Provide a color. Usage: `.boosterrole color <hex or name>`\nExamples: `#ff5733`, `red`, `royalblue`')] });
        const hex = resolveColor(raw);
        if (!hex)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Invalid Color').setDescription('Use a valid hex code like `#ff5733` or a color name like `red`, `blue`, `purple`.')] });
        try {
            await role.setColor(hex);
            return message.reply({ embeds: [base(hex).setTitle('✅ Color Updated').setDescription(`Your booster role color is now **${hex}**.`)] });
        } catch {
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] });
        }
    }

    // ── random ───────────────────────────────────────────────────────────────
    if (sub === 'random') {
        if (!entry || !role) return noRole();
        const hex = randomBrightColor();
        try {
            await role.setColor(hex);
            return message.reply({ embeds: [base(hex).setTitle('🎲 Random Color Set').setDescription(`Your booster role color has been set to **${hex}**.`)] });
        } catch {
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] });
        }
    }

    // ── dominant ─────────────────────────────────────────────────────────────
    if (sub === 'dominant') {
        if (!entry || !role) return noRole();
        const avatarURL = message.member.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true });
        if (!avatarURL)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No Avatar').setDescription('You don\'t have a custom avatar set.')] });

        const loadMsg = await message.reply({ embeds: [base(COLORS.muted).setTitle('⏳ Extracting Color…').setDescription('Analysing your avatar for the dominant color…')] });

        const hex = await getDominantColor(avatarURL) || '#9B59B6'; // fallback purple
        try {
            await role.setColor(hex);
            await loadMsg.edit({ embeds: [base(hex).setTitle('🎨 Dominant Color Set').setDescription(`Your avatar's dominant color (**${hex}**) has been applied to your role.`)] });
        } catch {
            await loadMsg.edit({ embeds: [base(COLORS.error).setTitle('❌ Failed').setDescription('Could not update the role color.')] });
        }
        return;
    }

    // ── reset ─────────────────────────────────────────────────────────────────
    if (sub === 'reset') {
        if (!entry || !role) return noRole();
        await role.delete('User reset their booster role').catch(() => {});
        delete map[message.author.id];
        db.set('boosterRoles', map);
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Reset').setDescription('Your booster role and all shares have been removed.')] });
    }

    // ── share ─────────────────────────────────────────────────────────────────
    if (sub === 'share') {
        if (!entry || !role) return noRole();
        if (cfg.shareMax === 0)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Sharing Disabled').setDescription('Role sharing is not enabled on this server.')] });

        const target = message.mentions.members?.first();
        if (!target)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No User').setDescription('Mention a user to share with. Usage: `.boosterrole share @user`')] });
        if (target.id === message.author.id)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌').setDescription('You can\'t share your role with yourself.')] });

        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        if (entry.sharedWith.includes(target.id))
            return message.reply({ embeds: [base(COLORS.warning).setTitle('Already Shared').setDescription(`You've already shared your role with ${target}.`)] });
        if (entry.sharedWith.length >= cfg.shareMax)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ Share Limit Reached').setDescription(`You can only share your role with up to **${cfg.shareMax}** user(s).`)] });

        entry.sharedWith.push(target.id);
        db.set('boosterRoles', map);
        await target.roles.add(role).catch(() => {});
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Role Shared').setDescription(`${target} now has your booster role <@&${role.id}>.\n(${entry.sharedWith.length}/${cfg.shareMax} slots used)`)] });
    }

    // ── unshare ───────────────────────────────────────────────────────────────
    if (sub === 'unshare') {
        if (!entry || !role) return noRole();
        const target = message.mentions.members?.first();
        if (!target)
            return message.reply({ embeds: [base(COLORS.error).setTitle('❌ No User').setDescription('Mention a user to unshare from. Usage: `.boosterrole unshare @user`')] });

        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        const idx = entry.sharedWith.indexOf(target.id);
        if (idx === -1)
            return message.reply({ embeds: [base(COLORS.warning).setTitle('Not Shared').setDescription(`You haven't shared your role with ${target}.`)] });

        entry.sharedWith.splice(idx, 1);
        db.set('boosterRoles', map);
        await target.roles.remove(role).catch(() => {});
        return message.reply({ embeds: [base(COLORS.success).setTitle('✅ Share Removed').setDescription(`${target} no longer has your booster role.`)] });
    }

    // ── shares ────────────────────────────────────────────────────────────────
    if (sub === 'shares') {
        if (!entry || !role) return noRole();
        if (!Array.isArray(entry.sharedWith)) entry.sharedWith = [];
        if (entry.sharedWith.length === 0)
            return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Shared With').setDescription('You haven\'t shared your role with anyone.\nUse `.boosterrole share @user` to share it.')] });

        const limit = cfg.shareMax || '∞';
        return message.reply({ embeds: [base(COLORS.info).setTitle('📋 Shared With')
            .setDescription(entry.sharedWith.map((id, i) => `\`${i + 1}.\` <@${id}>`).join('\n'))
            .setFooter({ text: `${entry.sharedWith.length}/${limit} slots used • Kaido` })] });
    }

    // ── help / default ────────────────────────────────────────────────────────
    return message.reply({ embeds: [base(COLORS.primary).setTitle('🎨 Booster Role — Help')
        .addFields(
            {
                name: '👤 User Commands',
                value: [
                    '`.boosterrole create [name]` — create your role',
                    '`.boosterrole view` — view your role info',
                    '`.boosterrole rename <name>` — rename it',
                    '`.boosterrole color <hex/name>` — set color',
                    '`.boosterrole dominant` — use avatar dominant color',
                    '`.boosterrole random` — random bright color',
                    '`.boosterrole share @user` — share with a user',
                    '`.boosterrole unshare @user` — remove a share',
                    '`.boosterrole shares` — list shares',
                    '`.boosterrole reset` — delete your role',
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚙️ Admin Commands',
                value: [
                    '`.boosterrole enable/disable` — toggle system',
                    '`.boosterrole sharemax <0-99>` — set share limit',
                    '`.boosterrole base @role` — set base role position',
                    '`.boosterrole filter <word>` — blacklist a word',
                    '`.boosterrole filter remove <word>` — remove from blacklist',
                    '`.boosterrole filter list` — view blacklist',
                ].join('\n'),
                inline: false,
            },
        )
        .setFooter({ text: 'Kaido' })] });
}

// ─── handleBoostRemoved ───────────────────────────────────────────────────────

/**
 * Call this from guildMemberUpdate when a member loses their boost.
 * Deletes their role, removes all shares, saves.
 */
async function handleBoostRemoved(member) {
    const db  = getGuildDb(member.guild.id);
    const map = db.get('boosterRoles', {});
    const entry = map[member.id];
    if (!entry) return;

    const role = member.guild.roles.cache.get(entry.roleId);
    if (role) await role.delete('Member stopped boosting').catch(() => {});

    delete map[member.id];
    db.set('boosterRoles', map);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { handleBoosterRoleCommand, handleBoostRemoved };
