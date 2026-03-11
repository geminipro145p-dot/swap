const fs = require('fs');
const path = require('path');
const os = require('os');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = '8714218476:AAHseToA2mid2asO1RSbu5QO70RQfg3v4Gg';
const ADMIN_ID = 7065784096;
const BOT_USERNAME = '@faceeswappbot';
const REQUIRED_GROUP = '@saveemoney';
const CONTACT_USERNAME = '@danishh0077';
const API_URL = 'https://ab-faceswap.vercel.app/swap';
const FREE_START_CREDITS = 5;
const REFERRAL_REWARD = 3;
const CREDITS_PER_RUPEE = 2;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_DIR = path.join(DATA_DIR, 'tmp');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function defaultDb() {
  return {
    users: {},
    orders: {},
    meta: {
      orderCounter: 1000,
      paymentQrFileId: '',
      replyMap: {},
      paymentReplyMap: {},
      supportReplyMap: {},
      qrSetBy: null,
      qrSetAt: null,
    },
  };
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = defaultDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      return db;
    }
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      ...defaultDb(),
      ...raw,
      meta: { ...defaultDb().meta, ...(raw.meta || {}) },
      users: raw.users || {},
      orders: raw.orders || {},
    };
  } catch (e) {
    console.error('DB load error:', e);
    return defaultDb();
  }
}

let db = loadDb();
function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const sessions = new Map();

function htmlEscape(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mentionUser(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'User';
  if (user.username) return `@${user.username}`;
  return htmlEscape(name);
}

function getUser(id, tgUser = null) {
  id = String(id);
  if (!db.users[id]) {
    db.users[id] = {
      id: Number(id),
      username: tgUser?.username || '',
      firstName: tgUser?.first_name || '',
      lastName: tgUser?.last_name || '',
      credits: FREE_START_CREDITS,
      joinedRequiredGroup: false,
      verified: false,
      referredBy: null,
      referralRewardClaimed: false,
      referrals: [],
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      state: null,
      pendingReferral: null,
      pendingOrderId: null,
      swap: {},
      stats: { swapsDone: 0 },
    };
  }
  if (tgUser) {
    db.users[id].username = tgUser.username || db.users[id].username || '';
    db.users[id].firstName = tgUser.first_name || db.users[id].firstName || '';
    db.users[id].lastName = tgUser.last_name || db.users[id].lastName || '';
    db.users[id].lastSeenAt = new Date().toISOString();
  }
  saveDb();
  return db.users[id];
}

function setState(userId, state, extra = {}) {
  const user = getUser(userId);
  user.state = state;
  Object.assign(user, extra);
  saveDb();
}

function clearState(userId) {
  const user = getUser(userId);
  user.state = null;
  user.swap = {};
  user.pendingOrderId = null;
  saveDb();
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸 Swap Photo', callback_data: 'menu_swap' }],
        [
          { text: '💰 Buy Credits', callback_data: 'menu_buy' },
          { text: '👛 My Wallet', callback_data: 'menu_wallet' },
        ],
        [
          { text: '🎁 Refer & Earn', callback_data: 'menu_refer' },
          { text: '📜 Rules', callback_data: 'menu_rules' },
        ],
      ],
    },
    parse_mode: 'HTML',
  };
}

function joinMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Join Group', url: 'https://t.me/saveemoney' }],
        [{ text: '🔍 Verify', callback_data: 'verify_join' }],
      ],
    },
    parse_mode: 'HTML',
  };
}

async function safeDelete(chatId, messageId) {
  try { await bot.deleteMessage(chatId, String(messageId)); } catch (_) {}
}

