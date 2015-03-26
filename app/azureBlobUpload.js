angular.module('azureBlobStorage').factory('azureBlobUpload', [
    '$log', '$http', '$q', 'arrayBufferUtils', function ($log, $http, $q, arrayBufferUtils) {

        // config { state, done, doneOne }
        function readNextSetOfBlocks(config) {
            var numberOfBlocksToRead = 10;

            var state = config.state;
            var done = config.done || function() {};
            var doneOne = config.doneOne || function() {};
            var doneHalf = config.doneHalf || function() {};
            var alreadyReading = config.alreadyReading || function() { $log.debug('Already reading next set of blocks!'); };

            if (state.readingNextSetOfBlocks) {
                alreadyReading();
                return;
            }

            state.readingNextSetOfBlocks = true;

            var fileReader = new FileReader();
            var skip = state.blocksReadIndex;
            var numberOfBlocks = state.numberOfBlocks;

            if (skip >= numberOfBlocks) {
                // FINISHED. WHY ARE YOU HERE?
                done();
                state.readingNextSetOfBlocks = false;
                return;
            }

            var end = (skip + numberOfBlocksToRead) > numberOfBlocks ? numberOfBlocks : (skip + numberOfBlocksToRead);

            var blocksToRead = state.blocks.slice(skip, end);
            var currentIndex = 0;

            var readNextBlock = function() {
                var fileContent = state.file.slice(blocksToRead[currentIndex].pointer, blocksToRead[currentIndex].end);
                fileReader.readAsArrayBuffer(fileContent);
            };

            fileReader.onload = function(e) {
                if (e.target.readyState === FileReader.DONE && !state.cancelled) {
                    var currentBlock = blocksToRead[currentIndex];
                    $log.debug('Read block ' + currentBlock.blockId);

                    currentBlock.read = true;
                    currentBlock.data = new Uint8Array(e.target.result);

                    // Calculate block MD5
                    var blockMd5Start = performance.now();
                    currentBlock.md5 = arrayBufferUtils.getArrayBufferMd5(currentBlock.data);
                    var blockMd5End = performance.now();
                    $log.debug("Call to getArrayBufferMd5 for block " + currentBlock.blockId + " took " + (blockMd5End - blockMd5Start) + " milliseconds.");

                    // Iterate file MD5
                    if (state.calculateFileMd5) {
                        state.fileMd5.append(currentBlock.data);
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
                        done();
                        state.blocksReadIndex = state.blocksReadIndex + currentIndex;
                        state.readingNextSetOfBlocks = false;
                    }
                }
            };

            readNextBlock();
        }

        function blockUploading(state, block) {
            block.uploading = true;

            var getReadAndUnprocessed = function() {
                return state.blocks.filter(function(b) {
                    return b.read === true && b.uploading === false && b.resolved === false;
                });
            };

            // Check that there available blocks
            if (getReadAndUnprocessed().length < 5 && !state.readingNextSetOfBlocks) {
                readNextSetOfBlocks({
                    state: state
                });
            }
        }

        function uploadBlock(state, block) {
            var deferred = $q.defer();

            $log.debug("uploadBlock: block id = " + block.blockId);

            if (state.cancelled) {
                deferred.reject('Cancelled');
                return deferred.promise;
            }

            var uri = state.blobUri + '&comp=block&blockid=' + block.getBlockId();
            var requestData = block.data;

            if (requestData === null) {
                throw new Error('Block ' + block.blockId + ' has no data to upload!');
            }

            blockUploading(state, block);

            $http.put(uri, requestData,
                {
                    headers: {
                        'x-ms-blob-type': 'BlockBlob',
                        'Content-Type': state.file.type,
                        'Content-MD5': block.md5.toString(CryptoJS.enc.Base64)
                    },
                    transformRequest: []
                }).success(function(data, status, headers, config) {
                    $log.debug('Put block successfully ' + block.blockId);

                    // Clear data
                    block.data = null;
                    block.uploading = false;

                    deferred.resolve({
                        requestLength: requestData.length,
                        data: data,
                        headers: headers,
                        config: config
                    });
                })
                .error(function(data, status, headers, config) {
                    $log.error('Put block error');
                    $log.error(data);

                    deferred.reject({
                        data: data,
                        status: status,
                        headers: headers,
                        config: config
                    });
                });

            return deferred.promise;
        }

        /* config: {
          blobUri: // Blob file uri (i.e. http://<accountName>.blob.core.windows.net/<container>/<blobname>) with SAS token,
          file: // File object using the HTML5 File API,
          progress: // progress callback function,
          complete: // complete callback function,
          error: // error callback function,
          blockSize: // Use this to override the DefaultBlockSize,
          calculateFileMd5: // Calculate full file MD5 and return with .complete callback
        } */
        function upload(config) {
            var state = initializeState(config);

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
                    blockIdBase64: btoa(blockId),
                    pointer: pointer,
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
                if (state.progress) state.progress(percentComplete, result.data, result.status, result.headers, result.config);

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
                    var action = uploadBlock(state, block);

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
                        if(state.blocks[j]) {
                            addNextAction(state.blocks[j]);
                        }
                    }
                }
            });

            return {
                cancel: function() {
                    state.cancelled = true;
                }
            };
        }

        function initializeState(config) {
            var defaultBlockSize = 1024 * 1024; // Default to 1024KB

            var blockSize = config.blockSize ? config.blockSize : defaultBlockSize;

            var maxBlockSize = blockSize;
            var numberOfBlocks = 1;

            var file = config.file;

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

            return {
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
                progress: config.progress,
                complete: config.complete,
                error: config.error,
                cancelled: false,
                calculateFileMd5: config.calculateFileMd5 || false,
                fileMd5: arrayBufferUtils.getArrayBufferMd5Iterative(),
                readingNextSetOfBlocks: false
            };
        }

        function commitBlockList(state) {
            var uri = state.blobUri + '&comp=blocklist';

            var requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
            state.blocks.forEach(function(block) {
                requestBody += '<Latest>' + block.getBlockId() + '</Latest>';
            });
            requestBody += '</BlockList>';

            $http.put(uri, requestBody,
                {
                    headers: {
                        'x-ms-blob-content-type': state.file.type,
                    }
                }).success(function(data, status, headers, config) {
                    if (state.complete) state.complete(data, status, headers, config, state.fileMd5.finalize());

                    $log.debug('Upload took ' + (performance.now() - state.startedUpload) + 'ms');
                })
                .error(function(data, status, headers, config) {
                    $log.error('Put block list error ' + status);
                    $log.error(data);
                    if (state.error) state.error(data, status, headers, config);
                });
        }

        function pad(number, length) {
            var str = '' + number;
            while (str.length < length) {
                str = '0' + str;
            }
            return str;
        }

        return {
            upload: upload,
        };
    }
]);
