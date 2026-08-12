const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { toDataURL } = require('qrcode');
const { createClient } = require('@supabase/supabase-js'); // 👈 Supabase import
const { handleIncomingMessage } = require('./debounce');
const { sendHumanLikeReply } = require('./sender');
const { shouldNightReply } = require('./nightmode');
const config = require('./config');

const app = express();
const server = http.createServer(app);               // 👈 ADD
const wss = new WebSocketServer({ server });         // 👈 ADD
let appStarted = false;
let reconnectAttempts = 0;
let isBotRunning = true;

// 🧠 Supabase Client Setup
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

// 🧠 History Memory Store
const chatHistories = new Map();

function appendToHistory(jid, role, content) {
    if (!chatHistories.has(jid)) {
        chatHistories.set(jid, []);
    }
    const history = chatHistories.get(jid);
    
    history.push({ role: role, content: content });

    if (history.length > 12) {
        history.shift(); 
    }
}

// ---------- WebSocket Dashboard ----------
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'status', running: isBotRunning }));
    ws.send(JSON.stringify({ type: 'log', message: '🔌 Dashboard connected to bot server' }));
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.action === 'pause') {
            isBotRunning = false;
            broadcastStatus();
            broadcastLog('⏸ Bot paused by dashboard');
        } else if (msg.action === 'resume') {
            isBotRunning = true;
            broadcastStatus();
            broadcastLog('▶️ Bot resumed by dashboard');
        } else if (msg.action === 'updateConfig') {
            if (msg.config.SMART_DELAY) config.SMART_DELAY = msg.config.SMART_DELAY;
            if (msg.config.DEBOUNCE_TIME) config.DEBOUNCE_TIME = msg.config.DEBOUNCE_TIME;
            broadcastLog('🔧 Config updated from dashboard');
        }
    });
});

function broadcastStatus() {
    wss.clients.forEach(client => {
        client.send(JSON.stringify({ type: 'status', running: isBotRunning }));
    });
}

function broadcastLog(message) {
    console.log(message);
    wss.clients.forEach(client => {
        client.send(JSON.stringify({ type: 'log', message }));
    });
}

app.use(express.static('dashboard'));
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard/index.html');
});

