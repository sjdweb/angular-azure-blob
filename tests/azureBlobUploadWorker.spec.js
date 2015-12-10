describe('azureBlobUploadWorker', function () {
	it('initialises correctly', function(done) {
		var worker = new Worker('base/app/azureBlobUploadWorker.js');
		worker.onmessage = function(result) {
			expect(result.data.message).toBe('total blocks = NaN');
			expect(1).toBe(1);
			done();
		}

		worker.postMessage({ type: 'file', file: {} });
	    worker.postMessage({
	        type: 'config',
	        config: {
	            blobUri: 'testy',
	            blockSize: 1024,
	            calculateFileMd5: false,
	            libPath: '/libs'
	        }
	    });
	});
});