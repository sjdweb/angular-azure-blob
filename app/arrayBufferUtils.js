angular.module('azureBlobStorage').service('arrayBufferUtils', function() {

    function arraybuffer2WordArray(arrayBuffer) {
        var words = [],
            u8Arr = new Uint8Array(arrayBuffer),
            len = u8Arr.length;

        for (var i = 0; i < len; i++) {
            words[i >>> 2] |= (u8Arr[i] & 0xff) << (24 - (i % 4) * 8);
        }

        return CryptoJS.lib.WordArray.create(words, len);
    }

    this.getArrayBufferMd5 = function(arrayBuffer) {
        var md5 = CryptoJS.algo.MD5.create();
        var wordArray = arraybuffer2WordArray(arrayBuffer);
        md5.update(wordArray);
        return md5.finalize();
    };

    function IterativeMd5() {
        this._md5 = CryptoJS.algo.MD5.create();
    }

    IterativeMd5.prototype.append = function(arrayBuffer) {
        var wordArray = arraybuffer2WordArray(arrayBuffer);
        this._md5.update(wordArray);
        return this;
    };

    IterativeMd5.prototype.finalize = function () {
        return this._md5.finalize();
    };

    this.getArrayBufferMd5Iterative = function() {
        return new IterativeMd5();
    };
});
