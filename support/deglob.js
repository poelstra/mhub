/**
 * Expand globs to individual filenames, as a workaround for programs that don't support these
 * patterns themselves (as is needed when running them in a Windows shell).
 * It's a bit blunt, in that it tries to replace everything that could be interpreted as a glob
 * pattern.
 */

"use strict";

var glob = require("glob");
var spawn = require("cross-spawn");

// Strip call to node and our own filename
var args = process.argv.slice(2);

// Expand each input argument, or leave it as-is
args = args.reduce(function(args, arg) {
	var matches = glob.sync(arg);
	if (matches.length === 0) {
		matches = [arg];
	}
	return args.concat(matches);
}, []);

var proc = spawn(args.shift(), args, { stdio: "inherit" });
proc.on("close", function (code) {
	process.exit(code);
});
