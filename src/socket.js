import SocketIO from "socket.io";
import uniqid from "uniqid";
import md5 from "md5";
import redis from "redis";
import zlib from "zlib";
import os from "os";
import gc from "expose-gc/function";

import { logger, rabbitmq } from "@dekproject/scope";

setInterval(() => {
    gc();
}, 30000);

export default class Socket {
    constructor(app){
        this.rabbitMQChannel = rabbitmq().createChannel({ json: true });
        this.namespace = "master";
        this.clients = {};
        this.crawlers = {};
        this.dashs = [];
        this.logs = {};
        this.server = require("http").createServer(app);
        this.requestCounter = 0;
        this.requestsPerSecounds = 0;
        this.reports = {};

        this.createRabbitMQWrapper();
        this.createPubSub();
        this.createSocket();

        setInterval(() => {
            this.pub.publish("report", JSON.stringify({
                type: "report",
                host: `${os.hostname()}:${process.env.PORT}`,
                crows: Object.keys(this.crawlers).length,
                clients: Object.keys(this.clients).length,
                requests: this.requestsPerSecounds
            }));
        }, 1000);

        setInterval(() => {
            this.requestsPerSecounds = this.requestCounter;
            this.requestCounter = 0;
        }, 1000);
    }

    createRabbitMQWrapper(){
        let channelWrapper = rabbitmq({ reconnectTimeInSecond: 1 }).createChannel({
            json: true,
            setup: (channel) => {
                return Promise.all([
                    channel.assertQueue("request", { autoDelete: false, durable: true }),
                    channel.prefetch(1),
                    channel.consume("request", async (msg) => {
                        try{
                            this.requestCounter++;

                            let data = JSON.parse(msg.content.toString());
                            //logger.info(`rabbitmq: recive message request ${data.sender}`);

                            if(Object.keys(this.crawlers).length > 0){
                                let crawlersKeys = Object.keys(this.crawlers);
                                let randomCrawler = crawlersKeys[this.__RandomMinMax(0, crawlersKeys.length)];
                                logger.info(`rabbitmq: send request ${data.sender} to ${randomCrawler}`);
                                data = JSON.stringify(data);
                                await this.crawlers[randomCrawler].emit("message", data); 
                            }

                            data = null;  

                            //setTimeout(() => {
                            channelWrapper.ack(msg);
                            //}, 5000);                        
                        }
                        catch(err){ 
                            logger.error(err.message); 
                            channelWrapper.ack(msg);
                        }
                    }, { noAck: false })
                ]);
            }
        });
    }

    async createPubSub(){
        this.pub = await redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });
        this.sub = redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });

        this.sub.on("message", async (channel, message) => {            
            message = JSON.parse(message);
            const sender = message.sender;
            
            if(this.clients[message.sender]){
                this.requestCounter++;

                if (typeof message.body === "string" && message.body) {
                    message.body = zlib.gzipSync(message.body).toString("hex");
                }

                message.type = "feedback";
                message = JSON.stringify(message);
                await this.clients[sender].emit("message", message);
                message = null;
            }                  
        }); 

        return true;
    }

    createSocket(){
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

        this.io.sockets.on("connection", this.socketConnection.bind(this));
    }

    socketConnection(socket){
        const clientId = uniqid();
        //const clientId = socket.handshake.headers["x-forwarded-for"] || socket.handshake.headers["x-real-ip"] || socket.handshake.address;
        
        if(this.clients[clientId] && this.clients[clientId].conneted)
            this.clients[clientId].disconnect();
        
        this.clients[clientId] = socket;
        this.sub.subscribe(clientId);
        let subDash = null;
        //let auth = false;

        //logger.info(`${clientId}`);      

        this.clients[clientId].on("site", () => {
            //auth = true;
            logger.info(`join site: ${clientId}`);      
        });
        
        this.clients[clientId].on("join", () => {
            //auth = true;
            //logger.info(`join crawler: ${clientId}`);
            this.crawlers[clientId] = this.clients[clientId];           
        });

        /*this.clients[clientId].on("joinCrw", () => {
            auth = true;
            //logger.info(`join crawler: ${clientId}`);
            this.crawlers[clientId] = this.clients[clientId];           
        });*/

        this.clients[clientId].on("dash", () => {
            //auth = true;
            logger.info(`join dashboard: ${clientId}`);
            subDash = redis.createClient({ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT });
            subDash.subscribe("report");
            subDash.on("message", (channel, message) => {
                this.clients[clientId].emit("report", message);
            });
        });
        
        this.clients[clientId].on("disconnect", () => {
            if(this.clients[clientId]){
                delete this.clients[clientId];
                /*let clients = {};

                for(let key in this.clients)
                    if(this.clients[key].connected)
                        clients[key] = this.clients;

                this.clients = clients;*/
            }
                
            if(this.crawlers[clientId]){
                delete this.crawlers[clientId];

                /*let crawlers = {};

                for(let key in this.crawlers)
                    if(this.crawlers[key].connected)
                        crawlers[key] = this.crawlers;

                this.crawlers = crawlers;*/
                //this.crawlers = this.crawlers.filter((item) => item);
            }                

            if(subDash)
                subDash.quit();

            //logger.info(`disconnect: ${reason}`);
        });

        this.clients[clientId].on("request", (data) => {
            logger.info(`request: send to rabbitmq ${clientId}`);

            this.rabbitMQChannel.sendToQueue("request", {
                type: "request",
                sender: clientId,
                uuid: md5(new Date().getTime()),
                data
            });
        });

        this.clients[clientId].on("feedback", async (data) => {
            //logger.info(`feedback: ${data.sender}`);
            const sender = data.sender;

            data.type = "feedback";            
            data = JSON.stringify(data);
            await this.pub.publish(sender, data);
            data = null;
        });
    }

    __RandomMinMax(min, max){
        return Math.floor(Math.random() * (max - min) ) + min;
    }

    listen(port){
        this.server.listen(port, () => logger.info(`listen ${port}`));
    }
}