// The "Y" button of the voice-over translation in the player controls.
// customUI.js adds it next to the speed button as a regular transport control;
// here its icon is replaced with the letter Y and coloured by state:
// off / waiting for the translation / playing / error.

import { t } from 'i18next';
import { onVoiceOverStateChange, voiceOverButtonState } from '../features/voiceOver.js';

export const VOICE_OVER_BUTTON_TYPE = 'TRANSPORT_CONTROLS_BUTTON_TYPE_VOICE_OVER';
export const VOICE_OVER_BUTTON_ICON = 'TRANSLATE';

const STATE_COLORS = {
    off: null,
    waiting: '#f9a825',
    playing: '#1e88e5',
    error: '#cc0000'
};

export function voiceOverButtonLabel() {
    return t('player.voiceOver.button');
}

function findButtons() {
    const label = voiceOverButtonLabel();
    const found = [];
    const nodes = document.querySelectorAll('[aria-label]');
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute('aria-label') === label) found.push(nodes[i]);
    }
    return found;
}

function decorate() {
    const state = voiceOverButtonState();
    const color = STATE_COLORS[state];
    findButtons().forEach((button) => {
        const icon = button.querySelector('yt-icon, ytlr-icon, .ytlr-icon, svg, [class*="icon"]');
        if (icon && !icon.getAttribute('data-tt-vot')) {
            icon.setAttribute('data-tt-vot', '1');
            icon.style.setProperty('display', 'none', 'important');
            const letter = document.createElement('span');
            letter.className = 'tt-vot-letter';
            letter.textContent = 'Y';
            letter.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
                'font-weight:700;font-size:1.6em;line-height:1;font-family:Roboto,Arial,sans-serif;pointer-events:none;';
            icon.parentNode.insertBefore(letter, icon);
        }
        if (color) {
            button.style.setProperty('background-color', color, 'important');
            button.style.setProperty('border-radius', '50%', 'important');
        } else {
            button.style.removeProperty('background-color');
            button.style.removeProperty('border-radius');
        }
    });
}

onVoiceOverStateChange(decorate);

// Player controls are re-rendered whenever they appear: re-apply on key presses.
window.addEventListener('keydown', () => setTimeout(decorate, 50), true);
setInterval(decorate, 2000);
