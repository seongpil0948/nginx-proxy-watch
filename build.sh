#!/bin/bash

VERSION=1.3
docker build -t docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.3 .
# docker tag nginx-proxy-watch docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.0
docker push docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.3
