/*jslint node: true */
"use strict";

module.exports = function(config) {
  config.set({
    basePath: '../',
    frameworks: [ 'browserify', 'jasmine' ],
    files: [
      'libs/angular/angular.js',
      'libs/angular-mocks/angular-mocks.js',
      'libs/underscore/underscore-min.js',
      'libs/crypto-js/crypto-js.js',
      'libs/crypto-js/md5.js',
      'libs/crypto-js/lib-typedarrays.js',
      'libs/crypto-js/enc-base64.js',
      'libs/atomic/dist/atomic.min.js',
      'libs/q/q.js',
      'libs/base-64/base64.js',
      'app/angular/module.js',
      'app/**/*.js',
      'tests/**/*.js'
    ],
    preprocessors: {
      'app/**/*.js': [ 'browserify', 'coverage' ],
      'tests/**/*.js': [ 'browserify', 'coverage' ],
    },
    proxies: {
      '/app': '/base/app',
      '/libs': '/base/libs'
    },
    browserify: {
      debug: true
    },
    junitReporter: {
      outputFile: 'results/TEST-units.xml',
      suite: ''
    },
    coverageReporter: {
      type : 'lcov',
      dir : 'results/',
      subdir: '.'
    },
    reporters: [ 'progress' ],
    colors: true,
    autoWatch: false,
    browsers: [ 'PhantomJS' ],
    singleRun: true,
    plugins: [
      'karma-phantomjs-launcher',
      'karma-jasmine',
      'karma-junit-reporter',
      'karma-coverage',
      'karma-browserify'
    ]
  });
};
