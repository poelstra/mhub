# FLL Message Server

## Introduction

This project contains a simple message broker for connecting various parts of First Lego League tournament software, developed collaboratively at https://github.com/FirstLegoLeague/.

It replaces the RabbitMQ server that we were using initially, which was removed to reduce the number of dependencies on software packages (we're already using Node and WebSockets), and to allow specific features to be implemented such as adding history to queues.

## Installation

Current package is still in active development, and pretty much hardcoded to a specific tournament (FLL Benelux Final, February 7th 2015, in the Netherlands).

Therefore, installation is currently only suitable for developers. A more user-friendly way of starting it will be developed later.

For now, to install and start the server:
```sh
git clone https://github.com/poelstra/mserver
cd mserver
npm install
npm run build
npm start
```

## Usage

Once the server is running, you can use the provided commandline tool to interface with it.

In one terminal, start:
```sh
node dist/src/client -n queue -l
```

This will subscribe to the node named 'queue', and log all messages that are posted to it to the console.
You should see a test message every 5 seconds.

In another terminal, run:
```sh
node dist/src/client -n queue -t my:topic -d '"topic data"'
```

This posts a message to the same queue, which you should see in the output of the first client (and in the debug output of the server).

Use the client's `--help` option for somewhat more advanced usage.

## Development

See Installation for basic installation, but instead of rebuilding and restarting the server manually every time, run:
```sh
npm run watch
```

The package is developed using Typescript: a superset of Javascript, adding type-safety and e.g. sophisticated code-completion (if your editor supports it). See http://www.typescriptlang.org/

CATS has been used as a simple open-source editor. It has some rough edges, but does provide code-completion and on-the-fly error checking of the Typescript code, see https://github.com/jbaron/cats/tree/unstable (be sure to take the 'unstable' branch for now).

## Protocol

For now, see the source of src/client.ts.
