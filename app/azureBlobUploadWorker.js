var Uploader = require('./azureBlobUploader');

(function () {
    if ("performance" in self === false) {
        self.performance = {};
    }

    Date.now = (Date.now || function () {  // thanks IE8
        return new Date().getTime();
    });

    if ("now" in self.performance === false) {
        var nowOffset = Date.now();

        if (performance.timing && performance.timing.navigationStart) {
            nowOffset = performance.timing.navigationStart;
        }

        self.performance.now = function now() {
            return Date.now() - nowOffset;
        };
    }
})();

(function() {
    var $log = {
        debug: function(message) {
            self.postMessage({ type: 'log', logType: 'debug', message: message });
        },
        error: function(message) {
            self.postMessage({ type: 'log', logType: 'error', message: message });
        }
    };

    function importAllScripts(libPath) {
        var addTrailingSlash = function(str) {
            var lastChar = str.substr(-1);
            if (lastChar !== '/') {
                str = str + '/';
            }
            return str;
        };

        var addLib = function(f) {
            importScripts(addTrailingSlash(libPath) + f);
        };

        addLib('underscore/underscore-min.js');
        addLib('crypto-js/crypto-js.js');
        addLib('crypto-js/md5.js');
        addLib('crypto-js/lib-typedarrays.js');
        addLib('crypto-js/enc-base64.js');
        addLib('atomic/dist/atomic.min.js');
        addLib('q/q.js');
        addLib('base-64/base64.js');
    }

    function notifyReady() {
        self.postMessage({ type: 'ready' });
    }

    var uploader = new Uploader({ 
        log: function(log) {
            self.postMessage({ type: log.type, logType: log.logType, message: log.message });
        }, 
        error: function(error) {
            $log.error(error);
            self.close();
        }, 
        progress: function(payload) {
            self.postMessage({ type: 'progress', payload: payload });
        },
        complete: function(payload) {
            self.postMessage({ type: 'complete', payload: payload });
            self.close();
        }
    });

    function doUpload() {
        try {
            uploader.upload();
        } catch(err) {
            $log.error(err);
        }
    }

    self.onmessage = function(e) {
        switch (e.data.type) {
            case 'file':
                uploader.setFile(e.data.file);
                break;
            case 'config':
                // Setup state
                uploader.setConfig(e.data.config);

                // Load scripts first
                importAllScripts(e.data.config.libPath);

                // Notify when ready for an upload
                notifyReady();
                break;
            case 'upload':
                doUpload();
                break;
            case 'cancel':
                uploader.cancel();
                self.close();
                break;
            default:
                throw new Error("Don't know what to do with message of type " + e.data.type);
        }
    };
})();