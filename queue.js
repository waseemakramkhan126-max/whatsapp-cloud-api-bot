const config = require('./config');

const queue = [];
let isProcessing = false;

/**
 * Ek task (function) queue mein add karta hai. Jab turn aaye execute hota hai.
 * Random delay baad agli task process hoti hai.
 */
async function addToQueue(taskFn) {
    return new Promise((resolve, reject) => {
        queue.push({ taskFn, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { taskFn, resolve, reject } = queue.shift();
    try {
        const result = await taskFn();
        resolve(result);
    } catch (err) {
        reject(err);
    }
    // Random delay before next message dispatch
    const delay = config.INTER_MESSAGE_DELAY();
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

module.exports = { addToQueue };