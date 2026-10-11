// Voice search through a local speech recognition endpoint (GigaAM app on the
// same device, http://127.0.0.1:8765) instead of YouTube's own voice search.
//
// Cobalt cannot capture audio itself (getUserMedia returns silence and
// webkitSpeechRecognition crashes the app), so the mic button on the search
// screen asks the endpoint to listen: the Android app records, detects the end
// of speech and returns the text, which is then sent to the search.
//
// The press has to start recording right away: on the Sber box the remote's
// microphone opens only if capture starts within ~1 s after an OK press.

import { configRead } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

const MIC_BUTTON = 'ytlr-search-voice-mic-button';
const OK_KEYS = [13];
const BACK_KEYS = [27, 8, 461, 10009];
const REQUEST_TIMEOUT = 5000;
const POLL_WAIT = 10000;
const WARMUP_INTERVAL = 60000;

let session = null;
let lastWarmup = 0;

function endpoint() {
    return configRead('voiceSearchEndpoint');
}

function request(method, path, timeout) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, endpoint() + path, true);
        xhr.timeout = timeout || REQUEST_TIMEOUT;
        xhr.onload = () => {
            try {
                resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
            } catch (e) {
                reject(new Error('bad response: ' + xhr.status));
            }
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.ontimeout = () => reject(new Error('timeout'));
        xhr.send();
    });
}

function micButton() {
    return document.querySelector(MIC_BUTTON);
}

function isMicTarget(el) {
    return !!(el && el.closest && el.closest(MIC_BUTTON));
}

function isMicFocused() {
    if (isMicTarget(document.activeElement)) return true;
    const button = micButton();
    return !!(button && button.classList.contains('zylon-focus'));
}

const STATE_COLORS = {
    starting: '#cc0000',
    listening: '#cc0000',
    speech: '#ff3d3d',
    recognizing: '#f9a825'
};

function setMicState(state) {
    const button = micButton();
    if (!button) return;
    const color = STATE_COLORS[state];
    if (color) {
        button.style.setProperty('background-color', color, 'important');
        button.style.setProperty('border-radius', '50%', 'important');
    } else {
        button.style.removeProperty('background-color');
        button.style.removeProperty('border-radius');
    }
}

function errorMessage(status) {
    switch (status.code) {
        case 'no_speech':
        case 'no_match':
            return t('toasts.voiceSearch.noSpeech');
        case 'no_overlay':
            return t('toasts.voiceSearch.noOverlay');
        case 'cancelled':
            return null;
        default:
            return status.error || status.code;
    }
}

function finish(current, status) {
    if (session !== current) return;
    session = null;
    setMicState(null);
    if (!status) return;
    if (status.state === 'done' && status.text) {
        console.info('[VoiceSearch] result:', status.text);
        resolveCommand({ searchEndpoint: { query: status.text } });
        return;
    }
    const message = errorMessage(status);
    if (message) showToast(t('toasts.voiceSearch.title'), message);
}

function dropSession(current, message) {
    if (session !== current) return;
    session = null;
    setMicState(null);
    if (message) showToast(t('toasts.voiceSearch.title'), message);
}

function poll(current, status) {
    if (session !== current) return;
    setMicState(status.state);
    if (status.final) {
        finish(current, status);
        return;
    }
    request('GET', '/status?id=' + current.id + '&v=' + status.v + '&wait=' + POLL_WAIT, POLL_WAIT + REQUEST_TIMEOUT)
        .then((res) => poll(current, res.body))
        .catch((e) => {
            console.warn('[VoiceSearch] status failed:', e.message);
            dropSession(current, t('toasts.voiceSearch.unavailable'));
        });
}

function start() {
    const current = { id: null, cancelled: false };
    session = current;
    setMicState('starting');
    request('POST', '/listen')
        .then((res) => {
            if (res.status !== 200) {
                // the endpoint answered but refused (e.g. foreign Origin)
                dropSession(current, res.body.error || ('HTTP ' + res.status));
                return;
            }
            current.id = res.body.id;
            if (current.cancelled) {
                request('POST', '/cancel?id=' + current.id).catch(() => { });
                return;
            }
            poll(current, res.body);
        })
        .catch((e) => {
            console.warn('[VoiceSearch] endpoint unavailable:', e.message);
            dropSession(current, t('toasts.voiceSearch.unavailable'));
        });
}

function cancel() {
    const current = session;
    if (!current) return;
    current.cancelled = true;
    session = null;
    setMicState(null);
    if (current.id !== null) request('POST', '/cancel?id=' + current.id).catch(() => { });
}

function onKey(evt) {
    if (!configRead('enableVoiceSearch')) return;

    if (session && BACK_KEYS.indexOf(evt.keyCode) !== -1) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        if (evt.type === 'keydown') cancel();
        return;
    }

    if (OK_KEYS.indexOf(evt.keyCode) === -1 || !isMicFocused()) return;

    // Keep YouTube's own voice search (it would grab the microphone) away
    // from the whole press: keydown, keypress, keyup and repeats.
    evt.preventDefault();
    evt.stopImmediatePropagation();
    if (evt.type !== 'keydown' || evt.repeat) return;
    if (session) cancel();
    else start();
}

function onClick(evt) {
    if (!configRead('enableVoiceSearch') || !isMicTarget(evt.target)) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    if (session) cancel();
    else start();
}

// Loading the model takes a few seconds, so start it as soon as the search
// screen opens instead of when the user has already finished speaking.
function warmup() {
    if (!configRead('enableVoiceSearch') || location.hash.indexOf('#/search') !== 0) return;
    const now = Date.now();
    if (now - lastWarmup < WARMUP_INTERVAL) return;
    lastWarmup = now;
    request('POST', '/warmup').catch(() => { });
}

window.addEventListener('hashchange', warmup);
window.addEventListener('keydown', onKey, true);
window.addEventListener('keypress', onKey, true);
window.addEventListener('keyup', onKey, true);
window.addEventListener('click', onClick, true);
