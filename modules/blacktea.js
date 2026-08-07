const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { success: mkSuccess, error: mkError, info: mkInfo } = require('../utils/embeds');
const { getGuildDb } = require('./database');

// ══════════════════════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════════════════════
const activeGames = new Map();   // channelId -> GameSession
const lockedPlayers = new Set(); // userIds in ANY blacktea game

// ══════════════════════════════════════════════════════════
// DICTIONARY & SEQUENCE CACHE (populated once at startup)
// ══════════════════════════════════════════════════════════
let dictionarySet = new Set();
let validSequences = [];
let sequenceToWords = new Map();

function initBlacktea(dictArray) {
  dictionarySet = new Set(dictArray);
  const seqSet = new Set();

  for (const word of dictArray) {
    if (word.length < 3) continue;
    const lower = word.toLowerCase();
    for (let i = 0; i <= lower.length - 3; i++) {
      const seq = lower.substring(i, i + 3);
      if (!/^[a-z]{3}$/.test(seq)) continue;
      seqSet.add(seq);
      if (!sequenceToWords.has(seq)) sequenceToWords.set(seq, []);
      sequenceToWords.get(seq).push(lower);
    }
  }

  // Only keep sequences that appear in at least 5 dictionary words
  validSequences = Array.from(seqSet).filter(seq => {
    const words = sequenceToWords.get(seq);
    return words && words.length >= 5;
  });

  logger.info('BLACKTEA', `Initialized with ${validSequences.length} valid 3-letter sequences`);
}

// ══════════════════════════════════════════════════════════
// GAME SESSION
// ══════════════════════════════════════════════════════════
class GameSession {
  constructor(channel, hostId, hostUser) {
    this.channel = channel;
    this.hostId = hostId;
    this.hostUser = hostUser;
    this.players = new Map();      // userId -> { user, lives, eliminated }
    this.turnOrder = [];
    this.currentTurnIndex = -1;
    this.usedWords = new Set();
    this.usedSequences = new Set();
    this.lobbyMessage = null;
    this.promptMessage = null;
    this.currentSequence = null;
    this.currentPlayerId = null;
    this.lobbyCollector = null;
    this.turnTimeout = null;
    this.countdownTimeouts = [];
    this.gameActive = false;
    this.lobbyActive = false;
    this.ended = false;
  }

  // ── Lobby ──
  async startLobby() {
    this.lobbyActive = true;

    const embed = this._buildLobbyEmbed(30);
    try {
      this.lobbyMessage = await this.channel.send({ embeds: [embed] });
      await this.lobbyMessage.react('✅').catch(() => {});
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to send lobby message', err);
      this.cleanup();
      return;
    }

    // Host is auto-added but CAN remove their reaction before lobby ends
    this.players.set(this.hostId, { user: this.hostUser, lives: 2, eliminated: false });
    lockedPlayers.add(this.hostId);

    const filter = (reaction, user) => reaction.emoji.name === '✅' && !user.bot;
    this.lobbyCollector = this.lobbyMessage.createReactionCollector({
      filter,
      time: 30000,
      dispose: true,
    });

    this.lobbyCollector.on('collect', (reaction, user) => {
      if (this.ended || !this.lobbyActive) return;
      if (lockedPlayers.has(user.id) && !this.players.has(user.id)) {
        reaction.users.remove(user.id).catch(() => {});
        return;
      }
      if (!this.players.has(user.id)) {
        this.players.set(user.id, { user, lives: 2, eliminated: false });
        lockedPlayers.add(user.id);
        this._updateLobbyEmbed();
      }
    });

    this.lobbyCollector.on('remove', (reaction, user) => {
      if (this.ended || !this.lobbyActive) return;
      this.players.delete(user.id);
      lockedPlayers.delete(user.id);
      this._updateLobbyEmbed();
    });

    // Live countdown updates every 5s (rate-limit friendly)
    let timeLeft = 30;
    const interval = setInterval(() => {
      timeLeft -= 5;
      if (timeLeft <= 0 || this.ended || !this.lobbyActive) {
        clearInterval(interval);
        return;
      }
      this._updateLobbyEmbed(timeLeft);
    }, 5000);

    this.lobbyCollector.on('end', async () => {
      clearInterval(interval);
      if (this.ended) return;
      await this._finalizeLobby();
    });
  }

