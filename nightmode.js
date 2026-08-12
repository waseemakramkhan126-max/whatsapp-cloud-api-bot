// Track karega kaunse users ko raat ka auto-reply mil chuka hai
const nightReplied = new Map();

/**
 * Check karta hai ke abhi night mode active hai ya nahi.
 * Agar active hai aur pehle reply nahi diya, toh true return karega (pehla reply do).
 * Agar already replied, toh false (completely silent).
 */
function shouldNightReply(jid) {
    const now = new Date();
    const hour = now.getHours();
    const start = require('./config').NIGHT_START_HOUR;
    const end = require('./config').NIGHT_END_HOUR;

    if (hour >= start && hour < end) {
        if (!nightReplied.has(jid)) {
            nightReplied.set(jid, true);
            return true; // pehla message, auto-reply bhejo
        }
        return false; // already replied, chup raho
    } else {
        // Subah ho gayi, user ki entry clear karo
        nightReplied.delete(jid);
        return null; // night mode active nahi
    }
}

/** Subah hote hi sab users ki night tracking reset */
function resetNightMode() {
    nightReplied.clear();
}

module.exports = { shouldNightReply, resetNightMode };