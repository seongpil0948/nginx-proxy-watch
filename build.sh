#!/bin/bash

docker build -t docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.1 .
# docker tag nginx-proxy-watch docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.0
docker push docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.1
