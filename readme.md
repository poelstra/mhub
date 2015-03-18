# FLL Message Server

## Introduction

This project contains a simple message broker for connecting various parts of First Lego League
tournament software, developed collaboratively at [Github](https://github.com/FirstLegoLeague/).

It replaces the RabbitMQ server that we were using initially, which was removed to reduce the number
of dependencies on software packages (we're already using Node and WebSockets), and to allow
specific features to be implemented such as adding history to queues.

## Status

Current package is still in active development, and mainly focussed on a specific tournament
(FLL Benelux Final, February 7th 2015, in the Netherlands).

Therefore, installation is currently only suitable for developers. A more user-friendly way of
starting it will be developed later.

## Installation and running the server

For now, to install and start the server using the default configuration:
```sh
git clone https://github.com/poelstra/mserver
cd mserver
npm install
npm run build
npm start
```

To customize the available nodes and bindings, create a copy of `server.conf.json`, edit it to your
needs and start the server as:
```sh
node start -- -c <config_filename>
```
(Note: passing custom arguments only works with a recent npm, tested with 2.4.1)

## Interfacing with the server from the commandline

Once the server is running, you can use the provided commandline tool to interface with it.

In one terminal, start:
```sh
node dist/src/client -n blib -l
```

This will subscribe to the node named 'blib', and log all messages that are posted to it to the
console. You should see a test message every 5 seconds.

In another terminal, run:
```sh
node dist/src/client -n blib -t my:topic -d '"topic data"'
```

This posts a message to the same queue, which you should see in the output of the first client (and
in the debug output of the server).

Use the client's `--help` option for somewhat more advanced usage.

## Interfacing with the server programmatically

A class for interfacing with the server is provided (and documented) in src/MClient.ts.

Example usage:
```js
var MClient = require("./dist/src/MClient");
var client = new MClient("ws://localhost:13900");
client.on("message", function(message) {
	console.log(message.topic, message.data, message.headers);
});
client.on("open", function() {
	client.subscribe("blib"); // or e.g. client.subscribe("blib", "my:*");
	client.publish("blib", "my:topic", 42, { some: "header" });
});
```

For use in the browser, browserify is recommended.

For internal details about the protocol, see the source of src/MClient.ts.

## Development

See Installation for basic installation, but instead of rebuilding and restarting the server
manually every time, run:
```sh
npm run watch
```

The package is developed using [Typescript](http://www.typescriptlang.org/).

Tip: use GitHub's [Atom Editor](https://atom.io/) and install the [Atom Typescript package](https://github.com/TypeStrong/atom-typescript).
You'll get instant smart code-completion ('IntelliSense'), compile-on-save, etc.

Or, if you're into SublimeText, try [Microsoft's plugin](https://github.com/Microsoft/ngconf2015demo).

## Authors

* [Martin Poelstra](https://github.com/poelstra)
