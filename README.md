# MHub message server and client

## Introduction

This project provides a simple message broker for loosely coupling software
components, including a library and simple (command-line) tools for interacting
with the server.

In particular, it is supported by the [Display System](https://github.com/FirstLegoLeague/displaySystem)
for running First Lego League tournaments.

It can be used as a lightweight Javascript-only alternative to e.g. RabbitMQ
(note that it only supports a small subset of RabbitMQ's features though).

## Concepts

An MHub server (`mserver`) instance typically contains a number of *nodes*.
A message posted to such a node is sent to all subscribers of that node.
It is also possible to create a *binding* between two nodes (optionally based on
a topic *pattern*), which will forward all messages that match the pattern from
its source node to its destination node.

To create a loose coupling between different software components, one would
typically define a node for each application end point.
Example end points can be:
* one or more displays containing e.g. a twitter feed, message bar, live scores
  table and match clock (typically only a subscriber)
* a control panel application for controlling such display(s) (typically both
  publisher and subscriber)
* a twitter scraper that posts tweets to the system (typically publish-only)
* a scores entry system (also publish-only)

The idea is to create bindings between these end points, such that e.g. messages
from the control panel application and tweets are routed to the displays (or
only some of them). Approved scores from the control panel could be sent to all
displays, whereas commands to show/hide the scores may only be sent to some of
the displays, based on patterned bindings.

Another example usage is coupling systems on a local network to systems on other
networks (including the Internet).

A *message* consists of a *topic* and optionally *data* and *headers*.
The topic is matched against subscription patterns, and is typically specified
as `<namespace>:<command>`.
Some messages (such as `clock:stop`) might not need data, others
(like `clock:arm`) may have data like `{ countdown: "2:30" }`.
Message headers are used for passing around meta-data about the message, and can
be used by e.g. proxy servers to prevent message loops.

## Installing and running the server

To install and run the server:
```sh
npm install -g mhub
mserver
```

To customize the available nodes and bindings, create a copy of
`server.conf.json`, edit it to your needs and start the server as:
```sh
mserver -c <config_filename>
```

## Command line interface

Once the server is running, you can use the provided commandline tool to
send and receive messages.

To subscribe ('listen') to all messages of a node named `blib`, and log all
messages to the console:
```sh
mclient -n blib -l
```

The `blib` node is a 'magic' node that broadcasts a message every 5 seconds.

To post two simple messages:
```sh
# On *nix shell:
mclient -n blib -t my:topic -d '"some string"'
mclient -n blib -t my:topic -d '{ "key": "value" }'
# On Windows command prompt:
mclient -n blib -t my:topic -d """some string"""
mclient -n blib -t my:topic -d "{ ""key"": ""value"" }"
```
Note that the data is always parsed as JSON, so make sure to keep an eye on the
necessary escaping of quotes etc.

These example messages would be output by the listening client as:
```
{ topic: 'blib', data: 476, headers: {} }
{ topic: 'my:topic', data: 'some string', headers: {} }
{ topic: 'my:topic', data: { key: 'value' }, headers: {} }
{ topic: 'blib', data: 477, headers: {} }
```

The same tool can also be used for communicating with other tools.

Example to stream tweets into an mserver, using the `tweet` command from [this fork of node-tweet-cli](https://github.com/rikkertkoppes/node-tweet-cli).
```sh
tweet login
tweet stream some_topic --json | mclient -n twitter -t twitter:add -i json
```

To read back what has been posted (just the data, not topic and headers), use e.g.:
```sh
mclient -n twitter -l -o jsondata
```

## Programmatic interface

Example usage of subscribing to a node and sending a message:
```js
var MClient = require("mhub").MClient;
var client = new MClient("ws://localhost:13900");
client.on("message", function(message) {
	console.log(message.topic, message.data, message.headers);
});
client.on("open", function() {
	client.subscribe("blib"); // or e.g. client.subscribe("blib", "my:*");
	client.publish("blib", "my:topic", 42, { some: "header" });
});
```

For use in the browser, [browserify](http://browserify.org/) is recommended.

## Protocol

For now, see the source of src/MClient.ts. This section will be updated once the
protocol stabilizes.

## Development

The package is developed in [Typescript](http://www.typescriptlang.org/) and
GitHub's [Atom Editor](https://atom.io/) using the awesome [Atom Typescript](https://github.com/TypeStrong/atom-typescript) plugin.

In SublimeText, use [Microsoft's plugin](https://packagecontrol.io/packages/TypeScript).

When using one of these, you'll get instant smart code-completion
('IntelliSense'), compile-on-save, etc.

Clone this repository and run the server with auto-reload:
```sh
git clone https://github.com/poelstra/mhub
cd mhub
npm install
npm run watch:start
```

For other editors, to get automatic compilation and live-reload:
```sh
git clone https://github.com/poelstra/mhub
cd mhub
npm install
npm run watch
# or run `npm run build` for one-time compilation
```

Make sure to run `npm test` (mainly for tslint, tests still pending...) before
sending a pull-request.

## License

Licensed under the MIT License, see LICENSE.txt.

Copyright (c) 2015 Martin Poelstra <martin@beryllium.net>
