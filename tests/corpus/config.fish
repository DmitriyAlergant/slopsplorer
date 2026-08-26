#!/usr/bin/env fish
# Fish is not Bourne shell, so it takes the marker fallback.
set -gx EDITOR vim

function greet
    echo "hello # not a comment"   # trailing
end
