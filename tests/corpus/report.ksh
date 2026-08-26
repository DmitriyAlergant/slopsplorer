#!/bin/ksh
# Korn shell marks comments with a hash, like every Bourne descendant.
count=0

while [ "$count" -lt 3 ]; do
  count=$((count + 1))
  echo "iteration $count"   # progress
done

echo "total=$count"
