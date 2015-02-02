/**
 * Poll moderated tweets from FLL Twitter api (https://github.com/FirstLegoLeague/twitter-admin)
 * and post them to FLL Message Server (https://github.com/poelstra/mserver).
 */

/// <reference path="../typings/tsd.d.ts" />

"use strict";

import http = require("http");
import util = require("util");
import fs = require("fs");
import path = require("path");
import querystring = require("querystring");
import overlay = require("./overlay");
import MClient = require("./MClient");

var configFile = path.resolve(__dirname, "../../twitter_pusher.conf.json");
console.log("Using config file " + configFile);
var config = JSON.parse(fs.readFileSync(configFile, "utf8"));

/* FLL Twitter API handling */

var shownIDs: string[] = [];
var deletedIDs: string[] = [];

function getAll(method: string, params: { [key: string]: any }, callback: (err: Error, data: string) => void): void {
	params["display_id"] = config.twitter.display;
	http.get(config.twitter.url + "/" + method + "?" + querystring.stringify(params), (res: http.ClientResponse): void => {
		var body = "";
		if (res.statusCode === 200) {
			res.setEncoding("utf8");
			res.on("data", (chunk: string): void => {
				body += chunk;
			});
			if (callback) {
				res.on("end", (): void => callback(null, body));
			}
		}
	}).on("error", (e: Error): void => {
		console.log("Twitter API error: " + e.message);
		callback(e, null);
	});
}

interface Tweet {
	id: number;
	statusId: string;
	shown: string; // ISO date string
	created: string; // ISO date string
	author: string;
	message: string;
}

function parseTweets(data: string): Tweet[] {
	var lines = data.split("\n");
	var tweets: Tweet[] = [];
	lines.forEach((line: string): void => {
		if (line === "") {
			return;
		}
		var parts = new overlay.Splitter(line);
		var tweet: Tweet = {
			id: +(parts.getPart()),
			statusId: parts.getPart(),
			shown: parts.getPart(),
			created: parts.getPart(),
			author: parts.getPart(),
			message: parts.getRest()
		};
		if (tweet.created === "0") {
			tweet.created = null;
		} else {
			tweet.created = new Date(Date.parse(tweet.created)).toISOString();
		}
		if (tweet.shown === "") {
			tweet.shown = null;
		} else {
			tweet.shown = new Date(Date.parse(tweet.shown)).toISOString();
		}
		tweets.push(tweet);
	});
	return tweets;
}

function handleTweets(tweets: Tweet[]): void {
	tweets.forEach((tweet: Tweet): void => {
		if (tweet.created) {
			if (publish("add", tweet)) {
				shownIDs.push(tweet.statusId);
				util.log("Add: " + util.inspect(tweet));
			}
		} else {
			if (publish("remove", tweet)) {
				deletedIDs.push(tweet.statusId);
				util.log("Remove: " + util.inspect(tweet));
			}
		};
	});
}

function postShown(cb: () => void): void {
	util.log("Shown: " + shownIDs.join(","));
	if (shownIDs.length > 0) {
		getAll("shown.php", {
			ids: shownIDs.join(",")
		}, (err: Error): void => {
			if (!err) {
				shownIDs = [];
			}
			cb();
		});
	} else {
		cb();
	}
}

function postDeleted(cb: () => void): void {
	util.log("Deleted: " + deletedIDs.join(","));
	if (shownIDs.length > 0) {
		getAll("deleted.php", {
			ids: deletedIDs.join(",")
		}, (err: Error): void => {
			if (!err) {
				deletedIDs = [];
			}
			cb();
		});
	} else {
		cb();
	}
}

function getNew(cb: () => void): void {
	getAll("feed.php", {
		count: 100
	}, (err: Error, body: string): void => {
		if (!err && body) {
			handleTweets(parseTweets(body));
		}
		cb();
	});
}

function pollTweets(): void {
	getNew((): void => {
		postShown((): void => {
			postDeleted((): void => {
				setTimeout(pollTweets, 10 * 1000);
			});
		});
	});
}

pollTweets();

/* FLL Message server handling */

var mclient: MClient;

function connectToMServer(): void {
	function connect(): void {
		var c = new MClient(config.mserver.url);
		c.on("open", (): void => {
			console.log("MClient connected");
			mclient = c;
		});
		c.on("close", (): void => {
			console.log("MClient closed");
			mclient = null;
			setTimeout((): void => {
				connect();
			}, 1000);
		});
		c.on("error", (e: Error): void => {
			console.log("MClient error:", e);
			mclient = null;
			setTimeout((): void => {
				connect();
			}, 10000);
		});
	}
	connect();
}

function publish(mode: string, tweet: Tweet): boolean {
	if (!mclient) {
		return false;
	}
	mclient.publish(config.mserver.node, "twitter:" + mode, tweet);
	return true;
}

connectToMServer();
