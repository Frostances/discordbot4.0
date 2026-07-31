/**
 * roleplay.js — All roleplay/reaction GIF commands
 * GIF source: nekos.best (primary) and waifu.pics (fallback)
 * Both are free, no API key required.
 * 
 * CUSTOM GIFS: Add a `customGif` property to any action in the ACTIONS map below.
 * If `customGif` is set, that URL will be used instead of fetching from the API.
 * If `customGif` is not set or is empty, the bot falls back to the API as usual.
 */

const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { getGuildDb } = require('./database');
const logger = require('../utils/logger');

function ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ══════════════════════════════════════════════════════════
// ACTION MAP
// api: 'nekos' = https://nekos.best/api/v2/{type}
// api: 'waifu' = https://api.waifu.pics/sfw/{type}
// 
// OPTIONAL: Add `customGif: 'https://...'` to any action to use a custom GIF.
// The bot will use the custom GIF URL instead of fetching from the API.
// ══════════════════════════════════════════════════════════
const ACTIONS = {
    // ── EXAMPLES WITH CUSTOM GIFS (replace URLs with your own) ──
    hug: { 
        api:'nekos', 
        type:'hug', 
        label:'hugged', 
        emoji:'🤗', 
        target:true, 
        color:'#FF69B4',
         customGif: 'https://i.pinimg.com/originals/cc/87/b3/cc87b317f7648475ad722210969fc89b.gif'  // ← UNCOMMENT AND SET YOUR URL
    },
    kiss: { 
        api:'nekos', 
        type:'kiss', 
        label:'kissed', 
        emoji:'💋', 
        target:true, 
        color:'#FF1493',
         customGif: 'https://animesher.com/orig/1/167/1673/16736/animesher.com_gif-couple-kiss-1673657.gif'
    },
    pat: { 
        api:'nekos', 
        type:'pat', 
        label:'patted', 
        emoji:'🫶', 
        target:true, 
        color:'#ADD8E6',
         customGif: 'https://animesher.com/orig/1/192/1921/19214/animesher.com_cutie-anime-gif-pat-1921416.gif'
    },
    cuddle: { 
        api:'nekos', 
        type:'cuddle', 
        label:'cuddled', 
        emoji:'🥰', 
        target:true, 
        color:'#FFB6C1',
         customGif: 'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUyOGJvZmk5eHMxNmdyc2d6Yjg4dGx2dnFzcTFtb3B4Znk0NHgxOWZ1bCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/WynnqxhdFEPYY/giphy.gif'
    },
    slap: { 
        api:'nekos', 
        type:'slap', 
        label:'slapped', 
        emoji:'👋', 
        target:true, 
        color:'#ED4245',
         customGif: 'https://i.imgflip.com/6itaqb.gif'
    },
    bite: { 
        api:'waifu', 
        type:'bite', 
        label:'bit', 
        emoji:'😈', 
        target:true, 
        color:'#8B0000',
         customGif: 'https://i.pinimg.com/originals/ca/eb/32/caeb32ef58807c7563460d96a3f7ecc9.gif'
    },
    wave: { api:'nekos', type:'wave', label:'waved at', emoji:'👋', target:false, color:'#5865F2' },
    dance: { api:'nekos', type:'dance', label:'danced', emoji:'💃', target:false, color:'#FF69B4' },
    cry: { api:'nekos', type:'cry', label:'cried', emoji:'😢', target:false, color:'#6495ED' },
    smile: { api:'nekos', type:'smile', label:'smiled', emoji:'😊', target:false, color:'#FFD700' },
    wink: { api:'nekos', type:'wink', label:'winked at', emoji:'😉', target:true, color:'#FFA500' },
    poke: { api:'nekos', type:'poke', label:'poked', emoji:'👉', target:true, color:'#57F287' },
    nom: { api:'waifu', type:'nom', label:'nommed', emoji:'😋', target:true, color:'#FF8C00' },
    lick: { api:'waifu', type:'lick', label:'licked', emoji:'👅', target:true, color:'#FF69B4' },
    blush: { api:'nekos', type:'blush', label:'blushed', emoji:'😊', target:false, color:'#FFB6C1' },
    happy: { api:'nekos', type:'happy', label:'is happy', emoji:'😄', target:false, color:'#FFD700' },
    smug: { api:'nekos', type:'smug', label:'is smug', emoji:'😏', target:false, color:'#9B59B6' },
    punch: { api:'nekos', type:'punch', label:'punched', emoji:'👊', target:true, color:'#ED4245' },
    tickle: { api:'nekos', type:'tickle', label:'tickled', emoji:'😂', target:true, color:'#57F287' },
    sleep: { api:'nekos', type:'sleep', label:'fell asleep', emoji:'😴', target:false, color:'#7289DA' },
    facepalm: { api:'nekos', type:'facepalm', label:'facepalmed', emoji:'🤦', target:false, color:'#95A5A6' },
    shrug: { api:'nekos', type:'shrug', label:'shrugged', emoji:'🤷', target:false, color:'#95A5A6' },
    yawn: { api:'nekos', type:'yawn', label:'yawned', emoji:'😪', target:false, color:'#7289DA' },
    feed: { api:'nekos', type:'feed', label:'fed', emoji:'🍱', target:true, color:'#FF8C00' },
    highfive: { api:'nekos', type:'highfive', label:'high-fived', emoji:'🙌', target:true, color:'#57F287' },
    handshake: { api:'nekos', type:'handshake', label:'handshook', emoji:'🤝', target:true, color:'#5865F2' },
    nod: { api:'nekos', type:'nod', label:'nodded at', emoji:'👍', target:false, color:'#57F287' },
    nope: { api:'nekos', type:'nope', label:'said nope', emoji:'❌', target:false, color:'#ED4245' },
    stare: { api:'nekos', type:'stare', label:'stared at', emoji:'👀', target:true, color:'#2F3136' },
    think: { api:'nekos', type:'think', label:'is thinking', emoji:'🤔', target:false, color:'#9B59B6' },
    thumbsup: { api:'nekos', type:'thumbsup', label:'gave a thumbs up',emoji:'👍', target:true, color:'#57F287' },
    laugh: { api:'nekos', type:'laugh', label:'laughed', emoji:'😂', target:false, color:'#FFD700' },
    pout: { api:'nekos', type:'pout', label:'is pouting', emoji:'😤', target:false, color:'#E67E22' },
    run: { api:'nekos', type:'run', label:'ran', emoji:'🏃', target:false, color:'#57F287' },
    yeet: { api:'waifu', type:'yeet', label:'yeeted', emoji:'🚀', target:true, color:'#E67E22' },
    bully: { api:'waifu', type:'bully', label:'bullied', emoji:'😤', target:true, color:'#ED4245' },
    bonk: { api:'waifu', type:'bonk', label:'bonked', emoji:'🔨', target:true, color:'#E67E22' },
    glomp: { api:'waifu', type:'glomp', label:'glomped', emoji:'🤗', target:true, color:'#FF69B4' },
    kill: { api:'waifu', type:'kill', label:'killed', emoji:'💀', target:true, color:'#2F3136' },
    kick: { api:'waifu', type:'kick', label:'kicked', emoji:'🦵', target:true, color:'#ED4245' },
    cringe: { api:'waifu', type:'cringe', label:'cringed', emoji:'😬', target:false, color:'#95A5A6' },
    // Aliases mapping to existing types
    nuzzle: { api:'nekos', type:'cuddle', label:'nuzzled', emoji:'🥰', target:true, color:'#FFB6C1' },
    clap: { api:'nekos', type:'highfive', label:'clapped', emoji:'👏', target:false, color:'#57F287' },
    yay: { api:'nekos', type:'happy', label:'is excited', emoji:'🎉', target:false, color:'#FFD700' },
    yes: { api:'nekos', type:'nod', label:'said yes', emoji:'✅', target:false, color:'#57F287' },
    sad: { api:'nekos', type:'cry', label:'is sad', emoji:'😢', target:false, color:'#6495ED' },
    angry: { api:'waifu', type:'slap', label:'is angry', emoji:'😠', target:false, color:'#ED4245' },
    shy: { api:'nekos', type:'blush', label:'is shy', emoji:'🥺', target:false, color:'#FFB6C1' },
    sip: { api:'nekos', type:'sleep', label:'is sipping', emoji:'☕', target:false, color:'#8B4513' },
    peek: { api:'nekos', type:'lurk', label:'is peeking', emoji:'👀', target:false, color:'#2F3136' },
    bleh: { api:'waifu', type:'lick', label:'went bleh', emoji:'😛', target:false, color:'#57F287' },
    brofist: { api:'nekos', type:'handshake', label:'brofisted', emoji:'👊', target:true, color:'#E67E22' },
    celebrate: { api:'nekos', type:'happy', label:'celebrated', emoji:'🎉', target:false, color:'#FFD700' },
    cheers: { api:'nekos', type:'highfive', label:'cheered', emoji:'🥂', target:true, color:'#FFD700' },
    confused: { api:'nekos', type:'think', label:'is confused', emoji:'❓', target:false, color:'#9B59B6' },
    cool: { api:'nekos', type:'smug', label:'is cool', emoji:'😎', target:false, color:'#3498DB' },
    drool: { api:'waifu', type:'nom', label:'is drooling', emoji:'🤤', target:false, color:'#95A5A6' },
    headbang: { api:'nekos', type:'dance', label:'is headbanging', emoji:'🎸', target:false, color:'#ED4245' },
    love: { api:'nekos', type:'kiss', label:'loves', emoji:'❤️', target:true, color:'#ED4245' },
    mad: { api:'nekos', type:'slap', label:'is mad', emoji:'😡', target:false, color:'#ED4245' },
    nervous: { api:'waifu', type:'cringe', label:'is nervous', emoji:'😰', target:false, color:'#95A5A6' },
    nyah: { api:'waifu', type:'lick', label:'went nyah~', emoji:'😼', target:false, color:'#FF69B4' },
    scared: { api:'waifu', type:'cringe', label:'is scared', emoji:'😱', target:false, color:'#2F3136' },
    sigh: { api:'nekos', type:'cry', label:'sighed', emoji:'😮‍💨', target:false, color:'#6495ED' },
    slowclap: { api:'nekos', type:'highfive', label:'slow-clapped', emoji:'👏', target:false, color:'#95A5A6' },
    smack: { api:'nekos', type:'slap', label:'smacked', emoji:'💥', target:true, color:'#ED4245' },
    sneeze: { api:'nekos', type:'yawn', label:'sneezed', emoji:'🤧', target:false, color:'#95A5A6' },
    sorry: { api:'nekos', type:'cry', label:'apologized to', emoji:'🙏', target:true, color:'#6495ED' },
    surprised: { api:'nekos', type:'bored', label:'is surprised', emoji:'😲', target:false, color:'#FFD700' },
    sweat: { api:'waifu', type:'cringe', label:'is sweating', emoji:'😰', target:false, color:'#95A5A6' },
    tired: { api:'nekos', type:'sleep', label:'is tired', emoji:'😴', target:false, color:'#7289DA' },
    woah: { api:'waifu', type:'cringe', label:'said woah', emoji:'😲', target:false, color:'#FFD700' },
    lurk: { api:'nekos', type:'lurk', label:'is lurking', emoji:'👀', target:false, color:'#2F3136' },
    sulk: { api:'nekos', type:'pout', label:'is sulking', emoji:'😒', target:false, color:'#95A5A6' },
    shoot: { api:'nekos', type:'shoot', label:'shot', emoji:'🔫', target:true, color:'#ED4245' },
    bored: { api:'nekos', type:'bored', label:'is bored', emoji:'🥱', target:false, color:'#95A5A6' },
};

