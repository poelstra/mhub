/**
 * Expand globs to individual filenames, as a workaround for programs that don't support these
 * patterns themselves (as is needed when running them in a Windows shell).
 * It's a bit blunt, in that it tries to replace everything that could be interpreted as a glob
 * pattern.
 */

"use strict";

var mglob = require("multi-glob");
var spawn = require("child_process").spawn;
var fs = require("fs");

var args = process.argv.slice(2);

mglob.glob(args, function(err, files) {
	var proc = spawn(args.shift(), args, { stdio: "inherit" });
	proc.on("close", function (code) {
		process.exit(code);
	});
});
