var SteamCommunity = require('../index.js');
var CEconItem = require('../classes/CEconItem.js');
var SteamID = require('steamid');
var request = require('request');
var Cheerio = require('cheerio');
var Async = require('async');

/*
 * Inventory history in a nutshell.
 *
 * There are no more page numbers. Now you have to request start_time.
 */

/**
 * @param {object} options
 * @param {function} callback
 */
SteamCommunity.prototype.getInventoryHistory = function(options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}

	var qs = "?l=english";
	if (options.startTime) {
		if (options.startTime instanceof Date) {
			options.startTime = Math.floor(options.startTime.getTime() / 1000);
		}

		qs += "&start_time=" + options.startTime;
	}

	this._myProfile("inventoryhistory" + qs, null, function(err, response, body) {
		if (err) {
			callback(err);
			return;
		}

		var output = {};
		var vanityURLs = [];

		var $ = Cheerio.load(body);
		if (!$('.inventory_history_pagingrow').html()) {
			callback(new Error("Malformed page: no paging row found"));
			return;
		}

		// Load the descriptions
		var match2 = body.match(/var g_rgDescriptions = (.*);/);
		if (!match2) {
			callback(new Error("Malformed page: no trade found"));
			return;
		}

		try {
			var descriptions = JSON.parse(match2[1]);
		} catch (ex) {
			callback(new Error("Malformed page: no well-formed trade data found"));
			return;
		}

		var i;

		// See if we've got paging buttons
		var $paging = $('.inventory_history_nextbtn .pagebtn:not(.disabled)');
		var href;
		for (i = 0; i < $paging.length; i++) {
			href = $paging[i].attribs.href;
			if (href.match(/prev=1/)) {
				output.firstTradeTime = new Date(href.match(/after_time=(\d+)/)[1] * 1000);
				output.firstTradeID = href.match(/after_trade=(\d+)/)[1];
			} else {
				output.lastTradeTime = new Date(href.match(/after_time=(\d+)/)[1] * 1000);
				output.lastTradeID = href.match(/after_trade=(\d+)/)[1];
			}
		}

		output.events = [];
		var events = $('.tradehistoryrow');

		var entry, event, profileLink, items, j, timeMatch, time;
		for (i = 0; i < events.length; i++) {
			entry = $(events[i]);
			event = {
				id: entry.find('[id]')[0].attribs['id'].split('_')[0],
				type: entry.find('.tradehistory_event_description').text().trim()
			};

			event.onHold = !!event.type.match(/was placed on hold/);

			timeMatch = entry.find('.tradehistory_timestamp').html().match(/(\d+):(\d+)(am|pm)/);
			if (timeMatch[1] == 12 && timeMatch[3] == 'am') {
				timeMatch[1] = 0;
			}

			if (timeMatch[1] < 12 && timeMatch[3] == 'pm') {
				timeMatch[1] = parseInt(timeMatch[1], 10) + 12;
			}

			time = (timeMatch[1] < 10 ? '0' : '') + timeMatch[1] + ':' + timeMatch[2] + ':00';

			event.date = new Date(entry.find('.tradehistory_date').clone().children().remove().end().text().trim() + ' ' + time + ' UTC');

			event.partnerName = entry.find('.tradehistory_event_description a').html();
			event.partnerSteamID = null;
			event.partnerVanityURL = null;
			event.plusEvents = [];
			event.minusEvents = [];

			profileLink = entry.find('.tradehistory_event_description a').attr('href');
			if(profileLink) {
				if (profileLink.indexOf('/profiles/') != -1) {
					event.partnerSteamID = new SteamID(profileLink.match(/(\d+)$/)[1]);
				} else {
					event.partnerVanityURL = profileLink.match(/\/([^\/]+)$/)[1];
					if (options.resolveVanityURLs && vanityURLs.indexOf(event.partnerVanityURL) == -1) {
						vanityURLs.push(event.partnerVanityURL);
					}
				}
			}

			items = entry.find('.history_item');
			for (j = 0; j < items.length; j++) {
				const item = items[j];
				const appId = item.attribs['data-appid'];
				const classInstanceId = `${item.attribs['data-classid']}_${item.attribs['data-instanceid']}`;
				if(appId === '754' && classInstanceId === "0_0") continue;	// this is a comment about a trade hold so skip
				const description = descriptions[appId][classInstanceId];
				const contextID = item.attribs['data-contextid'];

				const econItem = {
					amount: item.attribs['data-amount'],
					instanceid: item.attribs['data-instanceid']
				}
				if(item.attribs['href']) {
					[,,econItem.id] = item.attribs['href'].match(/(\d+)/g)
				}
				if ($(item).parent().parent().children().eq(0).text() === "+") {
					event.plusEvents.push(new CEconItem(econItem, description, contextID));
				} else {
					event.minusEvents.push(new CEconItem(econItem, description, contextID));
				}
			}

			output.events.push(event);
		}

		if (options.resolveVanityURLs) {
			Async.map(vanityURLs, resolveVanityURL, function(err, results) {
				if (err) {
					callback(err);
					return;
				}

				for (i = 0; i < output.events.length; i++) {
					if (output.events[i].partnerSteamID || !output.events[i].partnerVanityURL) {
						continue;
					}

					// Find the vanity URL
					for (j = 0; j < results.length; j++) {
						if (results[j].vanityURL == output.events[i].partnerVanityURL) {
							output.events[i].partnerSteamID = new SteamID(results[j].steamID);
							break;
						}
					}
				}

				callback(null, output);
			});
		} else {
			callback(null, output);
		}
	}, "steamcommunity");
};

function resolveVanityURL(vanityURL, callback) {
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
