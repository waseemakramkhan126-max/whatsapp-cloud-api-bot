const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}`);
const logDiv = document.getElementById('logContainer');
const statusSpan = document.getElementById('status');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'log') {
        logDiv.innerHTML += `<div>${data.message}</div>`;
        logDiv.scrollTop = logDiv.scrollHeight;
    } else if (data.type === 'status') {
        statusSpan.textContent = `Status: ${data.running ? 'Running' : 'Paused'}`;
    }
};

document.getElementById('pauseBtn').onclick = () => ws.send(JSON.stringify({ action: 'pause' }));
document.getElementById('resumeBtn').onclick = () => ws.send(JSON.stringify({ action: 'resume' }));

document.getElementById('saveConfig').onclick = () => {
    ws.send(JSON.stringify({
        action: 'updateConfig',
        config: {
            SMART_DELAY: () => {
                const min = parseInt(document.getElementById('typingMin').value);
                const max = parseInt(document.getElementById('typingMax').value);
                return Math.random() * (max - min) + min;
            },
            DEBOUNCE_TIME: parseInt(document.getElementById('debounce').value)
        }
    }));
};