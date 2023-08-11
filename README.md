Socket Cluster

## Cluster 

Para configurar multiplos servidores de websocket
para criar um loadbalance no Nginx, para
mais informações acesse https://socket.io/docs/using-multiple-nodes/

```
$ sudo nano /etc/nginx/site-enable/wscluster
```

Caso utilize Mac OS

``` 
$ sudo nano /usr/local/etc/nginx/nginx.conf
```

```
http {
    server {
        listen 5559;
        server_name wscluster;

        location / {
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header Host $host;

            proxy_pass http://nodes;

            # enable WebSockets
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }

    upstream nodes {
        # enable sticky session based on IP
        ip_hash;

        server localhost:5501;
        server localhost:5502;
        server localhost:5503;
    }
}
```

## 1mm de Sockets

Para aguentar uma grande quantidade de sockets simultâneo 
será necessário realizar algumas configurações no OS: 

/etc/security/limits.d/custom.conf
```
root soft nofile 1000000
root hard nofile 1000000
* soft nofile 1000000
* hard nofile 1000000
```

/etc/sysctl.conf
```
fs.file-max = 1000000
fs.nr_open = 1000000       
net.ipv4.netfilter.ip_conntrack_max = 1048576
net.nf_conntrack_max = 1048576
```

## Build

```bash
$ yarn build
```

## Dev Mode

```bash
$ yarn dev
```

## Prod

Ps.: Favor não usar NPM INSTALL + YARN BUILD

```bash
$ yarn build
$ yarn start
```
Ou 

```bash
$ yarn build
$ NODE_ENV=production NODE_NO_WARNINGS=1 /usr/local/bin/node --unhandled-rejections=none --nouse-idle-notification --expose-gc  --max-old-space-size=8192 build/index.js 
```