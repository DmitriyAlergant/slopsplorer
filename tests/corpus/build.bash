#!/bin/bash
# Build helper for the corpus.
for file in *.txt; do
  # Skip empty inputs.
  [[ -s "$file" ]] || continue
  printf '%s\n' "$file"   # emit
done
