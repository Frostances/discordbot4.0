const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { COLORS, base } = require('../utils/embeds');
const { getGuildDb, getUserDb } = require('../modules/database');
const { Readable } = require('node:stream');

// ══════════════════════════════════════════════════════════
// API KEYS — Paste your keys here if config/apikeys.js is missing
// ══════════════════════════════════════════════════════════
let API_KEYS;
try {
  API_KEYS = require('../config/apikeys');
} catch {
  API_KEYS = {
    GOOGLE_API_KEY: '',
    GOOGLE_CX: '',
    GIPHY_API_KEY: '',
    TENOR_API_KEY: '',
    PERSPECTIVE_API_KEY: '',
    RAWG_API_KEY: '',
    OMDB_API_KEY: '',
    OCR_API_KEY: '',
    REMOVEBG_API_KEY: '',
    WOLFRAM_API_KEY: '',
  };
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function textFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function bufferFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function replyEmbed(ctx, embed, files = []) {
 const isInteraction = !!ctx.deferReply;
 const payload = { embeds: [embed] };
 if (files.length) payload.files = files;
 if (isInteraction) {
 if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
 return ctx.reply(payload);
 }
 return ctx.channel.send(payload);
}

// Extract image URL from command args, replied message, attachments, or recent messages
async function resolveImageUrl(ctx, args) {
  // 1. Check args for a direct URL
  const urlArg = args.find(a => /^https?:\/\//.test(a));
  if (urlArg) return urlArg;

  // 2. Check if this is a reply to a message with an image/video
  const referenced = ctx.reference || ctx.message?.reference;
  if (referenced?.messageId) {
    try {
      const refMsg = await ctx.channel.messages.fetch(referenced.messageId);
      const imgAtt = refMsg.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
      if (imgAtt) return imgAtt.url;
      const imgEmbed = refMsg.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (imgEmbed) return imgEmbed.image?.url || imgEmbed.thumbnail?.url;
    } catch {}
  }

  // 3. Check if command message itself has attachments
  const msg = ctx.message || ctx;
  if (msg?.attachments?.size > 0) {
    const imgAtt = msg.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
    if (imgAtt) return imgAtt.url;
  }

  // 4. Check last few messages in channel for images
  try {
    const messages = await ctx.channel.messages.fetch({ limit: 10 });
    for (const m of messages.values()) {
      if (m.id === ctx.id || m.id === ctx.message?.id) continue;
      const imgAtt = m.attachments.find(a => a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)(\?|$)/i.test(a.url));
      if (imgAtt) return imgAtt.url;
      const imgEmbed = m.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (imgEmbed) return imgEmbed.image?.url || imgEmbed.thumbnail?.url;
    }
  } catch {}

  return null;
}

// ══════════════════════════════════════════════════════════
// 1. LYRICS
// ══════════════════════════════════════════════════════════
async function handleLyrics(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,lyrics <artist> - <song>` or `,lyrics <song>`'));

  // Try lyrist API first (most reliable)
  try {
    let artist = query, title = query;
    if (query.includes(' - ')) { [artist, title] = query.split(' - ').map(s => s.trim()); }
    const data = await jsonFetch(`https://lyrist.vercel.app/api/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (data?.lyrics) {
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${data.title || title} — ${data.artist || artist}`)
        .setDescription(data.lyrics.length > 4000 ? data.lyrics.slice(0, 4000) + '...' : data.lyrics)
        .setFooter({ text: 'Powered by Lyrist' }));
    }
  } catch (e) { console.log('[Lyrics] Lyrist failed:', e.message); }

  // Fallback to lyrics.ovh
  try {
    const [artist, title] = query.includes(' - ') ? query.split(' - ').map(s => s.trim()) : [query, query];
    const data = await jsonFetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    if (data?.lyrics) {
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${title || query}`)
        .setDescription(data.lyrics.length > 4000 ? data.lyrics.slice(0, 4000) + '...' : data.lyrics)
        .setFooter({ text: 'Powered by lyrics.ovh' }));
    }
  } catch (e) { console.log('[Lyrics] lyrics.ovh failed:', e.message); }

  // Final fallback: try lyrics.ovh suggest endpoint
  try {
    const data = await jsonFetch(`https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`);
    if (data?.data?.length) {
      const song = data.data[0];
      const lyricsData = await jsonFetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(song.artist.name)}/${encodeURIComponent(song.title)}`);
      if (lyricsData?.lyrics) {
        return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎵 ${song.title} — ${song.artist.name}`)
          .setDescription(lyricsData.lyrics.length > 4000 ? lyricsData.lyrics.slice(0, 4000) + '...' : lyricsData.lyrics)
          .setFooter({ text: 'Powered by lyrics.ovh' }));
      }
    }
  } catch (e) { console.log('[Lyrics] suggest failed:', e.message); }

  return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Not Found').setDescription('Could not find lyrics. Try `artist - song` format, e.g. `,lyrics The Weeknd - Blinding Lights`'));
}

// ══════════════════════════════════════════════════════════
// 2. DUCKDUCKGO SEARCH
// ══════════════════════════════════════════════════════════
async function handleDuckDuckGo(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,duckduckgo <query>`'));
  try {
    const html = await textFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const results = [];
    const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = regex.exec(html)) !== null && results.length < 5) {
      const url = m[1].replace(/&amp;/g, '&');
      const title = m[2].replace(/<\/?[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
      if (title && url && !url.includes('duckduckgo.com')) results.push({ title, url });
    }
    if (!results.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No results found.'));
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🔍 DuckDuckGo: ${query}`)
      .setDescription(results.map((r, i) => `**${i + 1}.** [${r.title}](${r.url})`).join('\n'))
      .setFooter({ text: 'Results from DuckDuckGo' }));
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Search Failed').setDescription('Could not perform search.'));
  }
}

// ══════════════════════════════════════════════════════════
// 3. BLACKTEA (3-letter word game)
// ══════════════════════════════════════════════════════════
const blackteaGames = new Map();
const THREE_LETTER_WORDS = [
  'ace','act','add','age','aid','aim','air','ale','all','and','ant','any','ape','apt','arc','are','ark','arm','art','ash',
  'ask','ate','awe','axe','bad','bag','ban','bar','bat','bay','bed','bee','beg','bet','bid','big','bin','bit','bob','bog',
  'boo','bow','box','boy','bra','bud','bug','bum','bun','bus','but','buy','bye','cab','cad','cam','can','cap','car','cat',
  'cop','cot','cow','coy','cry','cub','cue','cup','cut','dad','dam','day','den','dew','did','die','dig','dim','din','dip',
  'dog','dot','dry','dub','dud','due','dug','dun','duo','dye','ear','eat','ebb','eel','egg','ego','elf','elk','elm','end',
  'era','eve','eye','fad','fan','far','fat','fax','fay','fed','fee','fen','few','fig','fin','fir','fit','fix','flu','fly',
  'fog','foe','fop','for','fox','fro','fry','fun','fur','gab','gad','gag','gal','gap','gas','gay','gee','gel','gem',
  'get','gig','gin','god','got','gum','gun','gut','guy','gym','had','hag','ham','has','hat','hay','hem','hen','her','hew',
  'hex','hid','him','hip','his','hit','hob','hoe','hog','hop','hot','how','hub','hue','hug','huh','hum','hut','ice','icy',
  'ink','inn','ion','ire','irk','ivy','jab','jag','jam','jar','jaw','jay','jet','jew','jig','job','jog','jot','joy','jug',
  'jut','keg','ken','key','kid','kin','kit','lab','lad','lag','lam','lap','law','lax','lay','lea','led','lee','leg','let',
  'lid','lie','lip','lit','lob','log','lop','lot','low','lox','lug','lux','lye','mad','man','map','mar','mat','maw','max',
  'may','men','met','mew','mid','mil','mix','mob','mod','mop','mow','mud','mug','mum','nab','nag','nap','nay','nee','net',
  'new','nil','nip','nod','nor','not','now','nub','nun','nut','oaf','oak','oar','oat','odd','ode','off','oft','ohm','oho',
  'oil','old','one','ooh','opt','orb','ore','our','out','ova','owe','owl','own','pad','pal','pan','par','pat','paw','pay',
  'pea','peg','pen','pep','per','pet','pew','phi','pic','pie','pig','pin','pip','pit','ply','pod','poi','pop','pot','pow',
  'pox','pro','pry','pub','pug','pun','pup','pus','put','rag','rah','ram','ran','rap','rat','raw','ray','red','ref','rep',
  'rev','rib','rid','rig','rim','rip','rob','rod','roe','rot','row','rub','rue','rug','rum','run','rut','rye','sac','sad',
  'sag','sap','sat','saw','sax','say','sea','sec','see','set','sew','sex','shy','sib','sic','sin','sip','sir','sit','six',
  'ski','sky','sly','sob','sod','sol','son','sop','sot','sow','soy','spa','spy','sty','sub','sue','sum','sun','sup','tab',
  'tad','tag','tam','tan','tap','tar','tat','tax','tea','tee','ten','the','thy','tic','tie','tin','tip','toe','tog','tom',
  'ton','too','top','tor','tot','tow','toy','try','tub','tug','tun','tux','two','use','van','vat','vet','vex','via','vie',
  'vim','vow','wad','wag','wan','war','was','wax','way','web','wed','wee','wet','who','why','wig','win','wit','woe','won',
  'woo','wow','wry','yak','yam','yap','yaw','yea','yen','yep','yes','yet','yew','yip','yod','yon','you','yow','yuk','yum',
  'yup','zag','zap','zed','zen','zip','zit','zoo'
];

