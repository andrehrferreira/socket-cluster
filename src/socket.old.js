import SocketIO from "socket.io";
import uniqid from "uniqid";
import redis from "redis";
import zlib from "zlib";
import os from "os";

import { logger } from "@dekproject/scope";

export default class Socket {
    constructor(app){
        this.namespace = "master";
        this.clients = {};
        this.dashs = [];
        this.crowIds = [];
        this.crowTTLs = {};
        this.logs = {};
        this.server = require("http").createServer(app);
        this.requestCounter = 0;
        this.requestsPerMinute = 0;
        this.reports = {};

        this.io = SocketIO(this.server, {
            serveClient: true,
            pingInterval: 25000,
            pingTimeout: 30000, 
            upgradeTimeout: 20000, 
            agent: false,
            cookie: false,
            rejectUnauthorized: false,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            maxHttpBufferSize: 100000000 
        });

        this.pub = redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });
        this.sub = redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });

        this.sub.on("connection", () => {
            logger.info("[System] connect to subcribe server");
        });

        this.pub.on("connection", () => {
            logger.info("[System] connect to publish server");
        });

        this.sub.on("message", async (channel, message) => {
            try{
                message = JSON.parse(message);

                switch(message.type){
                case "connection":                     
                    logger.info(`[${message.clientId}]: connected to the ${channel} `);

                    break;
                case "disconnected": 
                    if(this.crowIds.includes(message.clientId)){
                        delete this.crowIds[message.clientId]; 
                        delete this.crowTTLs[message.clientId];
                        this.crowIds = this.crowIds.filter((item) => item);
                    } 
                        
                    //logger.info(`disconnect ${message.clientId}`);
                    break;
                case "ping":       
                    if(this.crowIds.includes(message.clientId))              
                        this.crowTTLs[message.clientId] = new Date().getTime() + 120000;
                    /*else {
                        this.crowIds.push(message.clientId);
                        this.crowTTLs[message.clientId] = new Date().getTime() + 120000;
                    }*/

                    //logger.info(`[${message.clientId}] ping`);
                    break;                
                case "join": 
                    if(!this.crowIds.includes(message.clientId)) {
                        this.crowIds.push(message.clientId); 
                        this.crowTTLs[message.clientId] = new Date().getTime() + 120000;
                    }

                    logger.info(`[${message.clientId}] join the crawler clients`);
                    break;
                case "dash": 
                    if(!this.dashs.includes(message.clientId)) 
                        this.dashs.push(message.clientId);

                    for(let key in this.reports)
                        this.clients[message.clientId].emit("report", JSON.stringify(this.reports[key]));

                    logger.info(`[${message.clientId}] join the dashboard clients`);
                    break;
                case "report":      
                    this.reports[message.host] = message;

                    this.dashs.map((clientId) => {
                        if(this.clients[clientId])
                            this.clients[clientId].emit("report", JSON.stringify(message));
                    });

                    //logger.info(`[${message.clientId}] ping`);
                    break;
                case "request": 
                    if(this.clients[message.to]){
                        this.requestCounter++;
                        logger.info(`[${message.to}] recieve request ${message.uuid}`);
                        this.clients[message.to].emit("message", JSON.stringify(message));
                    }
                    break;
                case "feedback":
                    if(this.clients[message.sender]){
                        logger.info(`[${message.sender}] recieve feedback ${message.uuid}`);

                        if(message.body)
                            message.body = zlib.gzipSync(message.body).toString("hex");

                        this.clients[message.sender].emit("message", JSON.stringify(message));
                    }
                    break;
                }                
            }     
            catch(err){
                logger.error(err);
            }       
        });

        //Garbage collector sockets
        setInterval(() => {
            this.crowIds = this.crowIds.filter((clientId) => {
                if(this.crowTTLs[clientId] > new Date().getTime()){
                    return true;
                }
                else{
                    logger.info(`[${clientId}] Removed for inactivity`);
                    delete this.crowTTLs[clientId];
                    return false;
                }
            });

            //logger.info(`[System] ${this.crowIds.length} sockets active`);
        }, 120000);

        setInterval(() => {
            this.pub.publish(this.namespace, JSON.stringify({ 
                type: "report",
                data: {
                    host: `${os.hostname()}:${process.env.PORT}`,
                    crows: this.crowIds.length,
                    clients: Object.keys(this.clients).length,
                    requests: this.requestsPerMinute
                }
            }));
        }, 60000);

        /*setInterval(() => {
            let clients = {};

            for(let key in this.clients){
                if(this.clients[key].connected)
                    clients[key] = this.clients[key];
            }

            this.clients = clients;
        }, 40000);*/

        setInterval(() => {
            this.requestsPerMinute = this.requestCounter;
            this.requestCounter = 0;
        }, 60000);

        this.io.sockets.on("connection", this.connection.bind(this));
        this.io.sockets.on("connect_error", this.connectError.bind(this));
        this.io.sockets.on("connect_timeout", this.connectTimeout.bind(this));
        this.io.sockets.on("error", this.error.bind(this));
        this.io.sockets.on("disconnect", this.disconnect.bind(this));
        this.io.sockets.on("reconnecting", this.reconnecting.bind(this));
    }

    connection(socket){
        const clientId = /*socket.handshake.headers["X-Forwarded-For"] || socket.handshake.address ||*/ uniqid(); //socket.request.connection.remoteAddress;// 
        let pingSocketInterval = null;

        // eslint-disable-next-line no-console
        //console.log(socket.handshake);
        //logger.info(`${socket.handshake.address} / ${socket.request.connection.remoteAddress}`);

        /*try{
            if(this.clients[clientId])
                this.clients[clientId].disconnect();
        }catch(err){}*/

        this.clients[clientId] = socket;
        this.logs[clientId] = "Connected";
        
        this.clients[clientId].on("message", (data) => {
            this.pub.publish(this.namespace, JSON.stringify({
                type: "message",
                data,
                clientId
            }));
        });

        this.clients[clientId].on("dash", () => {
            this.sub.subscribe("dash");
            //this.pub.publish(this.namespace, JSON.stringify({ type: "dash", clientId }));
        });

        this.clients[clientId].on("join", () => {
            this.logs[clientId] = "join";
            this.sub.subscribe(clientId);
            //this.pub.publish(this.namespace, JSON.stringify({ type: "join", clientId }));

            /*pingSocketInterval = setInterval(() => {
                if(this.clients[clientId] && this.clients[clientId].connected){
                    this.pub.publish(this.namespace, JSON.stringify({
                        type: "ping",
                        clientId
                    }));
                }
                else{
                    clearInterval(pingSocketInterval);
                }
            }, 10000); */
        });

        this.clients[clientId].on("request", (data) => {
            if(this.crowIds.length > 0){
                const clientToRequest = this.crowIds[this.__RandomMinMax(0, this.crowIds.length)];
                //const uuid = crypto.createHash("sha256").update(new Date().getTime().toString() + uniqid() + clientToRequest).digest("hex");
                //this.logs[clientId] = `Request message: ${uuid}`;

                // eslint-disable-next-line no-console
                // logger.info(`Send request to ${clientToRequest} - ${uuid}`);

                this.pub.publish(this.namespace, JSON.stringify({
                    type: "request",                
                    to: clientToRequest,
                    sender: clientId,
                    //uuid,
                    data                
                }));
            }
            else{
                this.clients[clientId].emit("message", JSON.stringify({ status: 500, message: "Don't has crawler clients connected"}));
            }            
        });

        this.clients[clientId].on("feedback", (data) => {
            this.logs[clientId] = `Recive feeback: ${data.uuid}`;
            data.type = "feedback";
            this.pub.publish(this.namespace, JSON.stringify(data));
        });

        /*this.clients[clientId].on("ping", () => {
            this.clients[clientId].emit("pong");
        });*/

        this.clients[clientId].on("pong", () => {
            this.pub.publish(this.namespace, JSON.stringify({
                type: "ping",
                clientId
            }));
        });

        this.clients[clientId].on("disconnect", (reason) => {
            logger.info(`disconnect: ${reason}`);

            if(this.crowIds.includes(clientId)){
                delete this.crowIds[this.crowIds.indexOf(clientId)];
                this.crowIds = this.crowIds.filter((item) => item);
            }  

            if(this.clients[clientId])
                delete this.clients[clientId];

            /*let clients = {};

            for(let key in this.clients){
                if(this.clients[key].connected)
                    clients[key] = this.clients[key];
            }

            this.clients = clients;*/

            this.pub.publish(this.namespace, JSON.stringify({
                type: "disconnected",
                clientId
            }));

            clearInterval(pingSocketInterval);
        });

        /*this.pub.publish(this.namespace, JSON.stringify({
            type: "connection",
            clientId
        }));*/

        //Garbage collector clients
        /*setInterval(() => {
            let clients = {};

            for(let key in this.clients){
                if(this.clients[key].connected)
                    clients[key] = this.clients[key];
            }

            this.clients = clients;
        }, 40000);*/
        
        //logger.info(`Connect ${clientId}`);
    }

    __RandomMinMax(min, max){
        return Math.floor(Math.random() * (max - min) ) + min;
    }

    connectError(){
        //logger.error("connectError");
    }

    connectTimeout(){
        //logger.error("connectTimeout");
    }

    disconnect(){
        //logger.error("disconnect");
    }

    error(){
        //logger.error("error");
    }

    reconnecting(){
        //logger.error("reconnecting");
    }

    listen(port){
        this.server.listen(port, () => logger.info(`listen ${port}`));
    }
}