server.listen(3000, () => {
    console.log('✅ Dashboard & QR server started on port 3000');
    appStarted = true;
    broadcastLog('🚀 Bot server started and ready');   // 👈 add
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        syncFullHistory: false,
        shouldSyncHistoryMessage: (msg) => {
            const allowed = ['PUSH_NAME', 'NON_BLOCKING_DATA', 'RECENT'];
            return allowed.includes(msg.syncType);
        },
    });

    // QR via web
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            console.log('Scan QR at http://localhost:3000/qr');
            const qrImage = await toDataURL(qr);
            app.get('/qr', (req, res) => {
                res.send(`<html><body><img src="${qrImage}" /></body></html>`);
            });
            
        }

        if (connection === 'open') {
            reconnectAttempts = 0;                             // 👈 add karein
            console.log('✅ Bot connected to WhatsApp');
            setupOrderRealtimeListener(sock);
        } else if (connection === 'close') {
    const statusCode = (lastDisconnect?.error)?.output?.statusCode;
    const shouldReconnect = statusCode !== 401; // 401 means logged out

    if (shouldReconnect) {
        reconnectAttempts++;
        if (reconnectAttempts > 5) {
            console.log('❌ Max reconnect attempts reached. Please check internet and restart manually.');
            process.exit(1);
        }
        const delay = Math.floor(Math.random() * 5000) + 5000;
        console.log(`⏳ Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts})`);
        setTimeout(() => startBot(), delay);
    } else {
        console.log('❌ Session logged out, clearing auth_info...');
        fs.rmSync('auth_info', { recursive: true, force: true });
        console.log('🔄 Restarting bot, QR scan required.');
        startBot();
    }
}
    });

    // Messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        console.log('\n--- NEW MESSAGE RECEIVED ---');
        console.log('Type:', m.type, '| From Me:', msg.key.fromMe);

        if (!msg.key.fromMe && m.type === 'notify') {
            const jid = msg.key.remoteJid;
            console.log('1. JID:', jid);

            if (jid.endsWith('@g.us') || jid.includes('@broadcast') || jid.endsWith('@newsletter')) {
                console.log('❌ IGNORING group/status/broadcast chat:', jid);
                return;
            }

            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else {
                console.log('⚠️ MESSAGE JSON:', JSON.stringify(msg.message));
            }

            console.log('2. Extracted Text:', text);

            if (!text) {
                console.log('❌ IGNORING: No text found in message.');
                return;
            }

            console.log('3. Sending to handleIncomingMessage...');
            
            handleIncomingMessage(jid, text, async (combinedText) => {
                if (!isBotRunning) {
                    broadcastLog(`⏸ Bot is paused, ignoring message from ${jid}`);
                    return;
                }
                console.log('✅ Debounce finished! Combined Text:', combinedText);
                broadcastLog(`📩 Message from ${jid}: ${combinedText}`);
                
                // Night mode check
                const nightAction = shouldNightReply(jid);
                if (nightAction === true) {
                    await sendHumanLikeReply(sock, jid, config.NIGHT_REPLY_TEXT, msg.key, true);
                    broadcastLog(`📤 Night auto-reply sent to ${jid}`);
                    return;

                } else if (nightAction === false) {
                    return;
                }

                // ========== ORDER STATUS FETCH (by JID) ==========
let finalMessage = combinedText;
try {
    const { data: latestOrder } = await supabase
        .from('orders')
        .select('status, dc_amount, rider_status, area')
        .eq('chat_jid', jid)                  // 👈 directly match by JID
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (latestOrder) {
        finalMessage = `[SYSTEM ORDER CONTEXT]\nStatus: ${latestOrder.status}\nRider Status: ${latestOrder.rider_status || 'N/A'}\nDelivery Fee: Rs. ${latestOrder.dc_amount || 0}\nArea: ${latestOrder.area || 'N/A'}\n\nCUSTOMER'S QUESTION: ${combinedText}`;
        console.log('📦 Order context added for AI');
    } else {
        console.log('ℹ️ No existing order found for this user (JID).');
    }
} catch (e) {
    console.error('❌ Failed to fetch order status:', e);
}
// =========================================================

                // 1. User ka message pehle history mein save karein
                appendToHistory(jid, 'user', combinedText);

                // 2. AI call
                let aiReply;
                try {
                    aiReply = await getAIResponse(jid, finalMessage);
                    console.log('🤖 AI Reply ready:', aiReply);
                } catch (err) {
                    console.error('❌ AI Error:', err);
                    aiReply = 'Sorry, error getting reply';
                }

                const lower = combinedText.toLowerCase().trim();
                const isDeadEnd = config.DEAD_END_KEYWORDS.some(kw => lower === kw);
                const shouldRead = !isDeadEnd;

                console.log('4. Sending reply to WhatsApp...');
                await sendHumanLikeReply(sock, jid, aiReply, msg.key, shouldRead);
                broadcastLog(`📤 Reply to ${jid}: ${aiReply}`);
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

async function getAIResponse(jid, message) {
    try {
        const supabaseUrl = config.AI_ENDPOINT;
        const existingHistory = chatHistories.get(jid) || [];

        const response = await fetch(supabaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                message: message,
                history: existingHistory,
                jid: jid                  // 👈 comma pehle laga ke add kiya
            }),                            // 👈 object close, comma, parentheses close
        });

        if (!response.ok) {
            
            throw new Error(`Supabase Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const aiReply = data.reply || data.message || data.text || JSON.stringify(data);
        
        appendToHistory(jid, 'model', aiReply);
        return aiReply;
    } catch (err) {
        console.error('❌ AI API Error:', err.message);
        return 'Sorry, AI service is not available right now.';
    }
}

// Phone number ko valid WhatsApp JID mein convert karne ka helper
function formatToJid(phone) {
    if (!phone) return null;
    let clean = phone.replace(/[^0-9]/g, ''); // Sirf digits rakhein
    
    // Agar 0300... hai to 92300... karein
    if (clean.startsWith('0')) {
        clean = '92' + clean.slice(1);
    }
    // Agar 300... (10 digits) hai to 92300... karein
    else if (clean.length === 10 && clean.startsWith('3')) {
        clean = '92' + clean;
    }

    return clean.endsWith('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`;
}

// Wallet balance helper (tries both 92... and 03... formats)
async function getWalletBalance(phone) {
    if (!phone) return 0;
    let phone92 = phone.trim();
    if (phone92.startsWith('0')) {
        phone92 = '92' + phone92.slice(1);
    }
    let phone03 = phone92.startsWith('92') && phone92.length >= 11 ? '0' + phone92.slice(2) : phone92;

    try {
        const { data, error } = await supabase
            .from("wallets")
            .select("current_balance, customer_phone")
            .or(`customer_phone.eq.${phone92},customer_phone.eq.${phone03}`)
            .maybeSingle();

        console.log(`🔍 Wallet lookup for phone92=${phone92} / phone03=${phone03} →`, data, error);

        if (data) {
            return Number(data.current_balance) || 0;
        }
    } catch (e) {
        console.error("Wallet fetch error:", e);
    }
    return 0;
}

// -----------------------------------------------------------------------------
// 📡 REALTIME ORDERS TABLE LISTENER (Rider Status & Bill Updates)
// -----------------------------------------------------------------------------
function setupOrderRealtimeListener(sock) {
    console.log('📡 Listening for Realtime updates on "orders" table...');

    const channelName = `realtime-orders-${Date.now()}`;

    supabase
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'orders' },
            async (payload) => {
                const oldRow = payload.old || {};
                const newRow = payload.new || {};

                console.log(`🔔 Order Update Detected for Order ID: ${newRow.id}`);

                const jid = formatToJid(newRow.customer_phone);
                if (!jid) return;

                const currentStatus = String(newRow.rider_status || '').toLowerCase().trim();
                const oldStatus = String(oldRow.rider_status || '').toLowerCase().trim();
                const statusChanged = currentStatus !== oldStatus;

                const isBillUploaded = newRow.bill_image && (newRow.bill_image !== oldRow.bill_image || newRow.bill_amount !== oldRow.bill_amount);
                const isRiderOnWay = (currentStatus === 'on_the_way' || currentStatus === 'ontheway' || currentStatus === 'on the way') && statusChanged;

                if (isBillUploaded || isRiderOnWay) {
                    const billAmt = (Number(newRow.item_price) || 0) + (Number(newRow.dc_amount) || 0);

                    let walletBalance = await getWalletBalance(newRow.customer_phone);

                    let captionText = `📄 *Order Bill Details*\n\n`;
                    captionText += `Bill Amount: Rs. ${billAmt}\n`;

                    let totalPayable = billAmt;
                    if (walletBalance > 0) {
                        captionText += `Previous Due: Rs. ${walletBalance}\n`;
                        totalPayable = billAmt + walletBalance;
                    } else if (walletBalance < 0) {
                        captionText += `Remaining Amount: Rs. ${Math.abs(walletBalance)}\n`;
                        totalPayable = billAmt + walletBalance;
                    }

                    captionText += `---------------------------\n`;
                    captionText += `*Total Payable: Rs. ${totalPayable}*\n\n`;
                    captionText += `*Rider is on the way 🏍️*`;

                    try {
                        if (newRow.bill_image) {
                            await sock.sendMessage(jid, {
                                image: { url: newRow.bill_image },
                                caption: captionText
                            });
                        } else {
                            await sock.sendMessage(jid, { text: captionText });
                        }
                        console.log(`✅ Bill & On-The-Way details sent to ${jid}`);
                    } catch (err) {
                        console.error('❌ Failed to send bill details:', err);
                    }
                }

                if (currentStatus === 'arrived') {
                    const arrivedMsg = `*Your order has arrived 🏠*\nPlease receive your order.`;
                    try {
                        await sock.sendMessage(jid, { text: arrivedMsg });
                        console.log(`✅ Arrived message sent to ${jid}`);
                    } catch (err) {
                        console.error('❌ Failed to send arrived message:', err);
                    }
                }

                if (currentStatus === 'delivered' || currentStatus === 'completed') {
                    let deliveredMsg = `*✅Order Completed:*\nThank you for choosing Faster, We appreciate your trust in our services.`;

                    let walletBalance = await getWalletBalance(newRow.customer_phone);

                    if (walletBalance > 0) {
                        deliveredMsg += `\n\n*Pending Amount:* Rs. ${walletBalance}`;
                    } else if (walletBalance < 0) {
                        deliveredMsg += `\n\n*Remaining Amount :* Rs. ${Math.abs(walletBalance)}`;
                    }

                    try {
                        await sock.sendMessage(jid, { text: deliveredMsg });
                        console.log(`✅ Delivered message sent to ${jid}`);
                    } catch (err) {
                        console.error('❌ Failed to send delivered message:', err);
                    }
                }
            }
        )
        .subscribe();
}

startBot();