async function handleBlacktea(ctx, args) {
  const channelId = ctx.channel?.id || ctx.channelId;
  if (blackteaGames.has(channelId)) {
    const game = blackteaGames.get(channelId);
    const rem = Math.max(0, 60 - Math.floor((Date.now() - game.startTime) / 1000));
    return replyEmbed(ctx, base(COLORS.warning).setTitle('☕ Blacktea Active')
      .setDescription(`A game is already running! **${rem}s** remaining.`));
  }
  const word = rand(THREE_LETTER_WORDS);
  const game = { word, guesses: [], active: true, startTime: Date.now(), winner: null };
  blackteaGames.set(channelId, game);
  replyEmbed(ctx, base(COLORS.primary).setTitle('☕ Blacktea')
    .setDescription('I\'m thinking of a **3-letter word**...\nType your guess in chat! First to find it wins!\n\n⏰ **60 seconds**')
    .setFooter({ text: 'Hint: it\'s a real English word!' }));
  const filter = m => m.content.length === 3 && /^[a-zA-Z]+$/.test(m.content) && !m.author.bot;
  const collector = ctx.channel.createMessageCollector({ filter, time: 60000 });
  collector.on('collect', async m => {
    const guess = m.content.toLowerCase();
    if (game.guesses.includes(guess)) return;
    game.guesses.push(guess);
    if (guess === game.word) {
      game.active = false; game.winner = m.author.id;
      blackteaGames.delete(channelId); collector.stop('won');
      const udb = getUserDb(ctx.guild.id, m.author.id);
      udb.data.blackteaWins = (udb.data.blackteaWins || 0) + 1; udb.save();
      return replyEmbed(ctx, base(COLORS.success).setTitle('☕ Blacktea')
        .setDescription(`🏆 **${m.author.username}** found the word **\`${game.word.toUpperCase()}\`**!\nGuesses: ${game.guesses.length}`));
    }
  });
  collector.on('end', (_, reason) => {
    if (reason !== 'won') {
      blackteaGames.delete(channelId);
      replyEmbed(ctx, base(COLORS.error).setTitle('☕ Blacktea Over')
        .setDescription(`Time\'s up! The word was **\`${game.word.toUpperCase()}\`**.\nGuesses: ${game.guesses.length}`));
    }
  });
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 4. QUOTE (message quoting)
// ══════════════════════════════════════════════════════════
async function handleQuote(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  let targetMsg = null;
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);

  try {
    // 1. Message link provided
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    }
    // 2. Numeric message ID provided
    else if (/^\d+$/.test(input) && input.length >= 10) {
      targetMsg = await ctx.channel.messages.fetch(input).catch(() => null);
    }
    // 3. Command is a reply to another message → quote the REPLIED message
    else if (ctx.reference?.messageId || ctx.message?.reference?.messageId) {
      const refId = ctx.reference?.messageId || ctx.message?.reference?.messageId;
      targetMsg = await ctx.channel.messages.fetch(refId).catch(() => null);
    }
    // 4. Mention a user → quote their most recent message
    else {
      const messages = await ctx.channel.messages.fetch({ limit: 15 });
      const mention = isInteraction ? null : ctx.mentions?.users?.first();
      if (mention) {
        targetMsg = messages.find(m => m.author.id === mention.id && !m.author.bot);
      }
      // 5. No mention → quote the most recent non-bot message that isn't this command
      if (!targetMsg) {
        const cmdId = ctx.id || ctx.message?.id;
        targetMsg = messages.find(m => 
          !m.author.bot && 
          m.id !== cmdId &&
          m.content?.length > 0
        );
      }
    }
  } catch (err) {
    console.error('[Quote] Fetch error:', err.message);
  }

  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Message Not Found')
    .setDescription('Reply to a message with `,quote` or provide a message link/ID.\nUsage: `,quote <message-link>`'));

  try {
    const Canvas = require('@napi-rs/canvas');
    const canvas = Canvas.createCanvas(1200, 675);
    const ctx2d = canvas.getContext('2d');

    // Try to load background image from message attachments
    let bgImage = null;
    if (targetMsg.attachments.size > 0) {
      const imgAtt = targetMsg.attachments.find(a => a.contentType?.startsWith('image/'));
      if (imgAtt) {
        try { bgImage = await Canvas.loadImage(imgAtt.url); } catch {}
      }
    }
    if (!bgImage && targetMsg.embeds.length > 0) {
      const embedImg = targetMsg.embeds.find(e => e.image?.url || e.thumbnail?.url);
      if (embedImg) {
        try { bgImage = await Canvas.loadImage(embedImg.image?.url || embedImg.thumbnail?.url); } catch {}
      }
    }

    if (bgImage) {
      const imgAspect = bgImage.width / bgImage.height;
      const canvasAspect = 660 / 675;
      let sx, sy, sWidth, sHeight;
      if (imgAspect > canvasAspect) {
        sHeight = bgImage.height;
        sWidth = sHeight * canvasAspect;
        sx = (bgImage.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = bgImage.width;
        sHeight = sWidth / canvasAspect;
        sx = 0;
        sy = (bgImage.height - sHeight) / 2;
      }
      ctx2d.drawImage(bgImage, sx, sy, sWidth, sHeight, 0, 0, 660, 675);

      const gradLeft = ctx2d.createLinearGradient(0, 0, 660, 0);
      gradLeft.addColorStop(0, 'rgba(0,0,0,0.3)');
      gradLeft.addColorStop(0.7, 'rgba(0,0,0,0.6)');
      gradLeft.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx2d.fillStyle = gradLeft;
      ctx2d.fillRect(0, 0, 660, 675);
    } else {
      // No image attachment — use user's avatar as blurred background
      try {
        const avatarUrl = targetMsg.author.displayAvatarURL({ format: 'png', size: 512 });
        bgImage = await Canvas.loadImage(avatarUrl);
        ctx2d.filter = 'blur(8px) brightness(0.4)';
        ctx2d.drawImage(bgImage, -100, -100, 860, 875);
        ctx2d.filter = 'none';
      } catch {
        ctx2d.fillStyle = '#0a0a0a';
        ctx2d.fillRect(0, 0, 660, 675);
      }
    }

    // Right side solid dark
    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(660, 0, 540, 675);

    // Smooth gradient transition
    const gradCenter = ctx2d.createLinearGradient(500, 0, 800, 0);
    gradCenter.addColorStop(0, 'rgba(10,10,10,0)');
    gradCenter.addColorStop(1, 'rgba(10,10,10,1)');
    ctx2d.fillStyle = gradCenter;
    ctx2d.fillRect(500, 0, 300, 675);

    // Top-left: circular avatar + display name
    try {
      const avatarUrl = targetMsg.author.displayAvatarURL({ format: 'png', size: 256 });
      const avatarImg = await Canvas.loadImage(avatarUrl);
      const avSize = 70;
      const avX = 40;
      const avY = 40;
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.arc(avX + avSize/2, avY + avSize/2, avSize/2, 0, Math.PI * 2);
      ctx2d.closePath();
      ctx2d.clip();
      ctx2d.drawImage(avatarImg, avX, avY, avSize, avSize);
      ctx2d.restore();

      const displayName = targetMsg.member?.displayName || targetMsg.author.displayName || targetMsg.author.username;
      ctx2d.fillStyle = '#ffffff';
      ctx2d.font = 'bold 24px sans-serif';
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(displayName, avX + avSize + 15, avY + avSize/2);
    } catch {}

    // === DYNAMIC FONT SIZING FOR QUOTE TEXT ===
    const text = targetMsg.content || '*No text content*';
    const username = targetMsg.author.username;
    const maxWidth = 460;
    const maxHeight = 520;
    const centerX = 930;

    // Binary search for optimal font size
    let minFont = 16;
    let maxFont = 56;
    let bestFont = minFont;
    let bestLines = [];

    while (minFont <= maxFont) {
      const midFont = Math.floor((minFont + maxFont) / 2);
      ctx2d.font = `bold ${midFont}px sans-serif`;
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const word of words) {
        const testLine = line + word + ' ';
        const metrics = ctx2d.measureText(testLine);
        if (metrics.width > maxWidth && line !== '') {
          lines.push(line.trim());
          line = word + ' ';
        } else {
          line = testLine;
        }
      }
      lines.push(line.trim());

      const lineHeight = midFont * 1.5;
      const attributionHeight = Math.max(16, midFont * 0.55);
      const totalHeight = lines.length * lineHeight + attributionHeight + 30;

      if (totalHeight <= maxHeight) {
        bestFont = midFont;
        bestLines = lines;
        minFont = midFont + 1;
      } else {
        maxFont = midFont - 1;
      }
    }

    // Render with best font size
    const fontSize = bestFont;
    const lineHeight = fontSize * 1.5;
    const attributionHeight = Math.max(16, fontSize * 0.55);
    const totalHeight = bestLines.length * lineHeight + attributionHeight + 30;
    let startY = (675 - totalHeight) / 2 + lineHeight / 2;

    ctx2d.fillStyle = '#ffffff';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.font = `bold ${fontSize}px sans-serif`;

    for (let i = 0; i < bestLines.length; i++) {
      ctx2d.fillText(bestLines[i], centerX, startY + i * lineHeight);
    }

    // Attribution with username
    ctx2d.fillStyle = '#888888';
    ctx2d.font = `italic ${Math.max(16, fontSize * 0.55)}px sans-serif`;
    ctx2d.fillText(`— ${username}`, centerX, startY + bestLines.length * lineHeight + 20);

    // Send as plain file (no embed wrapper)
    const buffer = await canvas.encode('png');
    const att = new AttachmentBuilder(buffer, { name: 'quote.png' });
    return ctx.channel.send({ files: [att] });
  } catch (err) {
    console.error('[Quote] Canvas error:', err.message);
    // Fallback to simple embed
    const embed = base(COLORS.primary)
      .setAuthor({ name: targetMsg.author.tag, iconURL: targetMsg.author.displayAvatarURL() })
      .setDescription(targetMsg.content || '*No text content*')
      .setTimestamp(targetMsg.createdTimestamp)
      .setFooter({ text: `#${targetMsg.channel.name}` });
    if (targetMsg.attachments.size > 0) {
      const img = targetMsg.attachments.find(a => a.contentType?.startsWith('image/'));
      if (img) embed.setImage(img.url);
    }
    return replyEmbed(ctx, embed);
  }
}