// ══════════════════════════════════════════════════════════
// MESSAGE TEMPLATES — varied per action
// ══════════════════════════════════════════════════════════
const PAIR_TEMPLATES = {
    hug: [
        (a, t, o) => `Aww~ **${a}** wrapped **${t}** in a warm hug for the **${o}** time! 🤗`,
        (a, t, o) => `Woahh.. **${a}** hugged **${t}** for the **${o}** time! Can they ever stop? 🥺`,
        (a, t, o) => `**${a}** squeezed **${t}** tightly — that's hug #**${o}**! 💕`,
    ],
    kiss: [
        (a, t, o) => `Mwah! **${a}** kissed **${t}** for the **${o}** time! 💋`,
        (a, t, o) => `**${a}** planted a kiss on **${t}** — smooch #**${o}**! 😘`,
        (a, t, o) => `Oooh~ **${a}** kissed **${t}** again! That's **${o}** now! 💕`,
    ],
    pat: [
        (a, t, o) => `**${a}** gave **${t}** a gentle pat — for the **${o}** time! Good boi~ 🫶`,
        (a, t, o) => `Headpat #**${o}**! **${a}** patted **${t}** again~ ✨`,
        (a, t, o) => `**${a}** patted **${t}** on the head for the **${o}** time! So wholesome 🌸`,
    ],
    slap: [
        (a, t, o) => `**${a}** SLAPPED **${t}** for the **${o}** time!! That's gotta hurt 💢`,
        (a, t, o) => `SMACK! **${a}** slapped **${t}** — hit #**${o}**! 👋`,
        (a, t, o) => `**${t}** just got slapped by **${a}** for the **${o}** time. Oof. 💥`,
    ],
    cuddle: [
        (a, t, o) => `**${a}** cuddled up with **${t}** for the **${o}** time! So cozy 🥰`,
        (a, t, o) => `Cuddle #**${o}**! **${a}** and **${t}** are getting close~ 💕`,
        (a, t, o) => `**${a}** snuggled **${t}** again — that's **${o}** times now! 🤗`,
    ],
    bite: [
        (a, t, o) => `**${a}** bit **${t}** for the **${o}** time! Chomp chomp 😈`,
        (a, t, o) => `NOM! **${a}** bit **${t}** again — bite #**${o}**! 🦷`,
        (a, t, o) => `**${t}** got bitten by **${a}** for the **${o}** time. Ouch! 😬`,
    ],
    punch: [
        (a, t, o) => `**${a}** punched **${t}** for the **${o}** time! POW! 👊`,
        (a, t, o) => `BAM! That's punch #**${o}** from **${a}** on **${t}**! 💥`,
        (a, t, o) => `**${t}** took a hit from **${a}** for the **${o}** time. Ow 😵`,
    ],
    poke: [
        (a, t, o) => `**${a}** poked **${t}** for the **${o}** time! STOP THAT 👉`,
        (a, t, o) => `Poke #**${o}**! **${a}** just won't leave **${t}** alone 😆`,
        (a, t, o) => `**${t}** got poked by **${a}** again — **${o}** times total! 😤`,
    ],
    tickle: [
        (a, t, o) => `**${a}** tickled **${t}** for the **${o}** time! HAHA STOP 😂`,
        (a, t, o) => `Tickle #**${o}**! **${t}** can't escape **${a}**'s fingers 🤣`,
        (a, t, o) => `**${a}** is tickling **${t}** again — **${o}** times and counting! 😹`,
    ],
    wink: [
        (a, t, o) => `**${a}** winked at **${t}** for the **${o}** time~ 😉`,
        (a, t, o) => `Wink #**${o}**! Is **${a}** flirting with **${t}** again? 👀`,
        (a, t, o) => `**${t}** got winked at by **${a}** — **${o}** times now! 😏`,
    ],
    nom: [
        (a, t, o) => `**${a}** nommed **${t}** for the **${o}** time! Om nom nom 😋`,
        (a, t, o) => `NOM #**${o}**! **${a}** decided **${t}** looks tasty again 😈`,
        (a, t, o) => `**${t}** got nommed by **${a}** for the **${o}** time~ 🍴`,
    ],
    lick: [
        (a, t, o) => `**${a}** licked **${t}** for the **${o}** time! Eww~ 👅`,
        (a, t, o) => `Lick #**${o}**! **${a}** really likes the taste of **${t}** apparently 😳`,
        (a, t, o) => `**${t}** got licked by **${a}** again — **${o}** times! 😅`,
    ],
    bonk: [
        (a, t, o) => `**${a}** bonked **${t}** for the **${o}** time! Go to horny jail 🔨`,
        (a, t, o) => `BONK #**${o}**! **${a}** smacked **${t}** with the bonk hammer! 💥`,
        (a, t, o) => `**${t}** got bonked by **${a}** for the **${o}** time. Deserved. 😤`,
    ],
    glomp: [
        (a, t, o) => `**${a}** GLOMPED **${t}** for the **${o}** time! They never saw it coming 🤗`,
        (a, t, o) => `GLOMP #**${o}**! **${a}** tackled **${t}** with love! 💕`,
        (a, t, o) => `**${t}** got glomped by **${a}** again — **${o}** times! 🥰`,
    ],
    kill: [
        (a, t, o) => `**${a}** killed **${t}** for the **${o}** time! F in chat 💀`,
        (a, t, o) => `RIP **${t}**. Killed by **${a}** — death #**${o}**! 👻`,
        (a, t, o) => `**${t}** has been eliminated by **${a}** for the **${o}** time. GG 💀`,
    ],
    kick: [
        (a, t, o) => `**${a}** kicked **${t}** for the **${o}** time! RIGHT IN THE SHIN 🦵`,
        (a, t, o) => `Kick #**${o}**! **${a}** sent **${t}** flying! 💨`,
        (a, t, o) => `**${t}** got kicked by **${a}** again — **${o}** times! Ow 😵`,
    ],
    bully: [
        (a, t, o) => `**${a}** bullied **${t}** for the **${o}** time! Not cool 😤`,
        (a, t, o) => `Bully incident #**${o}**! **${a}** is picking on **${t}** again 😡`,
        (a, t, o) => `**${t}** got bullied by **${a}** for the **${o}** time. Stop it! 🛑`,
    ],
    yeet: [
        (a, t, o) => `**${a}** YEETED **${t}** for the **${o}** time! TO THE MOON 🚀`,
        (a, t, o) => `YEET #**${o}**! **${t}** is airborne thanks to **${a}**! ✈️`,
        (a, t, o) => `**${t}** got yeeted by **${a}** again — **${o}** times! 😂`,
    ],
    feed: [
        (a, t, o) => `**${a}** fed **${t}** for the **${o}** time! Eat up~ 🍱`,
        (a, t, o) => `Meal #**${o}**! **${a}** is taking care of **${t}** again 🥺`,
        (a, t, o) => `**${t}** got fed by **${a}** for the **${o}** time~ 🍜`,
    ],
    highfive: [
        (a, t, o) => `**${a}** high-fived **${t}** for the **${o}** time! YEAH! 🙌`,
        (a, t, o) => `High-five #**${o}**! **${a}** and **${t}** are vibing~ ✨`,
        (a, t, o) => `**${a}** and **${t}** slapped hands for the **${o}** time! 👋`,
    ],
    handshake: [
        (a, t, o) => `**${a}** shook hands with **${t}** for the **${o}** time! Very professional 🤝`,
        (a, t, o) => `Handshake #**${o}**! **${a}** and **${t}** keep it formal 😂`,
        (a, t, o) => `**${a}** and **${t}** did the handshake for the **${o}** time~ 🤝`,
    ],
    stare: [
        (a, t, o) => `**${a}** stared at **${t}** for the **${o}** time... creepy 👀`,
        (a, t, o) => `Stare #**${o}**! **${a}** can't stop looking at **${t}** 😳`,
        (a, t, o) => `**${t}** is being stared at by **${a}** again — **${o}** times! 👁️`,
    ],
    thumbsup: [
        (a, t, o) => `**${a}** gave **${t}** a thumbs up for the **${o}** time! 👍`,
        (a, t, o) => `Approval #**${o}**! **${a}** approves of **${t}** once again 😎`,
        (a, t, o) => `**${t}** got a thumbs up from **${a}** — **${o}** times! 👍`,
    ],
    sorry: [
        (a, t, o) => `**${a}** apologized to **${t}** for the **${o}** time... learn from it 🙏`,
        (a, t, o) => `Apology #**${o}**! **${a}** said sorry to **${t}** again 😔`,
        (a, t, o) => `**${a}** is apologizing to **${t}** for the **${o}** time~ 🥺`,
    ],
    smack: [
        (a, t, o) => `**${a}** smacked **${t}** for the **${o}** time! WHAP 💥`,
        (a, t, o) => `Smack #**${o}**! **${t}** took another hit from **${a}** 😵`,
        (a, t, o) => `**${t}** got smacked by **${a}** for the **${o}** time. OOF 💢`,
    ],
    shoot: [
        (a, t, o) => `**${a}** shot **${t}** for the **${o}** time! BANG 🔫`,
        (a, t, o) => `BANG #**${o}**! **${a}** took aim at **${t}** again 💥`,
        (a, t, o) => `**${t}** got shot by **${a}** for the **${o}** time. Ouch 😵`,
    ],
    nuzzle: [
        (a, t, o) => `**${a}** nuzzled **${t}** for the **${o}** time! So soft~ 🥰`,
        (a, t, o) => `Nuzzle #**${o}**! **${a}** and **${t}** are adorable 💕`,
        (a, t, o) => `**${a}** nuzzled up to **${t}** again — **${o}** times! 🌸`,
    ],
    brofist: [
        (a, t, o) => `**${a}** brofisted **${t}** for the **${o}** time! BRO 👊`,
        (a, t, o) => `Brofist #**${o}**! **${a}** and **${t}** are true bros 😤`,
        (a, t, o) => `**${a}** and **${t}** did the brofist for the **${o}** time~ 🤜🤛`,
    ],
    cheers: [
        (a, t, o) => `**${a}** cheered with **${t}** for the **${o}** time! Bottoms up 🥂`,
        (a, t, o) => `Cheers #**${o}**! **${a}** and **${t}** are celebrating again 🎉`,
        (a, t, o) => `**${a}** raised a glass with **${t}** for the **${o}** time~ 🥂`,
    ],
    love: [
        (a, t, o) => `**${a}** showered **${t}** with love for the **${o}** time! 💕`,
        (a, t, o) => `Love declaration #**${o}**! **${a}** loves **${t}** so much ❤️`,
        (a, t, o) => `**${a}** expressed love to **${t}** again — **${o}** times! 💖`,
    ],
    wink: [
        (a, t, o) => `**${a}** winked at **${t}** for the **${o}** time~ 😉`,
        (a, t, o) => `Wink #**${o}**! Is **${a}** flirting with **${t}** again? 👀`,
        (a, t, o) => `**${t}** got winked at by **${a}** — **${o}** times now! 😏`,
    ],
};

