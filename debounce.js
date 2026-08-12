const config = require('./config');

// Har user ke liye ek buffer
const buffers = new Map();

/**
 * @param {string} jid - sender ka ID
 * @param {string} text - incoming message text
 * @param {function} callback - jab grouping complete ho, combined text ke saath call
 */
function handleIncomingMessage(jid, text, callback) {
    if (!buffers.has(jid)) {
        buffers.set(jid, { messages: [], timer: null });
    }
    const buf = buffers.get(jid);
    buf.messages.push(text);
    clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
        const combined = buf.messages.join('\n');
        buf.messages = [];
        callback(combined);
    }, config.DEBOUNCE_TIME);
}

module.exports = { handleIncomingMessage };