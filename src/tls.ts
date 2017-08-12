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

function readFile(file: string, rootDir: string): Buffer;
function readFile(file: string[], rootDir: string): Buffer[];
function readFile(file: string | string[], rootDir: string): Buffer | Buffer[] {
	// Some options accept an array of keys/certs etc
	if (Array.isArray(file)) {
		return file.map((fileName) => readFile(fileName, rootDir));
	}
	return fs.readFileSync(path.resolve(rootDir, file));
}

/// Convert filenames to the contents of these files
export function replaceKeyFiles(options: TlsOptions, rootDir: string): void {
	["pfx", "key", "cert", "crl", "ca", "dhparam", "NPNProtocols", "ALPNProtocols", "ticketKeys"]
		.forEach((propName: keyof TlsOptions) => {
			if (options[propName]) {
				options[propName] = readFile(options[propName] as string, rootDir);
			}
		});
}