async function isUserJoined(userId) {
  try {
    const member = await bot.getChatMember(REQUIRED_GROUP, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    console.error('Join check failed:', e.message);
    return false;
  }
}

async function ensureVerified(chatId, user) {
  if (!user.verified) {
    await bot.sendMessage(
      chatId,
      '🚫 <b>Access locked!</b>\n\nपहले हमारी group join करो, फिर <b>Verify</b> दबाओ।\n\nWithout joining the group, bot work nahi karega 😎',
      joinMenu()
    );
    return false;
  }
  return true;
}

function rulesText(user) {
  return (
`🎉 <b>Welcome to Face Swap Bot</b>\n\n` +
`👛 <b>Your Credits:</b> ${user.credits}\n` +
`🎁 <b>Free Joining Bonus:</b> ${FREE_START_CREDITS} credits\n` +
`👥 <b>Referral Reward:</b> ${REFERRAL_REWARD} credits per verified referral\n` +
`🖼 <b>1 credit = 1 photo face swap</b>\n` +
`💸 <b>Price:</b> ${CREDITS_PER_RUPEE} credits = ₹1\n\n` +
`📌 <b>Rules:</b>\n` +
`• Har swap me 1 credit cut hoga\n` +
`• Payment ke baad screenshot bhejna zaroori hai\n` +
`• Fake payment pe credits add nahi honge\n` +
`• Kisi problem me contact: ${CONTACT_USERNAME}\n\n` +
`👇 <b>Use buttons below</b>`
  );
}

function walletText(user) {
  return (
`👛 <b>Your Wallet</b>\n\n` +
`💎 Credits: <b>${user.credits}</b>\n` +
`🎁 Referrals: <b>${(user.referrals || []).length}</b>\n` +
`🖼 Swaps Done: <b>${user.stats?.swapsDone || 0}</b>\n\n` +
`1 photo swap = 1 credit`
  );
}

function referralLink(userId) {
  return `https://t.me/${BOT_USERNAME.replace('@', '')}?start=ref_${userId}`;
}

async function notifyAdminUserMessage(msg) {
  if (msg.from?.id === ADMIN_ID) return;
  const from = msg.from || {};
  const user = getUser(from.id, from);
  let metaText =
    `📥 <b>User Message Alert</b>\n\n` +
    `👤 User: ${htmlEscape([from.first_name, from.last_name].filter(Boolean).join(' ') || 'Unknown')}\n` +
    `🆔 ID: <code>${from.id}</code>\n` +
    `👛 Credits: <b>${user.credits}</b>\n` +
    `🔗 Username: ${from.username ? '@' + htmlEscape(from.username) : 'N/A'}\n` +
    `💬 Reply to this message to answer user.`;

  try {
    if (msg.text && !msg.text.startsWith('/')) {
      const sent = await bot.sendMessage(ADMIN_ID, `${metaText}\n\n📝 <b>Text:</b> ${htmlEscape(msg.text)}`, { parse_mode: 'HTML' });
      db.meta.replyMap[String(sent.message_id)] = from.id;
      saveDb();
      return;
    }

    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1].file_id;
      const sentPhoto = await bot.sendPhoto(ADMIN_ID, largest, {
        caption: `${metaText}\n\n🖼 <b>Photo received from user.</b>`,
        parse_mode: 'HTML',
      });
      db.meta.replyMap[String(sentPhoto.message_id)] = from.id;
      saveDb();
      return;
    }

    if (msg.document) {
      const sentDoc = await bot.sendDocument(ADMIN_ID, msg.document.file_id, {
        caption: `${metaText}\n\n📎 <b>Document:</b> ${htmlEscape(msg.document.file_name || 'file')}`,
        parse_mode: 'HTML',
      });
      db.meta.replyMap[String(sentDoc.message_id)] = from.id;
      saveDb();
    }
  } catch (e) {
    console.error('Admin notify error:', e.message);
  }
}

