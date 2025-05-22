#!/bin/bash

VERSION=2.0.4
docker build -t docker.shop.co.kr/theshop-front/nginx-proxy-watch:$VERSION .
# docker tag nginx-proxy-watch docker.shop.co.kr/theshop-front/nginx-proxy-watch:1.0
docker push docker.shop.co.kr/theshop-front/nginx-proxy-watch:$VERSION