// 5. TIC-TAC-TOE (with stats & leaderboard)
// ══════════════════════════════════════════════════════════
const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function tttCheck(b) {
  for (const [a,c,d] of TTT_WINS) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  if (b.every(c => c !== null)) return 'draw';
  return null;
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

const tttGames = new Map();

async function handleTicTacToe(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const challenger = isInteraction ? ctx.user : ctx.author;
  const channelId = isInteraction ? ctx.channelId : ctx.channel.id;

  // ── Stats ──
  if (args[0]?.toLowerCase() === 'stats') {
    const target = isInteraction ? (ctx.options?.getUser?.('user') || ctx.user) : (ctx.mentions?.users?.first() || ctx.author);
    const udb = getUserDb(ctx.guild.id, target.id);
    const stats = { wins: udb.data.tttWins || 0, losses: udb.data.tttLosses || 0, draws: udb.data.tttDraws || 0 };
    const embed = new EmbedBuilder()
      .setTitle(`❌⭕ TicTacToe — ${target.username}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor('#5865F2')
      .setDescription(
        `-# WINS\n**${stats.wins}**\n\n` +
        `-# LOSSES\n**${stats.losses}**\n\n` +
        `-# DRAWS\n**${stats.draws}**\n\n` +
        `-# TOTAL GAMES\n**${stats.wins + stats.losses + stats.draws}**`
      );
    return replyEmbed(ctx, embed);
  }

  // ── Leaderboard ──
  if (args[0]?.toLowerCase() === 'leaderboard') {
    const db = getGuildDb(ctx.guild.id);
    const users = db.data.users || {};
    const sorted = Object.entries(users).filter(([, d]) => (d.tttWins || 0) > 0).sort((a, b) => (b[1].tttWins || 0) - (a[1].tttWins || 0)).slice(0, 10);
    if (sorted.length === 0) {
      return replyEmbed(ctx, new EmbedBuilder().setTitle('🏆 TicTacToe Leaderboard').setDescription('No wins recorded yet.').setColor('#5865F2'));
    }
    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const [uid, d] = sorted[i];
      desc += `${i + 1}- <@${uid}> — **${d.tttWins || 0}**\n`;
    }
    return replyEmbed(ctx, new EmbedBuilder().setTitle('🏆 TicTacToe Leaderboard').setDescription(desc).setColor('#5865F2'));
  }

  if (tttGames.has(channelId)) {
    const msg = '❌ A TicTacToe game is already active in this channel.';
    return isInteraction ? ctx.reply({ content: msg, ephemeral: true }) : ctx.reply(msg);
  }

  // ── Require an opponent mention — no bot play ──
  const opponent = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
  if (!opponent || opponent.id === challenger.id) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Opponent')
      .setDescription('Mention a user to play against.\nUsage: `,tictactoe @user`\n\nYou cannot play against bots or yourself.'));
  }
  if (opponent.bot) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid Opponent')
      .setDescription('You cannot play against bots. Mention a real user.'));
  }

  const xPlayer = challenger, oPlayer = opponent;
  const board = Array(9).fill(null);
  const gameState = { board, xPlayer, oPlayer, currentTurn: 'X', channelId, startedAt: Date.now(), lastMoveAt: Date.now() };
  tttGames.set(channelId, gameState);

  const embed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setColor(COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' })
    .setDescription(`${xPlayer} (**❌**) vs ${oPlayer} (**⭕**)\n\n${xPlayer}'s turn (❌)\n⏰ 30s per move`);

  let sent;
  if (isInteraction) { await ctx.reply({ embeds: [embed], components: tttComponents(board) }); sent = await ctx.fetchReply(); }
  else { sent = await ctx.channel.send({ embeds: [embed], components: tttComponents(board) }); }

  // ── 30-second turn timer ──
  const turnTimer = setInterval(async () => {
    const gs = tttGames.get(channelId);
    if (!gs) { clearInterval(turnTimer); return; }
    const elapsed = Date.now() - gs.lastMoveAt;
    if (elapsed >= 30000) {
      tttGames.delete(channelId); clearInterval(turnTimer);
      const forfeitPlayer = gs.currentTurn === 'X' ? gs.xPlayer : gs.oPlayer;
      const winner = gs.currentTurn === 'X' ? gs.oPlayer : gs.xPlayer;
      const wdb = getUserDb(ctx.guild.id, winner.id);
      wdb.data.tttWins = (wdb.data.tttWins || 0) + 1; wdb.save();
      const ldb = getUserDb(ctx.guild.id, forfeitPlayer.id);
      ldb.data.tttLosses = (ldb.data.tttLosses || 0) + 1; ldb.save();
      const endEmbed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setColor(COLORS.success).setTimestamp().setFooter({ text: 'Kaido' })
        .setDescription(`⏰ **${forfeitPlayer.username}** ran out of time!\n\n**${winner.username}** wins by forfeit! 🎉`);
      await sent.edit({ embeds: [endEmbed], components: tttComponents(gs.board).map(r => { r.components.forEach(b => b.setDisabled(true)); return r; }) }).catch(() => {});
    }
  }, 5000);

  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button, time: 5 * 60 * 1000,
    filter: i => {
      const gs = tttGames.get(channelId);
      if (!gs) { i.deferUpdate(); return false; }
      const validUser = gs.currentTurn === 'X' ? i.user.id === gs.xPlayer.id : i.user.id === gs.oPlayer.id;
      if (!validUser) { i.reply({ content: '❌ It\'s not your turn.', ephemeral: true }); return false; }
      return true;
    },
  });

  collector.on('collect', async i => {
    const gs = tttGames.get(channelId);
    if (!gs) return i.deferUpdate();
    const idx = parseInt(i.customId.replace('ttt_', ''));
    if (gs.board[idx]) return i.deferUpdate();
    gs.board[idx] = gs.currentTurn;
    gs.lastMoveAt = Date.now();

    const result = tttCheck(gs.board);
    let desc;
    if (result) {
      tttGames.delete(channelId); clearInterval(turnTimer); collector.stop('done');
      if (result === 'draw') {
        desc = "It\'s a **draw**! 🤝";
        const xdb = getUserDb(ctx.guild.id, gs.xPlayer.id); xdb.data.tttDraws = (xdb.data.tttDraws || 0) + 1; xdb.save();
        const odb = getUserDb(ctx.guild.id, gs.oPlayer.id); odb.data.tttDraws = (odb.data.tttDraws || 0) + 1; odb.save();
      } else if (result === 'X') {
        desc = `**${gs.xPlayer.username}** wins! 🎉`;
        const udb = getUserDb(ctx.guild.id, gs.xPlayer.id); udb.data.tttWins = (udb.data.tttWins || 0) + 1; udb.save();
        const odb = getUserDb(ctx.guild.id, gs.oPlayer.id); odb.data.tttLosses = (odb.data.tttLosses || 0) + 1; odb.save();
      } else {
        desc = `**${gs.oPlayer.username}** wins! 🎉`;
        const udb = getUserDb(ctx.guild.id, gs.oPlayer.id); udb.data.tttWins = (udb.data.tttWins || 0) + 1; udb.save();
        const xdb = getUserDb(ctx.guild.id, gs.xPlayer.id); xdb.data.tttLosses = (xdb.data.tttLosses || 0) + 1; xdb.save();
      }
    } else {
      gs.currentTurn = gs.currentTurn === 'X' ? 'O' : 'X';
      const nextPlayer = gs.currentTurn === 'X' ? gs.xPlayer : gs.oPlayer;
      desc = `${nextPlayer}'s turn (${gs.currentTurn === 'X' ? '❌' : '⭕'})\n⏰ 30s per move`;
    }
    const updEmbed = new EmbedBuilder().setTitle('❌⭕ TicTacToe').setDescription(desc).setColor(result && result !== 'draw' ? COLORS.success : COLORS.primary).setTimestamp().setFooter({ text: 'Kaido' });
    await i.update({ embeds: [updEmbed], components: result ? tttComponents(gs.board).map(r => { r.components.forEach(b => b.setDisabled(true)); return r; }) : tttComponents(gs.board) });
  });
  collector.on('end', (_, reason) => {
    if (reason !== 'done') {
      tttGames.delete(channelId); clearInterval(turnTimer);
      sent.edit({ components: [] }).catch(() => {});
    }
  });
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 6. GOOGLE SEARCH
// ══════════════════════════════════════════════════════════
async function handleGoogle(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,google <query>`'));
  const key = API_KEYS.GOOGLE_API_KEY, cx = API_KEYS.GOOGLE_CX;
  if (!key || !cx) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Keys Missing')
      .setDescription('Add `GOOGLE_API_KEY` and `GOOGLE_CX` to `config/apikeys.js`.\nGet them at https://developers.google.com/custom-search/v1/overview'));
  }
  try {
    const data = await jsonFetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}`);
    if (data.items?.length) {
      const results = data.items.slice(0, 5).map((item, i) => `**${i + 1}.** [${item.title}](${item.link})\n${item.snippet?.slice(0, 120) || ''}...`);
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🔍 Google: ${query}`).setDescription(results.join('\n\n')).setFooter({ text: 'Google Custom Search' }));
    }
    return replyEmbed(ctx, base(COLORS.warning).setTitle('🔍 No Results').setDescription('Google found no results for that query.'));
  } catch (err) {
    console.error('[Google] Error:', err.message);
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Google Search Failed')
      .setDescription(`**Reason:** ${err.message}\n\nMake sure your API key and Search Engine ID are valid.`));
  }
}

// 7. GIPHY
// ══════════════════════════════════════════════════════════
async function handleGiphy(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,giphy <query>`'));
  const key = API_KEYS.GIPHY_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `GIPHY_API_KEY` to `config/apikeys.js`.\nGet one at https://developers.giphy.com/'));
  try {
    const data = await jsonFetch(`https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=25&rating=g`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No GIFs found.'));
    const gif = rand(data.data);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🎞️ Giphy: ${query}`).setImage(gif.images.original.url).setFooter({ text: `Powered by Giphy • ${gif.username || 'unknown'}` }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch from Giphy.')); }
}


// 8. TENOR (CANCELLED / REMOVED dont count it )

// ══════════════════════════════════════════════════════════
// 9. STEAL (most recent emote)
// ══════════════════════════════════════════════════════════
async function handleSteal(ctx, args) {
  const input = args[0] || '';
  const linkMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  let targetMsg = null;
  try {
    if (linkMatch) {
      const [, , channelId, messageId] = linkMatch;
      const ch = await ctx.client.channels.fetch(channelId).catch(() => null);
      if (ch) targetMsg = await ch.messages.fetch(messageId).catch(() => null);
    }
  } catch {}
  if (!targetMsg) {
    try {
      const messages = await ctx.channel.messages.fetch({ limit: 50 });
      targetMsg = messages.find(m => { const em = m.content.match(/<(a?):(\w+):(\d+)>/); return em && !m.author.bot; });
    } catch {}
  }
  if (!targetMsg) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Emote Found').setDescription('No custom emotes found in recent messages. Try providing a message link.'));
  const emojiMatch = targetMsg.content.match(/<(a?):(\w+):(\d+)>/);
  if (!emojiMatch) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Emote Found').setDescription('That message does not contain a custom emote.'));
  const animated = !!emojiMatch[1], name = emojiMatch[2], id = emojiMatch[3];
  const ext = animated ? 'gif' : 'png', url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=256`;
  return replyEmbed(ctx, base(COLORS.primary).setTitle(`:${name}:`)
    .setDescription(`**Name:** \`${name}\`\n**ID:** \`${id}\`\n**Animated:** ${animated ? 'Yes' : 'No'}\n**URL:** [Link](${url})`)
    .setImage(url).setFooter({ text: `Found in message by ${targetMsg.author.tag}` }));
}

// ══════════════════════════════════════════════════════════
// 10. DUCKDUCKGO IMAGE
// ══════════════════════════════════════════════════════════
async function handleDuckDuckGoImage(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,duckduckgoimage <query>`'));
  try {
    const html = await textFetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const match = html.match(/vqd="([^"]+)"/);
    if (!match) throw new Error('no vqd');
    const data = await jsonFetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&vqd=${match[1]}&f=,,,&l=us-en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://duckduckgo.com/' }
    });
    if (!data.results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No images found.'));
    const img = rand(data.results);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🖼️ DDG Images: ${query}`).setImage(img.image).setFooter({ text: `From: ${img.source || 'Unknown'}` }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Search Failed').setDescription('Could not fetch images.')); }
}

// ══════════════════════════════════════════════════════════
// 11. REVERSE IMAGE
// ══════════════════════════════════════════════════════════
async function handleReverseImage(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,reverseimage <image-url>` or reply to a message with an image.'));
  return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 Reverse Image Search')
    .setDescription(`[Search on Google Lens](https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)})\n[Search on TinEye](https://tineye.com/search?url=${encodeURIComponent(url)})\n[Search on Yandex](https://yandex.com/images/search?url=${encodeURIComponent(url)}&rpt=imageview)`)
    .setImage(url).setFooter({ text: 'Click a link above to view results' }));
}

