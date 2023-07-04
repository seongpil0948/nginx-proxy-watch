#!/bin/bash

function process() {

  PROXY_HOST=$(docker inspect theshop_front_seller-blue_1 | jq -r '.[] | .Config.Env[] | (select(contains("VIRTUAL_HOST"))) | split("=") | .[1]')
  INFO=$(docker inspect $(docker ps -a -q) | jq "[.[] | select(.Config.Env[] | contains(\"VIRTUAL_HOST=${PROXY_HOST}\")) | { \"id\": .Id, \"ip\": .NetworkSettings.IPAddress, \"name\": .Name, \"status\": .State.Status, \"env\": ([.Config.Env[] | split(\"=\") | { (.[0]): .[1] } ] | add) } ]")
  JSON=$(echo "$INFO" | jq 'group_by(.env.VIRTUAL_HOST) | map({ servername: (.[0].env.VIRTUAL_HOST), IPs: [ .[] | .ip + ":" + .env.VIRTUAL_PORT  ] })[]')

set -x
  ejs ../templates/upstream-template.ejs -i "$JSON" -o upstream-"$PROXY_HOST".conf
#  ejs ../templates/vhost-template.ejs -i "$JSON" -o /app/conf.d/vhost/vhost-"$PROXY_HOST".conf

#  ENVS=$(docker inspect "$1" | jq -r '.[].Config.Env[]')
#  IS_TARGET=$(echo "$ENVS" | grep "VIRTUAL_HOST" | wc -l)
#  # shellcheck disable=SC2046
#  echo "$IS_TARGET" > ~/$(date +%Y%m%d%H%M%S).log
}

(docker events --filter "event=start" --filter "event=stop" --format '{{.ID}}' &) | while read event
do
  process $event
done
