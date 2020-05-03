/**
 * Commandline tool for sending/receiving MHub messages to/from an mserver.
 */

import "source-map-support/register";

import * as tls from "tls";
import * as yargs from "yargs";

import { Headers, Message } from "./message";
import MClient from "./nodeclient";
import { replaceKeyFiles } from "./tlsHelpers";
import { die } from "./util";

// tslint:disable:no-console

const usage = [
	"Listen mode:",
	"  mhub-client [-n <nodename>] -l [-p <topic_pattern>] [-o <output_format>]",
	"Post mode:",
	"  mhub-client [-n <nodename>] -t <topic> [-d <json_data>] [-h <json_headers>]",
	"Pipe mode:",
	"  mhub-client [-n <nodename>] -t <topic> -i <input_format> [-h <json_headers>]",
	"",
	"Use -s [protocol://]<host>[:<port>] to specify a custom server/port.",
	"To use SSL/TLS, use e.g. -s wss://your_host.",
	"For self-signed certs, see --insecure.",
].join("\n");

const args = yargs
	.usage(usage)
	.help("help")
	.version()
	.alias("v", "version")
	.option("socket", {
		type: "string",
		alias: "s",
		description:
			"WebSocket to connect to, specify as [protocol://]host[:port], e.g. ws://localhost:13900, " +
			"or wss://localhost:13900",
		required: true,
		default: "localhost:13900",
	})
	.option("node", {
		type: "string",
		alias: "n",
		description: "Node to subscribe/publish to, e.g. 'test'",
		required: true,
		default: "default",
	})
	.option("listen", {
		type: "boolean",
		alias: "l",
		description: "Select listen mode",
	})
	.option("pattern", {
		type: "string",
		alias: "p",
		description: "Topic subscription pattern as glob, e.g. 'twitter:*'",
	})
	.option("output", {
		type: "string",
		alias: "o",
		description: "Output format, can be: human, text, jsondata, json",
		default: "human",
	})
	.option("topic", {
		type: "string",
		alias: "t",
		description: "Message topic",
	})
	.option("data", {
		type: "string",
		alias: "d",
		description:
			'Optional message data as JSON object, e.g. \'"a string"\' or \'{ "foo": "bar" }\'',
	})
	.option("headers", {
		type: "string",
		alias: "h",
		description:
			'Optional message headers as JSON object, e.g. \'{ "my-header": "foo" }\'',
	})
	.option("input", {
		type: "string",
		alias: "i",
		description:
			"Read lines from stdin, post each line to server. <input_format> can be: text, json",
	})
	.option("insecure", {
		type: "boolean",
		description:
			"Disable server certificate validation, useful for testing using self-signed certificates",
	})
	.option("key", {
		type: "string",
		description: "Filename of TLS private key (in PEM format)",
	})
	.option("cert", {
		type: "string",
		description: "Filename of TLS certificate (in PEM format)",
	})
	.option("ca", {
		type: "string",
		description: "Filename of TLS certificate authority (in PEM format)",
	})
	.option("passphrase", {
		type: "string",
		description: "Passphrase for private key",
	})
	.option("pfx", {
		type: "string",
		description:
			"Filename of TLS private key, certificate and CA certificates " +
			"(in PFX or PKCS12 format). Mutually exclusive with --key, --cert and --ca.",
	})
	.option("crl", {
		type: "string",
		description: "Filename of certificate revocation list (in PEM format)",
	})
	.option("ciphers", {
		type: "string",
		description: "List of ciphers to use or exclude, separated by :",
	})
	.option("username", {
		type: "string",
		alias: "U",
		description: "Username",
	})
	.option("password", {
		type: "string",
		alias: "P",
		description:
			"Password. Note: sent in plain-text, so only use on secure connection. " +
			"Also note it may appear in e.g. `ps` output.",
	})
	.strict();

enum OutputFormat {
	Human,
	Text,
	JsonData,
	Json,
}

function parseOutputFormat(s: string): OutputFormat {
	switch (s) {
		case "human":
			return OutputFormat.Human;
		case "text":
			return OutputFormat.Text;
		case "jsondata":
			return OutputFormat.JsonData;
		case "json":
			return OutputFormat.Json;
		default:
			return die("Invalid output format:", s);
	}
}