// ══════════════════════════════════════════════════════════
// 12. IMAGE SEARCH
// ══════════════════════════════════════════════════════════
async function handleImage(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,image <query>`'));
  const key = API_KEYS.GOOGLE_API_KEY, cx = API_KEYS.GOOGLE_CX;
  if (!key || !cx) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Keys Missing')
      .setDescription('Add `GOOGLE_API_KEY` and `GOOGLE_CX` to `config/apikeys.js`.\nGet them at https://developers.google.com/custom-search/v1/overview'));
  }
  try {
    const data = await jsonFetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image`);
    if (data.items?.length) {
      const img = rand(data.items);
      return replyEmbed(ctx, base(COLORS.primary).setTitle(`🖼️ Image: ${query}`).setImage(img.link).setFooter({ text: `From: ${img.displayLink || 'Google'}` }));
    }
    return replyEmbed(ctx, base(COLORS.warning).setTitle('🖼️ No Results').setDescription('Google found no images for that query.'));
  } catch (err) {
    console.error('[Image] Error:', err.message);
    return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Image Search Failed')
      .setDescription(`**Reason:** ${err.message}\n\nMake sure your API key and Search Engine ID are valid.`));
  }
}
// ══════════════════════════════════════════════════════════
// 13. BOOK (Open Library)
// ══════════════════════════════════════════════════════════
async function handleBook(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,book <title>`'));
  try {
    const data = await jsonFetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.docs?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No books found.'));
    const book = data.docs[0];
    const embed = base(COLORS.primary).setTitle(`📖 ${book.title}`)
      .setDescription(book.first_sentence?.[0] || '*No description available*')
      .addFields(
        { name: 'Author', value: book.author_name?.join(', ') || 'Unknown', inline: true },
        { name: 'Published', value: book.first_publish_year?.toString() || 'Unknown', inline: true },
        { name: 'Pages', value: book.number_of_pages_median?.toString() || 'Unknown', inline: true },
        { name: 'ISBN', value: book.isbn?.[0] || 'N/A', inline: true }
      ).setFooter({ text: 'Powered by Open Library' });
    if (book.cover_i) embed.setThumbnail(`https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch book information.')); }
}

