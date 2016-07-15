/// <reference path="node/node.d.ts" />
/// <reference path="es6-promise/es6-promise.d.ts" />
/// <reference path="express/express.d.ts" />
/// <reference path="ws/ws.d.ts" />
/// <reference path="minimatch/minimatch.d.ts" />
/// <reference path="yargs/yargs.d.ts" />
/// <reference path="mocha/mocha.d.ts" />
/// <reference path="serve-static/serve-static.d.ts" />
/// <reference path="express-serve-static-core/express-serve-static-core.d.ts" />
/// <reference path="mime/mime.d.ts" />
/// <reference path="mkdirp/mkdirp.d.ts" />

// ES6 has `name` defined on Functions (including classes)
declare interface Function {
	name: string;
}
