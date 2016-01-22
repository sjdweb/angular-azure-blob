var Uploader = require('../app/azureBlobUploader');

describe('Uploader', function () {
	it('configures callbacks correctly', function () {
		var config = { log: function () { }, error: function () { }, progress: function () { }, complete: function () { } };
		spyOn(config, 'log');

		var uploader = new Uploader(config);
		uploader.logger.debug();

		expect(config.log).toHaveBeenCalled();
	});

	it('calculates and puts blocks correctly', function () {
		var config = {
			log: function (l) {
				console.log('LOG - type: ' + l.logType + ' message: ' + l.message);
			},
			error: function () { },
			progress: function () { },
			complete: function () { }
		};

		window.FileReaderSync = null;

		var eventListener = jasmine.createSpy();

		var fakeFileReaderSync = {
			addEventListener: eventListener,
			readAsArrayBuffer: function () { }
		};

		spyOn(window, 'FileReaderSync').and.returnValue(fakeFileReaderSync);

		var fakeAtomic = {
			put: function () {
				return {
					success: function (cb) {
						cb({});
						return {
							error: function (cbErr) {
								// cbErr({}, { status: 500 });
							}
						};
					}
				}
			}
		};

		window.atomic = fakeAtomic;

		var SIZE_IN_MB = 18.23;
		var file = { size: (SIZE_IN_MB * 1024), slice: function () {} };
		spyOn(file, 'slice');

		var uploader = new Uploader(config);
		uploader.setFile(file);

		uploader.setConfig({
			blobUri: 'xxx',
			blockSize: 1024,
			calculateFileMd5: true,
			libPath: '/libs'
		});

		var state = uploader.getState();

		uploader.upload();

		expect(state.numberOfBlocks).toBe(19);
		expect(file.slice.calls.count()).toBe(19);
	});

	it('handles retries gracefully', function () {
		var config = {
			log: function (l) {
				console.log('LOG - type: ' + l.logType + ' message: ' + l.message);
			},
			error: function (message) {
				console.log('FATAL ERROR - ' + message);
			},
			progress: function () { },
			complete: function () { }
		};

		window.FileReaderSync = null;

		var eventListener = jasmine.createSpy();

		var fakeFileReaderSync = {
			addEventListener: eventListener,
			readAsArrayBuffer: function () { }
		};

		spyOn(window, 'FileReaderSync').and.returnValue(fakeFileReaderSync);

		var uriRequests = {};

		var fakeAtomic = {
			put: function (uri) {
				if(!uriRequests[uri]) {
					uriRequests[uri] = 1;
				}

				return {
					success: function (cb) {
						if(uriRequests[uri] === 4) {
							cb({});
						}
						return {
							error: function (cbErr) {
								if(uriRequests[uri] < 4) {
									uriRequests[uri]++;
									cbErr({}, { status: 500 });
								}
							}
						};
					}
				};
			}
		};

		window.atomic = fakeAtomic;

		var SIZE_IN_MB = 18.23;
		var file = { size: (SIZE_IN_MB * 1024), slice: function () {} };
		spyOn(file, 'slice');

		var uploader = new Uploader(config);
		uploader.setFile(file);

		uploader.setConfig({
			blobUri: 'xxx',
			blockSize: 1024,
			calculateFileMd5: true,
			libPath: '/libs'
		});

		uploader.upload();

		var state = uploader.getState();

		expect(state.numberOfBlocks).toBe(19);
		expect(file.slice.calls.count()).toBe(19);

		expect(state.cancelled).toBe(false);
	});
});
