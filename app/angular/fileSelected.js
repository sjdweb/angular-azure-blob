angular.module('azureBlobStorage').directive('fileSelected', [ '$parse', '$http', '$timeout', function($parse, $http, $timeout) {
    return function(scope, elem, attr) {
        var fn = $parse(attr.ngFileSelect);
        elem.bind('change', function(evt) {
            var files = [], fileList, i;
            fileList = evt.target.files;
            if (fileList !== null) {
                for (i = 0; i < fileList.length; i++) {
                    files.push(fileList.item(i));
                }
            }
            $timeout(function() {
                fn(scope, {
                    $files : files,
                    $event: evt
                });
            });
        });
        elem.bind('click', function(){
            this.value = null;
        });
    };
} ]);
