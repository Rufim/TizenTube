// Loader for the Rufim/TizenTube build in TizenTube Cobalt.
//
// The patched APK loads https://rufim.github.io/TizenTube/userScript.js: the GitHub Pages
// host is added to the list of hosts Cobalt lets past YouTube's CSP. Older builds load this
// file from https://cdn.jsdelivr.net/gh/Rufim/TizenTube@gh-pages/userScript.js.
//
// The build is taken from GitHub Pages too (served fresh within 10 minutes of a push).
// If Pages is unreachable or the APK does not let it through, it falls back to jsDelivr.
// jsDelivr may serve a branch URL stale for up to 12 hours, so the fallback asks GitHub
// for the current gh-pages commit and loads the build pinned to it.
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

    function load(url, onerror) {
        var script = document.createElement('script');
        script.src = policy ? policy.createScriptURL(url) : url;
        if (onerror) script.onerror = onerror;
        (document.head || document.documentElement).appendChild(script);
    }

    function loadFromJsDelivr() {
        function inject(ref) {
            load('https://cdn.jsdelivr.net/gh/' + repo + '@' + ref + '/' + file);
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
    }

    // Pages caches for 10 minutes; the parameter keeps Cobalt's own cache in step with it.
    load('https://rufim.github.io/TizenTube/' + file + '?v=' + Math.floor(Date.now() / 600000),
        function () {
            console.warn('TizenTube: GitHub Pages is not reachable, loading the build from jsDelivr');
            loadFromJsDelivr();
        });
})();
