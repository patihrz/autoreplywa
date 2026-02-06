const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const TARGET_NUMBER = process.env.TARGET_NUMBER || '';
const TARGET_JID = TARGET_NUMBER ? jidNormalizedUser(TARGET_NUMBER) : '';
// If messages arrive as LID, put the target LID here (see logs: "from: '...@lid'")
const TARGET_LID = process.env.TARGET_LID || '';
const AUTO_REPLY_MESSAGES = [
  "Halo 👋 Maaf ya, sekarang aku lagi nggak pegang HP jadi belum bisa balas. Pesan kamu sudah aku terima dan nanti akan aku balas secepatnya kalau sudah memungkinkan. Sambil nunggu, jangan lupa makan dan istirahat ya 😊 Terima kasih ya sudah nunggu 🙏",
  "Haii, maaf ya aku lagi away dulu. Nanti aku kabarin begitu bisa bales. Jangan lupa makan ya, biar tetap fit 🙏",
  "Halo! Lagi nggak bisa bales dulu ya. Pesan kamu sudah aku baca, nanti aku balas pas sempat. Istirahat dulu kalau capek 😊",
  "Maaf ya, lagi nggak pegang HP. Aku balas nanti ya. Sambil nunggu, jangan lupa minum air putih 🙏",
  "Hey, aku lagi off dulu. Nanti aku bales pas sudah bisa. Jangan lupa makan teratur ya 😊",
];
const REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 jam
const REPLY_DELAY_MIN_MS = 3000;
const REPLY_DELAY_MAX_MS = 5000;

const repliedMap = new Map();

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

async function startBot() {
  if (!TARGET_JID && !TARGET_LID) {
    throw new Error('Missing target. Set TARGET_NUMBER or TARGET_LID environment variables.');
  }

  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console),
    },
    printQRInTerminal: true, // QR otomatis ditampilkan oleh Baileys
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR ready. Scan from WhatsApp > Linked Devices.');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnect:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('Connection opened.');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (!msg.message) continue; // abaikan pesan tanpa konten
      if (msg.key.fromMe) continue; // jangan reply ke pesan sendiri

      const jid = jidNormalizedUser(msg.key.remoteJid || '');
      if (!jid) {
        console.log('Skip: invalid JID');
        continue;
      }
      if (jid.endsWith('@g.us')) {
        console.log('Skip: group message', jid);
        continue;
      }
      const isTarget = jid === TARGET_JID || (TARGET_LID && jid === TARGET_LID);
      if (!isTarget) {
        console.log('Skip: not target', { from: jid, target: TARGET_JID, targetLid: TARGET_LID });
        continue; // hanya reply ke target
      }

      const lastRepliedAt = repliedMap.get(jid) || 0;
      const now = Date.now();
      if (now - lastRepliedAt < REPLY_COOLDOWN_MS) {
        const remainingMs = REPLY_COOLDOWN_MS - (now - lastRepliedAt);
        console.log('Skip: cooldown', { jid, remainingMinutes: Math.ceil(remainingMs / 60000) });
        continue; // anti spam 24 jam
      }

      const delayMs = randomDelay(REPLY_DELAY_MIN_MS, REPLY_DELAY_MAX_MS);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const replyText = pickRandomMessage(AUTO_REPLY_MESSAGES);
      await sock.sendMessage(jid, { text: replyText });
      repliedMap.set(jid, now);
      console.log('Reply sent', { jid, delayMs });
    }
  });
}

startBot().catch((err) => {
  console.error('Failed to start bot:', err);
});
