Angular Azure Blob Upload
==========================

AngularJS service for uploading to azure blob storage in HTML5 browsers via FileReader with effective error handling and parallel block uploads.

Library will send MD5 of blocks for integrity by default, and can also optionally MD5 the whole file for usage in your own app once upload completed.

Upload task happens in a separate Web Worker thread.

Prerequisites
-----------

* IE10+
* Existing Angular app (ofcourse)
* CryptoJS with MD5 module referenced in your SPA
* Underscore.js library referenced

How to use
--------------
Download the latest release [here]()

or

Build the library on your machine
```javascript
npm install
bower install
grunt package
```

There will be a zip file in the dist/ folder for use.


Reference the dist library in your SPA along with CryptoJS MD5 and Underscore.js
```HTML
<script src="/dist/angular-azure-blob.js"></script>
```

Require the azureBlobStorage module:
```javascript
angular.module('appx', ['azureBlobStorage']);
```

Use the service in your controller, **make sure the paths are correct!**
```javascript
angular.module('appx').controller('UploadController', [
    '$scope', 'azureBlobUpload',
    function($scope, azureBlobUpload) {
        $scope.upload = function(files) {
            azureBlobUpload.upload({
                path: '/dist/',
                libPath: '/libs/',
                blobUri: xxx,
                file: files[0],
                process: function cb(){},
                complete: function cb() {},
                error: function cb() {},
                blockSize: 1024, // optional
                calculateFileMd5: false // optional, false by default
            });
        };
    }
]);
```

CORS
-------------

Cross Origin Resource Sharing (CORS) must be enabled on the azure blob storage account. The following articles can assist with this...

[Windows Azure Storage Introducing CORS](http://blogs.msdn.com/b/windowsazurestorage/archive/2014/02/03/windows-azure-storage-introducing-cors.aspx)

[Windows Azure Storage and CORS](http://www.contentmaster.com/azure/windows-azure-storage-cors/)

Thanks To
-------------
Gaurav Mantri for this blog http://gauravmantri.com/2013/02/16/uploading-large-files-in-windows-azure-blob-storage-using-shared-access-signature-html-and-javascript

Stephen Brannan for his original library https://github.com/kinstephen/angular-azure-blob-upload

UMG
