/*
 Copyright (c) Microsoft. All rights reserved.
 Licensed under the MIT license. See LICENSE file in the project root for full license information.
 */

/// <reference path="../../definitions/vsts-task-lib.d.ts" />
import fs = require('fs');
import path = require('path');
import os = require('os');
import https = require('https');
import http = require('http');
import tl = require('vsts-task-lib/task');

// Get inputs
var action = tl.getInput('action', true);
var email = tl.getInput('email', true);
var password = tl.getInput('password', true);
var activateAndroid = tl.getInput('activateAndroid', false);
var product = tl.getInput('product', false);
var timeout = tl.getInput('timeout', false);

// Output debug information for inputs
tl.debug('action: ' + action);
tl.debug('email: ' + email);
tl.debug('password: ' + password);
tl.debug('activateAndroid: ' + activateAndroid);
tl.debug('product: ' + product);
tl.debug('timeout: ' + timeout);


// Function for error handling
var onFailedExecution = function (err) {
    // Error executing
    tl.debug('Task failed: ' + err);
    tl.exit(1);
}

//validate inputs
if (!product) {
    //older task.json
    if (activateAndroid == 'true') {
        product = 'MA';
    }
}

if (!product) {
    onFailedExecution('No product selected to activate.');
}

var licenseLocation;
if (product == 'MA' && os.platform() == 'darwin') {
    licenseLocation = '/Library/MonoAndroid/License.v2/monoandroid.licx';
} else if (product == 'MT' && os.platform() == 'darwin') {
    licenseLocation = '/Library/MononTouch/License.v2/monotouch.licx';
} else if (product == 'MM' && os.platform() == 'darwin') {
    licenseLocation = '/Library/Xamarin.Mac/License.v2/monomac.licx'
} else if (product == 'MA' && os.platform() == 'win32') {
    licenseLocation = 'C:\\ProgramData\\Mono For Android\\License\\monoandroid.licx';
} else if (product == 'MT' && os.platform() == 'win32') {
    licenseLocation = 'C:\\ProgramData\\MonoTouch\\License\\monotouch.licx';
}

if (!licenseLocation) {
    onFailedExecution('The xamarin product: ' + product + ' is not supported on this os: ' + os.platform());
}

if (isNaN(Number(timeout))) {
    timeout = '30';
}
var timeoutInSecs = Number(timeout);

//Xamarin activation constants
var apiKey = '96cae35ce8a9b0244178bf28e4966c2ce1b8385723a96a6b838858cdd6ca0a1e';

//xamarin data file
var dataFileLocation = process.env.HOME + '/vsts_generated_' + product + '.dat';
if (os.platform() == 'win32') {
    dataFileLocation = process.env.USERPROFILE + '\\vsts_generated_' + product + '.dat';
}

var doHttpRequest = function (options, requestBody, timeout, callback) {
    var reqData;
    var socket;

    if (requestBody) {
        reqData = requestBody;
        options.headers["Content-Length"] = Buffer.byteLength(reqData, 'utf8');
    }

    var req = https.request(options, function (res) {
        var output = '';

        res.on('data', function (chunk) {
            output += chunk;
        });

        res.on('end', function () {
            callback(null, res, output);
        });
    });

    req.on('socket', function (sock) {
        socket = sock;
    });

    req.setTimeout(timeout, function () {
        if (socket) {
            socket.end();
        }
    });

    req.on('error', function (err) {
        callback(err, null, null);
    });

    if (reqData) {
        req.write(reqData, 'utf8');
    }

    req.end();
}