async function processReferralReward(user) {
  if (!user.pendingReferral || user.referralRewardClaimed) return;
  const referrer = getUser(user.pendingReferral);
  if (String(referrer.id) === String(user.id)) return;
  referrer.credits += REFERRAL_REWARD;
  referrer.referrals = Array.from(new Set([...(referrer.referrals || []), user.id]));
  user.referredBy = referrer.id;
  user.referralRewardClaimed = true;
  saveDb();
  try {
    await bot.sendMessage(
      referrer.id,
      `🎉 <b>Referral Reward Added!</b>\n\n` +
      `A new user joined and verified using your link.\n` +
      `💎 +${REFERRAL_REWARD} credits added to your wallet.\n\n` +
      `👛 New balance: <b>${referrer.credits}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (_) {}
}

function newOrderId() {
  db.meta.orderCounter += 1;
  saveDb();
  return `ORD${db.meta.orderCounter}`;
}

function calcAmount(credits) {
  return (credits / CREDITS_PER_RUPEE).toFixed(2);
}

async function showPaymentQr(chatId, order) {
  const text =
    `💳 <b>Payment Order Created</b>\n\n` +
    `🧾 Order ID: <code>${order.id}</code>\n` +
    `💎 Credits: <b>${order.credits}</b>\n` +
    `💰 Amount: <b>₹${order.amount}</b>\n\n` +
    `QR scan karke payment karo, phir <b>Paid</b> dabao.\n` +
    `⚠️ Payment fake hua to credits add nahi honge.`;

  const keyboard = {
    inline_keyboard: [[
      { text: '❌ Cancel Payment', callback_data: `pay_cancel_${order.id}` },
      { text: '✅ Paid', callback_data: `pay_done_${order.id}` },
    ]],
  };

  if (db.meta.paymentQrFileId) {
    await bot.sendPhoto(chatId, db.meta.paymentQrFileId, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } else {
    await bot.sendMessage(chatId, text + '\n\n⚠️ Admin ne abhi QR set nahi kiya hai.', {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

async function createOrder(userId, credits) {
  const orderId = newOrderId();
  const order = {
    id: orderId,
    userId,
    credits,
    amount: calcAmount(credits),
    status: 'awaiting_payment',
    createdAt: new Date().toISOString(),
    screenshotFileId: '',
    adminMessageId: null,
    paymentRequestedAt: null,
  };
  db.orders[orderId] = order;
  saveDb();
  return order;
}

async function startSwap(chatId, user) {
  if (user.credits < 1) {
    await bot.sendMessage(
      chatId,
      `😕 <b>Insufficient credits</b>\n\n1 photo swap ke liye 1 credit chahiye.\nBuy ya refer karke credits lo.`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '💰 Buy Credits', callback_data: 'menu_buy' }]] },
      }
    );
    return;
  }
  user.swap = {};
  user.state = 'awaiting_source';
  saveDb();
  await bot.sendMessage(
    chatId,
    `📸 <b>Step 1/2</b>\n\nपहले <b>source photo</b> bhejo jiska face lena hai.`,
    { parse_mode: 'HTML' }
  );
}

async function downloadTelegramFile(fileId, outName) {
  const url = await bot.getFileLink(fileId);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Telegram se image download nahi hui');
  const buffer = Buffer.from(await res.arrayBuffer());
  const p = path.join(TMP_DIR, outName);
  fs.writeFileSync(p, buffer);
  return p;
}

async function swapFaces(sourcePath, targetPath) {
  const form = new FormData();
  form.append('source', new Blob([fs.readFileSync(sourcePath)]), 'source.jpg');
  form.append('target', new Blob([fs.readFileSync(targetPath)]), 'target.jpg');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Android)',
      origin: 'https://ab-faceswap.vercel.app',
      referer: 'https://ab-faceswap.vercel.app/',
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown API error');
    throw new Error(`Face swap API failed: ${res.status} ${text}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function performSwap(chatId, tgUser, targetFileId) {
  const user = getUser(chatId, tgUser);
  const session = sessions.get(chatId) || { busy: false };
  if (session.busy) {
    await bot.sendMessage(chatId, '⏳ Ek swap already process ho raha hai.');
    return;
  }
  if (user.credits < 1) {
    clearState(chatId);
    await bot.sendMessage(chatId, '😕 Credits khatam ho gaye. Pehle credits lo.', {
      reply_markup: { inline_keyboard: [[{ text: '💰 Buy Credits', callback_data: 'menu_buy' }]] },
    });
    return;
  }

  session.busy = true;
  sessions.set(chatId, session);
  let sourcePath = null;
  let targetPath = null;
  let resultPath = null;
  try {
    await bot.sendMessage(chatId, '✨ Face swap ho raha hai... thoda wait karo.');
    sourcePath = await downloadTelegramFile(user.swap.sourceFileId, `source_${chatId}_${Date.now()}.jpg`);
    targetPath = await downloadTelegramFile(targetFileId, `target_${chatId}_${Date.now()}.jpg`);
    const result = await swapFaces(sourcePath, targetPath);
    resultPath = path.join(TMP_DIR, `result_${chatId}_${Date.now()}.jpg`);
    fs.writeFileSync(resultPath, result);

    user.credits -= 1;
    user.state = null;
    user.swap = {};
    user.stats = user.stats || { swapsDone: 0 };
    user.stats.swapsDone += 1;
    saveDb();

    await bot.sendPhoto(chatId, resultPath, {
      caption:
        `✅ <b>Swap Complete!</b>\n\n` +
        `💎 1 credit deducted\n` +
        `👛 Remaining credits: <b>${user.credits}</b>`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📸 Swap Again', callback_data: 'menu_swap' }],
          [{ text: '💰 Buy Credits', callback_data: 'menu_buy' }, { text: '👛 Wallet', callback_data: 'menu_wallet' }],
        ],
      },
    });
  } catch (e) {
    console.error('Swap error:', e);
    await bot.sendMessage(
      chatId,
      `❌ <b>Swap failed</b>\n\n${htmlEscape(e.message || String(e))}\n\nPlease try again later.`,
      { parse_mode: 'HTML' }
    );
    user.state = null;
    user.swap = {};
    saveDb();
  } finally {
    [sourcePath, targetPath, resultPath].forEach((p) => {
      try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    });
    session.busy = false;
    sessions.set(chatId, session);
  }
}

async function sendHome(chatId, user) {
  await bot.sendMessage(chatId, rulesText(user), mainMenu());
}

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const tgUser = msg.from;
  const user = getUser(chatId, tgUser);
  const payload = (match && match[1]) || '';
  if (payload.startsWith('ref_')) {
    const refId = payload.replace('ref_', '').trim();
    if (refId && refId !== String(chatId) && !user.referredBy && !user.referralRewardClaimed) {
      user.pendingReferral = Number(refId);
      saveDb();
    }
  }
  clearState(chatId);

  if (!(await isUserJoined(chatId))) {
    user.verified = false;
    saveDb();
    await bot.sendMessage(
      chatId,
      `👋 <b>Welcome to ${BOT_USERNAME}</b>\n\n` +
      `Bot use karne se pehle group join karna mandatory hai.\n\n` +
      `🔓 Join karo aur phir <b>Verify</b> dabao.`,
      joinMenu()
    );
    return;
  }

  user.verified = true;
  user.joinedRequiredGroup = true;
  saveDb();
  await processReferralReward(user);
  await sendHome(chatId, user);
});

