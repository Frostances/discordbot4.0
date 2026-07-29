const { EmbedBuilder } = require('discord.js');
const { getGuildDb } = require('./database');

async function handleStaffCommand(message, args) {
    const { isAdmin } = require('./helpers');
    const db = getGuildDb(message.guild.id);
    const sub = args[0];

    if (sub === 'set') {
        if (!isAdmin(message.author.id)) return message.reply('❌ Only the bot admin can configure staff roles.');
        const role = message.mentions.roles.first();
        if (!role) return message.reply('❌ Usage: `.staff set @role`');
        const staffRoles = db.get('staffRoles', []);
        const idx = staffRoles.indexOf(role.id);
        if (idx === -1) {
            staffRoles.push(role.id);
            db.set('staffRoles', staffRoles);
            return message.reply(`✅ Added **${role.name}** to staff roles.`);
        } else {
            staffRoles.splice(idx, 1);
            db.set('staffRoles', staffRoles);
            return message.reply(`✅ Removed **${role.name}** from staff roles.`);
        }
    }

    if (sub === 'list') {
        const staffRoles = db.get('staffRoles', []);
        if (!staffRoles.length) return message.reply('📋 No staff roles configured.');
        const list = staffRoles.map(id => {
            const r = message.guild.roles.cache.get(id);
            return r ? `• ${r.name}` : `• Unknown (${id})`;
        }).join('\n');
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('👮 Staff Roles').setDescription(list).setColor('#3498db').setTimestamp()] });
    }

    if (sub === 'restrict') {
        if (!isAdmin(message.author.id)) return message.reply('❌ Only the bot admin can restrict commands.');
        const role = message.mentions.roles.first();
        const cmd = args[2];
        if (!role || !cmd) return message.reply('❌ Usage: `.staff restrict @role <command>`');
        const restrictions = db.get('staffRestrictions', {});
        if (!restrictions[role.id]) restrictions[role.id] = [];
        if (!restrictions[role.id].includes(cmd)) restrictions[role.id].push(cmd);
        db.set('staffRestrictions', restrictions);
        return message.reply(`✅ **${role.name}** is now restricted from using \`.${cmd}\`.`);
    }

    if (sub === 'unrestrict') {
        if (!isAdmin(message.author.id)) return message.reply('❌ Only the bot admin can change restrictions.');
        const role = message.mentions.roles.first();
        const cmd = args[2];
        if (!role || !cmd) return message.reply('❌ Usage: `.staff unrestrict @role <command>`');
        const restrictions = db.get('staffRestrictions', {});
        if (restrictions[role.id]) {
            restrictions[role.id] = restrictions[role.id].filter(c => c !== cmd);
            db.set('staffRestrictions', restrictions);
        }
        return message.reply(`✅ Restriction removed: **${role.name}** can now use \`.${cmd}\`.`);
    }

    if (sub === 'restrictions') {
        const restrictions = db.get('staffRestrictions', {});
        const entries = Object.entries(restrictions);
        if (!entries.length) return message.reply('📋 No command restrictions configured.');
        let desc = '';
        for (const [roleId, cmds] of entries) {
            const role = message.guild.roles.cache.get(roleId);
            desc += `**${role ? role.name : roleId}**: ${cmds.map(c => `\`.${c}\``).join(', ')}\n`;
        }
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🚫 Command Restrictions').setDescription(desc).setColor('#e74c3c').setTimestamp()] });
    }

    return message.reply('❌ Usage: `.staff set @role` | `.staff list` | `.staff restrict @role cmd` | `.staff unrestrict @role cmd` | `.staff restrictions`');
}

module.exports = { handleStaffCommand };
