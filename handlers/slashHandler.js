const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { info: logInfo, error: logError } = require('../utils/logger');

function buildSlashCommands() {
    return [
        // ── Info ──
        new SlashCommandBuilder()
            .setName('help').setDescription('Browse or search all commands')
            .addStringOption(o => o.setName('category').setDescription('Category to view').setRequired(false)
                .addChoices(
                    { name: 'Moderation',  value: 'moderation'  },
                    { name: 'Security',    value: 'security'    },
                    { name: 'Levels',      value: 'levels'      },
                    { name: 'Config',      value: 'config'      },
                    { name: 'Info',        value: 'info'        },
                    { name: 'Fun',         value: 'fun'         },
                    { name: 'Tickets',     value: 'tickets'     },
                    { name: 'Staff',       value: 'staff'       },
                    { name: 'Utility',     value: 'utility'     },
                ))
            .addStringOption(o => o.setName('command').setDescription('Specific command to look up').setRequired(false)),

        new SlashCommandBuilder().setName('ping').setDescription("Check the bot's latency"),
        new SlashCommandBuilder().setName('botstats').setDescription('View live bot statistics'),
        new SlashCommandBuilder().setName('serverinfo').setDescription('View info about this server'),

        new SlashCommandBuilder()
            .setName('avatar').setDescription("View a member's avatar")
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)),

        new SlashCommandBuilder()
            .setName('userinfo').setDescription('View info about a member')
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)),

        // ── Moderation ──
        new SlashCommandBuilder()
            .setName('ban').setDescription('Ban a member from the server')
            .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(false)),

        new SlashCommandBuilder()
            .setName('unban').setDescription('Unban a user by ID')
            .addStringOption(o => o.setName('userid').setDescription('User ID to unban').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('kick').setDescription('Kick a member from the server')
            .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason for kick').setRequired(false)),

        new SlashCommandBuilder()
            .setName('softban').setDescription('Ban then immediately unban a member (clears messages)')
            .addUserOption(o => o.setName('user').setDescription('User to softban').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('tempban').setDescription('Temporarily ban a member')
            .addUserOption(o => o.setName('user').setDescription('User to tempban').setRequired(true))
            .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 1h, 7d)').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('timeout').setDescription('Timeout a member')
            .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
            .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d)').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('untimeout').setDescription('Remove a timeout from a member')
            .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('warn').setDescription('Issue a warning to a member')
            .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true)),

        new SlashCommandBuilder()
            .setName('warnings').setDescription('View warnings for a member')
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)),

        new SlashCommandBuilder()
            .setName('history').setDescription('View moderation history for a member')
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),

        new SlashCommandBuilder()
            .setName('case').setDescription('View a moderation case')
            .addIntegerOption(o => o.setName('id').setDescription('Case ID').setRequired(true)),

        new SlashCommandBuilder()
            .setName('reason').setDescription('Edit the reason of a moderation case')
            .addIntegerOption(o => o.setName('id').setDescription('Case ID').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('New reason').setRequired(true)),

        new SlashCommandBuilder()
            .setName('modstats').setDescription('View moderation statistics for a moderator')
            .addUserOption(o => o.setName('user').setDescription('Moderator (defaults to you)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('purge').setDescription('Delete messages in bulk')
            .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
            .addUserOption(o => o.setName('user').setDescription('Only delete from this user').setRequired(false))
            .addStringOption(o => o.setName('filter').setDescription('Filter type').setRequired(false)
                .addChoices(
                    { name: 'Bots',    value: 'bots'    },
                    { name: 'Humans',  value: 'humans'  },
                    { name: 'Links',   value: 'links'   },
                    { name: 'Images',  value: 'images'  },
                    { name: 'Embeds',  value: 'embeds'  },
                    { name: 'Files',   value: 'files'   },
                )),

        new SlashCommandBuilder()
            .setName('mute').setDescription('Mute a member with the mute role')
            .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true))
            .addStringOption(o => o.setName('duration').setDescription('Duration (optional, e.g. 1h, 1d)').setRequired(false))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('unmute').setDescription('Unmute a member')
            .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('jail').setDescription('Jail a member')
            .addUserOption(o => o.setName('user').setDescription('User to jail').setRequired(true))
            .addStringOption(o => o.setName('duration').setDescription('Duration (optional, e.g. 1h, 1d)').setRequired(false))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('unjail').setDescription('Release a member from jail')
            .addUserOption(o => o.setName('user').setDescription('User to unjail').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        new SlashCommandBuilder()
            .setName('lock').setDescription('Lock a channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (defaults to current)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('unlock').setDescription('Unlock a channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (defaults to current)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('slowmode').setDescription('Set slowmode in a channel')
            .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (0 to disable)').setMinValue(0).setMaxValue(21600).setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('nick').setDescription("Change a member's nickname")
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
            .addStringOption(o => o.setName('nickname').setDescription('New nickname (leave blank to reset)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('role').setDescription('Manage member roles')
            .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices(
                { name: 'Add',    value: 'add'    },
                { name: 'Remove', value: 'remove' },
            ))
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('Role to add/remove').setRequired(true)),

        new SlashCommandBuilder()
            .setName('temprole').setDescription('Assign a temporary role to a member')
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
            .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 1h, 7d)').setRequired(true))
            .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

        // ── Levels ──
        new SlashCommandBuilder()
            .setName('levels').setDescription('XP and level system')
            .addSubcommand(s => s.setName('rank').setDescription("View your or someone's rank")
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)))
            .addSubcommand(s => s.setName('leaderboard').setDescription('Top 10 XP leaderboard')),

        // ── Config ──
        new SlashCommandBuilder()
            .setName('config').setDescription('View or change bot settings')
            .addSubcommand(s => s.setName('view').setDescription('View all current settings'))
            .addSubcommand(s => s.setName('modules').setDescription('View module status')),

        // ── Fun ──
        new SlashCommandBuilder()
            .setName('8ball').setDescription('Ask the magic 8 ball a question')
            .addStringOption(o => o.setName('question').setDescription('Your yes/no question').setRequired(true)),

        new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin'),

        new SlashCommandBuilder()
            .setName('dice').setDescription('Roll a dice')
            .addStringOption(o => o.setName('format').setDescription('Sides or NdN format (e.g. 20 or 2d6)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('rps').setDescription('Rock, paper, scissors vs the bot')
            .addStringOption(o => o.setName('choice').setDescription('Your choice').setRequired(true)
                .addChoices({ name: 'Rock 🪨', value: 'rock' }, { name: 'Paper 📄', value: 'paper' }, { name: 'Scissors ✂️', value: 'scissors' })),

        new SlashCommandBuilder()
            .setName('choose').setDescription('Choose between options')
            .addStringOption(o => o.setName('options').setDescription('Comma-separated options (e.g. pizza, burger, tacos)').setRequired(true)),

        new SlashCommandBuilder().setName('quote').setDescription('Get a random inspirational quote'),
        new SlashCommandBuilder().setName('joke').setDescription('Get a random joke'),
        new SlashCommandBuilder().setName('cat').setDescription('Get a random cat image'),
        new SlashCommandBuilder().setName('dog').setDescription('Get a random dog image'),
        new SlashCommandBuilder().setName('meme').setDescription('Get a random meme'),
        new SlashCommandBuilder().setName('wyr').setDescription('Get a random "Would you rather" prompt'),

        new SlashCommandBuilder()
            .setName('rate').setDescription('Rate something out of 10')
            .addStringOption(o => o.setName('thing').setDescription('What to rate').setRequired(true)),

        new SlashCommandBuilder()
            .setName('pp').setDescription("Check someone's pp size (silly)")
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false)),

        new SlashCommandBuilder()
            .setName('ship').setDescription('Ship two users')
            .addUserOption(o => o.setName('user1').setDescription('First user').setRequired(true))
            .addUserOption(o => o.setName('user2').setDescription('Second user').setRequired(true)),

        new SlashCommandBuilder()
            .setName('tictactoe').setDescription('Play TicTacToe')
            .addUserOption(o => o.setName('user').setDescription('Opponent (leave blank to play vs bot)').setRequired(false)),

        // ── Roleplay ──
        new SlashCommandBuilder()
            .setName('rp').setDescription('Send a roleplay / reaction GIF')
            .addStringOption(o => o.setName('action').setDescription('Roleplay action (e.g. hug, kiss, pat, slap, cry...)').setRequired(true))
            .addUserOption(o => o.setName('user').setDescription('Target user (optional)').setRequired(false)),

    ].map(c => c.toJSON());
}

async function registerSlashCommands(client) {
    const token = process.env.BOT_TOKEN;
    if (!token) { logError('SLASH', 'No BOT_TOKEN found, skipping slash registration'); return; }
    try {
        const rest     = new REST({ version: '10' }).setToken(token);
        const commands = buildSlashCommands();
        logInfo('SLASH', `Registering ${commands.length} slash commands globally...`);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        logInfo('SLASH', `Registered ${commands.length} slash commands successfully.`);
    } catch (err) {
        logError('SLASH', 'Failed to register slash commands', err);
    }
}

module.exports = { registerSlashCommands };
