// The "Y" button of the voice-over translation in the player controls.
// customUI.js adds it next to the speed button as a regular transport control;
// here its icon is replaced with the letter Y and coloured by state:
// off / waiting for the translation / playing / error.
//
// Only a stylesheet keyed on the button's aria-label is used: YouTube's renderer
// reuses icon elements between buttons on re-render, so any mark left on a node
// (inline style, extra child) ends up on a neighbouring button.

import { t } from 'i18next';
import { onVoiceOverStateChange, voiceOverButtonState } from '../features/voiceOver.js';

export const VOICE_OVER_BUTTON_TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_VOICE_OVER';
export const VOICE_OVER_BUTTON_ICON = 'TRANSLATE';

const STATE_ATTR = 'data-tt-vot-state';

const STATE_COLORS = {
    waiting: '#f9a825',
    playing: '#1e88e5',
    error: '#cc0000'
};

export function voiceOverButtonLabel() {
    return t('player.voiceOver.button');
}

let style = null;
let styledLabel = null;

function buildCss(label) {
    const button = `yt-button-container[aria-label="${label.replace(/["\\]/g, '\\$&')}"]`;
    let css = `
    ${button} yt-icon {
        display: none !important;
    }
    ${button} yt-button-graphic::before {
        content: "Y";
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        font-weight: 700;
        font-size: 1.2em;
        line-height: 1;
        font-family: Roboto, Arial, sans-serif;
    }
`;
    for (const state in STATE_COLORS) {
        css += `
    html[${STATE_ATTR}="${state}"] ${button} {
        background-color: ${STATE_COLORS[state]} !important;
        border-radius: 50% !important;
    }
`;
    }
    return css;
}

function ensureStyle() {
    const label = voiceOverButtonLabel();
    if (style && style.isConnected && styledLabel === label) return;
    if (!document.head) return;
    if (!style) {
        style = document.createElement('style');
        // YouTube's CSP only lets styles with the page's style nonce through
        // (scripts have a different one).
        const nonced = document.querySelector('style[nonce]');
        if (nonced && nonced.nonce) style.nonce = nonced.nonce;
    }
    style.textContent = buildCss(label);
    styledLabel = label;
    if (!style.isConnected) document.head.appendChild(style);
}

function applyState() {
    ensureStyle();
    document.documentElement.setAttribute(STATE_ATTR, voiceOverButtonState());
}

onVoiceOverStateChange(applyState);
applyState();
setInterval(ensureStyle, 5000);
