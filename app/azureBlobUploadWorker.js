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
    var arrayBufferUtils = require('./arrayBufferUtils');
    var SparkMD5 = require('spark-md5');
    
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
        addLib('base-64/base64.js');
    }
    
    function notifyReady() {
        self.postMessage({ type: 'ready' });
    }
    
    function calculateBlockMd5(blockId, blockData) {
        var result1 = arrayBufferUtils.getArrayBufferMd5(blockData);
        var result = SparkMD5.ArrayBuffer.hash(blockData, true);
        self.postMessage({ type: 'blockMd5Result', result: result, blockId: blockId, blockData: blockData });
    }

    self.onmessage = function(e) {
        switch (e.data.type) {
            case 'config':
                // Load scripts first
                importAllScripts(e.data.config.libPath);

                // Notify when ready for an upload
                notifyReady();
                break;
            case 'blockMd5':
                calculateBlockMd5(e.data.blockId, e.data.blockData);
                break;
            case 'close':
                self.close();
                break;
            default:
                throw new Error("Don't know what to do with message of type " + e.data.type);
        }
    };
})();