// ══════════════════════════════════════════════════════════
// 14. MANGA (Jikan)
// ══════════════════════════════════════════════════════════
async function handleManga(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,manga <title>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No manga found.'));
    const manga = data.data[0];
    const embed = base(COLORS.primary).setTitle(`📚 ${manga.title}`).setURL(manga.url)
      .setDescription(manga.synopsis?.slice(0, 500) + '...' || '*No synopsis*')
      .addFields(
        { name: 'Type', value: manga.type || 'Unknown', inline: true },
        { name: 'Chapters', value: manga.chapters?.toString() || 'Unknown', inline: true },
        { name: 'Volumes', value: manga.volumes?.toString() || 'Unknown', inline: true },
        { name: 'Score', value: manga.score?.toString() || 'N/A', inline: true },
        { name: 'Status', value: manga.status || 'Unknown', inline: true },
        { name: 'Published', value: manga.published?.string || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (manga.images?.jpg?.image_url) embed.setThumbnail(manga.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch manga information.')); }
}

// ══════════════════════════════════════════════════════════
// 15. ANIME (Jikan)
// ══════════════════════════════════════════════════════════
async function handleAnime(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,anime <title>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No anime found.'));
    const anime = data.data[0];
    const embed = base(COLORS.primary).setTitle(`📺 ${anime.title}`).setURL(anime.url)
      .setDescription(anime.synopsis?.slice(0, 500) + '...' || '*No synopsis*')
      .addFields(
        { name: 'Type', value: anime.type || 'Unknown', inline: true },
        { name: 'Episodes', value: anime.episodes?.toString() || 'Unknown', inline: true },
        { name: 'Score', value: anime.score?.toString() || 'N/A', inline: true },
        { name: 'Status', value: anime.status || 'Unknown', inline: true },
        { name: 'Aired', value: anime.aired?.string || 'Unknown', inline: true },
        { name: 'Rating', value: anime.rating || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (anime.images?.jpg?.image_url) embed.setThumbnail(anime.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch anime information.')); }
}

// ══════════════════════════════════════════════════════════
// 16. CHARACTER (Jikan)
// ══════════════════════════════════════════════════════════
async function handleCharacter(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,character <name>`'));
  try {
    const data = await jsonFetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=5`);
    if (!data.data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No character found.'));
    const char = data.data[0];
    const embed = base(COLORS.primary).setTitle(`👤 ${char.name}`).setURL(char.url)
      .setDescription(char.about?.slice(0, 500) + '...' || '*No description*')
      .addFields(
        { name: 'Kanji', value: char.name_kanji || 'N/A', inline: true },
        { name: 'Favorites', value: char.favorites?.toString() || '0', inline: true },
        { name: 'Nicknames', value: char.nicknames?.join(', ') || 'None', inline: true }
      ).setFooter({ text: 'Powered by MyAnimeList (Jikan)' });
    if (char.images?.jpg?.image_url) embed.setThumbnail(char.images.jpg.image_url);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch character information.')); }
}

// ══════════════════════════════════════════════════════════
// 17. TONE (Google Perspective)
// ══════════════════════════════════════════════════════════
async function handleTone(ctx, args) {
  const text = args.join(' ').trim();
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,tone <text>`'));
  const key = API_KEYS.PERSPECTIVE_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `PERSPECTIVE_API_KEY` to `config/apikeys.js`.\nGet one at https://perspectiveapi.com/'));
  try {
    const body = { comment: { text }, languages: ['en'], requestedAttributes: { TOXICITY: {}, SEVERE_TOXICITY: {}, IDENTITY_ATTACK: {}, INSULT: {}, PROFANITY: {}, THREAT: {} } };
    const res = await fetch(`https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    const scores = data.attributeScores || {};
    const fmt = (key) => { const s = scores[key]?.summaryScore?.value; return s !== undefined ? `${(s * 100).toFixed(1)}%` : 'N/A'; };
    const embed = base(COLORS.primary).setTitle('📊 Perspective Analysis')
      .setDescription(`\`\`\`${text.slice(0, 200)}\`\`\``)
      .addFields(
        { name: 'Toxicity', value: fmt('TOXICITY'), inline: true },
        { name: 'Severe Toxicity', value: fmt('SEVERE_TOXICITY'), inline: true },
        { name: 'Identity Attack', value: fmt('IDENTITY_ATTACK'), inline: true },
        { name: 'Insult', value: fmt('INSULT'), inline: true },
        { name: 'Profanity', value: fmt('PROFANITY'), inline: true },
        { name: 'Threat', value: fmt('THREAT'), inline: true }
      ).setFooter({ text: 'Powered by Google Perspective' });
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not analyze text.')); }
}

// ══════════════════════════════════════════════════════════
// 18. TAGS SYSTEM
// ══════════════════════════════════════════════════════════
function getTagsDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.tags) db.data.tags = {};
  return db.data.tags;
}

async function handleTags(ctx, args) {
  const guildId = ctx.guild.id;
  const tags = getTagsDb(guildId);
  const sub = args[0]?.toLowerCase();
  const isInteraction = !!ctx.deferReply;

  // Display tag
  if (!sub || (!['add','edit','random','rename','reset','search','remove','list','author'].includes(sub))) {
    const name = args[0]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Tag Name').setDescription('Usage: `,tags <name>` or `,tags add <name> <content>`'));
    const tag = tags[name];
    if (!tag) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    tag.uses = (tag.uses || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setDescription(tag.content).setFooter({ text: `Tag: ${name} • Used ${tag.uses} times` }));
  }

  if (sub === 'add') {
    const name = args[1]?.toLowerCase();
    const content = args.slice(2).join(' ');
    if (!name || !content) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags add <name> <content>`'));
    if (tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Exists').setDescription(`Tag \`${name}\` already exists. Use \`,tags edit\` to modify it.`));
    tags[name] = { content, authorId: ctx.author?.id || ctx.user.id, createdAt: Date.now(), uses: 0 };
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Added').setDescription(`Tag \`${name}\` has been created.`));
  }

  if (sub === 'edit') {
    const name = args[1]?.toLowerCase();
    const content = args.slice(2).join(' ');
    if (!name || !content) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags edit <name> <new content>`'));
    if (!tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    tags[name].content = content;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Edited').setDescription(`Tag \`${name}\` has been updated.`));
  }

  if (sub === 'random') {
    const keys = Object.keys(tags);
    if (!keys.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Tags').setDescription('This server has no tags.'));
    const name = rand(keys);
    tags[name].uses = (tags[name].uses || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setDescription(tags[name].content).setFooter({ text: `Random Tag: ${name}` }));
  }

  if (sub === 'rename') {
    const oldName = args[1]?.toLowerCase();
    const newName = args[2]?.toLowerCase();
    if (!oldName || !newName) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Arguments').setDescription('Usage: `,tags rename <old> <new>`'));
    if (!tags[oldName]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${oldName}\` does not exist.`));
    if (tags[newName]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Exists').setDescription(`Tag \`${newName}\` already exists.`));
    tags[newName] = tags[oldName]; delete tags[oldName];
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Renamed').setDescription(`\`${oldName}\` → \`${newName}\``));
  }

  if (sub === 'reset') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Permission Denied').setDescription('You need **Manage Server** permission.'));
    const db = getGuildDb(guildId); db.data.tags = {}; db._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tags Reset').setDescription('All tags have been deleted.'));
  }

  if (sub === 'search') {
    const query = args.slice(1).join(' ').toLowerCase();
    if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Query').setDescription('Usage: `,tags search <keyword>`'));
    const matches = Object.entries(tags).filter(([name, tag]) => name.includes(query) || tag.content.toLowerCase().includes(query));
    if (!matches.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No tags matching that keyword.'));
    const embed = base(COLORS.primary).setTitle(`🔍 Tag Search: ${query}`)
      .setDescription(matches.slice(0, 20).map(([name, tag]) => `• \`${name}\` — ${tag.content.slice(0, 50)}...`).join('\n'));
    return replyEmbed(ctx, embed);
  }

  if (sub === 'remove') {
    const name = args[1]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Name').setDescription('Usage: `,tags remove <name>`'));
    if (!tags[name]) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    delete tags[name]; getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('✅ Tag Removed').setDescription(`Tag \`${name}\` has been deleted.`));
  }

  if (sub === 'list') {
    const target = isInteraction ? (ctx.options?.getUser?.('user') || ctx.user) : (ctx.mentions?.users?.first() || ctx.author);
    const userTags = Object.entries(tags).filter(([, tag]) => tag.authorId === target.id);
    if (!userTags.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Tags').setDescription(`${target.username} has no tags.`));
    const embed = base(COLORS.primary).setTitle(`🏷️ Tags by ${target.username}`)
      .setDescription(userTags.map(([name, tag]) => `• \`${name}\` — Used ${tag.uses || 0} times`).join('\n'));
    return replyEmbed(ctx, embed);
  }

  if (sub === 'author') {
    const name = args[1]?.toLowerCase();
    if (!name) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Name').setDescription('Usage: `,tags author <name>`'));
    const tag = tags[name];
    if (!tag) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Tag Not Found').setDescription(`Tag \`${name}\` does not exist.`));
    const author = await ctx.client.users.fetch(tag.authorId).catch(() => null);
    return replyEmbed(ctx, base(COLORS.primary).setTitle(`🏷️ Tag: ${name}`)
      .addFields(
        { name: 'Author', value: author ? `${author.tag} (${author.id})` : 'Unknown', inline: true },
        { name: 'Created', value: new Date(tag.createdAt).toLocaleDateString(), inline: true },
        { name: 'Uses', value: (tag.uses || 0).toString(), inline: true }
      ));
  }
}

// ══════════════════════════════════════════════════════════
// 19. TV SHOW (TVMaze)
// ══════════════════════════════════════════════════════════
async function handleTvshow(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,tvshow <title>`'));
  try {
    const data = await jsonFetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    if (!data?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No TV show found.'));
    const show = data[0].show;
    const embed = base(COLORS.primary).setTitle(`📺 ${show.name}`).setURL(show.url)
      .setDescription(show.summary?.replace(/<[^>]+>/g, '').slice(0, 500) + '...' || '*No summary*')
      .addFields(
        { name: 'Language', value: show.language || 'Unknown', inline: true },
        { name: 'Genres', value: show.genres?.join(', ') || 'Unknown', inline: true },
        { name: 'Status', value: show.status || 'Unknown', inline: true },
        { name: 'Premiered', value: show.premiered || 'Unknown', inline: true },
        { name: 'Rating', value: show.rating?.average?.toString() || 'N/A', inline: true },
        { name: 'Network', value: show.network?.name || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by TVMaze' });
    if (show.image?.original) embed.setThumbnail(show.image.original);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch TV show information.')); }
}

// ══════════════════════════════════════════════════════════
// 20. GAME (RAWG)
// ══════════════════════════════════════════════════════════
async function handleGame(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,game <title>`'));
  const key = API_KEYS.RAWG_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `RAWG_API_KEY` to `config/apikeys.js`.\nGet one at https://rawg.io/'));
  try {
    const search = await jsonFetch(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(query)}&page_size=5`);
    if (!search.results?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription('No game found.'));
    const game = search.results[0];
    const embed = base(COLORS.primary).setTitle(`🎮 ${game.name}`).setURL(`https://rawg.io/games/${game.slug}`)
      .addFields(
        { name: 'Released', value: game.released || 'Unknown', inline: true },
        { name: 'Rating', value: game.rating?.toString() || 'N/A', inline: true },
        { name: 'Metacritic', value: game.metacritic?.toString() || 'N/A', inline: true },
        { name: 'Platforms', value: game.platforms?.map(p => p.platform.name).slice(0, 5).join(', ') || 'Unknown', inline: true }
      ).setFooter({ text: 'Powered by RAWG' });
    if (game.background_image) embed.setImage(game.background_image);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch game information.')); }
}

// ══════════════════════════════════════════════════════════
// 21. MOVIE (OMDB)
// ══════════════════════════════════════════════════════════
async function handleMovie(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Title').setDescription('Usage: `,movie <title>`'));
  const key = API_KEYS.OMDB_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OMDB_API_KEY` to `config/apikeys.js`.\nGet one at https://www.omdbapi.com/'));
  try {
    const data = await jsonFetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${key}&plot=short`);
    if (data.Response === 'False') return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Results').setDescription(data.Error || 'Movie not found.'));
    const embed = base(COLORS.primary).setTitle(`🎬 ${data.Title} (${data.Year})`)
      .setDescription(data.Plot || '*No plot available*')
      .addFields(
        { name: 'Genre', value: data.Genre || 'Unknown', inline: true },
        { name: 'Director', value: data.Director || 'Unknown', inline: true },
        { name: 'Actors', value: data.Actors || 'Unknown', inline: true },
        { name: 'Rated', value: data.Rated || 'N/A', inline: true },
        { name: 'Runtime', value: data.Runtime || 'N/A', inline: true },
        { name: 'IMDb Rating', value: data.imdbRating || 'N/A', inline: true }
      ).setFooter({ text: 'Powered by OMDB' });
    if (data.Poster && data.Poster !== 'N/A') embed.setThumbnail(data.Poster);
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not fetch movie information.')); }
}

// ══════════════════════════════════════════════════════════
// 22. OCR (OCR.space)
// ══════════════════════════════════════════════════════════
async function handleOcr(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,ocr <image-url>` or reply to a message with an image.'));
  const key = API_KEYS.OCR_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OCR_API_KEY` to `config/apikeys.js`.\nGet one at https://ocr.space/'));
  try {
    const res = await fetch(`https://api.ocr.space/parse/imageurl?apikey=${key}&url=${encodeURIComponent(url)}&language=eng`);
    const data = await res.json();
    const text = data.ParsedResults?.[0]?.ParsedText || 'No text detected.';
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 OCR Results').setDescription(`\`\`\`${text.slice(0, 3900)}\`\`\``).setFooter({ text: 'Powered by OCR.space' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not perform OCR.')); }
}

