#!/usr/bin/env bash

if [ "$TRAVIS" != "true" ]; then
  pg_ctl -D /usr/local/var/postgres start
  mongod --fork --config /usr/local/etc/mongod.conf --pidfilepath /tmp/mongod.pid >/tmp/mongod.log 2>&1
  redis-server /usr/local/etc/redis.conf --daemonize yes
  mysql.server start
fi
