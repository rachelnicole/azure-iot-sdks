#!/usr/bin/env node
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

// Native node modules
var fs = require('fs');

// External dependencies
var program = require('commander');

// Local dependencies
var printError = require('./common.js').printError;
var printSuccess = require('./common.js').printSuccess;
var configLoc = require('./common.js').configLoc;

program
  .description('Terminate a temporary session on your IoT hub')
  .parse(process.argv);

var loc = configLoc();

try {
  fs.unlinkSync(loc.dir + '/' + loc.file);
  printSuccess('Session successfully terminated.');
}
catch (err) {
  if (err.code === 'ENOENT') {
    printError('No session information found.');
  } else {
    throw err;
  }
}