bot.onText(/^\/(help|menu)$/, async (msg) => {
  const user = getUser(msg.chat.id, msg.from);
  if (!(await ensureVerified(msg.chat.id, user))) return;
  await sendHome(msg.chat.id, user);
});

bot.onText(/^\/(field|fileid)$/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const reply = msg.reply_to_message;
  if (!reply || !reply.photo) {
    await bot.sendMessage(msg.chat.id, 'Reply photo par /field ya /fileid use karo.');
    return;
  }
  const fileId = reply.photo[reply.photo.length - 1].file_id;
  await bot.sendMessage(msg.chat.id, `🧾 <b>Photo file_id</b>\n\n<code>${htmlEscape(fileId)}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/^\/(setqr)$/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const reply = msg.reply_to_message;
  if (!reply || !reply.photo) {
    await bot.sendMessage(msg.chat.id, 'QR set karne ke liye photo par reply करके /setqr bhejo.');
    return;
  }
  const fileId = reply.photo[reply.photo.length - 1].file_id;
  db.meta.paymentQrFileId = fileId;
  db.meta.qrSetBy = msg.from.id;
  db.meta.qrSetAt = new Date().toISOString();
  saveDb();
  await bot.sendMessage(msg.chat.id, '✅ Payment QR set ho gaya.');
});

bot.onText(/^\/reply\s+(\d+)\s+([\s\S]+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = Number(match[1]);
  const text = match[2];
  try {
    await bot.sendMessage(userId, `📩 <b>Admin Reply</b>\n\n${htmlEscape(text)}`, { parse_mode: 'HTML' });
    await bot.sendMessage(msg.chat.id, '✅ Reply sent.');
  } catch (e) {
    await bot.sendMessage(msg.chat.id, '❌ Reply send nahi ho paya.');
  }
});

bot.on('callback_query', async (query) => {
  const data = query.data || '';
  const chatId = query.message.chat.id;
  const user = getUser(query.from.id, query.from);

  try { await bot.answerCallbackQuery(query.id); } catch (_) {}

  if (data === 'verify_join') {
    const joined = await isUserJoined(query.from.id);
    if (!joined) {
      await bot.sendMessage(chatId, '❌ Pehle group join karo, phir Verify dabao.', joinMenu());
      return;
    }
    user.verified = true;
    user.joinedRequiredGroup = true;
    saveDb();
    await processReferralReward(user);
    await bot.sendMessage(chatId, '✅ Verification successful!\n\nAb aap bot use kar sakte ho 😍', { parse_mode: 'HTML' });
    await sendHome(chatId, user);
    return;
  }

  if (!(await ensureVerified(chatId, user))) return;

  if (data === 'menu_rules') {
    await bot.sendMessage(chatId, rulesText(user), mainMenu());
    return;
  }

  if (data === 'menu_wallet') {
    await bot.sendMessage(chatId, walletText(user), { parse_mode: 'HTML' });
    return;
  }

  if (data === 'menu_refer') {
    await bot.sendMessage(
      chatId,
      `🎁 <b>Refer & Earn</b>\n\n` +
      `Har verified referral par <b>${REFERRAL_REWARD} credits</b> milenge.\n\n` +
      `🔗 Your referral link:\n<code>${referralLink(chatId)}</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data === 'menu_buy') {
    setState(chatId, 'awaiting_credit_amount');
    await bot.sendMessage(
      chatId,
      `💰 <b>Buy Credits</b>\n\nKitne credits chahiye?\n\n` +
      `📌 Rate: ${CREDITS_PER_RUPEE} credits = ₹1\n` +
      `Example: 10 credits = ₹${calcAmount(10)}`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_generic' }]] },
      }
    );
    return;
  }

  if (data === 'menu_swap') {
    await startSwap(chatId, user);
    return;
  }

  if (data === 'cancel_generic') {
    clearState(chatId);
    await bot.sendMessage(chatId, '❌ Cancelled.', mainMenu());
    return;
  }

  if (data.startsWith('pay_cancel_')) {
    const orderId = data.replace('pay_cancel_', '');
    const order = db.orders[orderId];
    if (!order || order.userId !== chatId) return;
    order.status = 'cancelled';
    saveDb();
    clearState(chatId);
    await bot.sendMessage(chatId, `❌ Order <code>${orderId}</code> cancelled.`, { parse_mode: 'HTML' });
    return;
  }

  if (data.startsWith('pay_done_')) {
    const orderId = data.replace('pay_done_', '');
    const order = db.orders[orderId];
    if (!order || order.userId !== chatId) return;
    order.status = 'awaiting_screenshot';
    order.paymentRequestedAt = new Date().toISOString();
    user.state = 'awaiting_payment_screenshot';
    user.pendingOrderId = orderId;
    saveDb();
    await bot.sendMessage(
      chatId,
      `📸 <b>Payment Screenshot Required</b>\n\nAb payment screenshot bhejo.\n` +
      `Uske baad order admin ko review ke liye chala jayega.\n\n` +
      `⏳ <i>Wait for few min, credits will be added if payment has done.</i>\n` +
      `⚠️ Any problem contact ${CONTACT_USERNAME}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (data.startsWith('admin_add_')) {
    if (query.from.id !== ADMIN_ID) return;
    const orderId = data.replace('admin_add_', '');
    const order = db.orders[orderId];
    if (!order || order.status === 'approved') return;
    order.status = 'approved';
    const orderUser = getUser(order.userId);
    orderUser.credits += order.credits;
    saveDb();
    try {
      await bot.sendMessage(order.userId,
        `✅ <b>Payment Approved</b>\n\n` +
        `🧾 Order ID: <code>${order.id}</code>\n` +
        `💎 Added Credits: <b>${order.credits}</b>\n` +
        `👛 New Balance: <b>${orderUser.credits}</b>\n\n` +
        `Thank you for your purchase ❤️`,
        { parse_mode: 'HTML', reply_markup: mainMenu().reply_markup }
      );
    } catch (_) {}
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id }); } catch (_) {}
    await bot.sendMessage(ADMIN_ID, `✅ Order ${order.id} approved. ${order.credits} credits added.`);
    return;
  }

  if (data.startsWith('admin_cancel_')) {
    if (query.from.id !== ADMIN_ID) return;
    const orderId = data.replace('admin_cancel_', '');
    const order = db.orders[orderId];
    if (!order || order.status === 'cancelled') return;
    order.status = 'cancelled';
    saveDb();
    try {
      await bot.sendMessage(order.userId,
        `❌ <b>Payment Cancelled</b>\n\n` +
        `🧾 Order ID: <code>${order.id}</code>\n` +
        `Agar payment kiya hai to ${CONTACT_USERNAME} se contact karo.`,
        { parse_mode: 'HTML', reply_markup: mainMenu().reply_markup }
      );
    } catch (_) {}
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id }); } catch (_) {}
    await bot.sendMessage(ADMIN_ID, `❌ Order ${order.id} cancelled.`);
    return;
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  if (!from) return;

  if (msg.text && msg.text.startsWith('/')) {
    await notifyAdminUserMessage(msg);
    return;
  }

  if (from.id === ADMIN_ID && msg.reply_to_message) {
    const replyToId = String(msg.reply_to_message.message_id);
    const mappedUserId = db.meta.replyMap[replyToId];
    if (mappedUserId) {
      if (msg.text) {
        await bot.sendMessage(mappedUserId, `📩 <b>Admin Reply</b>\n\n${htmlEscape(msg.text)}`, { parse_mode: 'HTML' });
      } else if (msg.photo) {
        await bot.sendPhoto(mappedUserId, msg.photo[msg.photo.length - 1].file_id, { caption: '📩 Admin sent you a photo' });
      } else if (msg.document) {
        await bot.sendDocument(mappedUserId, msg.document.file_id, { caption: '📩 Admin sent you a file' });
      }
      return;
    }
  }

  const user = getUser(chatId, from);
  await notifyAdminUserMessage(msg);

  if (!(await ensureVerified(chatId, user))) return;

  if (user.state === 'awaiting_credit_amount' && msg.text) {
    const credits = parseInt(msg.text.trim(), 10);
    if (!Number.isFinite(credits) || credits <= 0) {
      await bot.sendMessage(chatId, '❌ Valid credit amount bhejo. Example: 10');
      return;
    }
    const order = await createOrder(chatId, credits);
    user.pendingOrderId = order.id;
    user.state = 'payment_created';
    saveDb();
    await showPaymentQr(chatId, order);
    return;
  }

  if (user.state === 'awaiting_payment_screenshot') {
    const order = db.orders[user.pendingOrderId];
    if (!order) {
      clearState(chatId);
      await bot.sendMessage(chatId, 'Order nahi mila. Dobara try karo.');
      return;
    }
    if (!msg.photo) {
      await bot.sendMessage(chatId, '📸 Payment screenshot photo ke form me bhejo.');
      return;
    }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    order.screenshotFileId = fileId;
    order.status = 'pending_admin_review';
    saveDb();
    clearState(chatId);

    const caption =
      `💳 <b>New Payment Review Request</b>\n\n` +
      `🧾 Order ID: <code>${order.id}</code>\n` +
      `👤 User ID: <code>${chatId}</code>\n` +
      `🔗 Username: ${from.username ? '@' + htmlEscape(from.username) : 'N/A'}\n` +
      `💎 Ordered Credits: <b>${order.credits}</b>\n` +
      `💰 Amount: <b>₹${order.amount}</b>\n\n` +
      `Reply to this message to message the user.`;

    const sent = await bot.sendPhoto(ADMIN_ID, fileId, {
      caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: `✅ Add ${order.credits} Credits`, callback_data: `admin_add_${order.id}` },
          { text: '❌ Cancel', callback_data: `admin_cancel_${order.id}` },
        ]],
      },
    });
    db.meta.replyMap[String(sent.message_id)] = chatId;
    order.adminMessageId = sent.message_id;
    saveDb();

    await bot.sendMessage(
      chatId,
      `✅ <b>Screenshot received</b>\n\n` +
      `⏳ Wait for few min, credits will be added if payment has done.\n` +
      `⚠️ Any problem contact ${CONTACT_USERNAME}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (user.state === 'awaiting_source') {
    if (!msg.photo) {
      await bot.sendMessage(chatId, '📸 Please source photo bhejo.');
      return;
    }
    user.swap = { sourceFileId: msg.photo[msg.photo.length - 1].file_id };
    user.state = 'awaiting_target';
    saveDb();
    await bot.sendMessage(chatId, '📸 <b>Step 2/2</b>\n\nAb target photo bhejo jisme face replace karna hai.', { parse_mode: 'HTML' });
    return;
  }

  if (user.state === 'awaiting_target') {
    if (!msg.photo) {
      await bot.sendMessage(chatId, '📸 Please target photo bhejo.');
      return;
    }
    await performSwap(chatId, from, msg.photo[msg.photo.length - 1].file_id);
    return;
  }

  if (msg.text) {
    await bot.sendMessage(
      chatId,
      `👇 <b>Choose an option</b>\n\nUse buttons below to continue.`,
      mainMenu()
    );
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('✅ FaceSwap credit bot is running...');