  _buildLobbyEmbed(timeLeft = 30) {
    const playerList = Array.from(this.players.values())
      .map(p => `• ${p.user.username}`)
      .join('\n') || 'No players yet';

    return new EmbedBuilder()
      .setTitle('🍵 Blacktea Game')
      .setDescription(
        'React with ✅ to join the game!\n\n' +
        '**Rules:**\n' +
        '• Lobby lasts 30 seconds\n' +
        '• Everyone starts with 2 lives\n' +
        '• Last player alive wins\n' +
        '• Every turn you\'ll be asked to type an English word containing 3 given letters\n\n' +
        `**Time remaining:** ${timeLeft}s`
      )
      .addFields(
        { name: `Current Players (${this.players.size})`, value: playerList, inline: true }
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Blacktea Lobby' })
      .setTimestamp();
  }

  async _updateLobbyEmbed(timeLeft) {
    if (!this.lobbyMessage || this.ended) return;
    try {
      const embed = this._buildLobbyEmbed(timeLeft);
      await this.lobbyMessage.edit({ embeds: [embed] });
    } catch (err) {
      if (err.code === 10008) {
        this.forceEnd('The Blacktea game was cancelled because the lobby message was deleted.');
      } else {
        logger.error('BLACKTEA', 'Failed to update lobby embed', err);
      }
    }
  }

  async _finalizeLobby() {
    this.lobbyActive = false;

    // Double-check reactions on the message to ensure accuracy
    try {
      const msg = await this.channel.messages.fetch(this.lobbyMessage.id);
      const reaction = msg.reactions.cache.get('✅');
      if (reaction) {
        const users = await reaction.users.fetch();
        // Add anyone who reacted but wasn't tracked (cache miss / race)
        for (const [userId, user] of users) {
          if (user.bot) continue;
          if (!this.players.has(userId) && !lockedPlayers.has(userId)) {
            this.players.set(userId, { user, lives: 2, eliminated: false });
            lockedPlayers.add(userId);
          }
        }
        // Remove anyone who no longer has the reaction
        for (const [userId] of new Map(this.players)) {
          if (!users.has(userId)) {
            this.players.delete(userId);
            lockedPlayers.delete(userId);
          }
        }
      }
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to finalize lobby reactions', err);
    }

    if (this.players.size < 2) {
      await this.channel.send({
        embeds: [mkError('Not Enough Players', 'At least 2 players are required to start Blacktea. The game has been cancelled.')]
      }).catch(() => {});
      this.cleanup();
      return;
    }

    // Start game
    this.turnOrder = Array.from(this.players.keys()).sort(() => Math.random() - 0.5);
    this.currentTurnIndex = -1;
    this.gameActive = true;

    await this.channel.send(
      `🍵 **Blacktea is starting!** ${this.players.size} players, 2 lives each. Good luck!`
    ).catch(() => {});

    await this.nextTurn();
  }

  // ── Turn Engine ──
  async nextTurn() {
    if (this.ended) return;
    try {
      let attempts = 0;
      let nextPlayerId = null;
      let nextPlayer = null;

      do {
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
        nextPlayerId = this.turnOrder[this.currentTurnIndex];
        nextPlayer = this.players.get(nextPlayerId);
        attempts++;
      } while ((nextPlayer?.eliminated) && attempts < this.turnOrder.length);

      if (!nextPlayer || nextPlayer.eliminated) {
        const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
        if (alive.length === 1) {
          await this._declareWinner(alive[0]);
          return;
        }
        await this.forceEnd('The game ended unexpectedly.');
        return;
      }

      // Verify player is still in the guild
      const member = await this.channel.guild.members.fetch(nextPlayerId).catch(() => null);
      if (!member) {
        nextPlayer.eliminated = true;
        await this.channel.send(`<@${nextPlayerId}> is no longer in the server and has been eliminated!`).catch(() => {});
        const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
        if (alive.length === 1) {
          await this._declareWinner(alive[0]);
          return;
        }
        await this.nextTurn();
        return;
      }

      this.currentPlayerId = nextPlayerId;
      await this._sendTurnPrompt();
      await this._startTurnTimer();
    } catch (err) {
      logger.error('BLACKTEA', 'Error in nextTurn', err);
      await this.forceEnd('The Blacktea game ended due to an error.');
    }
  }

  async _sendTurnPrompt() {
    // Generate a fresh sequence never used in this game
    let seq = null;
    const available = validSequences.filter(s => !this.usedSequences.has(s));
    const pool = available.length > 0 ? available : validSequences;
    seq = pool[Math.floor(Math.random() * pool.length)];
    this.usedSequences.add(seq);
    this.currentSequence = seq;

    try {
      this.promptMessage = await this.channel.send({
        content: `<@${this.currentPlayerId}>`,
        embeds: [
          new EmbedBuilder()
            .setDescription(`Type an English word containing\n\n**${seq.toUpperCase()}**`)
            .setColor('#5865F2')
            .setFooter({ text: 'You have 10 seconds!' })
        ]
      });
    } catch (err) {
      logger.error('BLACKTEA', 'Failed to send turn prompt', err);
      await this.forceEnd('The Blacktea game ended because the prompt could not be sent.');
    }
  }

  async _startTurnTimer() {
    this.turnTimeout = setTimeout(() => this._handleTurnTimeout(), 10000);

    this.countdownTimeouts.push(
      setTimeout(() => this._addCountdownReaction('3️⃣'), 7000),
      setTimeout(() => this._swapCountdownReaction('3️⃣', '2️⃣'), 8000),
      setTimeout(() => this._swapCountdownReaction('2️⃣', '1️⃣'), 9000)
    );
  }

  async _addCountdownReaction(emoji) {
    if (!this.promptMessage || this.ended) return;
    await this.promptMessage.react(emoji).catch(() => {});
  }

  async _swapCountdownReaction(oldEmoji, newEmoji) {
    if (!this.promptMessage || this.ended) return;
    await this.promptMessage.reactions.cache.get(oldEmoji)?.users.remove(this.channel.client.user.id).catch(() => {});
    await this.promptMessage.react(newEmoji).catch(() => {});
  }

  async _clearCountdownReactions() {
    if (!this.promptMessage) return;
    for (const emoji of ['3️⃣', '2️⃣', '1️⃣']) {
      await this.promptMessage.reactions.cache.get(emoji)?.users.remove(this.channel.client.user.id).catch(() => {});
    }
  }

  _clearTurnTimers() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
    for (const t of this.countdownTimeouts) clearTimeout(t);
    this.countdownTimeouts = [];
  }