// ══════════════════════════════════════════════════════════
// 23. OCR + TRANSLATE
// ══════════════════════════════════════════════════════════
async function handleOcrtr(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  const toLang = args.find(a => /^[a-z]{2}(-[A-Z]{2})?$/.test(a)) || 'en';
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Invalid URL').setDescription('Usage: `,ocrtr <image-url> [to-language]` or reply to a message with an image.'));
  const key = API_KEYS.OCR_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ API Key Missing').setDescription('Add `OCR_API_KEY` to `config/apikeys.js`.'));
  try {
    const ocrRes = await fetch(`https://api.ocr.space/parse/imageurl?apikey=${key}&url=${encodeURIComponent(url)}&language=eng`);
    const ocrData = await ocrRes.json();
    const text = ocrData.ParsedResults?.[0]?.ParsedText || '';
    if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ No Text').setDescription('No text detected in the image.'));
    const trRes = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`);
    const trData = await trRes.json();
    const translated = trData?.[0]?.map(x => x[0]).join('') || text;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🔍 OCR + Translate')
      .addFields(
        { name: 'Original', value: `\`\`\`${text.slice(0, 1000)}\`\`\``, inline: false },
        { name: `Translated (${toLang})`, value: `\`\`\`${translated.slice(0, 1000)}\`\`\``, inline: false }
      ).setFooter({ text: 'Powered by OCR.space & Google Translate' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not process image.')); }
}

// ══════════════════════════════════════════════════════════
// 24. TRANSLATE
// ══════════════════════════════════════════════════════════
async function handleTranslate(ctx, args) {
  let toLang = 'en', fromLang = 'auto', textStart = 0;

  // Check if replying to a message
  const referenced = ctx.reference || ctx.message?.reference;
  let text = null;

  if (referenced?.messageId) {
    try {
      const refMsg = await ctx.channel.messages.fetch(referenced.messageId);
      text = refMsg.content;
      // Check if user specified a language in args
      if (args.length >= 1 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0])) {
        toLang = args[0];
      }
    } catch {}
  }

  if (!text) {
    if (args.length >= 3 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0]) && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[1])) {
      fromLang = args[0]; toLang = args[1]; textStart = 2;
    } else if (args.length >= 2 && /^[a-z]{2}(-[A-Z]{2})?$/.test(args[0])) {
      toLang = args[0]; textStart = 1;
    }
    text = args.slice(textStart).join(' ');
  }

  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Missing Text').setDescription('Usage: `,translate <to-lang> <text>` or reply to a message with `,translate <to-lang>`'));
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`);
    const data = await res.json();
    const translated = data?.[0]?.map(x => x[0]).join('') || text;
    const detected = data?.[2] || fromLang;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('🌐 Translate')
      .addFields(
        { name: `Original (${detected})`, value: text.slice(0, 1024), inline: false },
        { name: `Translated (${toLang})`, value: translated.slice(0, 1024), inline: false }
      ).setFooter({ text: 'Powered by Google Translate' }));
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('❌ Failed').setDescription('Could not translate text.')); }
}

// ══════════════════════════════════════════════════════════
// 25. TTS (Text to Speech)
// ══════════════════════════════════════════════════════════
async function handleTts(ctx, args) {
  let speaker = 'en', textStart = 0;
  const voices = ['en','es','fr','de','it','ja','ko','ru','ar','pt','nl','pl','tr','zh'];
  if (voices.includes(args[0]?.toLowerCase())) { speaker = args[0].toLowerCase(); textStart = 1; }
  const text = args.slice(textStart).join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Text').setDescription('Usage: `,tts [language] <text>`\nLanguages: en, es, fr, de, it, ja, ko, ru, ar, pt, nl, pl, tr, zh'));
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${speaker}&client=tw-ob`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error('Google TTS blocked');
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'tts.mp3' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('TTS').setDescription(`Language: **${speaker}**`), [att]);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not generate TTS. Google may have blocked the request.')); }
}

