const EResult = require('../resources/EResult.js');
var request = require('request');

exports.isSteamID = function(input) {
	var keys = Object.keys(input);
	if (keys.length != 4) {
		return false;
	}

	// Make sure it has the keys we expect
	keys = keys.filter(function(item) {
		return ['universe', 'type', 'instance', 'accountid'].indexOf(item) != -1;
	});

	return keys.length == 4;
};

exports.decodeSteamTime = function(time) {
	var date = new Date();

	if (time.includes("@")) {
		var parts = time.split('@');
		if (!parts[0].includes(",")) {
			// no year, assume current year
			parts[0] += ", " + date.getFullYear();
		}

		date = new Date(parts.join('@').replace(/(am|pm)/, ' $1') + " UTC");  // add a space so JS can decode it
	} else {
		// Relative date
		var amount = time.replace(/(\d) (minutes|hour|hours) ago/, "$1");

		if(time.includes("minutes")) {
			date.setMinutes(date.getMinutes() - amount);
		} else if(time.match(/hour|hours/)) {
			date.setHours(date.getHours() - amount);
		}
	}

	return date;
};

/**
 * Get an Error object for a particular EResult
 * @param {int} eresult
 * @returns {null|Error}
 */
exports.eresultError = function(eresult) {
	if (eresult == EResult.OK) {
		// no error
		return null;
	}

	var err = new Error(EResult[eresult] || ("Error " + eresult));
	err.eresult = eresult;
	return err;
};

exports.resolveVanityURL = function(vanityURL, callback) {
	request("https://steamcommunity.com/id/" + vanityURL + "/?xml=1", function(err, response, body) {
		if (err) {
			callback(err);
			return;
		}

		var match = body.match(/<steamID64>(\d+)<\/steamID64>/);
		if (!match || !match[1]) {
			callback(new Error("Couldn't find Steam ID"));
			return;
		}

		callback(null, {"vanityURL": vanityURL, "steamID": match[1]});
	});
}