  // ── Guess Handling ──
  async handleGuess(message) {
    if (this.ended || !this.gameActive) return;
    if (message.author.id !== this.currentPlayerId) return;

    const guess = message.content.trim().toLowerCase();
    if (!guess || guess.length < 3) return;
    if (!/^[a-z]+$/.test(guess)) return;
    if (!dictionarySet.has(guess)) return;
    if (!guess.includes(this.currentSequence)) return;
    if (this.usedWords.has(guess)) return;

    // Valid word
    this.usedWords.add(guess);
    await message.react('✅').catch(() => {});
    await this._endTurn(true);
  }

  async _endTurn(success) {
    this._clearTurnTimers();
    await this._clearCountdownReactions();
    if (success && !this.ended) {
      await this.nextTurn();
    }
  }

  async _handleTurnTimeout() {
    if (this.ended || !this.gameActive) return;
    this._clearTurnTimers();
    await this._clearCountdownReactions();

    const player = this.players.get(this.currentPlayerId);
    if (!player) {
      await this.nextTurn();
      return;
    }

    player.lives--;

    if (player.lives === 1) {
      await this.channel.send(`<@${this.currentPlayerId}> lost a life! ❤️ 1 life remaining.`).catch(() => {});
      await this.nextTurn();
    } else if (player.lives <= 0) {
      player.eliminated = true;
      await this.channel.send(`<@${this.currentPlayerId}> has been eliminated!`).catch(() => {});

      const alive = Array.from(this.players.values()).filter(p => !p.eliminated);
      if (alive.length === 1) {
        await this._declareWinner(alive[0]);
        return;
      }
      await this.nextTurn();
    } else {
      // Should never happen (starts at 2, only loses 1 at a time), but safe fallback
      await this.nextTurn();
    }
  }

