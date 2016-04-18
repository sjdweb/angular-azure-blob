angular.module('azureBlobStorage').factory('azureBlobUpload', [
    '$log', function ($log) {

        var queue = [];
        var processing = false;

        function QueueItem(file, config) {
            this.file = file;
            this.config = config;
            this.uploading = false;
            this.completed = false;
            this.cancel = null;
            this.cancelled = false;

            this.unresolved = function () {
                return this.uploading === false && this.completed === false && this.cancelled === false;
            };
        }

        function getUnresolved() {
            return queue.filter(function (q) { return q.unresolved(); });
        }

        function processQueueItem(item) {
            if (item.cancelled) {
                return;
            }

            var worker = new window.Worker(item.config.path + (item.config.workerFileName || 'azure-blob-upload-worker.js'));

            processing = true;
            item.uploading = true;

            item.cancel = function () {
                worker.postMessage({ type: 'cancel' });

                processNextItem();
            };

            // Get blob URI promise before kicking off worker
            item.config.getBlobUri(item).then(function (result) {
                worker.postMessage({ type: 'file', file: item.file.file });
                worker.postMessage({
                    type: 'config',
                    config: {
                        blobUri: result,
                        blockSize: item.config.blockSize,
                        calculateFileMd5: item.config.calculateFileMd5,
                        libPath: item.config.libPath || item.config.path
                    }
                });
            });

            function log(logType, message) {
                var logTypes = { 'debug': $log.debug, 'error': $log.error };
                logTypes[logType](message);
            }

            function processNextItem() {
                var unresolved = getUnresolved();
                if (unresolved[0]) {
                    processQueueItem(unresolved[0]);
                } else {
                    processing = false;
                }
            }

            function complete(payload) {
                item.completed = true;
                item.uploading = false;
                item.cancel = null;

                item.config.complete(item, payload);

                processNextItem();
            }

            worker.onmessage = function (e) {
                switch (e.data.type) {
                    case "ready":
                        // When worker is ready, kick off the upload
                        worker.postMessage({ type: 'upload' });
                        break;
                    case "progress":
                        item.config.progress(item, e.data.payload);
                        break;
                    case "complete":
                        complete(e.data.payload);
                        break;
                    case "log":
                        log(e.data.logType, e.data.message);
                        break;
                    case "error":
                        // Handle error
                        break;
                    default:
                        throw new Error("Don't know what to do with message of type " + e.data.type);
                }
            };
        }

        function cancelAllWorkers() {
            // Mark all as cancel to avoid picking up next in queue
            queue.forEach(function (q) {
                if (q.completed === false) {
                    q.cancelled = true;
                }
            });

            // Cancel active upload(s)
            queue.filter(function (q) { return q.uploading === true; }).forEach(function (q) {
                q.cancel();
                q.cancel = null;
            });
        }

        /* config: {
            path: // Path in the browser to this library
            workerFileName: // Optional worker file name, default: azure-blob-upload-worker.js
            libPath: // Optional path to the libs required for the worker
            getBlobUri: // Get blob uri for given file (i.e. http://<accountName>.blob.core.windows.net/<container>/<blobname>) with SAS token,
            files: // Array of file objects using the HTML5 File API,
            progress: // progress callback function,
            complete: // complete callback function,
            error: // error callback function,
            blockSize: // Use this to override the DefaultBlockSize,
            calculateFileMd5: // Calculate full file MD5 and return with .complete callback
        } */
        function multipleUpload(config) {
            if (!config || !config.files) {
                throw new Error('Invalid config or missing files');
            }

            config.files.map(function (file) {
                return new QueueItem(file, config);
            }).forEach(function (f) {
                queue.push(f);
            });

            if (!processing) {
                var unresolved = getUnresolved();
                if (unresolved[0]) {
                    processQueueItem(unresolved[0]);
                }
            }

            function cancel(file) {
                var item = _.findWhere(queue, { file: file });
                if (item.uploading) {
                    item.cancel();
                    item.cancel = null;
                } else {
                    item.cancelled = true;
                }
            }

            return {
                cancel: cancel
            };
        }

        return {
            upload: multipleUpload,
            cancelAll: cancelAllWorkers
        };
    }
]);
