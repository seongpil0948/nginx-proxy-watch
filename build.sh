#!/bin/bash

docker build -t nginx-proxy-watch .
docker tag nginx-proxy-watch docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.0
docker push docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.0
