import "@babel/polyfill/noConflict";
import "dotenv/config";

import express from "express";
import path from "path";

import { $, plugins } from "@dekproject/scope";
import Socket from "./socket";

//let newrelic;

//if (process.env.NODE_ENV === "production")
//    newrelic = require("newrelic");

class App {
    constructor() {
        const app = express();

        if (process.env.NODE_ENV === "production"){
            //newrelic.instrumentWebframework("express", express);
            //app.locals.newrelic = newrelic;
        }
        else{
            app.use("/", express.static(__dirname + "/static"));

            app.get("/", (req, res) => {
                res.sendFile(path.resolve("./static/index.html"));
            });
            
            app.get("/extension", (req, res) => {
                res.sendFile(path.resolve("./static/extension.html"));
            });
        }

        app.get("/dashboard", (req, res) => {
            res.sendFile(path.resolve("./static/dashboard.html"));
        });

        app.get("/health", (req, res) => res.send("Healthy"));

        try {
            plugins("node_modules/@dekproject");

            $.wait(["logger", "rabbitmq"], 3000).then(async () => {
                this.app = app;
                this.app.disable("x-powered-by");
                this.app.set("etag", true);
                this.app.enable("trust proxy");
                $.set("app", app);

                this.io = new Socket(this.app);
                $.set("io", this.io);
            }).catch((error) => {
                console.error(error);
            });
        } catch (err) {
            console.error(err);
        }
    }
}

module.exports = new App().app;