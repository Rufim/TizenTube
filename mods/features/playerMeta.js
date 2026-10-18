// Remembers metadata of recently parsed player responses (title, duration and
// the spoken language guessed from the auto-generated caption track), keyed
// by video id. Filled from the JSON.parse hook in adblock.js.

const MAX_ENTRIES = 20;
const entries = {};
const order = [];

export function rememberPlayerResponse(r) {
    const details = r && r.videoDetails;
    if (!details || !details.videoId) return;
    let spokenLang = null;
    try {
        const tracks = r.captions.playerCaptionsTracklistRenderer.captionTracks || [];
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].kind === 'asr' && tracks[i].languageCode) {
                spokenLang = tracks[i].languageCode;
                break;
            }
        }
    } catch (e) { }
    const id = details.videoId;
    if (!entries[id]) {
        order.push(id);
        if (order.length > MAX_ENTRIES) delete entries[order.shift()];
    }
    entries[id] = {
        videoId: id,
        title: details.title || '',
        lengthSeconds: Number(details.lengthSeconds) || 0,
        isLive: !!details.isLive,
        spokenLang
    };
}

export function getPlayerMeta(videoId) {
    return entries[videoId] || null;
}
