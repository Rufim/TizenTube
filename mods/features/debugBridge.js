// Debug bridge to the voice-over module inside the TizenTube Cobalt APK
// (http://127.0.0.1:8777). DevTools are stripped from Cobalt builds, so:
//  - console.* calls, uncaught errors and unhandled rejections are forwarded to
//    POST /debug/log and land in logcat under the TizenTube-js tag;
//  - the page long-polls GET /debug/next for JS snippets queued from the host
//    (tools/tt-eval.py through `adb forward`), runs them and posts the result
//    to POST /debug/result.
// Off by default (Settings -> Miscellaneous). The host can also attach it for
// the current run only (tools/tt-eval.py --attach): while the setting is off the
// page asks GET /debug/attached every 15 s.

import { configRead, configChangeEmitter } from '../config.js';

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
const FLUSH_DELAY = 300;
const MAX_BUFFER = 300;
const POLL_WAIT = 25000;
const RETRY_DELAY = 5000;
const EVAL_TIMEOUT = 15000;
const ATTACH_CHECK_INTERVAL = 15000;

const buffer = [];
let flushTimer = null;
let polling = false;
let hooked = false;
let scriptPolicy = null;
let hostAttached = false;

function enabled() {
    return hostAttached || !!configRead('enableDebugBridge');
}

function endpoint() {
    return configRead('voiceOverEndpoint');
}

function describe(value, depth) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean' || type === 'function') return String(value).slice(0, 500);
    if (value instanceof Error) return value.stack || (value.name + ': ' + value.message);
    if (value && value.nodeType === 1 && value.outerHTML) return value.outerHTML.slice(0, 1000);
    try {
        const seen = [];
        return JSON.stringify(value, (key, v) => {
            if (v && typeof v === 'object') {
                if (seen.indexOf(v) !== -1) return '[circular]';
                seen.push(v);
                if (v.nodeType === 1) return '<' + v.tagName.toLowerCase() + '>';
            }
            if (typeof v === 'function') return '[function]';
            return v;
        }).slice(0, depth ? 4000 : 20000);
    } catch (e) {
        return String(value);
    }
}

function format(args) {
    const parts = [];
    for (let i = 0; i < args.length; i++) parts.push(describe(args[i], true));
    return parts.join(' ');
}

function post(path, body, timeout, onDone) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint() + path, true);
    xhr.timeout = timeout || 5000;
    // text/plain keeps the request "simple" (no CORS preflight needed).
    xhr.setRequestHeader('Content-Type', 'text/plain');
    if (onDone) {
        xhr.onload = () => onDone(null, xhr);
        xhr.onerror = xhr.ontimeout = () => onDone(new Error('request failed'), xhr);
    }
    xhr.send(body);
}

function flush() {
    flushTimer = null;
    if (!buffer.length || !enabled()) {
        buffer.length = 0;
        return;
    }
    const batch = buffer.splice(0, buffer.length);
    post('/debug/log', JSON.stringify(batch));
}

function queue(level, message) {
    if (!enabled()) return;
    buffer.push({ l: level, m: message });
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY);
}

function hookConsole() {
    if (hooked) return;
    hooked = true;
    LEVELS.forEach((level) => {
        const original = console[level];
        if (typeof original !== 'function') return;
        console[level] = function () {
            try {
                original.apply(console, arguments);
            } catch (e) { }
            try {
                queue(level, format(arguments));
            } catch (e) { }
        };
    });
    window.addEventListener('error', (e) => {
        queue('error', 'Uncaught ' + (e.message || 'error') + ' at ' + (e.filename || '?') + ':' + e.lineno + ':' + e.colno +
            (e.error && e.error.stack ? '\n' + e.error.stack : ''));
    });
    window.addEventListener('unhandledrejection', (e) => {
        queue('error', 'Unhandled rejection: ' + describe(e.reason, true));
    });
}

function evaluate(code) {
    // Indirect eval runs in the global scope. With Trusted Types enforced the
    // string has to go through a policy first.
    const indirect = eval;
    try {
        return indirect(code);
    } catch (e) {
        if (!(e instanceof TypeError) || !window.trustedTypes) throw e;
        if (!scriptPolicy) {
            scriptPolicy = window.trustedTypes.createPolicy('tizentube-debug-' + Date.now(), {
                createScript: (s) => s
            });
        }
        return indirect(scriptPolicy.createScript(code));
    }
}

function runCommand(cmd) {
    const started = Date.now();
    let finished = false;
    const reply = (ok, value) => {
        if (finished) return;
        finished = true;
        const body = { id: cmd.id, ok, ms: Date.now() - started };
        body[ok ? 'result' : 'error'] = describe(value, false);
        post('/debug/result', JSON.stringify(body));
    };
    try {
        const result = evaluate(cmd.code);
        if (result && typeof result.then === 'function') {
            setTimeout(() => reply(false, 'promise timeout'), EVAL_TIMEOUT);
            result.then((v) => reply(true, v), (e) => reply(false, e));
        } else {
            reply(true, result);
        }
    } catch (e) {
        reply(false, e);
    }
}

function poll() {
    if (!enabled()) {
        polling = false;
        return;
    }
    polling = true;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', endpoint() + '/debug/next?wait=' + POLL_WAIT, true);
    xhr.timeout = POLL_WAIT + 5000;
    xhr.onload = () => {
        let cmd = null;
        try {
            cmd = JSON.parse(xhr.responseText);
        } catch (e) { }
        if (cmd && cmd.id) runCommand(cmd);
        if (xhr.status === 200) poll();
        else setTimeout(poll, RETRY_DELAY);
    };
    xhr.onerror = xhr.ontimeout = () => setTimeout(poll, RETRY_DELAY);
    xhr.send();
}

function start() {
    if (!enabled()) return;
    hookConsole();
    if (!polling) poll();
    queue('info', '[DebugBridge] attached: ' + location.href);
}

function checkAttached() {
    if (configRead('enableDebugBridge')) return;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', endpoint() + '/debug/attached', true);
    xhr.timeout = 3000;
    xhr.onload = () => {
        let attached = false;
        try {
            attached = !!JSON.parse(xhr.responseText).attached;
        } catch (e) { }
        if (attached !== hostAttached) {
            hostAttached = attached;
            if (attached) start();
        }
    };
    xhr.send();
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail && e.detail.key === 'enableDebugBridge') start();
});

start();
setInterval(checkAttached, ATTACH_CHECK_INTERVAL);
checkAttached();
