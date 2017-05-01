#!/usr/bin/env bash

shopt -s extglob # allow for complex regex like globs

NODE_VERSION="$(node --version)"

if [[ "${NODE_VERSION:0:6}" != "v0.10." && "${NODE_VERSION:0:6}" != "v0.12." ]]; then
  standard || exit $?;
fi

for file in test/!(_*).js; do
  node "$file" || exit $?;
done

for file in test/instrumentation/!(_*).js; do
  node "$file" || exit $?;
done

for file in test/instrumentation/modules/!(_*).js; do
  node "$file" || exit $?;
done

for file in test/instrumentation/modules/mysql/!(_*).js; do
  node "$file" || exit $?;
done