// ══════════════════════════════════════════════════════════
// 26. TTS CHANNEL (speak in VC)
// ══════════════════════════════════════════════════════════
const ttsConnections = new Map(); // guildId -> { connection, player, tmpFile, timeout }

function cleanupTts(guildId) {
  const entry = ttsConnections.get(guildId);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  try { entry.player?.stop(); } catch {}
  try {
    if (entry.connection && entry.connection.state.status !== 'destroyed') {
      entry.connection.destroy();
    }
  } catch {}
  if (entry.tmpFile && fs.existsSync(entry.tmpFile)) {
    try { fs.unlinkSync(entry.tmpFile); } catch {}
  }
  ttsConnections.delete(guildId);
}

async function handleTtsChannel(ctx, args) {
  let speaker = 'en', textStart = 0;
  const voices = ['en','es','fr','de','it','ja','ko','ru','ar','pt','nl','pl','tr','zh'];
  if (voices.includes(args[0]?.toLowerCase())) { speaker = args[0].toLowerCase(); textStart = 1; }
  const text = args.slice(textStart).join(' ');
  if (!text) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Text').setDescription('Usage: `,ttschannel [language] <text>`'));
  const vc = ctx.member?.voice?.channel;
  if (!vc) return replyEmbed(ctx, base(COLORS.error).setTitle('Not in VC').setDescription('Join a voice channel first.'));

  // Check if bot is already in another VC in this guild
  const botMember = ctx.guild.members.me;
  if (botMember?.voice?.channel && botMember.voice.channel.id !== vc.id) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Bot Already in VC')
      .setDescription(`The bot is currently in **${botMember.voice.channel.name}**. Use \`,stop\` to make it leave first.`));
  }

  // Lazy-load voice dependencies
  let voice;
  try {
    voice = require('@discordjs/voice');
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Dependency')
      .setDescription('Install `@discordjs/voice` and `ffmpeg-static` to use this feature.\nRun: `npm install @discordjs/voice ffmpeg-static`'));
  }

  // Check ffmpeg-static is available
  try {
    require('ffmpeg-static');
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Missing ffmpeg')
      .setDescription('`ffmpeg-static` is required to play audio.\nRun: `npm install ffmpeg-static`'));
  }

  // Check opus encoder is available
  const opusModules = ['@discordjs/opus', 'node-opus', 'opusscript'];
  let hasOpus = false;
  for (const mod of opusModules) {
    try { require(mod); hasOpus = true; break; } catch {}
  }
  if (!hasOpus) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Opus Encoder')
      .setDescription('An Opus encoder is required to play audio.\nRun one of these:\n`npm install @discordjs/opus` (recommended)\n`npm install opusscript` (fallback, pure JS)'));
  }

  try {
    // Fetch TTS audio from Google
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${speaker}&client=tw-ob`;
    console.log('[TTS] Fetching:', url.slice(0, 80) + '...');
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!res.ok) throw new Error(`Google TTS HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Google TTS returned HTML (blocked)');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) throw new Error(`TTS audio too small (${buffer.length} bytes) — likely blocked`);
    console.log('[TTS] Audio fetched:', buffer.length, 'bytes');

    // Clean up any existing TTS for this guild
    cleanupTts(ctx.guild.id);

    // Wait for Discord to process the disconnect before reconnecting
    console.log('[TTS] Waiting 2s for cleanup to settle...');
    await new Promise(r => setTimeout(r, 2000));

    // Join voice channel
    const connection = voice.joinVoiceChannel({
      channelId: vc.id,
      guildId: ctx.guild.id,
      adapterCreator: ctx.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // Debug: log state changes
    connection.on('stateChange', (oldState, newState) => {
      console.log(`[TTS] Connection state: ${oldState.status} -> ${newState.status}`);
      if (newState.status === 'disconnected' && newState.reason) {
        console.log('[TTS] Disconnect reason:', newState.reason);
      }
      if (newState.status === 'connecting' && oldState.status === 'connecting') {
        console.log('[TTS] Connection retrying...');
      }
    });

    connection.on('error', (err) => {
      console.error('[TTS] Connection error:', err.message);
    });

    connection.on('debug', (msg) => {
      console.log('[TTS] Debug:', msg);
    });

    // CRITICAL: Wait for connection to be ready before playing
    try {
      await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 60000);
      console.log('[TTS] Voice connection ready');
    } catch (e) {
      connection.destroy();
      console.error('[TTS] Connection failed to reach Ready:', e.message);
      throw new Error('Voice connection failed to establish.\n\nCommon causes:\n1. Replit blocks Discord voice UDP (most likely)\n2. Bot lacks Connect/Speak permissions in the voice channel\n3. Discord voice region issue — try a different voice channel\n4. Missing GuildVoiceStates intent\n\nIf you are on Replit, Discord voice often does not work due to UDP restrictions. Consider using Railway, Fly.io, or a VPS.');
    }

    // Write buffer to temp file — ffmpeg needs a real file path
    const tmpFile = path.join(os.tmpdir(), `kaido_tts_${ctx.guild.id}_${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, buffer);
    console.log('[TTS] Temp file written:', tmpFile);

    // Create player
    const player = voice.createAudioPlayer({
      behaviors: { noSubscriber: voice.NoSubscriberBehavior.Play }
    });

    // Debug: log player state changes
    player.on('stateChange', (oldState, newState) => {
      console.log(`[TTS] Player state: ${oldState.status} -> ${newState.status}`);
    });

    // Create audio resource from file
    const resource = voice.createAudioResource(tmpFile, {
      inputType: voice.StreamType.Arbitrary,
      inlineVolume: true,
    });

    player.play(resource);
    connection.subscribe(player);
    console.log('[TTS] Player started');

    // Store for cleanup
    const entry = { connection, player, tmpFile };
    ttsConnections.set(ctx.guild.id, entry);

    // Auto-disconnect after 5 minutes of inactivity
    player.on(voice.AudioPlayerStatus.Idle, () => {
      console.log('[TTS] Player idle — scheduling disconnect in 5 min');
      entry.timeout = setTimeout(() => cleanupTts(ctx.guild.id), 5 * 60 * 1000);
    });

    player.on('error', (err) => {
      console.error('[TTS] Player error:', err.message);
      cleanupTts(ctx.guild.id);
    });

    return replyEmbed(ctx, base(COLORS.success).setTitle('Speaking').setDescription(`Speaking in **${vc.name}**...`));
  } catch (err) {
    console.error('[TTS] Error:', err);
    cleanupTts(ctx.guild.id);
    return replyEmbed(ctx, base(COLORS.error).setTitle('Failed')
      .setDescription(`Could not speak in voice channel.\n**Reason:** ${err.message || 'Unknown error'}`));
  }
}

// ══════════════════════════════════════════════════════════
// 27. LEGO (Legofy image)
// ══════════════════════════════════════════════════════════
async function handleLego(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,lego <image-url>` or reply to a message with an image.\nSupported: PNG, JPG, GIF, WEBP'));
  try {
    const apiUrl = `https://legoify.vercel.app/api/legoify?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('API failed');
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'lego.png' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Legofied').setImage('attachment://lego.png'), [att]);
  } catch {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not legofy image. Try a different URL or image format.'));
  }
}

// ══════════════════════════════════════════════════════════
// 28. MAKEGIF (video to GIF)
// ══════════════════════════════════════════════════════════
async function handleMakegif(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,makegif <video-url>` or reply to a message with a video.\nSupported: MP4, MOV, WEBM'));
  if (!url.match(/\.(mp4|mov|webm)(\?|$)/i)) {
    return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid File').setDescription('That does not look like a video file. Supported: MP4, MOV, WEBM'));
  }
  return replyEmbed(ctx, base(COLORS.warning).setTitle('MakeGIF')
    .setDescription('Video-to-GIF conversion requires ffmpeg processing.\n\n**To enable:**\n1. Install: `npm install ffmpeg-static fluent-ffmpeg`\n2. Or use a cloud converter API\n\n**Usage:** `,makegif <video-url>` or reply to a video with `,makegif`'));
}

// ══════════════════════════════════════════════════════════
// 29. TRANSPARENT (remove background)
// ══════════════════════════════════════════════════════════
async function handleTransparent(ctx, args) {
  const url = await resolveImageUrl(ctx, args);
  if (!url) return replyEmbed(ctx, base(COLORS.error).setTitle('Invalid URL').setDescription('Usage: `,transparent <image-url>` or reply to a message with an image.\nSupported: PNG, JPG, GIF, WEBP'));
  const key = API_KEYS.REMOVEBG_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('API Key Missing').setDescription('Add `REMOVEBG_API_KEY` to `config/apikeys.js`.\nGet one at https://www.remove.bg/'));
  try {
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ image_url: url }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.errors?.[0]?.title || errJson.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const att = new AttachmentBuilder(buffer, { name: 'transparent.png' });
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Background Removed').setImage('attachment://transparent.png'), [att]);
  } catch (err) {
    console.error('Transparent error:', err);
    return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription(`Could not remove background.\n**Reason:** ${err.message || 'Unknown error'}\n\nMake sure your Remove.bg API key is valid and the image URL is accessible.`));
  }
}

