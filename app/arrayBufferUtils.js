module.exports = (function () {
    this.arrayBuffer2WordArray = function(arrayBuffer) {
        return CryptoJS.lib.WordArray.create(arrayBuffer, arrayBuffer.length);
    };

    this.getArrayBufferMd5 = function (arrayBuffer) {
        var wordArray = this.arrayBuffer2WordArray(arrayBuffer);
        return this.getWordArrayMd5(wordArray);
    };
    
    this.getWordArrayMd5 = function(wordArray) {
        var md5 = CryptoJS.algo.MD5.create();
        md5.update(wordArray);
        return md5.finalize();
    };

    function IterativeMd5() {
        this._md5 = null; // Lazy load
    }

    IterativeMd5.prototype.append = function (arrayBuffer) {
        if (this._md5 === null) {
        this._md5 = CryptoJS.algo.MD5.create();
        }

        var wordArray = this.arrayBuffer2WordArray(arrayBuffer);
        this._md5.update(wordArray);
        return this;
    };

    IterativeMd5.prototype.finalize = function () {
        return this._md5.finalize();
    };

    this.getArrayBufferMd5Iterative = function () {
        return new IterativeMd5();
    };

    return this;
})();