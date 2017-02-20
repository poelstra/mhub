/**
 * Common test initialization.
 */

import "source-map-support/register";

import log from "../src/log";
import { LogLevel } from "../src/logger";

log.logLevel = LogLevel.None;
