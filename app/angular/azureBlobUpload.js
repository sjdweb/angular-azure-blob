angular.module('azureBlobStorage').factory('azureBlobUpload', [
    '$log', function ($log) {
        /* config: {
            path: // Path in the browser to this library
            workerFileName: // Optional worker file name, default: azure-blob-upload-worker.js
            libPath: // Optional path to the libs required for the worker
            blobUri: // Blob file uri (i.e. http://<accountName>.blob.core.windows.net/<container>/<blobname>) with SAS token,
            file: // File object using the HTML5 File API,
            progress: // progress callback function,
            complete: // complete callback function,
            error: // error callback function,
            blockSize: // Use this to override the DefaultBlockSize,
            calculateFileMd5: // Calculate full file MD5 and return with .complete callback
        } */
        function upload(config) {
            var worker = new window.Worker(config.path + (config.workerFileName  || 'azure-blob-upload-worker.js'));

            worker.postMessage({ type: 'file', file: config.file });
            worker.postMessage({
                type: 'config',
                config: {
                    blobUri: config.blobUri,
                    blockSize: config.blockSize,
                    calculateFileMd5: config.calculateFileMd5,
                    libPath: config.libPath || config.path
                }
            });

            function log(logType, message) {
                var logTypes = { 'debug': $log.debug, 'error': $log.error };
                logTypes[logType](message);
            }

            worker.onmessage = function(e) {
                switch(e.data.type) {
                    case "ready":
                        // When worker is ready, kick off the upload
                        worker.postMessage({ type: 'upload' });
                        break;
                    case "progress":
                        config.progress(e.data.payload);
                        break;
                    case "complete":
                        config.complete(e.data.payload);
                        break;
                    case "log":
                        log(e.data.logType, e.data.message);
                        break;
                    case "error":
                        // Handle errror
                        break;
                    default:
                        throw new Error("Don't know what to do with message of type " + e.data.type);
                }
            };

            
        }

        return {
            upload: upload,
        };
    }
]);