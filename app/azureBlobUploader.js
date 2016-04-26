/* global CryptoJS, atomic, base64, _, Q, FileReaderSync */
var arrayBufferUtils = (function () {
  function arraybuffer2WordArray(arrayBuffer) {
    return CryptoJS.lib.WordArray.create(arrayBuffer);
  }

  this.getArrayBufferMd5 = function (arrayBuffer) {
    var md5 = CryptoJS.algo.MD5.create();
    var wordArray = arraybuffer2WordArray(arrayBuffer);
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

    var wordArray = arraybuffer2WordArray(arrayBuffer);
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

module.exports = function Uploader(config) {
  config = config || {};

  var log = config.log || function () { };
  var progress = config.progress || function () { };
  var complete = config.complete || function () { };
  var error = config.error || function () { };

  var state = {};
  var file = null;

  this.setFile = function (f) {
    file = f;
  };

  var logger = {
    debug: function (message) {
      log({ type: 'log', logType: 'debug', message: message });
    },
    error: function (message) {
      log({ type: 'log', logType: 'error', message: message });
    }
  };

  this.logger = logger;

  function Block(index, blockId, pointer, end) {
    this.index = index;
    this.blockId = blockId;
    this.blockIdBase64 = base64.encode(blockId);

    this.pointer = pointer;
    this.size = (end - pointer);
    this.end = end;
    this.resolved = false;
    this.read = false;
    this.data = null;
    this.md5 = null;
    this.uploading = false;
    this.retries = 0;
    this.startedAt = null;

    this.incrementRetry = function () {
      this.retries++;
      this.uploading = false;
      this.resolved = false;
      this.read = false;
    };

    this.maxRetriesHit = function () {
      return this.retries === 4;
    };
  }

  // config { state, done, doneOne }
  function readNextSetOfBlocks(config) {
    var numberOfBlocksToRead = 10;

    var done = config.done || function () { };
    var doneOne = config.doneOne || function () { };
    var doneHalf = config.doneHalf || function () { };
    var alreadyReading = config.alreadyReading || function () { logger.debug('Already reading next set of blocks!'); };

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

    var readNextBlock = function () {
      var fileContent = config.state.file.slice(blocksToRead[currentIndex].pointer, blocksToRead[currentIndex].end);
      var result = fileReader.readAsArrayBuffer(fileContent);
      loaded(result);
    };

    var loaded = function (result) {
      var currentBlock = blocksToRead[currentIndex];
      logger.debug('Read block ' + currentBlock.blockId);

      currentBlock.read = true;
      currentBlock.data = result;

      // Calculate block MD5
      var blockMd5Start = performance.now();
      currentBlock.md5 = arrayBufferUtils.getArrayBufferMd5(currentBlock.data);
      var blockMd5End = performance.now();
      logger.debug("Call to getArrayBufferMd5 for block " + currentBlock.blockId + " took " + (blockMd5End - blockMd5Start) + " milliseconds.");

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
    block.startedAt = Date.now();

    var getReadAndUnprocessed = function () {
      return state.blocks.filter(function (b) {
        return b.read === true && b.uploading === false && b.resolved === false;
      });
    };

    // Check that there available blocks
    if (getReadAndUnprocessed().length < 5 && !state.readingNextSetOfBlocks) {
      readNextSetOfBlocks({ state: state });
    }
  }

  function uploadBlock(block, success, reject) {
    logger.debug("uploadBlock: block id = " + block.blockId);

    if (state.cancelled) {
      error('cancelled');
      return;
    }

    var uri = state.blobUri + '&comp=block&blockid=' + block.blockIdBase64;
    var requestData = block.data;

    if (requestData === null) {
      logger.error('Block ' + block.blockId + ' has no data to upload!');
    }

    blockUploading(block);

    // Fake atomic behaviour.
    // setTimeout(function () {
    //   logger.debug('Put block successfully ' + block.blockId);

    //   // Clear data
    //   block.data = null;
    //   block.uploading = false;

    //   success({
    //     requestLength: block.size,
    //     data: null,
    //   });
    // }, 1500);

    atomic.put(uri, requestData, {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': state.file.type,
      'Content-MD5': block.md5.toString(CryptoJS.enc.Base64)
    }).success(function (result, req) {
      logger.debug('Put block successfully ' + block.blockId);

      // Clear data
      block.data = null;
      block.uploading = false;

      success({
        requestLength: block.size,
        data: result,
      });
    }).error(function (result, req) {
      logger.error('Put block error ' + req.status);

      reject({
        data: result,
        status: req.status,
      });
    });
  }

  function commitBlockList() {
    var uri = state.blobUri + '&comp=blocklist';

    var requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
    state.blocks.forEach(function (block) {
      requestBody += '<Latest>' + block.blockIdBase64 + '</Latest>';
    });
    requestBody += '</BlockList>';

    atomic.put(uri, requestBody, {
      'x-ms-blob-content-type': state.file.type,
    }).success(function (data, req) {
      complete({ data: data, md5: state.fileMd5.finalize().toString(CryptoJS.enc.Base64), startedAt: state.startedAt });
      logger.debug('Upload took ' + (performance.now() - state.startedUpload) + 'ms');
    }).error(function (data, req) {
      logger.error('Put block list error ' + req.status);

      // Retry commit
      if(state.blockListRetries < 4) {
        state.blockListRetries++;
        commitBlockList();
      } else {
        state.cancelled = true;
        error('Failed putting block list - status: ' + req.status);
      }
    });
  }

  function pad(number, length) {
    var str = '' + number;
    while (str.length < length) {
      str = '0' + str;
    }
    return str;
  }

  /* config: {
  libPath: // Path to libs for the worker
  blobUri: // Blob file uri (i.e. http://<accountName>.blob.core.windows.net/<container>/<blobname>) with SAS token,
  error: // error callback function,
  blockSize: // Use this to override the DefaultBlockSize,
  calculateFileMd5: // Calculate full file MD5 and return with .complete callback
} */
this.setConfig = function (config) {
  var defaultBlockSize = 1024 * 1024; // Default to 1024KB

  var blockSize = config.blockSize ? config.blockSize : defaultBlockSize;

  var maxBlockSize = blockSize;
  var numberOfBlocks = 1;

  if (!file) {
    logger.error("MUST set file before setting config");
  }

  var fileSize = file.size;
  if (fileSize < blockSize) {
    maxBlockSize = fileSize;
    logger.debug("max block size = " + maxBlockSize);
  }

  if (fileSize % maxBlockSize === 0) {
    numberOfBlocks = fileSize / maxBlockSize;
  } else {
    numberOfBlocks = Math.ceil((fileSize / maxBlockSize));
  }

  logger.debug("total blocks = " + numberOfBlocks);

  state = {
    libPath: config.libPath,
    maxBlockSize: maxBlockSize, //Each file will be split in 256 KB.
    numberOfBlocks: numberOfBlocks,
    fileSize: fileSize,
    currentFilePointer: 0,
    blocks: [],
    blockIdPrefix: 'block-',
    blocksReadIndex: 0,
    file: file,
    blobUri: config.blobUri,
    error: config.error,
    cancelled: false,
    calculateFileMd5: config.calculateFileMd5 || false,
    fileMd5: arrayBufferUtils.getArrayBufferMd5Iterative(),
    readingNextSetOfBlocks: false,
    percentComplete: null,
    startedAt: null,
    blockListRetries: 0
  };
};

this.upload = function () {
  state.blocks = [];
  state.startedAt = Date.now();

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

    state.blocks.push(new Block(index, blockId, pointer, end));

    index++;
    numberOfBlocks--;
  }

  var currentlyProcessing = [];

  var addToCurrentlyProcessing = function (block, action) {
    currentlyProcessing.push({ action: action, block: block });
  };

  var removeFromCurrentlyProcessing = function (action) {
    currentlyProcessing.splice(currentlyProcessing.indexOf(_.findWhere(currentlyProcessing, { action: action })), 1);
  };

  var getUnresolved = function () {
    return state.blocks.filter(function (b) {
      return b.resolved === false && !_.findWhere(currentlyProcessing, { block: b });
    });
  };

  var removeProcessedAction = function (block, action, result) {
    var totalBytesUploaded = state.blocks.filter(function(s) {
        return s.resolved;
    }).map(function(s) {
        return s.size;
    }).reduce(function(a, b){
        return a + b;
    });

    var percentComplete = ((parseFloat(totalBytesUploaded) / parseFloat(state.file.size)) * 100).toFixed(2);

    progress({
      result: result,
      previousPercentComplete: state.percentComplete,
      percentComplete: percentComplete,
      startedAt: block.startedAt,
      blockSize: block.size
    });

    state.percentComplete = percentComplete;

    removeFromCurrentlyProcessing(action);

    var hasNext = addNextAction();
    if (!hasNext && !_.any(currentlyProcessing)) {
      commitBlockList(state);
    }
  };

  var processRejectedAction = function (block, action, rejectReason) {
    // Remove from currently processing
    removeFromCurrentlyProcessing(action);

    // Log error
    logger.error('Rejected action ' + block.blockId + ' status ' + rejectReason.status + ' retries ' + block.retries);

    if (block.maxRetriesHit()) {
      error('Hit max retries on block ' + block.blockId);
      state.cancelled = true;
      return;
    }

    block.incrementRetry();

    addNextAction();
  };

  var addNextAction = function () {
    var unresolved = getUnresolved();
    if (_.any(unresolved)) {
      var block = unresolved[0];
      var action = uploadBlock(block, function (result) {
        block.resolved = true;
        removeProcessedAction(block, action, result);
      }, function (rejectReason) {
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
    done: function () {
      for (var j = 0; j < 8; j++) {
        if (state.blocks[j]) {
          addNextAction(state.blocks[j]);
        }
      }
    }
  });
};

this.getState = function () {
  return _.clone(state);
};

this.cancel = function () {
  state.cancelled = true;
};
};
