/**
 * Commandline tool for determining latency.
 */

import "source-map-support/register";

import * as tls from "tls";
import * as yargs from "yargs";

import { Headers, Message } from "./message";
import MClient from "./nodeclient";
import { replaceKeyFiles } from "./tlsHelpers";
import { die } from "./util";

const usage = [
	"Sends a message to the given node, waits for an answer, then sends the next etc.",
	"Prints the round-trip time for each message.",
	"",
	"Make sure you have the `test` node enabled in mhub-server, or provide your own",
	"routing to respond with `ping:response` to each `ping:request`",
].join("\n");

const argv = yargs
	.usage(usage)
	.help("help")
	// tslint:disable-next-line:no-require-imports
	.version()
	.alias("v", "version")
	.option("socket", {
		type: "string",
		alias: "s",
		description: "WebSocket to connect to",
		default: "localhost:13900",
	})
	.option("node", {
		type: "string",
		alias: "n",
		description: "Node to subscribe/publish to",
		default: "ping",
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
	.option("count", {
		type: "number",
		alias: "c",
		description: "Number of pings to send",
		default: 10,
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
	.strict().argv;

function createClient(): Promise<MClient> {
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

let data: any;
try {
	data = argv.data && JSON.parse(argv.data);
} catch (e) {
	// tslint:disable-next-line:no-console
	console.error("Error parsing message data as JSON: " + e.message);
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

const pingCount = argv.count;

/**
 * High-res timestamp in milliseconds.
 */
function now(): number {
	const hrTime = process.hrtime();
	return hrTime[0] * 1000000000 + hrTime[1] / 1000000;
}

createClient()
	.then(async (client) => {
		async function ping(): Promise<void> {
			const response = new Promise<void>((resolve) => {
				client.once("message", (msg: Message): void => {
					const reply = JSON.stringify(msg.data);
					if (argv.data === reply) {
						resolve();
					}
				});
			});

			const request = client.publish(
				argv.node,
				"ping:request",
				data,
				headers
			);
			let timeoutTimer: NodeJS.Timer;
			const timeout = new Promise((_, reject) => {
				timeoutTimer = setTimeout(
					() => reject(new Error("timeout")),
					1000
				);
			});
			try {
				await Promise.race([Promise.all([request, response]), timeout]);
			} finally {
				clearTimeout(timeoutTimer!);
			}
		}

		client.subscribe(argv.node, "ping:response");
		for (let i = 0; i < pingCount; i++) {
			const start = now();
			try {
				await ping();
				console.log(`pong ${i}: ${(now() - start).toFixed(3)}ms`); // tslint:disable-line:no-console
			} catch (err) {
				console.warn(err.message || `${err}`); // tslint:disable-line:no-console
			}
		}
		return client.close();
	})
	.catch(die);
