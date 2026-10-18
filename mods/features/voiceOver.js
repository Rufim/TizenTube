// Voice-over translation (Yandex) for the current video.
//
// The translation itself lives in a Java module built into the TizenTube Cobalt
// APK (tizentube-vot): it serves http://127.0.0.1:8777, asks Yandex for the
// Russian voice-over, plays the track natively and keeps it in sync with the
// video. This file is the page side: the "Y" button in the player toggles it,
// the video state (time, pause, speed) is reported every second and on player
// events, and the original sound is turned down while the translation plays.

import { configRead, configChangeEmitter } from '../config.js';
import { showToast } from '../ui/ytUI.js';
import { getPlayerMeta } from './playerMeta.js';
import { t } from 'i18next';

const SYNC_INTERVAL = 1000;
const REQUEST_TIMEOUT = 5000;
const WAITING_TOAST_INTERVAL = 60000;
const SOURCE_LANGS = ['en', 'zh', 'ko', 'ar', 'fr', 'it', 'es', 'de', 'ja'];
const VIDEO_EVENTS = ['play', 'pause', 'playing', 'seeking', 'seeked', 'ratechange', 'waiting', 'canplay', 'ended', 'emptied'];

let session = null;
let listeners = [];
const buttonStateListeners = [];

function endpoint() {
    return configRead('voiceOverEndpoint');
}

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, endpoint() + path, true);
        xhr.timeout = REQUEST_TIMEOUT;
        xhr.onload = () => {
            try {
                resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
            } catch (e) {
                reject(new Error('bad response: ' + xhr.status));
            }
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.ontimeout = () => reject(new Error('timeout'));
        if (body !== undefined) {
            // text/plain keeps the request "simple" (no CORS preflight needed).
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.send(JSON.stringify(body));
        } else {
            xhr.send();
        }
    });
}

function currentVideoId() {
    const hash = location.hash || '';
    if (hash.indexOf('#/watch') !== 0) return null;
    const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(hash);
    return m ? m[1] : null;
}

function videoElement() {
    return document.querySelector('video');
}

function videoState(video) {
    // While buffering or seeking the picture stands still: report it as paused
    // so the translation does not run ahead.
    const stalled = video.seeking || video.readyState < 3;
    return {
        t: video.currentTime,
        paused: video.paused || video.ended || stalled,
        rate: video.playbackRate || 1
    };
}

function translationVolume() {
    return Math.max(0, Math.min(100, Number(configRead('voiceOverVolume')))) / 100;
}

function originalVolume() {
    return Math.max(0, Math.min(100, Number(configRead('voiceOverOriginalVolume')))) / 100;
}

// ---------------------------------------------------------------- button state

export function voiceOverButtonState() {
    if (!session) return 'off';
    return session.uiState;
}

export function onVoiceOverStateChange(cb) {
    buttonStateListeners.push(cb);
}

function setUiState(state) {
    if (!session || session.uiState === state) return;
    session.uiState = state;
    console.info('[VoiceOver] state:', state);
    buttonStateListeners.forEach((cb) => {
        try {
            cb(state);
        } catch (e) { }
    });
}

function notifyOff() {
    buttonStateListeners.forEach((cb) => {
        try {
            cb('off');
        } catch (e) { }
    });
}

// ---------------------------------------------------------------- original sound

function duck(video) {
    if (!session) return;
    if (session.savedVolume === null) session.savedVolume = video.volume;
    const target = Math.min(session.savedVolume, originalVolume());
    if (Math.abs(video.volume - target) > 0.01) video.volume = target;
    session.duckedVideo = video;
}

function unduck() {
    if (!session || session.savedVolume === null) return;
    const video = session.duckedVideo || videoElement();
    if (video) video.volume = session.savedVolume;
    session.savedVolume = null;
}

// ---------------------------------------------------------------- session

function toast(message) {
    showToast(t('toasts.voiceOver.title'), message);
}

function formatRemaining(seconds) {
    if (!(seconds > 0)) return t('toasts.voiceOver.waiting');
    const minutes = Math.max(1, Math.round(seconds / 60));
    return t('toasts.voiceOver.waitingMinutes', { minutes });
}

function handleStatus(status) {
    if (!session) return;
    switch (status.state) {
        case 'waiting': {
            setUiState('waiting');
            const now = Date.now();
            const remaining = status.remaining;
            if (now - session.lastWaitingToast > WAITING_TOAST_INTERVAL
                || (session.lastRemaining < 0 && remaining > 0)) {
                session.lastWaitingToast = now;
                toast(formatRemaining(remaining));
            }
            session.lastRemaining = remaining;
            break;
        }
        case 'loading':
            setUiState('waiting');
            break;
        case 'playing':
        case 'paused':
        case 'beyond':
        case 'ended': {
            if (session.uiState !== 'playing' && status.partial) toast(t('toasts.voiceOver.partial'));
            setUiState('playing');
            const video = videoElement();
            if (video) duck(video);
            break;
        }
        case 'error':
            fail(status.message || t('toasts.voiceOver.failed'));
            break;
        case 'idle':
            // The module lost the job (restarted): ask again.
            if (!session.restarting) {
                session.restarting = true;
                sendStart().then(() => {
                    if (session) session.restarting = false;
                });
            }
            break;
        default:
            break;
    }
}