// Fallback pair templates for actions not specifically defined
function defaultPairTemplate(a, t, o, action) {
    const templates = [
        () => `**${a}** ${action.label} **${t}** for the **${o}** time! ${action.emoji}`,
        () => `Woahh.. **${a}** ${action.label} **${t}** for the **${o}** time! ${action.emoji}`,
        () => `That's **${o}**! **${a}** ${action.label} **${t}** again ${action.emoji}`,
    ];
    return pick(templates)();
}

// Solo action templates (no target)
const SOLO_TEMPLATES = {
    dance: [
        (a) => `**${a}** is busting some moves! 💃`,
        (a) => `Look at **${a}** go! Get it! 🎶`,
        (a) => `**${a}** hit the dancefloor! 🕺`,
    ],
    cry: [
        (a) => `**${a}** is crying... someone give them a hug 😢`,
        (a) => `**${a}** burst into tears 😭`,
        (a) => `Someone comfort **${a}**, they're crying! 💧`,
    ],
    smile: [
        (a) => `**${a}** is smiling! That made my day ☀️`,
        (a) => `Look at that smile from **${a}**! 😊`,
        (a) => `**${a}** is all smiles today~ 🌸`,
    ],
    blush: [
        (a) => `**${a}** is blushing! How cute 😊`,
        (a) => `Aww, **${a}** turned red! 🍎`,
        (a) => `**${a}** is blushing so hard right now~ 💕`,
    ],
    happy: [
        (a) => `**${a}** is absolutely happy right now! 😄`,
        (a) => `**${a}** is full of joy! 🎉`,
        (a) => `Nothing can stop **${a}** from being happy! ✨`,
    ],
    laugh: [
        (a) => `**${a}** is DYING of laughter 😂`,
        (a) => `HAHAHA **${a}** can't stop laughing! 🤣`,
        (a) => `**${a}** is laughing way too hard 😹`,
    ],
    sleep: [
        (a) => `**${a}** fell asleep... zzz 😴`,
        (a) => `**${a}** is out cold 💤`,
        (a) => `Shh, **${a}** is sleeping~ 😪`,
    ],
    wave: [
        (a) => `**${a}** is waving! 👋`,
        (a) => `Hey! **${a}** waved at everyone~ 👋`,
        (a) => `**${a}** says hi! 🙌`,
    ],
};