function createClient(argv: any): Promise<MClient> {
	const tlsOptions: tls.TlsOptions = {};
	tlsOptions.pfx = argv.pfx;
	tlsOptions.key = argv.key;
	tlsOptions.passphrase = argv.passphrase;
	tlsOptions.cert = argv.cert;
	tlsOptions.ca = argv.ca;
	tlsOptions.crl = argv.crl;
	tlsOptions.ciphers = argv.ciphers;
	tlsOptions.rejectUnauthorized = !argv.insecure;
	replaceKeyFiles(tlsOptions, process.cwd());

	const client = new MClient(argv.socket, tlsOptions);
	client.on("error", (e: Error): void => {
		die("Client error:", e);
	});

	return client
		.connect()
		.then(() => {
			if (argv.username) {
				return client.login(argv.username, argv.password || "");
			}
		})
		.then(() => client);
}

function listenMode(): void {
	const argv = args.argv;
	const format = parseOutputFormat(argv.output);
	createClient(argv)
		.then((client) => {
			client.on("message", (msg: Message): void => {
				switch (format) {
					case OutputFormat.Human:
						console.log(msg);
						break;
					case OutputFormat.Text:
						console.log(msg.data);
						break;
					case OutputFormat.JsonData:
						console.log(JSON.stringify(msg.data));
						break;
					case OutputFormat.Json:
						console.log(JSON.stringify(msg));
						break;
					default:
						die("Unknown output format:", format);
				}
			});
			return client.subscribe(argv.node, argv.pattern);
		})
		.catch(die);
}

function postMode(): void {
	const argv = args.require("topic", true).argv;

	let data: any;
	try {
		data = argv.data && JSON.parse(argv.data);
	} catch (e) {
		console.error("Error parsing message data as JSON:", e.message);
		die(
			"Hint: if you're passing a string, make sure to put double-quotes around it, " +
				"and escape these quotes for your shell with single-quotes, e.g.: '\"my string\"'"
		);
	}

	let headers: Headers;
	try {
		headers = argv.headers && JSON.parse(argv.headers);
	} catch (e) {
		die("Error parsing message headers as JSON: " + e.message);
	}

	createClient(argv)
		.then((client) => {
			const closer = () => client.close();
			return client
				.publish(argv.node, argv.topic, data, headers)
				.then(closer, closer);
		})
		.catch(die);
}

enum InputFormat {
	Text,
	Json,
}

function parseInputFormat(s: string): InputFormat {
	switch (s) {
		case "text":
			return InputFormat.Text;
		case "json":
			return InputFormat.Json;
		default:
			return die("Invalid input format:", s);
	}
}

function pipeMode(): void {
	const argv = args.require("topic", true).require("input", true).argv;

	const format = parseInputFormat(argv.input);

	let headers: Headers;
	try {
		headers = argv.headers && JSON.parse(argv.headers);
	} catch (e) {
		die("Error parsing message headers as JSON: " + e.message);
	}

	let ended = false;
	createClient(argv)
		.then((client) => {
			// Connection opened, start reading lines from stdin
			process.stdin.setEncoding("utf8");
			process.stdin.on("readable", onRead);
			process.stdin.on("end", onEnd);

			let lineBuffer = "";

			function onRead(): void {
				const chunk = process.stdin.read();
				if (chunk === null) {
					// tslint:disable-line:no-null-keyword
					return;
				}
				lineBuffer += chunk;
				while (true) {
					const p = lineBuffer.indexOf("\n");
					if (p < 0) {
						break;
					}
					handleLine(lineBuffer.slice(0, p));
					lineBuffer = lineBuffer.slice(p + 1);
				}
			}

			function onEnd(): void {
				ended = true;
				if (lineBuffer !== "") {
					// Make sure to post remaining line, if non-empty
					handleLine(lineBuffer);
				} else {
					// Otherwise, we're done
					client.close();
				}
			}

			function handleLine(line: string): void {
				// Strip trailing \r if necessary
				if (line[line.length - 1] === "\r") {
					line = line.slice(0, -1);
				}
				let data: any;
				if (format === InputFormat.Json) {
					try {
						data = JSON.parse(line);
					} catch (e) {
						die("Error parsing line as JSON: " + e.message);
					}
				} else {
					data = line;
				}

				const closer = () => {
					if (ended) {
						client.close();
					}
				};
				client
					.publish(argv.node, argv.topic, data, headers)
					.then(closer, closer);
			}
		})
		.catch(die);
}

function main(): void {
	const argv = args.argv;

	if (argv.listen) {
		listenMode();
	} else if (argv.topic) {
		if (argv.input) {
			pipeMode();
		} else {
			postMode();
		}
	} else {
		die("Either -l or -t is required, see --help for more info.");
	}
}

main();