function fail(message) {
    console.warn('[VoiceOver] error:', message);
    setUiState('error');
    toast(message);
    stop();
}

function sendStart() {
    const current = session;
    const video = videoElement();
    if (!current || !video) return Promise.resolve();
    const meta = getPlayerMeta(current.videoId) || {};
    let lang = 'auto';
    if (meta.spokenLang) {
        const base = meta.spokenLang.split('-')[0].toLowerCase();
        if (base === 'ru') {
            fail(t('toasts.voiceOver.alreadyRussian'));
            return Promise.resolve();
        }
        if (SOURCE_LANGS.indexOf(base) !== -1) lang = base;
    }
    const state = videoState(video);
    const body = {
        videoId: current.videoId,
        duration: isFinite(video.duration) && video.duration > 0 ? video.duration : meta.lengthSeconds || 0,
        title: meta.title || '',
        lang,
        target: 'ru',
        t: state.t,
        paused: state.paused,
        rate: state.rate,
        volume: translationVolume()
    };
    console.info('[VoiceOver] start', current.videoId, 'lang=' + lang, 'duration=' + body.duration);
    return request('POST', '/vot/start', body)
        .then((res) => {
            if (session !== current) return;
            if (res.status !== 200) {
                fail(res.body.error || ('HTTP ' + res.status));
                return;
            }
            handleStatus(res.body);
        })
        .catch((e) => {
            if (session !== current) return;
            console.warn('[VoiceOver] module unavailable:', e.message);
            fail(t('toasts.voiceOver.unavailable'));
        });
}

function sync() {
    const current = session;
    if (!current || current.inFlight) return;
    const video = videoElement();
    const videoId = currentVideoId();
    if (!video || videoId !== current.videoId) {
        // Another video or the player was closed.
        stop();
        return;
    }
    const state = videoState(video);
    current.inFlight = true;
    request('POST', '/vot/sync', {
        videoId: current.videoId,
        t: state.t,
        paused: state.paused,
        rate: state.rate,
        volume: translationVolume()
    }).then((res) => {
        current.inFlight = false;
        current.failures = 0;
        if (session === current) handleStatus(res.body);
    }).catch((e) => {
        current.inFlight = false;
        if (session !== current) return;
        current.failures = (current.failures || 0) + 1;
        if (current.failures >= 3) {
            console.warn('[VoiceOver] module stopped responding:', e.message);
            fail(t('toasts.voiceOver.unavailable'));
        }
    });
}

function attachVideoEvents(video) {
    let pending = null;
    const onEvent = () => {
        // Coalesce bursts (seeking + seeked + playing) into one report.
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            sync();
        }, 30);
    };
    VIDEO_EVENTS.forEach((name) => {
        video.addEventListener(name, onEvent);
        listeners.push(() => video.removeEventListener(name, onEvent));
    });
}

function start() {
    const videoId = currentVideoId();
    const video = videoElement();
    if (!videoId || !video) {
        toast(t('toasts.voiceOver.noVideo'));
        return;
    }
    const meta = getPlayerMeta(videoId);
    if (meta && meta.isLive) {
        toast(t('toasts.voiceOver.live'));
        return;
    }
    session = {
        videoId,
        uiState: 'off',
        savedVolume: null,
        duckedVideo: null,
        lastWaitingToast: 0,
        lastRemaining: -1,
        inFlight: false,
        failures: 0,
        timer: null,
        restarting: false
    };
    setUiState('waiting');
    attachVideoEvents(video);
    session.timer = setInterval(sync, SYNC_INTERVAL);
    sendStart();
}

function stop() {
    const current = session;
    if (!current) return;
    unduck();
    clearInterval(current.timer);
    listeners.forEach((off) => off());
    listeners = [];
    session = null;
    request('POST', '/vot/stop', {}).catch(() => { });
    notifyOff();
}

export function toggleVoiceOver() {
    if (session) {
        console.info('[VoiceOver] off by user');
        stop();
    } else {
        start();
    }
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (!session || !e.detail) return;
    if (e.detail.key === 'voiceOverOriginalVolume' && session.savedVolume !== null) {
        const video = videoElement();
        if (video) duck(video);
    }
    if (e.detail.key === 'voiceOverVolume') sync();
});

window.addEventListener('hashchange', () => {
    if (session && currentVideoId() !== session.videoId) stop();
});
