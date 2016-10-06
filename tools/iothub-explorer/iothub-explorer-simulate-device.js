#!/usr/bin/env node
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

// Native packages
var fs = require('fs');
var path = require('path');

// External dependencies
var program = require('commander');
var prettyjson = require('prettyjson');

// Azure IoT SDK dependencies
var DeviceClient = require('azure-iot-device').Client;
var DeviceConnectionString = require('azure-iot-device').ConnectionString;
var Registry = require('azure-iothub').Registry;

// Local dependencies
var packageJson = require('./package.json');
var inputError = require('./common.js').inputError;
var printSuccess = require('./common.js').printSuccess;
var serviceError = require('./common.js').serviceError;
var printError = require('./common.js').printError;
var getSas = require('./common.js').getSas;
var getHostFromSas = require('./common.js').getHostFromSas;
var createDeviceConnectionString = require('./common.js').createDeviceConnectionString;
var createMessageFromArgument = require('./common.js').createMessageFromArgument;

program
  .version(packageJson.version)
  .description('Simulate a device.')
  .option('--connection-string <device-connection-string>', 'connection string to use for the device')
  .option('-l, --login <iothub-connection-string>', 'use the connection string provided as argument to use to authenticate with your IoT Hub instance')
  .option('--protocol <amqp|amqp-ws|http|mqtt>', 'protocol used to send and receive messages (defaults to amqp)', verifyProtocol)
  .option('--send [message]', 'send a test message as a device. If the message is not specified, a default message will be used')
  .option('--send-interval <interval-in-milliseconds>', 'interval to use between each message being sent (defaults to 1000ms)', parseInt)
  .option('--send-count <message-count>', 'number of messages to send', parseInt)
  .option('--receive', 'Receive cloud-to-device (C2D) messages as a device')
  .option('--receive-count <message-count>', 'number of C2D messages to receive', parseInt)
  .option('--settle <complete|abandon|reject>', 'indicate how the received C2D messages should be settled (defaults to \'complete\')', verifySettle)
  .option('--upload-file <file-path>', 'upload a file as a device')
  .parse(process.argv);

function verifySettle(arg) {
  if (arg !== 'complete' && arg !== 'reject' && arg !== 'abandon') {
    inputError('--settle can take only take one of the following values: \'complete\', \'reject\' or \'abandon\'');
  } else {
    return arg;
  }
}

function verifyProtocol(arg) {
  var lowerCaseArg = arg.toLowerCase();
  if (lowerCaseArg !== 'amqp' && lowerCaseArg !== 'amqp-ws' && lowerCaseArg !== 'http' && lowerCaseArg !== 'mqtt') {
    inputError('--settle can take only take one of the following values: \'complete\', \'reject\' or \'abandon\'');
  } else {
    return lowerCaseArg;
  }
}

var sas = getSas(program.login);

if((!program.connectionString && !sas) || (program.connectionString && sas)) {
  inputError('You must specify either the device connection string (--connection-string), the IoT Hub connection string (--login), or use the \'login\' command first.');
}

if(!program.connectionString && !program.args[0]) {
  inputError('You must specify either a device connection string (--connection-string) or the IoT Hub connection string and a device id as first argument');
}

if (!program.send && !program.receive && !program.uploadFile) {
  inputError('Nothing to do: please use --send, --receive or --uploadFile');
}

var settleMethod = program.settle || 'complete';

var protocolArg = program.protocol || 'amqp';
var Protocol;
switch(protocolArg) {
  case 'amqp-ws':
    Protocol = require('azure-iot-device-amqp-ws').AmqpWs;
    break;
  case 'http':
    Protocol = require('azure-iot-device-http').Http;
    break;
  case 'mqtt':
    Protocol = require('azure-iot-device-mqtt').Mqtt;
    if (settleMethod !== 'complete') {
      inputError('Cannot ' + settleMethod + ' messages with MQTT: messages are automatically completed.');
    }
    break;
  default:
    Protocol = require('azure-iot-device-amqp').Amqp;
    break;
}

var sendInterval = program.sendInterval || 1000;
var sendCount = program.sendCount || Number.MAX_SAFE_INTEGER;
var receiveCount = program.receiveCount || Number.MAX_SAFE_INTEGER;
var uploadFilePath = program.uploadFile;

var deviceConnectionString;
var deviceId = program.args[0];
if (!deviceId) {
  deviceConnectionString = program.connectionString;
  if(!deviceConnectionString) {
    inputError('You must specify either a device connection string (--connection-string) or the IoT Hub connection string and a device id as first argument');
  } else {
    deviceId = DeviceConnectionString.parse(deviceConnectionString).DeviceId;
    simulateDevice();
  }
} else {
  var registry = Registry.fromSharedAccessSignature(sas.toString());
  registry.get(deviceId, function(err, deviceInfo) {
    if (err) serviceError(err);
    else {
      var host = getHostFromSas(sas.toString());
      deviceConnectionString = createDeviceConnectionString(deviceInfo, host);
    }

    simulateDevice();
  });
}

function simulateDevice() {
  if (!deviceConnectionString) throw new Error('Couldn\'t figure out device connection string');
  if (!Protocol) throw new Error('Couldn\'t figure out protocol to connect to IoT Hub');

  var sendRunning = !!program.send;
  var receiveRunning = !!program.receive;
  var uploadRunning = !!program.uploadFile;

  var client = DeviceClient.fromConnectionString(deviceConnectionString, Protocol);
  client.open(function(err) {
    if (err) serviceError('Could not connect as device: ' + err.message);
    if (program.send) {
      var sendCounter = 0;

      var sendItv = setInterval(function() {
        var message = program.send === true ? createMessageFromArgument('Simulated message: #' + sendCounter) : createMessageFromArgument(program.send);
        client.sendEvent(message, function(err) {
          if (err) serviceError(err);
          else {
            printSuccess('Message #' + sendCounter + ' sent successfully');
            sendCounter++;
            if (sendCounter === sendCount) {
              sendRunning = false;
              clearInterval(sendItv);
            }
          }
        });
      }, sendInterval);
    }

    if (program.receive) {
      var receiveCounter = 0;
      var onMessage = function(msg) {
        printSuccess('-----------------');
        printSuccess('Message received:');
        console.log(prettyjson.render(msg.data.toString()));
        printSuccess('-----------------');
        receiveCounter++;
        if (receiveCounter === receiveCount) {
          receiveRunning = false;
          client.removeListener('message', onMessage);
        }
        client[settleMethod](msg, function(err) {
          if (err) serviceError('Could not ' + settleMethod + ' message: ' + err.message);
          else {
            printSuccess(settleMethod + ' message: Success');
          }
        });
      };

      client.on('message', onMessage);
    }

    if (uploadFilePath) {
      fs.stat(uploadFilePath, function (err, fileStats) {
        if (err) inputError('Cannot find: ' + program.uploadFile);
        var fileStream = fs.createReadStream(uploadFilePath);

        client.uploadToBlob(path.basename(uploadFilePath), fileStream, fileStats.size, function (err) {
          if (err) {
            printError('Cannot upload file: ' + err.constructor.name + ': ' + err.message);
          } else {
            printSuccess('Upload successful');
          }
          fileStream.destroy();
          uploadRunning = false;
        });
      });
    }

    var taskItv = setInterval(function() {
      if (!sendRunning && !receiveRunning && !uploadRunning) {
        printSuccess('Device simulation finished.');
        client.close(function(err) {
          if (err) serviceError(err);
          else {
            clearInterval(taskItv);
            process.exit(0);
          }
        });
      }
    }, 200);
  });
}