  // ── Winner ──
  async _declareWinner(winner) {
    if (this.ended) return;
    this.ended = true;
    this.gameActive = false;

    const embed = new EmbedBuilder()
      .setTitle('🏆 BLACKTEA WINNER')
      .setDescription(`Congratulations <@${winner.user.id}>!\n\nYou are the last player standing!`)
      .setColor('#FFD700')
      .setTimestamp();

    await this.channel.send({ embeds: [embed] }).catch(() => {});
    this.cleanup();
  }

  // ── Admin Force End ──
  async forceEnd(reason) {
    if (this.ended) return;
    this.ended = true;
    this.gameActive = false;
    this.lobbyActive = false;

    this._clearTurnTimers();
    if (this.lobbyCollector) {
      this.lobbyCollector.stop();
      this.lobbyCollector = null;
    }

    if (reason) {
      await this.channel.send(reason).catch(() => {});
    }
    this.cleanup();
  }

  // ── Cleanup ──
  cleanup() {
    this.ended = true;
    this.gameActive = false;
    this.lobbyActive = false;

    if (this.lobbyCollector) {
      this.lobbyCollector.stop();
      this.lobbyCollector = null;
    }
    this._clearTurnTimers();

    for (const [userId] of this.players) {
      lockedPlayers.delete(userId);
    }
    lockedPlayers.delete(this.hostId);

    activeGames.delete(this.channel.id);
  }
}

// ══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ══════════════════════════════════════════════════════════
async function handleBlackteaCommand(message, args, client) {
  const channelId = message.channel.id;

  // Admin end
  if (args[0]?.toLowerCase() === 'end') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply({ embeds: [mkError('Permission Denied', 'You need the **Manage Messages** permission.')] });
    }
    const game = activeGames.get(channelId);
    if (!game) {
      return message.reply({ embeds: [mkError('No Active Game', 'There is no active Blacktea game.')] });
    }
    await game.forceEnd('The Blacktea game has been ended by a moderator.');
    return;
  }

  // Start new game
  if (activeGames.has(channelId)) {
    return message.reply({ embeds: [mkError('Game Already Active', 'There is already an active Blacktea game in this channel.')] });
  }

  if (lockedPlayers.has(message.author.id)) {
    return message.reply({ embeds: [mkError('Already in Game', 'You are already participating in a Blacktea game in another channel.')] });
  }

  const game = new GameSession(message.channel, message.author.id, message.author);
  activeGames.set(channelId, game);
  lockedPlayers.add(message.author.id);
  await game.startLobby();
}

async function handleBlackteaMessage(message) {
  const game = activeGames.get(message.channel.id);
  if (!game?.gameActive) return false;
  if (game.currentPlayerId !== message.author.id) return false;

  // Do not treat prefix commands as guesses
  try {
    const db = getGuildDb(message.guild.id);
    const prefix = db.get('settings', {}).prefix || ',';
    if (message.content.startsWith(prefix)) return false;
  } catch {
    if (message.content.startsWith(',')) return false;
  }

  await game.handleGuess(message);
  return true; // consume the message so it is not processed as a command
}

async function handleBlackteaSlash(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.channel.id;
  if (activeGames.has(channelId)) {
    return interaction.editReply({ content: '❌ There is already an active Blacktea game in this channel.' });
  }

  if (lockedPlayers.has(interaction.user.id)) {
    return interaction.editReply({ content: '❌ You are already participating in a Blacktea game in another channel.' });
  }

  const game = new GameSession(interaction.channel, interaction.user.id, interaction.user);
  activeGames.set(channelId, game);
  lockedPlayers.add(interaction.user.id);

  try {
    await game.startLobby();
    await interaction.editReply({ content: '✅ Blacktea lobby started! React with ✅ to join.' });
  } catch (err) {
    logger.error('BLACKTEA', 'Slash lobby start error', err);
    activeGames.delete(channelId);
    lockedPlayers.delete(interaction.user.id);
    await interaction.editReply({ content: '❌ Failed to start the Blacktea game.' });
  }
}

module.exports = {
  initBlacktea,
  handleBlackteaCommand,
  handleBlackteaMessage,
  handleBlackteaSlash,
};