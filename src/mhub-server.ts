/**
 * MHub server (mserver)
 *
 * Makes MHub pubsub Nodes available through WebSockets.
 */

import "source-map-support/register";

import * as path from "path";
import * as yargs from "yargs";

import Promise from "ts-promise";
import parseConfigFile from "./configparser";
import { LogLevel } from "./logger";
import { LoggingOptions, MServer, NormalizedConfig } from "./nodeserver";
import * as storage from "./storage";

import log from "./log";

// tslint:disable-next-line:no-shadowed-variable
function die(...args: any[]): void {
	log.fatal.apply(log, args);
	process.exit(1);
}

// Build list of valid log level names (e.g. none, fatal, error, ...)
const logLevelNames = Object.keys(LogLevel).filter((s) => !/\d+/.test(s)).map((s) => s.toLowerCase());

// Parse input arguments

const args = yargs
	.usage("mhub-server [-c <config_file>]")
	.help("help")
	.alias("h", "help")
	// tslint:disable-next-line:no-require-imports
	.version(() => require(path.resolve(__dirname, "../../package.json")).version)
	.alias("v", "version")
	.option("c", {
		type: "string",
		alias: "config",
		description: "Filename of config, uses mhub's server.conf.json by default",
	})
	.option("l", {
		type: "string",
		alias: "loglevel",
		description: "Override log level in config file. Valid options: " + logLevelNames.join(", "),
	})
	.strict()
	.argv;

// Parse config file

let configFile: string;
if (!args.config) {
	configFile = path.resolve(__dirname, "../../server.conf.json");
} else {
	configFile = path.resolve(args.config);
}

function setLogLevel(logLevelName: LoggingOptions) {
	// Convert config.logging to a LogLevel
	const matching = Object.keys(LogLevel).filter((s) => {
		return s.toLowerCase() === logLevelName;
	})[0];
	if (matching) {
		log.logLevel = (<any>LogLevel)[matching] as LogLevel;
	} else {
		die(`Invalid log level '${logLevelName}', expected one of: ${logLevelNames.join(", ")}`);
	}
}

// Create default storage

function createDefaultStorage({ storage: storageConfig }: NormalizedConfig) {
	const storageRoot = path.resolve(path.dirname(configFile), storageConfig);
	const simpleStorage = new storage.ThrottledStorage(new storage.SimpleFileStorage<any>(storageRoot));
	storage.setDefaultStorage(simpleStorage);
}

function main(): Promise<void> {
	const config = parseConfigFile(configFile);

	setLogLevel(args.loglevel || config.logging);
	log.info("Using config file " + configFile);

	createDefaultStorage(config);

	// Create server
	const server = new MServer(config);
	server.setLogger(log);
	return server.init();
}

Promise.resolve().then(main).catch((err: Error) => {
	die(err);
});
