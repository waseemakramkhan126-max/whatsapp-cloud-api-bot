const config = require('./config');
const { addToQueue } = require('./queue');

/**
 * @param {object} sock
 * @param {string} jid
 * @param {string} text - reply
 * @param {object} msgKey - message key for read receipt
 * @param {boolean} shouldRead - true if blue tick dena hai
 */
async function sendHumanLikeReply(sock, jid, text, msgKey, shouldRead) {
    await addToQueue(async () => {
        try {
            // Phase 3: Smart delay
            const smartDelay = config.SMART_DELAY();
            await delay(smartDelay);

            // Read receipt at this moment (right before typing)
            if (shouldRead && msgKey) {
                await sock.readMessages([msgKey]);
            }

            // Composing
            await sock.sendPresenceUpdate('composing', jid);

            // Determine typing duration
            const chars = text.length;
            let typingTime;
            if (chars < config.SHORT_TEXT_THRESHOLD) {
                typingTime = config.SHORT_TYPING_TIME();
            } else if (chars < config.LONG_TEXT_THRESHOLD) {
                typingTime = config.LONG_TYPING_TIME();
            } else {
                typingTime = config.LONG_TYPING_TIME();
            }

            await delay(typingTime);

            // Advanced pattern 20% for long texts
            if (chars >= config.LONG_TEXT_THRESHOLD && Math.random() < 0.2) {
                await sock.sendPresenceUpdate('paused', jid);
                await delay(1000);
                await sock.sendPresenceUpdate('composing', jid);
                await delay(1000);
            }

            // Chunking
            if (chars > config.CHUNK_SIZE) {
                const chunks = splitIntoChunks(text, config.CHUNK_SIZE);
                for (let i = 0; i < chunks.length; i++) {
                    await sock.sendMessage(jid, { text: chunks[i] });
                    if (i < chunks.length - 1) {
                        await delay(config.CHUNK_GAP);
                    }
                }
            } else {
                await sock.sendMessage(jid, { text });
            }
        } catch (err) {
            console.error('Send error:', err);
        }
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function splitIntoChunks(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
        chunks.push(str.slice(i, i + size));
    }
    return chunks;
}

module.exports = { sendHumanLikeReply };