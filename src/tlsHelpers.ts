/**
 * TLS helpers.
 */

import * as fs from "fs";
import * as path from "path";
import * as tls from "tls";

function convertToBuffer(value: any, rootDir: string): any {
	// Some options accept an array of keys/certs etc
	if (Array.isArray(value)) {
		return value.map((element) => convertToBuffer(element, rootDir));
	}
	if (typeof value !== "string") {
		// Pass through Buffer / UInt8Array as-is
		return value;
	}
	// Read filename, convert to file contents
	return fs.readFileSync(path.resolve(rootDir, value));
}

/// Convert filenames to the contents of these files
export function replaceKeyFiles(options: tls.TlsOptions, rootDir: string): void {
	// tslint:disable-next-line:array-type
	(<Array<keyof tls.TlsOptions>>["pfx", "key", "cert", "crl", "ca", "dhparam", "ticketKeys"])
		.forEach((propName: keyof tls.TlsOptions) => {
			if (options[propName]) {
				options[propName] = convertToBuffer(options[propName], rootDir);
			}
		});
}
