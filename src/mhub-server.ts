/**
 * MHub server (mserver)
 *
 * Makes MHub pubsub Nodes available through WebSockets.
 */

import "source-map-support/register";

import * as path from "path";
import * as yargs from "yargs";

import parseConfigFile from "./configparser";
import { LogLevel } from "./logger";
import { LoggingOptions, MServer } from "./nodeserver";

import log from "./log";
import { die } from "./util";

// Build list of valid log level names (e.g. none, fatal, error, ...)
const logLevelNames = Object.keys(LogLevel)
	.filter((s) => !/\d+/.test(s))
	.map((s) => s.toLowerCase());

// Parse input arguments

const args = yargs
	.usage("mhub-server [-c <config_file>]")
	.help("help")
	.alias("h", "help")
	// tslint:disable-next-line:no-require-imports
	.version()
	.alias("v", "version")
	.option("config", {
		type: "string",
		alias: "c",
		description:
			"Filename of config, uses mhub's server.conf.json by default",
	})
	.option("loglevel", {
		type: "string",
		alias: "l",
		description:
			"Override log level in config file. Valid options: " +
			logLevelNames.join(", "),
	})
	.strict().argv;

// Parse config file

let configFile: string;
if (!args.config) {
	configFile = path.resolve(__dirname, "../../server.conf.json");
} else {
	configFile = path.resolve(args.config);
}

function setLogLevel(logLevelName: LoggingOptions | string) {
	// Convert config.logging to a LogLevel
	const matching = Object.keys(LogLevel).filter((s) => {
		return s.toLowerCase() === logLevelName;
	})[0];
	if (matching) {
		log.logLevel = (<any>LogLevel)[matching] as LogLevel;
	} else {
		die(
			`Invalid log level '${logLevelName}', expected one of: ${logLevelNames.join(
				", "
			)}`
		);
	}
}

function main(): Promise<void> {
	const config = parseConfigFile(configFile);

	setLogLevel(args.loglevel || config.logging);
	log.info("Using config file " + configFile);

	// Create server
	const server = new MServer(config);
	server.setLogger(log);
	return server.init();
}

Promise.resolve()
	.then(main)
	.catch((err: Error) => {
		die("main failed: ", err);
	});
