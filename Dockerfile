FROM node:12

ENV REDIS_HOST=
ENV REDIS_PORT=6379
ENV REDIS_SLAVES=redis-master:6379

ENV MONGO_HOST=
ENV MONGO_PORT=27017
ENV MONGO_DB=

WORKDIR /opt/wscluster

RUN rm /etc/localtime
RUN ln /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime

COPY nodemon.json ./
COPY package.json ./
COPY src ./src
COPY static ./static
COPY .babelrc ./.babelrc
#COPY .env ./.env

RUN npm install
RUN npm run build

EXPOSE 5559
ENTRYPOINT [ "npm", "start" ]