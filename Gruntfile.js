/*jslint node: true */
"use strict";


module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    uglify: {
      dist: {
        files: {
          'dist/angular-azure-blob.js': [ 'dist/angular-azure-blob.js' ]
        },
        options: {
          mangle: false
        }
      }
    },

    clean: {
      temp: {
        src: [ 'tmp' ]
      },
      dist: {
        src: [ 'dist' ]
      }
    },

    concat: {
      options: {
        separator: ';'
      },
      dist: {
        src: [ 'app/module.js', 'app/*.js', 'tmp/*.js' ],
        dest: 'dist/angular-azure-blob.js'
      }
    },

    jshint: {
      all: [ 'Gruntfile.js', 'app/*.js', 'app/**/*.js' ]
    },

    connect: {
      server: {
        options: {
          hostname: 'localhost',
          port: 8080
        }
      }
    },

    watch: {
      dev: {
        files: [ 'Gruntfile.js', 'app/*.js', ],
        tasks: [ 'jshint', /*'karma:unit',*/ 'concat:dist', 'clean:temp' ],
        options: {
          atBegin: true
        }
      },
      min: {
        files: [ 'Gruntfile.js', 'app/*.js' ],
        tasks: [ 'jshint', /*'karma:unit',*/ 'concat:dist', 'clean:temp', 'uglify:dist' ],
        options: {
          atBegin: true
        }
      }
    },

    compress: {
      dist: {
        options: {
          archive: 'dist/<%= pkg.name %>-<%= pkg.version %>.zip'
        },
        files: [{
          src: [  'dist/*.js', 'libs/**' ]
        }]
      }
    },

    // karma: {
    //   options: {
    //     configFile: 'config/karma.conf.js'
    //   },
    //   unit: {
    //     singleRun: true
    //   },
    //   junit: {
    //     singleRun: true,
    //     reporters: ['junit', 'coverage']
    //   },
    //   continuous: {
    //     singleRun: false,
    //     autoWatch: true
    //   }
    // }
  });

  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-contrib-compress');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-watch');

  // grunt.loadNpmTasks('grunt-karma');

  grunt.registerTask('dev', [ 'clean:dist', 'connect:server', 'watch:dev' ]);
  grunt.registerTask('test', [ 'clean:dist', 'jshint', 'karma:continuous' ]);
  grunt.registerTask('junit', [ 'clean:dist', 'jshint', 'karma:junit' ]);
  grunt.registerTask('minified', [ 'clean:dist', 'connect:server', 'watch:min' ]);
  grunt.registerTask('package', [ 'clean:dist', 'jshint', /*'karma:unit', */'concat:dist', 'uglify:dist', 'clean:temp', 'compress:dist' ]);
};