if (action == 'Activate') {
    tl.debug('Activate Xamarin license');
    //check if already activated
    if (fs.existsSync(licenseLocation)) {
        tl.debug('License file already exists');
        tl.exit(0); //return success TODO: not stopping execution
    }

    //Login as user
    tl.debug('Login');
    var loginRequestBody = 'email=' + encodeURI(email) + '&password=' + encodeURI(password);
    var options = {
        host: 'auth.xamarin.com',
        path: '/api/v1/auth',
        method: 'POST',
        headers: {
            'Host': 'auth.xamarin.com',
            'User-Agent': 'vso-agent-tasks-Xamarin-License',
            'Authorization': 'Basic ' + new Buffer(apiKey + ':').toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
    };
    doHttpRequest(options, loginRequestBody, timeoutInSecs, function (err, res, output) {
        if (err) {
            onFailedExecution('Login failed: ' + err);
        }

        if (!output) {
            onFailedExecution('Login failed. Response code = ' + res.ResponseCode);
        }

        var responseJson = JSON.parse(output);
        if (!responseJson || !responseJson.token || !responseJson.user || !responseJson.user.Guid) {
            onFailedExecution('Login failed. Json response not as expected: ' + output);
        }

        //Login succeeded
        var token = responseJson.token;
        var userGuid = responseJson.user.Guid;

        //Provision the machine
        var mToolPath;
        if (product == 'MA') {
            //find path to mandroid
            if (os.platform() == 'darwin') {
                mToolPath = '/Library/Frameworks/Xamarin.Android.framework/Commands/mandroid';
            } else if (os.platform() == 'win32') {
                mToolPath = 'C:\\Program Files (x86)\\MSBuild\\Xamarin\\Android\\mandroid.exe';
            }
            if (!fs.existsSync(mToolPath)) {
                onFailedExecution('The path to mandroid does not exist: ' + mToolPath);
            }
        } else if (product == 'MT' || product == 'MM') {
            //find path to mtouch
            if (os.platform() == 'darwin') {
                mToolPath = '/Library/Frameworks/Xamarin.iOS.framework/Versions/Current/bin/mtouch';
            } else {
                mToolPath = 'C:\\Program Files (x86)\\MSBuild\\Xamarin\\iOS\\mtouch.exe';
            }
            if (!fs.existsSync(mToolPath)) {
                onFailedExecution('The path to mtouch does not exist: ' + mToolPath);
            }
        }

        var mToolRunner = tl.createToolRunner(mToolPath);
        mToolRunner.arg('--datafile');
        mToolRunner.arg('>');
        mToolRunner.pathArg(dataFileLocation);
        mToolRunner.exec().then(function (code) {
            if (code != 0) {
                onFailedExecution('Failed to create data file file using: ' + mToolPath);
            }

            //Read the xamarin.dat file
            fs.readFile(dataFileLocation, function (err, data) {
                if (err) {
                    onFailedExecution('Failed to read datafile: ' + err);
                }

                //Call Xamarin activation endpoint
                var options = {
                    host: 'activation.xamarin.com',
                    path: '/api/studio.ashx?guid=' + decodeURI(userGuid) + '&token=' + encodeURI(token) + '&product=' + encodeURI(product),
                    method: 'POST',
                    headers: {
                        'Host': 'activation.xamarin.com',
                        'User-Agent': 'vso-agent-tasks-Xamarin-License',
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                };

                doHttpRequest(options, data, timeoutInSecs, function (err, res, output) {
                    if (err) {
                        onFailedExecution('License activation failed: ' + err);
                    }
                    if (!output) {
                        onFailedExecution('License activation failed. Response code = ' + res.ResponseCode);
                    }

                    var jsonResponse = JSON.parse(output);
                    if (!jsonResponse || !jsonResponse.license) {
                        onFailedExecution('License activation failed. Response not as expected: ' + output);
                    }

                    //Activation succeeded
                    var licenseDecoded = new Buffer(jsonResponse.license, 'base64');

                    //Save license file
                    tl.mkdirP(path.dirname(licenseLocation));
                    fs.writeFile(licenseLocation, licenseDecoded, function (err) {
                        if (err) {
                            onFailedExecution('Failed to save license file: ' + err);
                        }
                        tl.exit(0); //success
                    });
                });
            });
        });
    });

} else if (action == 'Deactivate') {
    tl.debug('Deactivate Xamarin License');

    //Login as user
    tl.debug('Login');
    var loginRequestBody = 'email=' + encodeURI(email) + '&password=' + encodeURI(password);
    var options = {
        host: 'auth.xamarin.com',
        path: '/api/v1/auth',
        method: 'POST',
        headers: {
            'Host': 'auth.xamarin.com',
            'User-Agent': 'vso-agent-tasks-Xamarin-License',
            'Authorization': 'Basic ' + new Buffer(apiKey + ':').toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
    };
    doHttpRequest(options, loginRequestBody, timeoutInSecs, function (err, res, output) {
        if (err) {
            onFailedExecution('Login failed: ' + err);
        }

        if (!output) {
            onFailedExecution('Login failed. Response code = ' + res.ResponseCode);
        }

        var responseJson = JSON.parse(output);
        if (!responseJson || !responseJson.token || !responseJson.user || !responseJson.user.Guid) {
            onFailedExecution('Login failed. Json response not as expected: ' + output);
        }

        //Login succeeded
        var token = responseJson.token;
        var userGuid = responseJson.user.Guid;

        //Read the xamarin.dat file
        fs.readFile(dataFileLocation, function (err, data) {
            if (err) {
                onFailedExecution('Failed to read datafile: ' + err);
            }

            //Call Xamarin activation endpoint
            var options = {
                host: 'activation.xamarin.com',
                path: '/api/deactivate.ashx?guid=' + decodeURI(userGuid) + '&token=' + encodeURI(token),
                method: 'POST',
                headers: {
                    'Host': 'activation.xamarin.com',
                    'User-Agent': 'vso-agent-tasks-Xamarin-License',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
            };

            doHttpRequest(options, data, timeoutInSecs, function (err, res, output) {
                if (err) {
                    onFailedExecution('License deactivation failed: ' + err);
                }
                if (!output) {
                    onFailedExecution('License deactivation failed. Response code = ' + res.ResponseCode);
                }

                var jsonResponse = JSON.parse(output);
                if (!jsonResponse || !jsonResponse.success) {
                    onFailedExecution('License deactivation failed. Response not as expected: ' + output);
                }

                //Deactivation succeeded
                tl.exit(0);
            });
        });
    });
}