function buildMessage(action, actionName, authorName, targetName, count) {
    if (action.target && targetName) {
        const o = ordinal(count);
        const templates = PAIR_TEMPLATES[actionName];
        if (templates) {
            return pick(templates)(authorName, targetName, o);
        }
        return defaultPairTemplate(authorName, targetName, o, action);
    } else {
        const templates = SOLO_TEMPLATES[actionName];
        if (templates) {
            return pick(templates)(authorName);
        }
        // Default solo message
        return `**${authorName}** ${action.label}! ${action.emoji}`;
    }
}

// ══════════════════════════════════════════════════════════
// SELF-ACTION MESSAGES
// ══════════════════════════════════════════════════════════
const SELF_MESSAGES = {
    hug: `You can't hug yourself... go touch grass 🌿`,
    kiss: `Kissing yourself? Bold move. Maybe try a mirror instead 💋`,
    slap: `Self-slapping? That's a new level of commitment 🤦`,
    pat: `You can't pat yourself on the head. Well, you can, but it's sad 😔`,
    cuddle: `Cuddling yourself? That's called sleeping 😴`,
    bite: `Biting yourself? That's just self-harm 😬`,
    punch: `Don't punch yourself, you'll regret it 🤕`,
    bonk: `You can't bonk yourself! Go to horny jail alone I guess 🔨`,
    poke: `Stop poking yourself. Weirdo 👉`,
    tickle: `You can't tickle yourself effectively. Science fact 🧪`,
    kill: `Existential crisis mode activated 💀`,
    yeet: `You tried to yeet yourself into another dimension 🚀`,
};

