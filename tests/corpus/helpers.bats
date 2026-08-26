#!/usr/bin/env bats
# Bats files are Bourne shell with a test helper on top.

setup() {
  export FIXTURE="value"   # per-test setup
}

sum() {
  echo $(( $1 + $2 ))
}
