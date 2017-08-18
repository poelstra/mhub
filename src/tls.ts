/**
 * TLS helpers.
 */

import * as fs from "fs";
import * as path from "path";

export interface TlsOptions {
	pfx?: string | Buffer;
	key?: string | string[] | Buffer | Buffer[];
	passphrase?: string;
	cert?: string | string[] | Buffer | Buffer[];
	ca?: string | string[] | Buffer | Buffer[];
	crl?: string | string[] | Buffer | Buffer[];
	ciphers?: string;
	honorCipherOrder?: boolean;
	requestCert?: boolean;
	rejectUnauthorized?: boolean;
	NPNProtocols?: string[] | Buffer;
	ALPNProtocols?: string[] | Buffer;
}

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
export function replaceKeyFiles(options: TlsOptions, rootDir: string): void {
	["pfx", "key", "cert", "crl", "ca", "dhparam", "ticketKeys"]
		.forEach((propName: keyof TlsOptions) => {
			if (options[propName]) {
				options[propName] = convertToBuffer(options[propName], rootDir);
			}
		});
}
