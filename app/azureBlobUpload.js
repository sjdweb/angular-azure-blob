angular.module('azureBlobStorage').factory('azureBlobUpload', [
    '$log', '$http', '$q', 'arrayBufferUtils', function ($log, $http, $q, arrayBufferUtils) {

        function calculateFileMd5(file, done) {
            var fileReader = new FileReader();
            var start = performance.now();

            fileReader.onload = function(e) {
                var md5 = arrayBufferUtils.getArrayBufferMd5(e.target.result);
                var end = performance.now();
                $log.debug('MD5 of whole file took ' + (end - start) + 'ms');

                done(md5);
            };

            fileReader.readAsArrayBuffer(file);

            fileReader.onerror = function(e) {
                $log.error(e);
            };
        }

        function uploadBlock(state, block) {
            $log.debug("uploadBlock: block id = " + block.blockId);

            var deferred = $q.defer();

            var reader = new FileReader();
            reader.onloadend = function(evt) {
                if (evt.target.readyState == FileReader.DONE && !state.cancelled) { // DONE == 2
                    var uri = state.blobUri + '&comp=block&blockid=' + block.blockIdBase64;
                    var requestData = new Uint8Array(evt.target.result);

                    var start = performance.now();
                    var blockMd5 = arrayBufferUtils.getArrayBufferMd5(evt.target.result);
                    var end = performance.now();

                    $log.debug("Call to getArrayBufferMd5 for block " + block.blockId + " took " + (end - start) + " milliseconds.");

                    $http.put(uri, requestData,
                        {
                            headers: {
                                'x-ms-blob-type': 'BlockBlob',
                                'Content-Type': state.file.type,
                                'Content-MD5': blockMd5.toString(CryptoJS.enc.Base64)
                            },
                            transformRequest: [],
                        }).success(function (data, status, headers, config) {
                            $log.debug('Put block successfully ' + block.blockId);

                            deferred.resolve({
                                requestLength: requestData.length,
                                data: data,
                                headers: headers,
                                config: config
                            });
                        })
                        .error(function (data, status, headers, config) {
                            $log.error('Put block error');
                            $log.error(data);

                            deferred.reject({
                                data: data,
                                status: status,
                                headers: headers,
                                config: config
                            });
                        });
                }
            };

            var fileContent = state.file.slice(block.pointer, block.end);
            reader.readAsArrayBuffer(fileContent);

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
                    resolved: false
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

            // Calculate whole file md5 in background
            if(config.calculateFileMd5) {
                calculateFileMd5(config.file, function (md5) {
                    state.fileMd5 = md5;
                });
            }

            state.startedUpload = performance.now();

            for (var j = 0; j < 8; j++) {
                if(state.blocks[j]) {
                    addNextAction(state.blocks[j]);
                }
            }

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
                bytesUploaded: 0,
                file: file,
                blobUri: config.blobUri,
                progress: config.progress,
                complete: config.complete,
                error: config.error,
                cancelled: false,
                calculateFileMd5: config.calculateFileMd5 || false,
                fileMd5: null
            };
        }

        function commitBlockList(state) {
            var uri = state.blobUri + '&comp=blocklist';

            var requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
            state.blocks.forEach(function(block) {
                requestBody += '<Latest>' + block.blockIdBase64 + '</Latest>';
            });
            requestBody += '</BlockList>';

            $http.put(uri, requestBody,
                {
                    headers: {
                        'x-ms-blob-content-type': state.file.type,
                    }
                }).success(function(data, status, headers, config) {
                    if (state.complete) state.complete(data, status, headers, config, state.fileMd5);

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
