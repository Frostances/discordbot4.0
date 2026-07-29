/**
 * funCommands.js — Fun commands
 * No external API keys required for most commands.
 * cat/dog use free public CDNs. quote uses quotable.io. joke uses official-joke-api.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { COLORS, base } = require('../utils/embeds');

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
async function jsonFetch(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ══════════════════════════════════════════════════════════
//  8BALL
// ══════════════════════════════════════════════════════════
const BALL_RESPONSES = [
    // Positive
    '✅ It is certain.', '✅ It is decidedly so.', '✅ Without a doubt.',
    '✅ Yes, definitely.', '✅ You may rely on it.', '✅ As I see it, yes.',
    '✅ Most likely.', '✅ Outlook good.', '✅ Yes.', '✅ Signs point to yes.',
    // Neutral
    '🔮 Reply hazy, try again.', '🔮 Ask again later.', '🔮 Better not tell you now.',
    '🔮 Cannot predict now.', '🔮 Concentrate and ask again.',
    // Negative
    '❌ Don\'t count on it.', '❌ My reply is no.', '❌ My sources say no.',
    '❌ Outlook not so good.', '❌ Very doubtful.',
];

async function handle8Ball(ctx, args) {
    const question = args.join(' ').trim();
    const send = r => replyEmbed(ctx, base(COLORS.primary).setTitle('🎱 Magic 8 Ball')
        .addFields(
            { name: 'Question', value: question || '*(no question)*' },
            { name: 'Answer',   value: rand(BALL_RESPONSES) },
        ));
    return send();
}

// ══════════════════════════════════════════════════════════
//  COINFLIP
// ══════════════════════════════════════════════════════════
async function handleCoinflip(ctx) {
    const result = Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🎭';
    return replyEmbed(ctx, base(COLORS.gold).setTitle('🪙 Coin Flip').setDescription(`The coin landed on **${result}**!`));
}

// ══════════════════════════════════════════════════════════
//  DICE
// ══════════════════════════════════════════════════════════
async function handleDice(ctx, args) {
    const input = args[0] || '6';
    // Support NdN format (e.g. 2d6) or just a number
    const match = input.match(/^(\d+)d(\d+)$/i);
    let rolls, sides;
    if (match) {
        const count = Math.min(parseInt(match[1]), 20);
        sides = Math.min(parseInt(match[2]), 10000);
        rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    } else {
        sides = Math.min(Math.max(parseInt(input) || 6, 2), 10000);
        rolls = [Math.floor(Math.random() * sides) + 1];
    }
    const total = rolls.reduce((a, b) => a + b, 0);
    const desc  = rolls.length > 1
        ? `**Rolls:** ${rolls.join(', ')}\n**Total:** ${total}`
        : `You rolled a **${rolls[0]}**!`;
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎲 Dice Roll (d${sides})`).setDescription(desc));
}

// ══════════════════════════════════════════════════════════
//  ROCK PAPER SCISSORS
// ══════════════════════════════════════════════════════════
const RPS_CHOICES = ['rock 🪨', 'paper 📄', 'scissors ✂️'];
const RPS_BEATS   = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

async function handleRPS(ctx, args) {
    const choice = args[0]?.toLowerCase().replace(/[^a-z]/g, '');
    if (!['rock', 'paper', 'scissors'].includes(choice)) {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Choice')
            .setDescription('Choose `rock`, `paper`, or `scissors`.'));
    }
    const bot      = rand(['rock', 'paper', 'scissors']);
    const botLabel = RPS_CHOICES.find(r => r.startsWith(bot));
    const myLabel  = RPS_CHOICES.find(r => r.startsWith(choice));

    let result, color;
    if (choice === bot)             { result = "It's a tie! 🤝"; color = COLORS.warning; }
    else if (RPS_BEATS[choice] === bot) { result = 'You win! 🎉';   color = COLORS.success; }
    else                             { result = 'You lose! 😢';  color = COLORS.error;   }

    return replyEmbed(ctx, base(color).setTitle('🪨📄✂️ Rock Paper Scissors')
        .addFields(
            { name: 'Your Choice', value: myLabel,  inline: true },
            { name: 'My Choice',   value: botLabel, inline: true },
            { name: 'Result',      value: result,   inline: false },
        ));
}

// ══════════════════════════════════════════════════════════
//  CHOOSE
// ══════════════════════════════════════════════════════════
async function handleChoose(ctx, args) {
    const text    = args.join(' ');
    const options = text.split(/,|\bor\b/i).map(s => s.trim()).filter(Boolean);
    if (options.length < 2) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Too Few Options')
        .setDescription('Give me at least 2 options separated by commas or "or". Example: `.choose pizza, burger, tacos`'));
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🤔 Decision Made!')
        .setDescription(`I choose: **${rand(options)}**`));
}

// ══════════════════════════════════════════════════════════
//  REVERSE TEXT
// ══════════════════════════════════════════════════════════
async function handleReverse(ctx, args) {
    const text = args.join(' ');
    if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Give me some text to reverse.'));
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔄 Reversed').setDescription(`\`${text.split('').reverse().join('')}\``));
}

// ══════════════════════════════════════════════════════════
//  RATE
// ══════════════════════════════════════════════════════════
async function handleRate(ctx, args) {
    const thing = args.join(' ') || 'nothing';
    // Seed with thing string for consistent answers
    let seed = thing.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 11;
    const rating = seed;
    const bar    = '█'.repeat(rating) + '░'.repeat(10 - rating);
    return replyEmbed(ctx, base(COLORS.gold).setTitle(`📊 Rating: ${thing}`)
        .setDescription(`**${rating}/10** \`[${bar}]\``));
}

// ══════════════════════════════════════════════════════════
//  PP / SIZE  (silly)
// ══════════════════════════════════════════════════════════
async function handlePP(ctx, args) {
    const isInteraction = !!ctx.deferReply;
    const target = isInteraction
        ? (ctx.options?.getUser?.('user') || ctx.user)
        : (ctx.mentions?.users?.first() || ctx.author);
    let seed = target.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 21;
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`📏 ${target.username}'s PP Size`)
        .setDescription(`8${'='.repeat(seed)}D (${seed} cm)`));
}

// ══════════════════════════════════════════════════════════
//  SHIP
// ══════════════════════════════════════════════════════════
async function handleShip(ctx, args) {
    const isInteraction = !!ctx.deferReply;
    const mentions = isInteraction ? [] : (ctx.mentions?.users?.map(u => u) || []);
    const user1 = mentions[0] || (isInteraction ? ctx.options?.getUser?.('user1') : null);
    const user2 = mentions[1] || (isInteraction ? ctx.options?.getUser?.('user2') : null);
    if (!user1 || !user2) return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Mention two users: `.ship @User1 @User2`'));
    const seed = (BigInt(user1.id) + BigInt(user2.id)) % 101n;
    const pct  = Number(seed);
    const bar  = '💗'.repeat(Math.floor(pct / 10)) + '🖤'.repeat(10 - Math.floor(pct / 10));
    const name = user1.username.slice(0, Math.ceil(user1.username.length / 2))
               + user2.username.slice(Math.floor(user2.username.length / 2));
    return replyEmbed(ctx, base(COLORS.primary)
        .setTitle(`💕 Shipping ${user1.username} & ${user2.username}`)
        .setDescription(`**Compatibility: ${pct}%**\n${bar}\n\n💑 Ship name: **${name}**`));
}

// ══════════════════════════════════════════════════════════
//  QUOTE
// ══════════════════════════════════════════════════════════
async function handleQuote(ctx) {
    try {
        const data = await jsonFetch('https://api.quotable.io/random?maxLength=200');
        return replyEmbed(ctx, base(COLORS.primary).setTitle('💬 Random Quote')
            .setDescription(`"${data.content}"\n\n— **${data.author}**`));
    } catch {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Could not fetch a quote right now.'));
    }
}

// ══════════════════════════════════════════════════════════
//  JOKE
// ══════════════════════════════════════════════════════════
async function handleJoke(ctx) {
    try {
        const data = await jsonFetch('https://official-joke-api.appspot.com/random_joke');
        return replyEmbed(ctx, base(COLORS.primary).setTitle('😂 Random Joke')
            .setDescription(`**${data.setup}**\n\n||${data.punchline}||`));
    } catch {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Could not fetch a joke right now.'));
    }
}

// ══════════════════════════════════════════════════════════
//  CAT
// ══════════════════════════════════════════════════════════
async function handleCat(ctx) {
    try {
        const data = await jsonFetch('https://api.thecatapi.com/v1/images/search');
        return replyEmbed(ctx, new EmbedBuilder().setTitle('🐱 Random Cat').setImage(data[0].url).setColor(COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' }));
    } catch {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Could not fetch a cat right now.'));
    }
}

// ══════════════════════════════════════════════════════════
//  DOG
// ══════════════════════════════════════════════════════════
async function handleDog(ctx) {
    try {
        const data = await jsonFetch('https://dog.ceo/api/breeds/image/random');
        return replyEmbed(ctx, new EmbedBuilder().setTitle('🐶 Random Dog').setImage(data.message).setColor(COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' }));
    } catch {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Could not fetch a dog right now.'));
    }
}

// ══════════════════════════════════════════════════════════
//  TIC-TAC-TOE
// ══════════════════════════════════════════════════════════
const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function tttCheck(b) {
    for (const [a,c,d] of TTT_WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
    if (b.every(c => c !== null)) return 'draw';
    return null;
}

function tttBest(b, player) {
    const res = tttCheck(b);
    if (res === 'O') return { score: 10 };
    if (res === 'X') return { score: -10 };
    if (res === 'draw') return { score: 0 };
    const moves = [];
    for (let i = 0; i < 9; i++) {
        if (b[i]) continue;
        b[i] = player;
        const s = tttBest(b, player === 'O' ? 'X' : 'O').score;
        b[i] = null;
        moves.push({ i, score: s });
    }
    return player === 'O'
        ? moves.reduce((a, m) => m.score > a.score ? m : a)
        : moves.reduce((a, m) => m.score < a.score ? m : a);
}

function tttComponents(board) {
    const labels = board.map(c => c === 'X' ? '❌' : c === 'O' ? '⭕' : '⬜');
    return [0, 3, 6].map(offset =>
        new ActionRowBuilder().addComponents(
            [0, 1, 2].map(i => new ButtonBuilder()
                .setCustomId(`ttt_${offset + i}`)
                .setLabel(labels[offset + i])
                .setStyle(board[offset + i] ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setDisabled(!!board[offset + i])
            )
        )
    );
}

const tttGames = new Map(); // channelId -> gameState

async function handleTicTacToe(ctx, args) {
    const isInteraction = !!ctx.deferReply;
    const challenger    = isInteraction ? ctx.user : ctx.author;
    const opponent      = isInteraction
        ? ctx.options?.getUser?.('user')
        : ctx.mentions?.users?.first();

    const channelId = isInteraction ? ctx.channelId : ctx.channel.id;
    if (tttGames.has(channelId)) {
        const msg = '❌ A TicTacToe game is already active in this channel.';
        return isInteraction ? ctx.reply({ content: msg, ephemeral: true }) : ctx.reply(msg);
    }

    const vsBot    = !opponent || opponent.id === challenger.id || opponent.bot;
    const xPlayer  = challenger;
    const oPlayer  = vsBot ? null : opponent;

    const board    = Array(9).fill(null);
    const gameState = {
        board, xPlayer, oPlayer, vsBot,
        currentTurn: 'X',
        channelId, startedAt: Date.now(),
    };
    tttGames.set(channelId, gameState);

    const embed = new EmbedBuilder()
        .setTitle('❌⭕ TicTacToe')
        .setDescription(
            vsBot
                ? `${xPlayer} (**❌**) vs **⭕ Kaido**\n\nYour turn! (❌)`
                : `${xPlayer} (**❌**) vs ${oPlayer} (**⭕**)\n\n${xPlayer}'s turn (❌)`
        )
        .setColor(COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' });

    let sent;
    if (isInteraction) {
        await ctx.reply({ embeds: [embed], components: tttComponents(board) });
        sent = await ctx.fetchReply();
    } else {
        sent = await ctx.channel.send({ embeds: [embed], components: tttComponents(board) });
    }

    const collector = sent.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000,
        filter: i => {
            const gs = tttGames.get(channelId);
            if (!gs) { i.deferUpdate(); return false; }
            const validUser = gs.currentTurn === 'X'
                ? i.user.id === gs.xPlayer.id
                : (gs.vsBot ? false : i.user.id === gs.oPlayer?.id);
            if (!validUser) {
                i.reply({ content: '❌ It\'s not your turn.', ephemeral: true });
                return false;
            }
            return true;
        },
    });

    collector.on('collect', async i => {
        const gs  = tttGames.get(channelId);
        if (!gs) return i.deferUpdate();
        const idx = parseInt(i.customId.replace('ttt_', ''));
        if (gs.board[idx]) return i.deferUpdate();

        gs.board[idx] = gs.currentTurn;
        const winner = tttCheck(gs.board);

        if (!winner && gs.vsBot && gs.currentTurn === 'X') {
            // Bot plays
            gs.currentTurn = 'O';
            const best = tttBest([...gs.board], 'O');
            if (best.i !== undefined) gs.board[best.i] = 'O';
        }

        const result = tttCheck(gs.board);
        let desc;

        if (result) {
            tttGames.delete(channelId);
            collector.stop('done');
            if (result === 'draw') {
                desc = "It's a **draw**! 🤝";
            } else if (result === 'X') {
                desc = `**${gs.xPlayer.username}** wins! 🎉`;
            } else {
                desc = gs.vsBot ? '**Kaido** wins! 🤖' : `**${gs.oPlayer?.username}** wins! 🎉`;
            }
        } else {
            if (!gs.vsBot) gs.currentTurn = gs.currentTurn === 'X' ? 'O' : 'X';
            const nextPlayer = gs.currentTurn === 'X' ? gs.xPlayer : gs.oPlayer;
            desc = gs.vsBot
                ? `${gs.xPlayer}'s turn (❌)`
                : `${nextPlayer}'s turn (${gs.currentTurn === 'X' ? '❌' : '⭕'})`;
        }

        const updEmbed = new EmbedBuilder()
            .setTitle('❌⭕ TicTacToe')
            .setDescription(desc)
            .setColor(result && result !== 'draw' ? COLORS.success : COLORS.primary)
            .setTimestamp().setFooter({ text: 'Kaido' });

        await i.update({
            embeds: [updEmbed],
            components: result ? tttComponents(gs.board).map(r => { r.components.forEach(b => b.setDisabled(true)); return r; }) : tttComponents(gs.board),
        });
    });

    collector.on('end', (_, reason) => {
        if (reason !== 'done') {
            tttGames.delete(channelId);
            sent.edit({ components: [] }).catch(() => {});
        }
    });
}

// ══════════════════════════════════════════════════════════
//  WOULD YOU RATHER
// ══════════════════════════════════════════════════════════
const WYR = [
    ['have the ability to fly', 'be invisible'],
    ['always be too hot', 'always be too cold'],
    ['have unlimited money', 'have unlimited time'],
    ['be able to speak every language', 'play every instrument'],
    ['never use social media again', 'never watch TV or movies again'],
    ['be incredibly smart', 'be incredibly attractive'],
    ['lose all your old memories', 'never be able to make new ones'],
    ['live without music', 'live without TV'],
    ['always be late', 'always be early'],
    ['be able to breathe underwater', 'fly in the sky'],
];

async function handleWouldYouRather(ctx) {
    const [a, b] = rand(WYR);
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🤔 Would You Rather...')
        .setDescription(`🅰️ **${a}**\n\n**or**\n\n🅱️ **${b}**`));
}

// ══════════════════════════════════════════════════════════
//  MEME (uses reddit JSON feed, no key needed)
// ══════════════════════════════════════════════════════════
const MEME_SUBS = ['memes', 'dankmemes', 'me_irl', 'funny'];

async function handleMeme(ctx) {
    try {
        const sub  = rand(MEME_SUBS);
        const data = await jsonFetch(`https://www.reddit.com/r/${sub}/random/.json`);
        const post = data[0]?.data?.children?.[0]?.data;
        if (!post || !post.url) throw new Error('no post');
        return replyEmbed(ctx, new EmbedBuilder()
            .setTitle(post.title.slice(0, 256))
            .setImage(post.url)
            .setURL(`https://reddit.com${post.permalink}`)
            .setColor(COLORS.primary).setTimestamp().setFooter({ text: `r/${sub} • Kaido` }));
    } catch {
        return replyEmbed(ctx, base(COLORS.error).setTitle('❌').setDescription('Could not fetch a meme right now.'));
    }
}

// ══════════════════════════════════════════════════════════
//  GENERIC REPLY HELPER  (works for both message & interaction)
// ══════════════════════════════════════════════════════════
async function replyEmbed(ctx, embed) {
    const isInteraction = !!ctx.deferReply;
    const payload = { embeds: [embed] };
    if (isInteraction) {
        if (ctx.deferred) return ctx.editReply(payload);
        return ctx.reply(payload);
    }
    return ctx.channel.send(payload);
}

// ══════════════════════════════════════════════════════════
//  DISPATCH
// ══════════════════════════════════════════════════════════
async function handleFunCommand(ctx, command, args) {
    switch (command) {
        case '8ball':          return handle8Ball(ctx, args);
        case 'coinflip':
        case 'flip':           return handleCoinflip(ctx);
        case 'dice':
        case 'roll':           return handleDice(ctx, args);
        case 'rps':            return handleRPS(ctx, args);
        case 'choose':
        case 'pick':           return handleChoose(ctx, args);
        case 'reverse':        return handleReverse(ctx, args);
        case 'rate':           return handleRate(ctx, args);
        case 'pp':             return handlePP(ctx, args);
        case 'ship':           return handleShip(ctx, args);
        case 'quote':          return handleQuote(ctx);
        case 'joke':           return handleJoke(ctx);
        case 'cat':            return handleCat(ctx);
        case 'dog':            return handleDog(ctx);
        case 'tictactoe':
        case 'ttt':            return handleTicTacToe(ctx, args);
        case 'wyr':
        case 'wouldyourather': return handleWouldYouRather(ctx);
        case 'meme':           return handleMeme(ctx);
        default: return null;
    }
}

const FUN_COMMANDS = new Set([
    '8ball','coinflip','flip','dice','roll','rps','choose','pick',
    'reverse','rate','pp','ship','quote','joke','cat','dog',
    'tictactoe','ttt','wyr','wouldyourather','meme',
]);

module.exports = { handleFunCommand, FUN_COMMANDS };