// ══════════════════════════════════════════════════════════
// 30. WOLFRAM
// ══════════════════════════════════════════════════════════
async function handleWolfram(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Query').setDescription('Usage: `,wolfram <query>`'));
  const key = API_KEYS.WOLFRAM_API_KEY;
  if (!key) return replyEmbed(ctx, base(COLORS.error).setTitle('API Key Missing').setDescription('Add `WOLFRAM_API_KEY` to `config/apikeys.js`.\nGet one at https://products.wolframalpha.com/api/'));
  try {
    const data = await jsonFetch(`https://api.wolframalpha.com/v2/query?input=${encodeURIComponent(query)}&format=plaintext&output=JSON&appid=${key}`);
    const pods = data.queryresult?.pods;
    if (!pods?.length) return replyEmbed(ctx, base(COLORS.error).setTitle('No Results').setDescription('WolframAlpha could not answer that query.'));
    const embed = base(COLORS.primary).setTitle(`Wolfram: ${query}`).setFooter({ text: 'Powered by WolframAlpha' });
    for (const pod of pods.slice(0, 4)) {
      const text = pod.subpods?.map(s => s.plaintext).filter(Boolean).join('\n') || 'N/A';
      if (text && text !== 'N/A') embed.addFields({ name: pod.title, value: text.slice(0, 1024), inline: false });
    }
    return replyEmbed(ctx, embed);
  } catch { return replyEmbed(ctx, base(COLORS.error).setTitle('Failed').setDescription('Could not query WolframAlpha.')); }
}

// ══════════════════════════════════════════════════════════
// 31-38. JUUL SYSTEM
// ══════════════════════════════════════════════════════════
function getJuulDb(guildId) {
  const db = getGuildDb(guildId);
  if (!db.data.juul) db.data.juul = { owner: null, flavor: 'Mango', hits: 0, active: true, passes: 0, stolen: 0 };
  return db.data.juul;
}

async function handleJuul(ctx, args) {
  const sub = args[0]?.toLowerCase();
  const guildId = ctx.guild.id;
  const juul = getJuulDb(guildId);
  const isInteraction = !!ctx.deferReply;
  const user = isInteraction ? ctx.user : ctx.author;

  if (sub === 'hit') {
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    juul.hits = (juul.hits || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Hit').setDescription(`**${user.username}** takes a hit of **${juul.flavor}** 🌬️\nTotal hits: **${juul.hits}**`));
  }

  if (sub === 'pass') {
    const target = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
    if (!target) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing User').setDescription('Usage: `,juul pass <@user>`'));
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    juul.passes = (juul.passes || 0) + 1;
    juul.owner = target.id;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Passed').setDescription(`**${user.username}** passes the juul to **${target.username}** 🔄\nFlavor: **${juul.flavor}**`));
  }

  if (sub === 'toggle') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('Permission Denied').setDescription('You need **Manage Server** permission.'));
    juul.active = !juul.active;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('Juul Toggled').setDescription(`Server juul is now **${juul.active ? 'ON' : 'OFF'}**`));
  }

  if (sub === 'stats') {
    const owner = juul.owner ? await ctx.client.users.fetch(juul.owner).catch(() => null) : null;
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Server Juul Stats')
      .addFields(
        { name: 'Flavor', value: juul.flavor || 'Mango', inline: true },
        { name: 'Status', value: juul.active ? 'On' : 'Off', inline: true },
        { name: 'Owner', value: owner ? owner.username : 'None', inline: true },
        { name: 'Hits', value: (juul.hits || 0).toString(), inline: true },
        { name: 'Passes', value: (juul.passes || 0).toString(), inline: true },
        { name: 'Stolen', value: (juul.stolen || 0).toString(), inline: true }
      ));
  }

  if (sub === 'flavor') {
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return replyEmbed(ctx, base(COLORS.error).setTitle('Permission Denied').setDescription('You need **Manage Server** permission.'));
    const flavor = args.slice(1).join(' ');
    if (!flavor) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Flavor').setDescription('Usage: `,juul flavor <flavor>`'));
    juul.flavor = flavor;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.success).setTitle('Flavor Changed').setDescription(`Server juul flavor is now **${flavor}**`));
  }

  if (sub === 'steal') {
    if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
    const prevOwner = juul.owner ? await ctx.client.users.fetch(juul.owner).catch(() => null) : null;
    juul.owner = user.id;
    juul.stolen = (juul.stolen || 0) + 1;
    getGuildDb(guildId)._save();
    return replyEmbed(ctx, base(COLORS.primary).setTitle('Juul Stolen').setDescription(`**${user.username}** steals the juul${prevOwner ? ` from **${prevOwner.username}**` : ''}! 🏃\nFlavor: **${juul.flavor}**`));
  }

  // Default: share
  if (!juul.active) return replyEmbed(ctx, base(COLORS.error).setTitle('Juul Off').setDescription('The server juul is currently turned off.'));
  return replyEmbed(ctx, base(COLORS.primary).setTitle('Share a Juul').setDescription(`**${user.username}** shares the **${juul.flavor}** juul with everyone! 🌬️`));
}

// ══════════════════════════════════════════════════════════
// 39-50. EXTRA PREMIUM COMMANDS (fillers to reach 50)
// ══════════════════════════════════════════════════════════
async function handleMovieExpand(ctx, args) {
  const query = args.join(' ').trim();
  if (!query) return replyEmbed(ctx, base(COLORS.error).setTitle('Missing Title').setDescription('Usage: `,movieexpand <title>`'));
  return handleMovie(ctx, args);
}

async function handleTtsChannelAlias(ctx, args) { return handleTtsChannel(ctx, args); }
async function handleJuulHit(ctx, args) { return handleJuul(ctx, ['hit', ...args]); }
async function handleJuulPass(ctx, args) {
  const isInteraction = !!ctx.deferReply;
  const target = isInteraction ? ctx.options?.getUser?.('user') : ctx.mentions?.users?.first();
  return handleJuul(ctx, ['pass', target?.id, ...args]);
}
async function handleJuulToggle(ctx, args) { return handleJuul(ctx, ['toggle', ...args]); }
async function handleJuulStats(ctx, args) { return handleJuul(ctx, ['stats', ...args]); }
async function handleJuulFlavor(ctx, args) { return handleJuul(ctx, ['flavor', ...args]); }
async function handleJuulSteal(ctx, args) { return handleJuul(ctx, ['steal', ...args]); }

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  lyrics: handleLyrics,
  duckduckgo: handleDuckDuckGo,
  blacktea: handleBlacktea,
  quote: handleQuote,
  tictactoe: handleTicTacToe,
  google: handleGoogle,
  giphy: handleGiphy,
  steal: handleSteal,
  duckduckgoimage: handleDuckDuckGoImage,
  reverseimage: handleReverseImage,
  image: handleImage,
  book: handleBook,
  manga: handleManga,
  anime: handleAnime,
  character: handleCharacter,
  tone: handleTone,
  tags: handleTags,
  tvshow: handleTvshow,
  game: handleGame,
  movie: handleMovie,
  movieexpand: handleMovieExpand,
  ocr: handleOcr,
  ocrtr: handleOcrtr,
  translate: handleTranslate,
  tts: handleTts,
  ttschannel: handleTtsChannel,
  lego: handleLego,
  makegif: handleMakegif,
  transparent: handleTransparent,
  wolfram: handleWolfram,
  juul: handleJuul,
  'juul hit': handleJuulHit,
  'juul pass': handleJuulPass,
  'juul toggle': handleJuulToggle,
  'juul stats': handleJuulStats,
  'juul flavor': handleJuulFlavor,
  'juul steal': handleJuulSteal,
};