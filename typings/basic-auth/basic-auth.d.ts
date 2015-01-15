/// <reference path="../express/express.d.ts" />

declare module "basic-auth" {
    import express = require("express");
    function basicAuth(req: express.Request): any;
    export = basicAuth;
}
