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

        // ══════════════════════════════════════════════════════════
        // ── Fun (50 commands) ──
        // ══════════════════════════════════════════════════════════
        new SlashCommandBuilder()
            .setName('lyrics').setDescription('Get lyrics for a song')
            .addStringOption(o => o.setName('query').setDescription('Song name or artist - song').setRequired(true)),

        new SlashCommandBuilder()
            .setName('duckduckgo').setDescription('Search DuckDuckGo')
            .addStringOption(o => o.setName('search').setDescription('Search query').setRequired(true)),

        new SlashCommandBuilder().setName('blacktea').setDescription('Play the 3-letter word guessing game'),

        new SlashCommandBuilder()
            .setName('quote').setDescription('Quote a message by link or ID')
            .addStringOption(o => o.setName('text').setDescription('Message link or ID').setRequired(false)),

        new SlashCommandBuilder()
            .setName('tictactoe').setDescription('Play TicTacToe vs bot or a user')
            .addUserOption(o => o.setName('user').setDescription('Opponent (leave blank for bot)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('google').setDescription('Search Google')
            .addStringOption(o => o.setName('search').setDescription('Search query').setRequired(true)),

        new SlashCommandBuilder()
            .setName('giphy').setDescription('Search Giphy for GIFs')
            .addStringOption(o => o.setName('keyword').setDescription('Search keyword').setRequired(true)),

        new SlashCommandBuilder()
            .setName('tenor').setDescription('Search Tenor for GIFs')
            .addStringOption(o => o.setName('keyword').setDescription('Search keyword').setRequired(true)),

        new SlashCommandBuilder()
            .setName('steal').setDescription('View the most recent custom emote used')
            .addStringOption(o => o.setName('message_link').setDescription('Message link (optional)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('duckduckgoimage').setDescription('Search DuckDuckGo images')
            .addStringOption(o => o.setName('search').setDescription('Search query').setRequired(true)),

        new SlashCommandBuilder()
            .setName('reverseimage').setDescription('Reverse image search on Google/TinEye/Yandex')
            .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(true)),

        new SlashCommandBuilder()
            .setName('image').setDescription('Search Google images')
            .addStringOption(o => o.setName('search').setDescription('Search query').setRequired(true)),

        new SlashCommandBuilder()
            .setName('book').setDescription('Search Open Library for a book')
            .addStringOption(o => o.setName('search').setDescription('Title, author, or ISBN').setRequired(true)),

        new SlashCommandBuilder()
            .setName('manga').setDescription('Search MyAnimeList for manga')
            .addStringOption(o => o.setName('search').setDescription('Manga title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('anime').setDescription('Search MyAnimeList for anime')
            .addStringOption(o => o.setName('search').setDescription('Anime title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('character').setDescription('Search MyAnimeList for a character')
            .addStringOption(o => o.setName('search').setDescription('Character name').setRequired(true)),

        new SlashCommandBuilder()
            .setName('tone').setDescription('Analyze text toxicity with Google Perspective')
            .addStringOption(o => o.setName('text').setDescription('Text to analyze').setRequired(true)),

        new SlashCommandBuilder()
            .setName('tags').setDescription('Tag system — display, add, edit, random, rename, reset, search, remove, list, author')
            .addStringOption(o => o.setName('tag_name').setDescription('Tag name or subcommand').setRequired(false)),

        new SlashCommandBuilder()
            .setName('tvshow').setDescription('Get TV show info from TVMaze')
            .addStringOption(o => o.setName('title').setDescription('TV show title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('game').setDescription('Get game info from RAWG')
            .addStringOption(o => o.setName('title').setDescription('Game title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('movie').setDescription('Get movie info from OMDB')
            .addStringOption(o => o.setName('title').setDescription('Movie title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('movieexpand').setDescription('Get expanded movie info from OMDB')
            .addStringOption(o => o.setName('title').setDescription('Movie title').setRequired(true)),

        new SlashCommandBuilder()
            .setName('ocr').setDescription('Detect text in an image')
            .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(true)),

        new SlashCommandBuilder()
            .setName('ocrtr').setDescription('OCR an image and translate the text')
            .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(true))
            .addStringOption(o => o.setName('to_language').setDescription('Target language code (default: en)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('translate').setDescription('Translate text using Google Translate')
            .addStringOption(o => o.setName('text').setDescription('Text to translate').setRequired(true))
            .addStringOption(o => o.setName('to_language').setDescription('Target language (default: en)').setRequired(false))
            .addStringOption(o => o.setName('from_language').setDescription('Source language (default: auto)').setRequired(false)),

        new SlashCommandBuilder()
            .setName('tts').setDescription('Convert text to speech MP3')
            .addStringOption(o => o.setName('text').setDescription('Text to speak').setRequired(true))
            .addStringOption(o => o.setName('speaker').setDescription('Language: en, es, fr, de, it, ja, ko, ru, ar, pt, nl, pl, tr, zh').setRequired(false)),

        new SlashCommandBuilder()
            .setName('ttschannel').setDescription('Speak text in your current voice channel')
            .addStringOption(o => o.setName('text').setDescription('Text to speak').setRequired(true))
            .addStringOption(o => o.setName('speaker').setDescription('Language code').setRequired(false)),

        new SlashCommandBuilder()
            .setName('lego').setDescription('Legofy an image')
            .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(true)),

        new SlashCommandBuilder()
            .setName('makegif').setDescription('Convert a video to GIF')
            .addStringOption(o => o.setName('url').setDescription('Video URL').setRequired(true))
            .addStringOption(o => o.setName('quality').setDescription('Quality 1-30 (default: 10)').setRequired(false))
            .addStringOption(o => o.setName('fps').setDescription('FPS (default: 15)').setRequired(false))
            .addBooleanOption(o => o.setName('fast_forward').setDescription('Fast forward?').setRequired(false)),

        new SlashCommandBuilder()
            .setName('transparent').setDescription('Remove background from an image')
            .addStringOption(o => o.setName('url').setDescription('Image URL').setRequired(true)),

        new SlashCommandBuilder()
            .setName('wolfram').setDescription('Query WolframAlpha')
            .addStringOption(o => o.setName('query').setDescription('Your query').setRequired(true)),

        new SlashCommandBuilder().setName('juul').setDescription('Share the server juul'),

        new SlashCommandBuilder().setName('juul_hit').setDescription('Hit the server juul'),

        new SlashCommandBuilder()
            .setName('juul_pass').setDescription('Pass the server juul to someone')
            .addUserOption(o => o.setName('member').setDescription('User to pass to').setRequired(true)),

        new SlashCommandBuilder().setName('juul_toggle').setDescription('Toggle the server juul on/off'),

        new SlashCommandBuilder().setName('juul_stats').setDescription('Show server juul stats'),

        new SlashCommandBuilder()
            .setName('juul_flavor').setDescription('Change the server juul flavor')
            .addStringOption(o => o.setName('flavor').setDescription('New flavor').setRequired(true)),

        new SlashCommandBuilder().setName('juul_steal').setDescription('Steal the server juul'),

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