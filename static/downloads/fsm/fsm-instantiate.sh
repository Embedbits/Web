#!/usr/bin/env bash
# Creates a state machine module from the template.
# Usage: fsm-instantiate.sh <Module> [template] [output folder]
#   fsm-instantiate.sh Heater                  -> Heater.c
#   fsm-instantiate.sh Heater FsmTemplate.cpp  -> Heater.cpp (and Heater.hpp from FsmTemplate.hpp)
set -euo pipefail

module="$1"
template="${2:-FsmTemplate.c}"
folder="${3:-.}"

lower="$(tr '[:upper:]' '[:lower:]' <<< "${module:0:1}")${module:1}"   # heater, heaterControl
upper="$(tr '[:lower:]' '[:upper:]' <<< "$module")"                    # HEATER, HEATERCONTROL

extension="${template##*.}"
base="${template%.*}"

for file in "$template" "${base}.hpp"; do
    [ -f "$file" ] || continue
    out="$folder/${module}.${file##*.}"
    sed -e "s/<Module>/${module}/g" -e "s/<module>/${lower}/g" -e "s/<MODULE>/${upper}/g" "$file" > "$out"
    echo "created $out"
    [ "$extension" = "c" ] && break
done

if [ "$extension" = "cpp" ] && [ -f "$(dirname "$template")/Fsm.hpp" ]; then
    cp "$(dirname "$template")/Fsm.hpp" "$folder/Fsm.hpp"
    echo "created $folder/Fsm.hpp"
fi