function getSelfMessage(actionName) {
    return SELF_MESSAGES[actionName] || `You can't do that to yourself... go touch grass 🌿`;
}

// All command names (for dispatch & registration)
const ROLEPLAY_COMMANDS = new Set(Object.keys(ACTIONS));

// ══════════════════════════════════════════════════════════
// COOLDOWN — 3 seconds per user
// ══════════════════════════════════════════════════════════
const cooldowns = new Map();
const COOLDOWN_MS = 3000;

function checkCooldown(userId) {
    const last = cooldowns.get(userId);
    if (last && Date.now() - last < COOLDOWN_MS) {
        return Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    }
    return 0;
}

// ══════════════════════════════════════════════════════════
// GIF FETCHER
// ══════════════════════════════════════════════════════════
async function fetchGif(api, type) {
    try {
        if (api === 'nekos') {
            const res = await fetch(`https://nekos.best/api/v2/${type}`);
            if (!res.ok) throw new Error(`nekos.best ${res.status}`);
            const data = await res.json();
            return data.results?.[0]?.url || null;
        }
        if (api === 'waifu') {
            const res = await fetch(`https://api.waifu.pics/sfw/${type}`);
            if (!res.ok) throw new Error(`waifu.pics ${res.status}`);
            const data = await res.json();
            return data.url || null;
        }
    } catch (err) {
        logger.error('ROLEPLAY', `GIF fetch failed (${api}/${type})`, err);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
// EMBED BUILDER
// ══════════════════════════════════════════════════════════
function buildRoleplayEmbed(action, actionName, authorName, authorAvatar, targetName, gifUrl, count) {
    const message = buildMessage(action, actionName, authorName, targetName, count);
    const color = action.color || COLORS.primary;

    const embed = new EmbedBuilder()
        .setAuthor({ name: authorName, iconURL: authorAvatar || undefined })
        .setDescription(`${action.emoji} ${message}`)
        .setColor(color)
        .setTimestamp();

    if (gifUrl) embed.setImage(gifUrl);

    if (action.target && targetName && count > 0) {
        embed.setFooter({ text: `Powered by Kaido • ${count} time${count !== 1 ? 's' : ''} ${action.label} together` });
    } else {
        embed.setFooter({ text: `Powered by Kaido` });
    }

    return embed;
}

// ══════════════════════════════════════════════════════════
// MAIN HANDLER (prefix & slash compatible)
// ══════════════════════════════════════════════════════════
async function handleRoleplay(ctx, actionName, targetUser, customImageUrl) {
    const isInteraction = !!ctx.deferReply;
    const authorId = isInteraction ? ctx.user.id : ctx.author.id;
    const authorName = isInteraction ? ctx.user.username : ctx.author.username;
    const authorAvatar = isInteraction
        ? ctx.user.displayAvatarURL({ dynamic: true })
        : ctx.author.displayAvatarURL({ dynamic: true });

    // Cooldown check
    const wait = checkCooldown(authorId);
    if (wait > 0) {
        const msg = `⏳ Wait **${wait}s** before using another roleplay command.`;
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }
    cooldowns.set(authorId, Date.now());

    const action = ACTIONS[actionName];
    if (!action) {
        const msg = `❌ Unknown roleplay action: \`${actionName}\``;
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }

    // Self-action check
    if (action.target && targetUser && targetUser.id === authorId) {
        const msg = getSelfMessage(actionName);
        if (isInteraction) return ctx.reply({ content: msg, ephemeral: true });
        return ctx.reply({ content: msg });
    }

    // Defer for slash interactions
    if (isInteraction) await ctx.deferReply();

    // ── Pair counter (only for targeted actions with a real user) ──
    let count = 0;
    if (action.target && targetUser && targetUser.id !== authorId) {
        const guildId = isInteraction ? ctx.guildId : ctx.guild?.id;
        if (guildId) {
            const db = getGuildDb(guildId);
            const rpCounts = db.get('rpCounts', {});
            const key = `${authorId}:${targetUser.id}:${actionName}`;
            rpCounts[key] = (rpCounts[key] || 0) + 1;
            count = rpCounts[key];
            db.set('rpCounts', rpCounts);
        }
    }

    // ── GIF RESOLUTION (priority: customGif > customImageUrl from args > API fetch) ──
    let gifUrl = null;

    // 1. Check if this action has a customGif configured in the ACTIONS map
    if (action.customGif && action.customGif.startsWith('http')) {
        gifUrl = action.customGif;
    }
    // 2. If no customGif, check if user passed a custom image URL in the command args
    else if (customImageUrl && customImageUrl.startsWith('http')) {
        gifUrl = customImageUrl;
    }
    // 3. Otherwise, fetch from the API
    else {
        gifUrl = await fetchGif(action.api, action.type);
    }

    const targetName = targetUser?.username || null;
    const embed = buildRoleplayEmbed(action, actionName, authorName, authorAvatar, targetName, gifUrl, count);

    const content = action.target && targetUser ? `<@${targetUser.id}>` : undefined;
    const payload = { embeds: [embed], ...(content ? { content } : {}) };

    if (isInteraction) return ctx.editReply(payload);
    return ctx.channel.send(payload);
}

module.exports = { handleRoleplay, ROLEPLAY_COMMANDS };