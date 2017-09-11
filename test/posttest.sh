#!/usr/bin/env bash

if [ "$TRAVIS" != "true" ]; then
  pg_ctl -D /usr/local/var/postgres stop
  kill `cat /tmp/mongod.pid`
  redis-cli shutdown
  mysql.server stop
fi
