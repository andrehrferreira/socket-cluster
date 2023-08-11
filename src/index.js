//Server controller

import "@babel/polyfill/noConflict";

import dotenv from "dotenv";
import winston from "winston";
import { $ } from "@dekproject/scope";
import "./app";

dotenv.config();
const PORT = process.env.PORT || 5559;

winston.addColors({
    error: "red",
    warn: "yellow",
    info: "cyan",
    debug: "green"
});

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`),
    )
});

if (process.env.NODE_ENV !== "production") {
    logger.add(new winston.transports.Console({
        format: winston.format.colorize()
    }));
}

$.set("logger", logger);

process.on("uncaughtException", (error) => {
    logger.error(error);
});

$.wait(["io", "logger", "rabbitmq"], 3000).then(async () => {
    $.io.listen(PORT);
}).catch((error) => {
    console.error(error);
});