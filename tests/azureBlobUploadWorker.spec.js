describe('azureBlobUploadWorker', function () {
	it('initialises correctly', function(done) {
		var worker = new Worker('base/app/azureBlobUploadWorker.js');

		worker.onmessage = function(result) {
			expect(result.data.message).toBe('total blocks = NaN');
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

	describe('Uploader', function () {
		// Because the Uploader() func is attached to self in the worker 
		//it will ultimately be available here under the context of window.
		it('configures correctly', function () {
			expect(self.Uploader).not.toBe(null);
		});
	});
});