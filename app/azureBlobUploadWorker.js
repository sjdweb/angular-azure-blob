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
    var arrayBufferUtils = (function() {
        function arraybuffer2WordArray(arrayBuffer) {
            return CryptoJS.lib.WordArray.create(arrayBuffer);
        }

        this.getArrayBufferMd5 = function(arrayBuffer) {
            var md5 = CryptoJS.algo.MD5.create();
            var wordArray = arraybuffer2WordArray(arrayBuffer);
            md5.update(wordArray);
            return md5.finalize();
        };

        function IterativeMd5() {
            this._md5 = null; // Lazy load
        }

        IterativeMd5.prototype.append = function(arrayBuffer) {
            if (this._md5 === null) {
                this._md5 = CryptoJS.algo.MD5.create();
            }

            var wordArray = arraybuffer2WordArray(arrayBuffer);
            this._md5.update(wordArray);
            return this;
        };

        IterativeMd5.prototype.finalize = function() {
            return this._md5.finalize();
        };

        this.getArrayBufferMd5Iterative = function() {
            return new IterativeMd5();
        };

        return this;
    })();

    var $log = {
        debug: function(message) {
            self.postMessage({ type: 'log', logType: 'debug', message: message });
        },
        error: function(message) {
            self.postMessage({ type: 'log', logType: 'error', message: message });
        }
    };

    var state = {};
    var file = null;

    function setFile(f) {
        file = f;
    }

    function error(data, status) {
        self.postMessage({ type: 'error', data: data, status: status });
        self.close();
    }

    /* config: {
          libPath: // Path to libs for the worker
          blobUri: // Blob file uri (i.e. http://<accountName>.blob.core.windows.net/<container>/<blobname>) with SAS token,
          error: // error callback function,
          blockSize: // Use this to override the DefaultBlockSize,
          calculateFileMd5: // Calculate full file MD5 and return with .complete callback
        } */
    function setConfig(config) {
        var defaultBlockSize = 1024 * 1024; // Default to 1024KB

        var blockSize = config.blockSize ? config.blockSize : defaultBlockSize;

        var maxBlockSize = blockSize;
        var numberOfBlocks = 1;

        if (!file) {
            $log.error("MUST set file before setting config");
        }

        var fileSize = file.size;
        if (fileSize < blockSize) {
            maxBlockSize = fileSize;
            $log.debug("max block size = " + maxBlockSize);
        }

        if (fileSize % maxBlockSize === 0) {
            numberOfBlocks = fileSize / maxBlockSize;
        } else {
            numberOfBlocks = parseInt(fileSize / maxBlockSize, 10) + 1;
        }

        $log.debug("total blocks = " + numberOfBlocks);

        state = {
            libPath: config.libPath,
            maxBlockSize: maxBlockSize, //Each file will be split in 256 KB.
            numberOfBlocks: numberOfBlocks,
            totalBytesRemaining: fileSize,
            fileSize: fileSize,
            currentFilePointer: 0,
            blocks: [],
            blockIdPrefix: 'block-',
            blocksReadIndex: 0,
            bytesUploaded: 0,
            file: file,
            blobUri: config.blobUri,
            error: config.error,
            cancelled: false,
            calculateFileMd5: config.calculateFileMd5 || false,
            fileMd5: arrayBufferUtils.getArrayBufferMd5Iterative(),
            readingNextSetOfBlocks: false
        };
    }

    // config { state, done, doneOne }
    function readNextSetOfBlocks(config) {
        var numberOfBlocksToRead = 10;

        var done = config.done || function() {};
        var doneOne = config.doneOne || function() {};
        var doneHalf = config.doneHalf || function() {};
        var alreadyReading = config.alreadyReading || function() { $log.debug('Already reading next set of blocks!'); };

        if (config.state.readingNextSetOfBlocks) {
            alreadyReading();
            return;
        }

        config.state.readingNextSetOfBlocks = true;

        var fileReader = new FileReaderSync();
        var skip = state.blocksReadIndex;
        var numberOfBlocks = state.numberOfBlocks;

        if (skip >= numberOfBlocks) {
            // FINISHED. WHY ARE YOU HERE?
            config.state.readingNextSetOfBlocks = false;
            done();
            return;
        }

        var end = (skip + numberOfBlocksToRead) > numberOfBlocks ? numberOfBlocks : (skip + numberOfBlocksToRead);

        var blocksToRead = config.state.blocks.slice(skip, end);
        var currentIndex = 0;

        var readNextBlock = function() {
            var fileContent = config.state.file.slice(blocksToRead[currentIndex].pointer, blocksToRead[currentIndex].end);
            var result = fileReader.readAsArrayBuffer(fileContent);
            loaded(result);
        };

        var loaded = function(result) {
            var currentBlock = blocksToRead[currentIndex];
            $log.debug('Read block ' + currentBlock.blockId);

            currentBlock.read = true;
            currentBlock.data = result;

            // Calculate block MD5
            var blockMd5Start = performance.now();
            currentBlock.md5 = arrayBufferUtils.getArrayBufferMd5(currentBlock.data);
            var blockMd5End = performance.now();
            $log.debug("Call to getArrayBufferMd5 for block " + currentBlock.blockId + " took " + (blockMd5End - blockMd5Start) + " milliseconds.");

            // Iterate file MD5
            if (config.state.calculateFileMd5) {
                config.state.fileMd5.append(currentBlock.data);
            }

            // Useful to keep things fast
            if (currentIndex === 0) {
                doneOne();
            }

            if (currentIndex === (numberOfBlocksToRead / 2 - 1)) {
                doneHalf();
            }

            ++currentIndex;
            if (currentIndex < blocksToRead.length) {
                readNextBlock();
            } else {
                config.state.blocksReadIndex = config.state.blocksReadIndex + currentIndex;
                config.state.readingNextSetOfBlocks = false;
                done();
            }
        };

        readNextBlock();
    }

    function blockUploading(block) {
        block.uploading = true;

        var getReadAndUnprocessed = function() {
            return state.blocks.filter(function(b) {
                return b.read === true && b.uploading === false && b.resolved === false;
            });
        };

        // Check that there available blocks
        if (getReadAndUnprocessed().length < 5 && !state.readingNextSetOfBlocks) {
            readNextSetOfBlocks({ state: state });
        }
    }

    function uploadBlock(block) {

        var deferred = Q.defer();

        $log.debug("uploadBlock: block id = " + block.blockId);

        if (state.cancelled) {
            error('cancelled');
            return deferred.promise;
        }

        var uri = state.blobUri + '&comp=block&blockid=' + block.blockIdBase64;
        var requestData = block.data;

        if (requestData === null) {
            $log.error('Block ' + block.blockId + ' has no data to upload!');
        }

        blockUploading(block);

        atomic.put(uri, requestData, {
            'x-ms-blob-type': 'BlockBlob',
            'Content-Type': state.file.type,
            'Content-MD5': block.md5.toString(CryptoJS.enc.Base64)
        }).success(function(result, req) {
            $log.debug('Put block successfully ' + block.blockId);

            // Clear data
            block.data = null;
            block.uploading = false;

            deferred.resolve({
                requestLength: block.size,
                data: result,
            });
        }).error(function(result, req) {
            $log.error('Put block error');
            $log.error(data);

            deferred.error({
                data: result,
                status: req.status,
            });
        });

        return deferred.promise;
    }

    function upload() {
        state.blocks = [];
        var numberOfBlocks = state.numberOfBlocks;
        var index = 0;
        var totalFileSize = state.fileSize;

        while (numberOfBlocks) {
            var pointer = (state.maxBlockSize * (index > 0 ? index : 0));

            var end = index === 0 ? state.maxBlockSize : pointer + state.maxBlockSize;
            if (end > totalFileSize) {
                end = totalFileSize;
            }

            var blockId = state.blockIdPrefix + pad(index, 6);

            state.blocks.push({
                index: index,
                blockId: blockId,
                blockIdBase64: base64.encode(blockId),
                pointer: pointer,
                size: (end - pointer),
                end: end,
                resolved: false,
                read: false,
                data: null,
                md5: null,
                uploading: false
            });

            index++;
            numberOfBlocks--;
        }

        var currentlyProcessing = [];

        var addToCurrentlyProcessing = function(block, action) {
            currentlyProcessing.push({ action: action, block: block });
        };

        var removeFromCurrentlyProcessing = function(action) {
            currentlyProcessing.splice(currentlyProcessing.indexOf(_.findWhere(currentlyProcessing, { action: action })), 1);
        };

        var getUnresolved = function() {
            return state.blocks.filter(function(b) {
                return b.resolved === false && !_.findWhere(currentlyProcessing, { block: b });
            });
        };

        var removeProcessedAction = function(action, result) {
            action.resolved = true;

            state.bytesUploaded += result.requestLength;
            state.totalBytesRemaining -= result.requestLength;

            var percentComplete = ((parseFloat(state.bytesUploaded) / parseFloat(state.file.size)) * 100).toFixed(2);

            self.postMessage({ type: 'progress', payload: { percentComplete: percentComplete, result: result } });

            removeFromCurrentlyProcessing(action);

            var hasNext = addNextAction();
            if (!hasNext && !_.any(currentlyProcessing)) {
                commitBlockList(state);
            }
        };

        var processRejectedAction = function(block, action, rejectReason) {
            // Remove from currently processing
            removeFromCurrentlyProcessing(action);

            // Log error
            $log.error(rejectReason);

            // Kick off retry and increment retry counter?

            // If reached maximum retries
            //if (state.error) state.error(data, status, headers, config);
        };

        var addNextAction = function() {
            var unresolved = getUnresolved();
            if (_.any(unresolved)) {
                var block = unresolved[0];
                var action = uploadBlock(block);

                action.then(function(result) {
                    block.resolved = true;
                    removeProcessedAction(action, result);
                }, function(rejectReason) {
                    block.resolved = false;
                    processRejectedAction(block, action, rejectReason);
                });

                addToCurrentlyProcessing(block, action);
            }

            return unresolved.length;
        };

        state.startedUpload = performance.now();

        // Get first set of blocks and kick off the upload process.
        readNextSetOfBlocks({
            state: state,
            done: function() {
                for (var j = 0; j < 8; j++) {
                    if (state.blocks[j]) {
                        addNextAction(state.blocks[j]);
                    }
                }
            }
        });
    }

    function commitBlockList() {
        var uri = state.blobUri + '&comp=blocklist';

        var requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
        state.blocks.forEach(function(block) {
            requestBody += '<Latest>' + block.blockIdBase64 + '</Latest>';
        });
        requestBody += '</BlockList>';

        atomic.put(uri, requestBody, {
                'x-ms-blob-content-type': state.file.type,
            }).success(function(data, req) {
                self.postMessage({ type: 'complete', payload: { data: data, md5: state.fileMd5.finalize().toString(CryptoJS.enc.Base64) } });
                $log.debug('Upload took ' + (performance.now() - state.startedUpload) + 'ms');

                self.close();
            })
            .error(function(data, req) {
                $log.error('Put block list error ' + req.status);
                $log.error(data);
                error(data, req.status);
            });
    }

    function pad(number, length) {
        var str = '' + number;
        while (str.length < length) {
            str = '0' + str;
        }
        return str;
    }

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

    function doUpload() {
        try {
            upload();
        } catch(err) {
            $log.error(err);
        }
    }

    self.onmessage = function(e) {

        switch (e.data.type) {
        case 'file':
            setFile(e.data.file);
            break;
        case 'config':
            // Setup state
            setConfig(e.data.config);

            // Load scripts first
            importAllScripts(e.data.config.libPath);

            // Notify when ready for an upload
            notifyReady();
            break;
        case 'upload':
            doUpload();
            break;
        case 'cancel':
            state.cancelled = true;
            break;
        default:
            throw new Error("Don't know what to do with message of type " + e.data.type);
        }
    };
})();