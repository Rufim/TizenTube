// Loader for the Rufim/TizenTube build in TizenTube Cobalt.
//
// The patched APK loads https://cdn.jsdelivr.net/gh/Rufim/TizenTube@gh-pages/userScript.js
// (cdn.jsdelivr.net is one of the few hosts Cobalt lets past YouTube's CSP).
// jsDelivr may serve a branch URL stale for up to 12 hours, so this small file
// asks GitHub for the current gh-pages commit and loads the build pinned to it.
(function () {
    var repo = 'Rufim/TizenTube';
    var file = 'tizentube.js';
    var policy = null;
    try {
        if (window.trustedTypes) {
            policy = window.trustedTypes.createPolicy('tizentube-loader-' + Date.now(), {
                createScriptURL: function (url) { return url; }
            });
        }
    } catch (e) { }

    function inject(ref) {
        var url = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + ref + '/' + file;
        var script = document.createElement('script');
        script.src = policy ? policy.createScriptURL(url) : url;
        (document.head || document.documentElement).appendChild(script);
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.github.com/repos/' + repo + '/git/ref/heads/gh-pages', true);
    xhr.timeout = 5000;
    xhr.onload = function () {
        try {
            var sha = JSON.parse(xhr.responseText).object.sha;
            if (/^[0-9a-f]{40}$/.test(sha)) return inject(sha);
        } catch (e) { }
        inject('gh-pages');
    };
    xhr.onerror = xhr.ontimeout = function () { inject('gh-pages'); };
    xhr.send();
})();
